// Manches, yokes, palonniers, manettes des gaz et manettes de jeu (Gamepad API, lot 2 de la feuille de route) : partie
// pure, sans navigateur (testée par tests/gamepads.test.js). Fonctions du jeu, préréglages reconnus par l'identifiant
// du périphérique, profils (un par périphérique, dans localStorage, export et import en JSON), traitement des axes
// (inversion, zone morte, courbe, sensibilité), lecture combinée de plusieurs périphériques à la fois (yoke + palonnier +
// manette des gaz), chapeau chinois, détection de la commande bougée pour « Assigner ».
// Décisions du 21/11/2026 : profils dans localStorage, export et import JSON, préréglages Logitech/Saitek, Thrustmaster
// et manette Xbox ; les axes sont appliqués directement, sans la montée progressive du clavier (InputRamp.js).

// Conventions des valeurs rendues : profondeur + = cabrer (manche tiré, axe Y+ de la Gamepad API), ailerons et direction
// + = à droite (axe X+), gaz, mixture et freins de 0 à 1. PlaneControls.setAxisInput reçoit ailerons et direction
// changés de signe (+ = à gauche, comme le clavier).
const ALL = [ 'c172', 'f15', 'r44' ];
const PLANES = [ 'c172', 'f15' ];
export const FUNCTIONS = [
	{ id: 'pitch', label: 'Profondeur', hint: 'R44 : cyclique avant / arrière', kind: 'axis', range: 'centre', aircraft: ALL },
	{ id: 'roll', label: 'Ailerons', hint: 'R44 : cyclique gauche / droite', kind: 'axis', range: 'centre', aircraft: ALL },
	{ id: 'yaw', label: 'Direction (palonnier)', hint: 'au sol : roulette de nez', kind: 'axis', range: 'centre', aircraft: ALL },
	{ id: 'throttle', label: 'Gaz', kind: 'axis', range: 'unit', aircraft: [ 'c172' ] },
	{ id: 'collective', label: 'Collectif', kind: 'axis', range: 'unit', aircraft: [ 'r44' ] },
	{ id: 'thrust', label: 'Poussée', hint: 'postcombustion au-delà de 85 %', kind: 'axis', range: 'unit', aircraft: [ 'f15' ] },
	{ id: 'throttleUp', label: 'Gaz : plus', hint: 'tenu (gâchette : selon la pression)', kind: 'button', aircraft: ALL },
	{ id: 'throttleDown', label: 'Gaz : moins', hint: 'tenu', kind: 'button', aircraft: ALL },
	{ id: 'mixture', label: 'Mixture', kind: 'axis', range: 'unit', aircraft: [ 'c172' ] },
	{ id: 'brakeLeft', label: 'Frein gauche', hint: 'avec le frein droit : freinage différentiel', kind: 'axis', range: 'unit', aircraft: PLANES },
	{ id: 'brakeRight', label: 'Frein droit', hint: 'seul : freine les deux roues', kind: 'axis', range: 'unit', aircraft: PLANES },
	{ id: 'brake', label: 'Freins (bouton)', hint: 'R44 : frein rotor', kind: 'button', aircraft: ALL },
	{ id: 'trimUp', label: 'Trim à cabrer', kind: 'button', aircraft: PLANES },
	{ id: 'trimDown', label: 'Trim à piquer', kind: 'button', aircraft: PLANES },
	{ id: 'flapsDown', label: 'Volets : sortir un cran', kind: 'button', aircraft: PLANES },
	{ id: 'flapsUp', label: 'Volets : rentrer un cran', kind: 'button', aircraft: PLANES },
	{ id: 'carbHeat', label: 'Réchauffe carburateur', hint: 'tirer / repousser', kind: 'button', aircraft: [ 'c172' ] },
	{ id: 'apDisc', label: 'Pilote automatique : A/P DISC', hint: 'bouton rouge du manche', kind: 'button', aircraft: [ 'c172' ] },
	{ id: 'fire', label: 'Tir (arme choisie)', kind: 'button', aircraft: [ 'f15' ] },
	{ id: 'view', label: 'Vue cabine / extérieure', kind: 'button', aircraft: ALL },
	{ id: 'look', label: 'Regard libre', hint: 'chapeau chinois', kind: 'hat', aircraft: ALL },
];
const BY_ID = new Map( FUNCTIONS.map( ( f ) => [ f.id, f ] ) );
export const functionById = ( id ) => BY_ID.get( id );
export const functionsFor = ( aircraft ) => FUNCTIONS.filter( ( f ) => f.aircraft.includes( aircraft ) );

