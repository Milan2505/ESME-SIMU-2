// Périphériques (lot 2, décisions du 21/11/2026) : correspondance Gamepad API -> fonctions du jeu (js/GamepadMapping.js),
// lecture par image et fronts (js/Gamepads.js), axes appliqués directement dans PlaneControls (sans la montée
// progressive du clavier), freins différentiels, profils dans localStorage, export et import JSON, préréglages
// Logitech/Saitek, Thrustmaster et manette Xbox reconnus par leur identifiant
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from 'three';
import {
    shapeAxis, readHat, readControls, brakeCommands, presetFor, vendorProduct, deviceName, detectMove, snapshot,
    GamepadProfiles, PROFILES_KEY, functionsFor, sanitizeBinding,
} from '../js/GamepadMapping.js';
import { Gamepads } from '../js/Gamepads.js';
import { RigidBodyModel } from '../js/RigidBodyModel.js';
import { CESSNA_172 } from '../js/Cessna172.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const button = (value = 0) => ({ pressed: value > 0.5, touched: value > 0, value });
const pad = (id, { axes = 10, buttons = 16, mapping = '', index = 0 } = {}) => ({
    id, index, mapping, connected: true, axes: new Array(axes).fill(0), buttons: Array.from({ length: buttons }, () => button()),
});
const YOKE = 'Saitek Pro Flight Yoke (Vendor: 06a3 Product: 0bac)';
const PEDALS = 'Saitek Pro Flight Rudder Pedals (Vendor: 06a3 Product: 0763)';
function storage(saved) {
    const data = new Map(saved ? [[PROFILES_KEY, JSON.stringify(saved)]] : []);
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
}
afterEach(() => { delete globalThis.window; });

test('axe centré : zone morte, inversion, courbe, sensibilité', () => {
    near(shapeAxis(0.04), 0);                                   // dans la zone morte (5 %)
    near(shapeAxis(1), 1);
    near(shapeAxis(-1), -1);
    near(shapeAxis(0.525), 0.5);                                // (0,525 - 0,05) / 0,95
    near(shapeAxis(0.5, { invert: true, deadzone: 0 }), -0.5);
    near(shapeAxis(0.5, { deadzone: 0, curve: 1 }), 0.125);     // cubique : plus fin au centre
    near(shapeAxis(1, { deadzone: 0, curve: 1 }), 1);           // butée inchangée
    near(shapeAxis(0.4, { deadzone: 0, sensitivity: 2 }), 0.8);
    near(shapeAxis(0.8, { deadzone: 0, sensitivity: 2 }), 1);   // borné
});

test('axe de 0 à 1 (gaz, frein) : brut -1 = 0, +1 = 1 ; levier inversé', () => {
    near(shapeAxis(-1, {}, 'unit'), 0);
    near(shapeAxis(1, {}, 'unit'), 1);
    near(shapeAxis(-1, { invert: true }, 'unit'), 1);
    near(shapeAxis(0, { deadzone: 0 }, 'unit'), 0.5);
    near(shapeAxis(-0.97, {}, 'unit'), 0);                       // pédale de frein au repos : zone morte
});

test('chapeau chinois : axe à 8 positions (centre hors plage) et croix d\'une manette standard', () => {
    const p = pad(YOKE);
    const hat = (v) => { p.axes[9] = v; return readHat(p, { hat: 9 }); };
    assert.deepEqual(hat(1.2857), { x: 0, y: 0 });
    assert.deepEqual(hat(-1), { x: 0, y: 1 });          // haut
    assert.deepEqual(hat(-1 + 4 / 7), { x: 1, y: 0 });  // droite
    assert.deepEqual(hat(-1 + 8 / 7), { x: 0, y: -1 }); // bas
    assert.deepEqual(hat(1 - 2 / 7), { x: -1, y: 0 });  // gauche
    assert.deepEqual(hat(1), { x: -1, y: 1 });          // haut gauche
    const x = pad('Xbox 360 Controller (XInput STANDARD GAMEPAD)', { buttons: 17, mapping: 'standard' });
    x.buttons[12] = button(1);
    x.buttons[15] = button(1);
    assert.deepEqual(readHat(x, { dpad: 12 }), { x: 1, y: 1 });
});

