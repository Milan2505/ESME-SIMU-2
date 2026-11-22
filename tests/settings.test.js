// Réglages (js/Settings.js) : modèle de vol du Cessna réaliste par défaut (21/11/2026), simplifié toujours au choix ;
// sauvegardes d'avant la version 3 (où le simplifié était le défaut, enregistré sans être choisi) -> réaliste
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Settings } from '../js/Settings.js';

const KEY = 'esme-fs-reglages';
function storage(saved) {
    const data = new Map(saved ? [[KEY, JSON.stringify(saved)]] : []);
    globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
}
afterEach(() => { delete globalThis.localStorage; });

test('modèle de vol du Cessna : réaliste par défaut, sans sauvegarde', () => {
    storage(null);
    assert.equal(new Settings().values.flightModel, 'realiste');
});

test('sauvegarde d\'avant la version 3 (simplifié, ancien défaut) : réaliste ; les autres réglages sont repris', () => {
    storage({ version: 2, preset: 'haut', values: { flightModel: 'simplifie', hud: false } });
    const settings = new Settings();
    assert.equal(settings.values.flightModel, 'realiste');
    assert.equal(settings.values.hud, false);
});

test('sauvegarde d\'avant la version 4 (douceur « Normale », ancien défaut) : « Très vive » ; choisie depuis : gardée', () => {
    storage({ version: 3, preset: 'haut', values: { controlRamp: 1, hud: false } });
    let settings = new Settings();
    assert.equal(settings.values.controlRamp, 0.25);
    assert.equal(settings.values.hud, false);
    storage({ version: 4, preset: 'haut', values: { controlRamp: 1 } });
    settings = new Settings();
    assert.equal(settings.values.controlRamp, 1);
});

test('simplifié choisi depuis la version 3 : gardé', () => {
    storage({ version: 3, preset: 'haut', values: { flightModel: 'simplifie' } });
    assert.equal(new Settings().values.flightModel, 'simplifie');
});