// Réglages d'un axe par défaut : zone morte (fraction de la course), courbe (0 = linéaire, 1 = cubique : plus fin au
// centre), sensibilité (multiplie la sortie, bornée)
export const AXIS_DEFAULTS = { centre: { deadzone: 0.05, curve: 0, sensitivity: 1 }, unit: { deadzone: 0.02, curve: 0, sensitivity: 1 } };
export const LIMITS = { deadzone: [ 0, 0.5 ], curve: [ 0, 1 ], sensitivity: [ 0.25, 3 ] };
const clamp = ( v, min, max ) => Math.min( max, Math.max( min, v ) );

// Axe brut (-1 -> 1) -> valeur de la fonction : centre (-1 -> 1) ou unit (0 -> 1 ; brut -1 = 0, brut +1 = 1)
export function shapeAxis( raw, binding = {}, range = 'centre' ) {
	const d = AXIS_DEFAULTS[ range ];
	const deadzone = binding.deadzone ?? d.deadzone, curve = binding.curve ?? d.curve, sensitivity = binding.sensitivity ?? d.sensitivity;
	let v = clamp( Number( raw ) || 0, - 1, 1 );
	if ( binding.invert ) v = - v;
	if ( range === 'unit' ) return clamp( shapeMagnitude( ( v + 1 ) / 2, deadzone, curve ) * sensitivity, 0, 1 );
	return clamp( Math.sign( v ) * shapeMagnitude( Math.abs( v ), deadzone, curve ) * sensitivity, - 1, 1 );
}
function shapeMagnitude( m, deadzone, curve ) {
	const a = m <= deadzone ? 0 : ( m - deadzone ) / ( 1 - deadzone );
	return ( 1 - curve ) * a + curve * a * a * a;
}

const buttonValue = ( pad, index ) => {
	const b = pad.buttons?.[ index ];
	if ( b === undefined || b === null ) return 0;
	if ( typeof b === 'number' ) return b;
	return b.value > 0 ? b.value : ( b.pressed ? 1 : 0 );
};

// Chapeau chinois -> { x (+ = droite), y (+ = haut) } : un axe (Chrome : 8 positions de -1 à +1 par pas de 2/7, en
// partant du haut dans le sens des aiguilles ; au centre, une valeur hors de [-1, 1]) ou la croix d'une manette à la
// disposition standard (boutons 12 à 15 : haut, bas, gauche, droite)
export function readHat( pad, binding ) {
	if ( binding.dpad !== undefined ) {
		const on = ( i ) => buttonValue( pad, binding.dpad + i ) > 0.5 ? 1 : 0;
		return { x: on( 3 ) - on( 2 ), y: on( 0 ) - on( 1 ) };
	}
	const v = pad.axes?.[ binding.hat ];
	if ( ! ( v >= - 1.05 && v <= 1.05 ) ) return { x: 0, y: 0 };
	const angle = ( Math.round( ( v + 1 ) * 3.5 ) % 8 ) * Math.PI / 4;
	return { x: Math.round( Math.sin( angle ) ) || 0, y: Math.round( Math.cos( angle ) ) || 0 };   // (|| 0 : jamais -0)
}

// Valeur d'une fonction d'axe : un axe, ou un bouton analogique (gâchettes d'une manette : 0 -> 1)
function axisFunctionValue( pad, binding, range ) {
	if ( binding.axis !== undefined ) {
		const raw = pad.axes?.[ binding.axis ];
		return raw === undefined ? undefined : shapeAxis( raw, binding, range );
	}
	// (bouton sur un axe centré : une seule moitié de la course, 0 -> 1)
	if ( binding.button !== undefined ) return shapeAxis( buttonValue( pad, binding.button ) * 2 - 1, { ...binding, invert: false }, 'unit' );
	return undefined;
}
// Valeur d'une fonction bouton : un bouton (0 -> 1, pression des gâchettes), ou un axe poussé au-delà de la moitié
function buttonFunctionValue( pad, binding ) {
	if ( binding.button !== undefined ) return buttonValue( pad, binding.button );
	if ( binding.axis !== undefined ) return shapeAxis( pad.axes?.[ binding.axis ] ?? - 1, binding, 'unit' ) > 0.5 ? 1 : 0;
	return 0;
}

