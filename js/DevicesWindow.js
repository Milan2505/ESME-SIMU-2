// Fenêtre « Commandes > Périphériques » (lot 2) : périphériques branchés et leur préréglage, puis une ligne par fonction
// de l'appareil choisi au hangar (profondeur, ailerons, direction, gaz ou collectif ou poussée, mixture, freins, trim,
// volets, tir, vue, regard libre) : affectation, bouton « Assigner » (écoute la prochaine commande bougée), réglages
// des axes (inversion, zone morte, courbe, sensibilité) et barre de test en direct. Export et import des profils en JSON.
import { functionsFor, bindingText, deviceName, presetFor, AXIS_DEFAULTS, LIMITS } from './GamepadMapping.js';

const AIRCRAFT_LABELS = { c172: 'Cessna 172', f15: 'F-15', r44: 'Robinson R44' };
const LISTEN_TIMEOUT = 15000;

export class DevicesWindow {
	// dialog : <dialog id="peripheriques-dialog"> ; gamepads : Gamepads ; profiles : GamepadProfiles ; aircraft() : type
	constructor( dialog, gamepads, profiles, aircraft ) {
		this.dialog = dialog;
		this.gamepads = gamepads;
		this.profiles = profiles;
		this.aircraft = aircraft;
		this.devicesNode = dialog.querySelector( '#periph-appareils' );
		this.functionsNode = dialog.querySelector( '#periph-fonctions' );
		this.messageNode = dialog.querySelector( '#periph-message' );
		this.aircraftNode = dialog.querySelector( '#periph-avion' );
		this.listening = null;   // fonction en cours d'assignation
		this._timer = 0;
		this._frame = 0;

		dialog.querySelector( '#periph-fermer' ).addEventListener( 'click', () => dialog.close() );
		dialog.addEventListener( 'close', () => { this._stopListening(); cancelAnimationFrame( this._frame ); } );
		// Échap pendant « Assigner » : annule l'écoute sans fermer la fenêtre
		dialog.addEventListener( 'cancel', ( event ) => {
			if ( ! this.listening ) return;
			event.preventDefault();
			this._stopListening();
			this._say( 'Assignation annulée.' );
			this.render();
		} );
		dialog.querySelector( '#periph-exporter' ).addEventListener( 'click', () => this._export() );
		const file = dialog.querySelector( '#periph-fichier' );
		dialog.querySelector( '#periph-importer' ).addEventListener( 'click', () => file.click() );
		file.addEventListener( 'change', async () => {
			const chosen = file.files?.[ 0 ];
			file.value = '';
			if ( chosen ) this.importText( await chosen.text() );
		} );
		gamepads.addEventListener( 'change', () => { if ( dialog.open ) this.render(); } );
		document.addEventListener( 'aircraft-change', () => { if ( dialog.open ) this.render(); } );
	}

	open() {
		this._say( '' );
		if ( ! this.dialog.open ) this.dialog.showModal();
		this.render();
		const tick = () => {
			if ( ! this.dialog.open ) return;
			this._updateBars();
			this._frame = requestAnimationFrame( tick );
		};
		cancelAnimationFrame( this._frame );
		this._frame = requestAnimationFrame( tick );
	}

	importText( text ) {
		try {
			const count = this.profiles.import( text );
			this._say( `${ count } profil${ count > 1 ? 's' : '' } importé${ count > 1 ? 's' : '' }.` );
		} catch ( error ) {
			this._say( error.message, true );
		}
		this.render();
	}

	_export() {
		const blob = new Blob( [ this.profiles.export() ], { type: 'application/json' } );
		const link = document.createElement( 'a' );
		link.href = URL.createObjectURL( blob );
		link.download = 'esme-peripheriques.json';
		link.click();
		setTimeout( () => URL.revokeObjectURL( link.href ), 1000 );
		this._say( 'Profils exportés (esme-peripheriques.json).' );
	}

	_say( text, error = false ) {
		this.messageNode.textContent = text;
		this.messageNode.classList.toggle( 'erreur', error );
	}

	// Périphérique branché qui porte la fonction (le premier), et son affectation
	_owner( functionId ) {
		for ( const pad of this.gamepads.pads ) {
			const binding = this.profiles.bindingsFor( pad )[ functionId ];
			if ( binding ) return { pad, binding };
		}
		return null;
	}