test('préréglages reconnus par l\'identifiant (Chrome, Firefox, XInput, disposition standard)', () => {
    assert.equal(vendorProduct(YOKE), '06a3:0bac');
    assert.equal(vendorProduct('6a3-bac-Saitek Pro Flight Yoke'), '06a3:0bac');
    assert.equal(presetFor(pad(YOKE)).id, 'saitek-yoke');
    assert.equal(presetFor(pad('6a3-763-Saitek Pro Flight Rudder Pedals')).id, 'saitek-rudder');
    assert.equal(presetFor(pad('T.16000M (Vendor: 044f Product: b10a)')).id, 't16000m');
    assert.equal(presetFor(pad('T-Rudder (Vendor: 044f Product: b679)')).id, 'tfrp');
    assert.equal(presetFor(pad('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).id, 'xbox');
    assert.equal(presetFor(pad('xinput')).id, 'xbox');
    assert.equal(presetFor(pad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', { mapping: 'standard' })).id, 'xbox');
    assert.equal(presetFor(pad('Manette inconnue (Vendor: 1234 Product: 5678)', { mapping: 'standard' })).id, 'xbox');
    assert.equal(presetFor(pad('Manche inconnu (Vendor: 1234 Product: 5678)')), null);
    assert.equal(deviceName(YOKE), 'Saitek Pro Flight Yoke');
    assert.equal(deviceName('6a3-bac-Saitek Pro Flight Yoke'), 'Saitek Pro Flight Yoke');
});

test('yoke + palonnier en même temps : axes, gaz, freins différentiels, chapeau chinois', () => {
    const profiles = new GamepadProfiles(storage());
    const yoke = pad(YOKE), pedals = pad(PEDALS, { axes: 6, buttons: 0, index: 1 });
    yoke.axes[0] = 0.525; yoke.axes[1] = -1; yoke.axes[2] = -1; yoke.axes[9] = -1;
    pedals.axes[0] = 1; pedals.axes[1] = -1; pedals.axes[5] = -1;
    const s = readControls([yoke, null, pedals], (p) => profiles.bindingsFor(p), 'c172');
    near(s.axes.roll, 0.5);
    near(s.axes.pitch, -1);
    near(s.axes.throttle, 1);            // levier poussé : plein gaz
    near(s.axes.yaw, -1);
    assert.equal(s.axes.collective, undefined);   // fonctions d'un autre appareil : pas lues
    assert.deepEqual(s.look, { x: 0, y: 1 });
    assert.deepEqual(brakeCommands(s.axes, s.buttons), { left: 1, right: 0, differential: true });
    // R44 : le même levier devient le collectif
    near(readControls([yoke], (p) => profiles.bindingsFor(p), 'r44').axes.collective, 1);
});

test('freins : un seul axe = les deux roues ; bouton = les deux roues à fond', () => {
    assert.deepEqual(brakeCommands({ brakeRight: 0.4 }, {}), { left: 0.4, right: 0.4, differential: false });
    assert.deepEqual(brakeCommands({}, { brake: 1 }), { left: 1, right: 1, differential: false });
    assert.deepEqual(brakeCommands({ brakeLeft: 0.2, brakeRight: 0 }, { brake: 1 }), { left: 1, right: 1, differential: true });
});

test('manette Xbox : stick, gâchettes analogiques (gaz tenus), boutons', () => {
    const profiles = new GamepadProfiles(storage());
    const x = pad('Xbox 360 Controller (XInput STANDARD GAMEPAD)', { axes: 4, buttons: 17, mapping: 'standard' });
    x.axes[1] = 0.1;                    // dans la zone morte de la manette (12 %)
    x.buttons[7] = button(0.6);         // RT à 60 %
    x.buttons[0] = button(1);           // A : tir
    const s = readControls([x], (p) => profiles.bindingsFor(p), 'f15');
    near(s.axes.pitch, 0);
    near(s.buttons.throttleUp, 0.6);
    assert.equal(s.buttons.fire, 1);
    assert.equal(readControls([x], (p) => profiles.bindingsFor(p), 'c172').buttons.fire, undefined);   // tir : F-15 seulement
});

test('fonctions montrées selon l\'appareil choisi au hangar', () => {
    const ids = (a) => functionsFor(a).map((f) => f.id);
    assert.ok(ids('c172').includes('mixture') && ids('c172').includes('throttle') && !ids('c172').includes('fire'));
    assert.ok(ids('r44').includes('collective') && !ids('r44').includes('flapsDown') && !ids('r44').includes('throttle'));
    assert.ok(ids('f15').includes('thrust') && ids('f15').includes('fire') && !ids('f15').includes('mixture'));
});

test('« Assigner » : axe bougé (sens déduit pour un levier), bouton, chapeau chinois', () => {
    const yoke = pad(YOKE);
    yoke.axes[9] = 1.2857;
    let before = snapshot([yoke]);
    yoke.axes[3] = -0.2;
    assert.equal(detectMove(before, [yoke], 'axis'), null);                 // trop peu
    yoke.axes[3] = -0.8;
    assert.deepEqual(detectMove(before, [yoke], 'axis', 'unit'), { index: 0, binding: { axis: 3, invert: true } });
    assert.deepEqual(detectMove(before, [yoke], 'axis', 'centre'), { index: 0, binding: { axis: 3 } });
    before = snapshot([yoke]);
    yoke.buttons[4] = button(1);
    assert.deepEqual(detectMove(before, [yoke], 'button'), { index: 0, binding: { button: 4 } });
    before = snapshot([yoke]);
    yoke.axes[9] = -1;
    assert.equal(detectMove(before, [yoke], 'axis'), null);                 // le chapeau chinois n'est pas un axe
    assert.deepEqual(detectMove(before, [yoke], 'hat'), { index: 0, binding: { hat: 9 } });
});

test('profils : localStorage par périphérique, préréglage par défaut, retour au préréglage, mode test sans écriture', () => {
    const store = storage();
    const profiles = new GamepadProfiles(store);
    const yoke = pad(YOKE), pedals = pad(PEDALS, { axes: 6, index: 1 });
    assert.equal(profiles.bindingsFor(yoke).throttle.axis, 2);
    // Le gaz passe sur le palonnier : retiré du yoke (une commande n'est jamais lue deux fois)
    profiles.assign(pedals, 'throttle', { axis: 3 }, [yoke, pedals]);
    profiles.tune(pedals, 'throttle', { deadzone: 0.1, curve: 0.5, sensitivity: 9 });
    assert.equal(profiles.bindingsFor(yoke).throttle, undefined);
    assert.equal(profiles.bindingsFor(yoke).pitch.axis, 1);                 // le reste du préréglage est gardé
    assert.deepEqual(profiles.bindingsFor(pedals).throttle, { axis: 3, deadzone: 0.1, curve: 0.5, sensitivity: 3 });
    const reloaded = new GamepadProfiles(store);
    assert.deepEqual(reloaded.bindingsFor(pedals).throttle, { axis: 3, deadzone: 0.1, curve: 0.5, sensitivity: 3 });
    reloaded.reset(yoke);
    assert.equal(new GamepadProfiles(store).bindingsFor(yoke).throttle.axis, 2);
    // persist = false (mode test) : rien n'est écrit
    const quiet = new GamepadProfiles(storage());
    quiet.persist = false;
    quiet.assign(yoke, 'mixture', { axis: 3 });
    assert.equal(quiet.storage.data.size, 0);
    // Stockage illisible : préréglages
    const broken = { getItem: () => '{pas du json', setItem: () => {} };
    assert.equal(new GamepadProfiles(broken).bindingsFor(yoke).pitch.axis, 1);
});

test('export et import JSON : profils repris, fichier invalide refusé, valeurs bornées', () => {
    const a = new GamepadProfiles(storage());
    const yoke = pad(YOKE);
    a.assign(yoke, 'yaw', { axis: 5, invert: true });
    const text = a.export();
    const b = new GamepadProfiles(storage());
    assert.equal(b.import(text), 1);
    assert.deepEqual(b.bindingsFor(yoke).yaw, { axis: 5, invert: true });
    assert.throws(() => b.import('pas du json'), /illisible/);
    assert.throws(() => b.import('{"format":"autre"}'), /pas un export/);
    assert.throws(() => b.import('{"format":"esme-peripheriques","version":9}'), /Version/);
    const odd = JSON.stringify({ format: 'esme-peripheriques', version: 1, profiles: { X: { bindings: { pitch: { axis: 1, deadzone: 4, script: 'x' }, inconnue: { axis: 0 }, look: { axis: 2 } } } } });
    b.import(odd);
    assert.deepEqual(b.profiles.X.bindings, { pitch: { axis: 1, deadzone: 0.5 } });
    assert.equal(sanitizeBinding('pitch', { axis: -1 }), null);
});

test('lecture par image : branchement à chaud, fronts des boutons, écoute « Assigner »', () => {
    const list = [];
    const gamepads = new Gamepads(new GamepadProfiles(storage()), () => list);
    gamepads.aircraft = 'c172';
    const changes = [];
    gamepads.addEventListener('change', ({ detail }) => changes.push(detail.added.map((p) => p.id)));
    gamepads.poll();
    assert.equal(changes.length, 0);
    const t16 = pad('T.16000M (Vendor: 044f Product: b10a)');
    list.push(t16);
    gamepads.poll();
    assert.deepEqual(changes, [[t16.id]]);
    t16.buttons[3] = button(1);   // volets : sortir
    gamepads.poll();
    assert.ok(gamepads.takeEdges().pressed.has('flapsDown'));
    gamepads.poll();
    assert.equal(gamepads.takeEdges().pressed.size, 0);   // tenu : un seul front
    t16.buttons[3] = button(0);
    gamepads.poll();
    assert.ok(gamepads.takeEdges().released.has('flapsDown'));
    let heard = null;
    gamepads.listen('axis', 'unit', (found) => { heard = found; });
    t16.axes[6] = -1;
    gamepads.poll();
    assert.equal(heard.pad, t16);
    assert.deepEqual(heard.binding, { axis: 6, invert: true });
    list.length = 0;
    gamepads.poll();
    assert.equal(gamepads.pads.length, 0);
    assert.deepEqual(gamepads.state.axes, {});
});

// PlaneControls écoute le clavier de la fenêtre : un faux window suffit hors navigateur
async function planeControls() {
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    const { PlaneControls } = await import('../js/PlaneControls.js');
    const object = new Object3D();
    const controls = new PlaneControls(object);
    const model = new RigidBodyModel(object, { ...CESSNA_172 });
    model.groundHeight = () => 0;
    model.surfaceAt = () => 'asphalt';
    controls.useModel(model);
    model.placeOnGround();
    model.restart(true);
    return { controls, model };
}

test('modèle réaliste : un axe arrive tout de suite à la gouverne (pas de montée progressive), le clavier garde la sienne', async () => {
    const { controls, model } = await planeControls();
    controls.setAxisInput({ pitch: 0.6, roll: -0.3, yaw: 0.2 });
    controls.update(1 / 60);
    near(model.controls.pitch, 0.6);
    near(model.controls.roll, -0.3);
    near(model.controls.yaw, 0.2);
    near(controls.getInputs().pitch, 0.6);   // manche de la cabine : même position
    controls.setAxisInput(null);
    controls.update(1 / 60);
    near(model.controls.pitch, 0, 1e-6);
    // Clavier (Z / S) : montée progressive (InputRamp), loin de la butée après une image
    controls.setTouchInput({ pitch: 1 });
    controls.update(1 / 60);
    assert.ok(model.controls.pitch > 0 && model.controls.pitch < 0.1, `clavier : ${model.controls.pitch}`);
});

test('freins des pédales : roue par roue sur le modèle réaliste ; gaz et trim tenus des boutons', async () => {
    const { controls, model } = await planeControls();
    model.throttle = 0;
    const trim = model.trim;
    controls.setAxisInput({ brakeLeft: 0.8, brakeRight: 0, accel: 1, trim: 1 });
    controls.update(0.1);
    assert.equal(model.controls.brakeLeft, 0.8);
    assert.equal(model.controls.brakeRight, 0);
    assert.equal(model.controls.brake, 0);   // pas de frein des deux roues : le différentiel fait tourner
    near(model.throttle, 0.1, 1e-9);
    assert.ok(model.trim > trim);
    assert.equal(controls.getInputs().toeBrake, 0.8);
});