// Lecture combinée de tous les périphériques branchés : bindingsOf(pad) rend les affectations du périphérique (profil
// ou préréglage). Axes centrés : somme bornée ; axes de 0 à 1 et boutons : le plus grand ; une fonction sans affectation
// est absente du résultat (le clavier et le tactile gardent la main)
export function readControls( pads, bindingsOf, aircraft = null ) {
	const out = { axes: {}, buttons: {}, look: { x: 0, y: 0 } };
	for ( const pad of pads ) {
		if ( ! pad || pad.connected === false ) continue;
		const bindings = bindingsOf( pad ) ?? {};
		for ( const [ id, binding ] of Object.entries( bindings ) ) {
			const f = BY_ID.get( id );
			if ( ! f || ! binding || ( aircraft && ! f.aircraft.includes( aircraft ) ) ) continue;
			if ( f.kind === 'hat' ) {
				const h = readHat( pad, binding );
				if ( h.x || h.y ) out.look = h;
			} else if ( f.kind === 'button' ) {
				out.buttons[ id ] = Math.max( out.buttons[ id ] ?? 0, buttonFunctionValue( pad, binding ) );
			} else {
				const v = axisFunctionValue( pad, binding, f.range );
				if ( v === undefined ) continue;
				out.axes[ id ] = f.range === 'centre' ? clamp( ( out.axes[ id ] ?? 0 ) + v, - 1, 1 ) : Math.max( out.axes[ id ] ?? 0, v );
			}
		}
	}
	return out;
}

// Freins : deux axes = freinage différentiel ; un seul axe = les deux roues ; bouton = les deux roues à fond
export function brakeCommands( axes, buttons ) {
	const button = buttons.brake ?? 0;
	const left = axes.brakeLeft, right = axes.brakeRight;
	if ( left !== undefined && right !== undefined ) return { left: Math.max( left, button ), right: Math.max( right, button ), differential: true };
	const single = left ?? right ?? 0;
	return { left: Math.max( single, button ), right: Math.max( single, button ), differential: false };
}