	render() {
		const pads = this.gamepads.pads;
		const type = this.aircraft();
		this.aircraftNode.textContent = AIRCRAFT_LABELS[ type ] ?? type;

		// Périphériques branchés
		this.devicesNode.replaceChildren();
		if ( ! pads.length ) {
			const empty = document.createElement( 'p' );
			empty.className = 'periph-vide';
			empty.textContent = 'Aucun périphérique détecté. Branchez-le, puis appuyez sur un de ses boutons (le navigateur ne le montre qu\'après un premier geste).';
			this.devicesNode.append( empty );
		}
		for ( const pad of pads ) {
			const row = document.createElement( 'div' );
			row.className = 'periph-appareil';
			row.dataset.id = pad.id;
			const name = document.createElement( 'strong' );
			name.textContent = deviceName( pad.id );
			name.title = pad.id;
			const preset = presetFor( pad );
			const info = document.createElement( 'small' );
			info.textContent = ( preset ? `Préréglage : ${ preset.label }` : 'Aucun préréglage : assignez ses commandes ci-dessous' )
				+ ( this.profiles.hasProfile( pad.id ) ? ' · profil personnalisé' : '' );
			row.append( name, info );
			if ( this.profiles.hasProfile( pad.id ) ) {
				const reset = document.createElement( 'button' );
				reset.className = 'periph-secondaire';
				reset.textContent = preset ? 'Revenir au préréglage' : 'Tout effacer';
				reset.addEventListener( 'click', () => { this.profiles.reset( pad ); this.render(); } );
				row.append( reset );
			}
			this.devicesNode.append( row );
		}

		// Fonctions de l'appareil choisi
		this.functionsNode.replaceChildren();
		for ( const f of functionsFor( type ) ) this.functionsNode.append( this._functionRow( f ) );
	}

	_functionRow( f ) {
		const owner = this._owner( f.id );
		const row = document.createElement( 'div' );
		row.className = 'periph-ligne';
		row.dataset.fonction = f.id;
		row.classList.toggle( 'ecoute', this.listening === f.id );

		const name = document.createElement( 'div' );
		name.className = 'periph-nom';
		name.textContent = f.label;
		if ( f.hint ) {
			const hint = document.createElement( 'small' );
			hint.textContent = f.hint;
			name.append( hint );
		}
		const binding = document.createElement( 'div' );
		binding.className = 'periph-affectation';
		binding.textContent = owner ? `${ deviceName( owner.pad.id ) } · ${ bindingText( owner.binding ) }` : '—';

		const assign = document.createElement( 'button' );
		assign.className = 'periph-assigner';
		assign.textContent = this.listening === f.id ? 'Bougez…' : 'Assigner';
		assign.addEventListener( 'click', () => this._assign( f ) );
		const clear = document.createElement( 'button' );
		clear.className = 'periph-effacer periph-secondaire';
		clear.textContent = '×';
		clear.title = 'Effacer l\'affectation';
		clear.disabled = ! owner;
		clear.addEventListener( 'click', () => { this.profiles.clear( owner.pad, f.id ); this.render(); } );

		const test = document.createElement( 'div' );
		test.className = `periph-test periph-${ f.kind === 'axis' ? f.range : f.kind }`;
		const bar = document.createElement( 'div' );
		bar.className = 'periph-barre';
		bar.append( document.createElement( 'span' ) );
		const value = document.createElement( 'output' );
		test.append( bar, value );

		row.append( name, binding, assign, clear, test );
		if ( owner && f.kind === 'axis' && owner.binding.axis !== undefined ) row.append( this._tuning( f, owner ) );
		return row;
	}

