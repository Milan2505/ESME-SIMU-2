// Périphériques de jeu branchés (Gamepad API) : lus une fois par image (poll), branchements et débranchements suivis à
// chaud (événements gamepadconnected / gamepaddisconnected, et liste relue à chaque image : Chrome ne montre un
// périphérique qu'après un premier geste, l'événement a pu partir avant le chargement). Plusieurs à la fois (yoke,
// palonnier, manette des gaz). La correspondance avec les fonctions du jeu est dans GamepadMapping.js (pure).
import { readControls, snapshot, detectMove } from './GamepadMapping.js';

const EMPTY = { axes: {}, buttons: {}, look: { x: 0, y: 0 } };

export class Gamepads extends EventTarget {
	// profiles : GamepadProfiles ; getGamepads : remplaçable (tests)
	constructor( profiles, getGamepads = () => ( typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [] ) ) {
		super();
		this.profiles = profiles;
		this.getGamepads = getGamepads;
		this.pads = [];          // périphériques branchés (objets Gamepad de l'image)
		this.state = EMPTY;      // dernière lecture combinée (readControls)
		this.aircraft = null;    // appareil piloté : seules ses fonctions sont lues
		this._previous = {};     // boutons de l'image d'avant (fronts)
		this._pressed = new Set();
		this._released = new Set();
		this._ids = '';
		this._listen = null;
		if ( typeof window !== 'undefined' ) {
			window.addEventListener( 'gamepadconnected', () => this.poll() );
			window.addEventListener( 'gamepaddisconnected', () => this.poll() );
		}
	}

	poll() {
		let list = [];
		try { list = Array.from( this.getGamepads() ?? [] ); } catch { /* API refusée (politique de permissions) */ }
		this.pads = list.filter( ( p ) => p && p.connected !== false );
		const ids = this.pads.map( ( p ) => `${ p.index }:${ p.id }` ).join( '|' );
		if ( ids !== this._ids ) {
			const before = this._ids ? this._ids.split( '|' ) : [];
			this._ids = ids;
			const added = this.pads.filter( ( p ) => ! before.includes( `${ p.index }:${ p.id }` ) );
			this.dispatchEvent( new CustomEvent( 'change', { detail: { pads: this.pads, added } } ) );
		}
		if ( this._listen ) this._checkListen();
		this.state = this.pads.length ? readControls( this.pads, ( p ) => this.profiles.bindingsFor( p ), this.aircraft ) : EMPTY;
		for ( const [ id, value ] of Object.entries( this.state.buttons ) ) {
			const was = this._previous[ id ] ?? 0;
			if ( value > 0.5 && was <= 0.5 ) this._pressed.add( id );
			if ( value <= 0.5 && was > 0.5 ) this._released.add( id );
		}
		for ( const id of Object.keys( this._previous ) ) if ( ! ( id in this.state.buttons ) && this._previous[ id ] > 0.5 ) this._released.add( id );
		this._previous = { ...this.state.buttons };
		return this.state;
	}

	// Fronts depuis le dernier appel (bouton enfoncé, relâché), puis oubliés
	takeEdges() {
		const edges = { pressed: this._pressed, released: this._released };
		this._pressed = new Set();
		this._released = new Set();
		return edges;
	}

	// « Assigner » : callback({ pad, binding }) à la première commande bougée (kind : 'axis', 'button' ou 'hat')
	listen( kind, range, callback ) {
		this._listen = { kind, range, callback, before: snapshot( this.pads ) };
	}
	cancelListen() { this._listen = null; }
	get listening() { return this._listen !== null; }
	_checkListen() {
		const l = this._listen;
		// Périphérique apparu pendant l'écoute : il entre dans l'instantané (sa position de repos n'est pas un geste)
		for ( const pad of this.pads ) if ( ! l.before.some( ( b ) => b && b.id === pad.id ) ) l.before.push( ...snapshot( [ pad ] ) );
		const found = detectMove( l.before, this.pads, l.kind, l.range );
		if ( ! found ) return;
		this._listen = null;
		l.callback( { pad: this.pads[ found.index ], binding: found.binding } );
	}
}