// --- Préréglages : reconnus par le couple fabricant:produit USB de l'identifiant ---
// Chrome : « Nom (Vendor: 06a3 Product: 0bac) » ou « Nom (STANDARD GAMEPAD Vendor: 045e Product: 02ea) » ; Firefox :
// « 6a3-bac-Nom » ; manettes XInput sous Windows : « Xbox 360 Controller (XInput STANDARD GAMEPAD) » ou « xinput ».
// Ordre des axes sous Chrome / Windows : X 0, Y 1, Z 2, Rx 3, Ry 4, Rz 5, curseur 6, chapeau chinois 9 (usage HID - 0x30).
// Disposition des axes et boutons tirée des noms DirectInput des fabricants et de l'usage courant : non relue sur le
// matériel (sens des leviers, numéros des boutons) ; tout se réassigne par « Assigner » dans Commandes > Périphériques.
export function vendorProduct( id = '' ) {
	const m = /Vendor: ?([0-9a-f]{1,4}) Product: ?([0-9a-f]{1,4})/i.exec( id ) ?? /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec( id );
	return m ? `${ m[ 1 ].padStart( 4, '0' ) }:${ m[ 2 ].padStart( 4, '0' ) }`.toLowerCase() : null;
}
const throttleAxis = ( binding ) => ( { throttle: binding, collective: binding, thrust: binding } );
export const PRESETS = [
	{
		id: 'saitek-yoke', label: 'Logitech / Saitek Pro Flight Yoke', usb: [ '06a3:0bac' ],
		bindings: {
			roll: { axis: 0 }, pitch: { axis: 1 },
			...throttleAxis( { axis: 2, invert: true } ),   // levier noir (gaz) ; levier poussé = brut -1 (non relu)
			mixture: { axis: 4, invert: true },              // 3e levier (rouge)
			look: { hat: 9 },
		},
	},
	{
		id: 'saitek-rudder', label: 'Logitech / Saitek Pro Flight Rudder Pedals', usb: [ '06a3:0763', '06a3:0764' ],
		bindings: { brakeLeft: { axis: 0 }, brakeRight: { axis: 1 }, yaw: { axis: 5 } },
	},
	{
		id: 't16000m', label: 'Thrustmaster T.16000M', usb: [ '044f:b10a' ],
		bindings: {
			roll: { axis: 0 }, pitch: { axis: 1 }, yaw: { axis: 5 },   // torsion du manche (Rz)
			...throttleAxis( { axis: 6, invert: true } ),               // molette des gaz (curseur)
			fire: { button: 0 }, brake: { button: 1 }, flapsUp: { button: 2 }, flapsDown: { button: 3 },
			look: { hat: 9 },
		},
	},
	{
		id: 'tfrp', label: 'Thrustmaster TFRP (palonnier)', usb: [ '044f:b679' ],
		bindings: { brakeLeft: { axis: 0 }, brakeRight: { axis: 1 }, yaw: { axis: 2 } },
	},
	{
		// Disposition standard du W3C : axes 0 / 1 stick gauche, 2 / 3 stick droit ; boutons 0 A, 1 B, 2 X, 3 Y, 4 LB,
		// 5 RB, 6 LT, 7 RT (analogiques), 8 View, 12 à 15 croix
		id: 'xbox', label: 'Manette Xbox', usb: [ '045e:028e', '045e:02ea', '045e:02dd', '045e:02e0', '045e:02fd', '045e:0b12', '045e:0b13' ],
		bindings: {
			roll: { axis: 0, deadzone: 0.12 }, pitch: { axis: 1, deadzone: 0.12 }, yaw: { axis: 2, deadzone: 0.15 },
			throttleUp: { button: 7 }, throttleDown: { button: 6 },
			fire: { button: 0 }, brake: { button: 1 }, flapsDown: { button: 2 }, flapsUp: { button: 3 },
			trimDown: { button: 4 }, trimUp: { button: 5 }, view: { button: 8 }, look: { dpad: 12 },
		},
	},
];
const XBOX = PRESETS.find( ( p ) => p.id === 'xbox' );
export function presetFor( pad ) {
	if ( ! pad ) return null;
	const usb = vendorProduct( pad.id );
	const found = usb && PRESETS.find( ( p ) => p.usb.includes( usb ) );
	if ( found ) return found;
	// Manette XInput sans identifiant USB, ou autre manette à la disposition standard : même disposition que la Xbox
	if ( /xinput|xbox/i.test( pad.id ?? '' ) || pad.mapping === 'standard' ) return XBOX;
	return null;
}
export const presetById = ( id ) => PRESETS.find( ( p ) => p.id === id ) ?? null;

// Nom court d'un périphérique (identifiant sans le suffixe technique)
export function deviceName( id = '' ) {
	const firefox = /^[0-9a-f]{1,4}-[0-9a-f]{1,4}-(.+)$/i.exec( id );
	const name = ( firefox ? firefox[ 1 ] : id.replace( /\s*\((?:[^()]*(?:Vendor|STANDARD GAMEPAD|XInput)[^()]*)\)\s*$/i, '' ) ).trim();
	return name || id || 'Périphérique';
}

// Texte d'une affectation : « axe 2 inversé », « bouton 4 », « chapeau (axe 9) », « croix »
export function bindingText( binding ) {
	if ( ! binding ) return '—';
	if ( binding.dpad !== undefined ) return 'croix';
	if ( binding.hat !== undefined ) return `chapeau (axe ${ binding.hat })`;
	if ( binding.axis !== undefined ) return `axe ${ binding.axis }${ binding.invert ? ' inversé' : '' }`;
	if ( binding.button !== undefined ) return `bouton ${ binding.button }`;
	return '—';
}