	// Réglages d'un axe : inversion, zone morte, courbe, sensibilité (appliqués tout de suite, enregistrés)
	_tuning( f, { pad, binding } ) {
		const box = document.createElement( 'div' );
		box.className = 'periph-reglages';
		const invert = document.createElement( 'label' );
		const check = document.createElement( 'input' );
		check.type = 'checkbox';
		check.name = 'invert';
		check.checked = Boolean( binding.invert );
		check.addEventListener( 'change', () => {
			this.profiles.tune( pad, f.id, { invert: check.checked } );
			this.render();
		} );
		invert.append( check, ' Inversé' );
		box.append( invert );
		const defaults = AXIS_DEFAULTS[ f.range ];
		for ( const [ key, label, step ] of [ [ 'deadzone', 'Zone morte', 0.01 ], [ 'curve', 'Courbe', 0.05 ], [ 'sensitivity', 'Sensibilité', 0.05 ] ] ) {
			const field = document.createElement( 'label' );
			const range = document.createElement( 'input' );
			range.type = 'range';
			range.name = key;
			[ range.min, range.max ] = LIMITS[ key ];
			range.step = step;
			range.value = binding[ key ] ?? defaults[ key ];
			const shown = document.createElement( 'span' );
			const show = () => { shown.textContent = key === 'sensitivity' ? `×${ Number( range.value ).toFixed( 2 ) }` : `${ Math.round( range.value * 100 ) } %`; };
			show();
			range.addEventListener( 'input', () => { this.profiles.tune( pad, f.id, { [ key ]: Number( range.value ) } ); show(); } );
			field.append( `${ label } `, range, shown );
			box.append( field );
		}
		return box;
	}

	_assign( f ) {
		if ( this.listening === f.id ) {
			this._stopListening();
			this.render();
			return;
		}
		if ( ! this.gamepads.pads.length ) {
			this._say( 'Aucun périphérique détecté : branchez-le et appuyez sur un de ses boutons.', true );
			return;
		}
		this._stopListening();
		this.listening = f.id;
		const gesture = f.kind === 'hat' ? 'poussez le chapeau chinois (ou la croix)'
			: f.kind === 'button' ? 'appuyez sur le bouton'
				: f.range === 'unit' ? 'poussez la commande vers le plein (frein : enfoncez la pédale)' : 'bougez l\'axe d\'un bout à l\'autre';
		this._say( `« ${ f.label } » : ${ gesture }. Échap : annuler.` );
		this.gamepads.listen( f.kind, f.range ?? 'centre', ( { pad, binding } ) => {
			clearTimeout( this._timer );
			this.listening = null;
			this.profiles.assign( pad, f.id, binding, this.gamepads.pads );
			this._say( `« ${ f.label } » : ${ deviceName( pad.id ) } · ${ bindingText( binding ) }.` );
			this.render();
		} );
		this._timer = setTimeout( () => {
			if ( this.listening !== f.id ) return;
			this._stopListening();
			this._say( 'Rien n\'a bougé : assignation annulée.', true );
			this.render();
		}, LISTEN_TIMEOUT );
		this.render();
	}

	_stopListening() {
		clearTimeout( this._timer );
		this.listening = null;
		this.gamepads.cancelListen();
	}

	// Barres de test : valeur lue en direct (après inversion, zone morte, courbe et sensibilité)
	_updateBars() {
		const state = this.gamepads.state;
		for ( const row of this.functionsNode.children ) {
			const id = row.dataset.fonction;
			const fill = row.querySelector( '.periph-barre span' ), out = row.querySelector( 'output' );
			const test = row.querySelector( '.periph-test' );
			let left = 0, width = 0, text = '';
			if ( test.classList.contains( 'periph-hat' ) ) {
				const { x, y } = state.look;
				text = ( y > 0 ? '↑' : y < 0 ? '↓' : '' ) + ( x > 0 ? '→' : x < 0 ? '←' : '' ) || '·';
				width = x || y ? 100 : 0;
			} else if ( test.classList.contains( 'periph-button' ) ) {
				const v = state.buttons[ id ] ?? 0;
				width = v * 100;
				text = v > 0.5 ? 'appuyé' : '';
			} else if ( id in state.axes ) {
				const v = state.axes[ id ];
				if ( test.classList.contains( 'periph-centre' ) ) {
					left = 50 + Math.min( 0, v ) * 50;
					width = Math.abs( v ) * 50;
				} else width = v * 100;
				text = `${ Math.round( v * 100 ) } %`;
			}
			fill.style.left = `${ left }%`;
			fill.style.width = `${ width }%`;
			out.textContent = text;
		}
	}
}