// --- Assigner : première commande bougée depuis l'instantané avant ---
export function snapshot( pads ) {
	return Array.from( pads ?? [], ( p ) => ( p ? { id: p.id, axes: Array.from( p.axes ?? [] ), buttons: Array.from( p.buttons ?? [], ( b, i ) => buttonValue( p, i ) ) } : null ) );
}
// kind : 'axis' (axe déplacé de plus d'un quart de course, ou gâchette analogique), 'button' (bouton enfoncé, ou axe
// poussé au-delà de la moitié), 'hat' (chapeau chinois quitté du centre, ou croix d'une manette standard). range 'unit' :
// sens déduit du geste (la commande est poussée vers le plein : gaz, frein enfoncé). Rend { index (du périphérique),
// binding } ou null
export function detectMove( before, pads, kind, range = 'centre' ) {
	const list = Array.from( pads ?? [] );
	for ( let i = 0; i < list.length; i ++ ) {
		const pad = list[ i ], old = before.find( ( b ) => b && pad && b.id === pad.id );
		if ( ! pad || ! old ) continue;
		const axes = Array.from( pad.axes ?? [] );
		if ( kind === 'hat' ) {
			if ( pad.mapping === 'standard' ) for ( let k = 12; k < 16; k ++ ) if ( buttonValue( pad, k ) > 0.5 && ( old.buttons[ k ] ?? 0 ) <= 0.5 ) return { index: i, binding: { dpad: 12 } };
			for ( let a = 0; a < axes.length; a ++ ) {
				const was = old.axes[ a ], now = axes[ a ];
				if ( ! ( was >= - 1.05 && was <= 1.05 ) && now >= - 1.05 && now <= 1.05 ) return { index: i, binding: { hat: a } };
			}
			continue;
		}
		const buttons = Array.from( pad.buttons ?? [], ( b, k ) => buttonValue( pad, k ) );
		for ( let k = 0; k < buttons.length; k ++ ) {
			if ( buttons[ k ] > 0.5 && ( old.buttons[ k ] ?? 0 ) <= 0.5 ) return { index: i, binding: { button: k } };
		}
		for ( let a = 0; a < axes.length; a ++ ) {
			const was = old.axes[ a ], now = axes[ a ];
			// (chapeau chinois au centre : hors de [-1, 1], jamais pris pour un axe)
			if ( ! ( was >= - 1.05 && was <= 1.05 && now >= - 1.05 && now <= 1.05 ) ) continue;
			const delta = now - was;
			if ( kind === 'button' ? Math.abs( delta ) > 1 : Math.abs( delta ) > 0.5 ) {
				const invert = ( kind === 'button' || range === 'unit' ) && delta < 0;
				return { index: i, binding: invert ? { axis: a, invert: true } : { axis: a } };
			}
		}
	}
	return null;
}

// --- Profils : un par périphérique (clé : son identifiant), dans localStorage ; export et import en JSON ---
export const PROFILES_KEY = 'esme-peripheriques';
export const PROFILES_FORMAT = 'esme-peripheriques';
export const PROFILES_VERSION = 1;

const int = ( v, max ) => Number.isInteger( v ) && v >= 0 && v <= max;
// Affectation lue d'un fichier ou du stockage : seulement les champs connus, valeurs bornées ; null si invalide
export function sanitizeBinding( functionId, b ) {
	const f = BY_ID.get( functionId );
	if ( ! f || ! b || typeof b !== 'object' ) return null;
	const out = {};
	if ( f.kind === 'hat' ) {
		if ( int( b.dpad, 124 ) ) out.dpad = b.dpad;
		else if ( int( b.hat, 63 ) ) out.hat = b.hat;
		else return null;
		return out;
	}
	if ( int( b.axis, 63 ) ) out.axis = b.axis;
	else if ( int( b.button, 127 ) ) out.button = b.button;
	else return null;
	if ( b.invert === true ) out.invert = true;
	for ( const key of [ 'deadzone', 'curve', 'sensitivity' ] ) {
		if ( typeof b[ key ] === 'number' && Number.isFinite( b[ key ] ) ) out[ key ] = clamp( b[ key ], ...LIMITS[ key ] );
	}
	return out;
}
function sanitizeProfiles( profiles ) {
	const out = {};
	if ( ! profiles || typeof profiles !== 'object' ) return out;
	for ( const [ id, profile ] of Object.entries( profiles ) ) {
		if ( typeof id !== 'string' || ! id || ! profile || typeof profile.bindings !== 'object' || profile.bindings === null ) continue;
		const bindings = {};
		for ( const [ fn, b ] of Object.entries( profile.bindings ) ) {
			const clean = sanitizeBinding( fn, b );
			if ( clean ) bindings[ fn ] = clean;
		}
		out[ id ] = { bindings };
	}
	return out;
}
const copy = ( value ) => JSON.parse( JSON.stringify( value ) );

export class GamepadProfiles {
	constructor( storage = globalThis.localStorage ) {
		this.storage = storage;
		this.persist = true;   // mode test : false (rien n'est écrit, voir simulator.js)
		this.profiles = {};
		try {
			const data = JSON.parse( storage?.getItem( PROFILES_KEY ) ?? 'null' );
			if ( data?.version === PROFILES_VERSION ) this.profiles = sanitizeProfiles( data.profiles );
		} catch { /* stockage indisponible ou illisible : préréglages */ }
	}
	_save() {
		if ( ! this.persist ) return;
		try { this.storage?.setItem( PROFILES_KEY, JSON.stringify( { version: PROFILES_VERSION, profiles: this.profiles } ) ); } catch { /* stockage plein ou interdit */ }
	}
	hasProfile( id ) { return Object.hasOwn( this.profiles, id ); }
	// Affectations d'un périphérique : son profil enregistré, sinon son préréglage, sinon rien
	bindingsFor( pad ) {
		if ( ! pad ) return {};
		return this.profiles[ pad.id ]?.bindings ?? presetFor( pad )?.bindings ?? {};
	}
	_own( pad ) {
		if ( ! this.hasProfile( pad.id ) ) this.profiles[ pad.id ] = { bindings: copy( presetFor( pad )?.bindings ?? {} ) };
		return this.profiles[ pad.id ].bindings;
	}
	// Assigne une commande du périphérique pad à la fonction ; la fonction est retirée des autres périphériques branchés
	// (others), pour qu'une commande ne soit pas lue deux fois
	assign( pad, functionId, binding, others = [] ) {
		const clean = sanitizeBinding( functionId, binding );
		if ( ! clean ) return false;
		for ( const other of others ) if ( other && other.id !== pad.id && this.bindingsFor( other )[ functionId ] ) delete this._own( other )[ functionId ];
		this._own( pad )[ functionId ] = clean;
		this._save();
		return true;
	}
	clear( pad, functionId ) {
		delete this._own( pad )[ functionId ];
		this._save();
	}
	// Réglage d'un axe (invert, deadzone, curve, sensitivity)
	tune( pad, functionId, patch ) {
		const bindings = this._own( pad );
		const clean = sanitizeBinding( functionId, { ...bindings[ functionId ], ...patch } );
		if ( ! clean ) return;
		if ( patch.invert === false ) delete clean.invert;
		bindings[ functionId ] = clean;
		this._save();
	}
	// Retour au préréglage (ou à rien) : le profil enregistré est oublié
	reset( pad ) {
		delete this.profiles[ pad.id ];
		this._save();
	}
	export() {
		return JSON.stringify( { format: PROFILES_FORMAT, version: PROFILES_VERSION, profiles: this.profiles }, null, 2 );
	}
	// Fichier exporté (ici ou sur un autre ordinateur) : ses profils remplacent ceux des mêmes périphériques ; rend le
	// nombre de profils importés ; erreur explicite si le fichier n'en est pas un
	import( text ) {
		let data;
		try { data = JSON.parse( text ); } catch { throw new Error( 'Fichier illisible : ce n\'est pas du JSON.' ); }
		if ( data?.format !== PROFILES_FORMAT ) throw new Error( 'Ce fichier n\'est pas un export des périphériques du simulateur.' );
		if ( data.version !== PROFILES_VERSION ) throw new Error( `Version de fichier inconnue (${ data.version }).` );
		const profiles = sanitizeProfiles( data.profiles );
		Object.assign( this.profiles, profiles );
		this._save();
		return Object.keys( profiles ).length;
	}
}
