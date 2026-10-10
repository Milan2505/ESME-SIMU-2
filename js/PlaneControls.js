import {
	Controls,
	MathUtils,
	Quaternion,
	Vector3
} from 'three';
import { FlightModel } from './FlightModel.js';

// Commandes de l'avion au clavier : les touches deviennent des commandes (manche, gaz, trim, volets, freins)
// transmises au modèle de vol (FlightModel.js, la physique) ; fournit aussi les valeurs des instruments.

const _changeEvent = { type: 'change' };
const _resetEvent = { type: 'reset' };

const _EPS = 0.000001;
const _MAX_DELTA = 0.1;            // évite les sauts après un onglet en arrière-plan
const _CONTROL_SMOOTHING = 0.5;    // temps (s) pour que les gouvernes suivent les touches : mouvements arrondis
const _TRIM_RATE = MathUtils.degToRad( 5 ); // vitesse du tab de trim, touche enfoncée (d'une butée à l'autre en ~7 s)
const _up = new Vector3( 0, 1, 0 );

// Touches gérées (event.code = position physique, Z/Q/S/D en AZERTY)
const _KEYS = {
	KeyS: 'pitchUp', KeyW: 'pitchDown',
	KeyA: 'rollLeft', KeyD: 'rollRight',
	KeyQ: 'yawLeft', KeyE: 'yawRight',
	Space: 'speedup', ControlLeft: 'speeddown', ShiftLeft: 'speeddown',
	KeyB: 'brake',
	KeyZ: 'trimDown', KeyX: 'trimUp',   // W / X en AZERTY : trim à piquer / à cabrer
};

class PlaneControls extends Controls {

	constructor( object, domElement = null ) {

		super( object, domElement );

		this.model = new FlightModel( object );
		this.throttleRate = 1;
		this.parkingBrake = false;   // manette de frein de la cabine : freins serrés tant qu'elle est tirée       // variation de la manette des gaz par seconde (plein gaz en 1 s)
		// Événements du modèle de vol relayés : envol, toucher, crash
		for ( const type of [ 'liftoff', 'touchdown', 'crash' ] ) {
			this.model.addEventListener( type, ( event ) => this.dispatchEvent( { ...event } ) );
		}

		// internals
		this._moveState = {
			pitchUp: 0, pitchDown: 0,
			rollLeft: 0, rollRight: 0,
			speedup: 0, speeddown: 0,
			yawLeft: 0, yawRight: 0,
			brake: 0,
			trimDown: 0, trimUp: 0,
		};
		this.accel = 0;
		this._rotationVector = new Vector3( 0, 0, 0 );   // touches enfoncées (-1, 0 ou 1)
		this._controls = new Vector3( 0, 0, 0 );         // position réelle des gouvernes, qui suit les touches en douceur
		this._lastQuaternion = new Quaternion();
		this._lastPosition = new Vector3();
		this._savedPosition = object.position.clone();
		this._savedQuaternion = object.quaternion.clone();
		this._savedThrottle = this.model.throttle;
		this._savedOnGround = false;
		this._roll = 0;
		this._pitch_rate = 0;
		this._heading = 0;
		this._verticalSpeed = 0;

		// event listeners
		this._onKeyDown = onKeyDown.bind( this );
		this._onKeyUp = onKeyUp.bind( this );
		this._onBlur = onBlur.bind( this );
		window.addEventListener( 'keydown', this._onKeyDown );
		window.addEventListener( 'keyup', this._onKeyUp );
		window.addEventListener( 'blur', this._onBlur );
	}

	dispose() {
		window.removeEventListener( 'keydown', this._onKeyDown );
		window.removeEventListener( 'keyup', this._onKeyUp );
		window.removeEventListener( 'blur', this._onBlur );
	}

	// --- Réglages transmis au modèle de vol (environnement, aides au pilotage) ---

	get groundHeight() { return this.model.groundHeight; }
	set groundHeight( value ) { this.model.groundHeight = value; }
	get surfaceAt() { return this.model.surfaceAt; }
	set surfaceAt( value ) { this.model.surfaceAt = value; }
	get minAltitude() { return this.model.minAltitude; }
	set minAltitude( value ) { this.model.minAltitude = value; }
	get obstacles() { return this.model.obstacles; }
	set obstacles( value ) { this.model.obstacles = value; }
	get turbulence() { return this.model.turbulence; }
	set turbulence( value ) { this.model.turbulence = value; }
	get assists() { return this.model.assists; }
	get rotateSpeed() { return this.model.rotateSpeed; }
	get throttle() { return this.model.throttle; }
	set throttle( value ) { this.model.throttle = value; }
	get trim() { return this.model.trim; }
	set trim( value ) { this.model.trim = value; }
	get velocity() { return this.model.velocity; }

	// Pose l'avion sur le sol à sa position actuelle (cap conservé), moteur au ralenti
	placeOnGround() {
		this.model.placeOnGround();
	}

	// Mémorise la position actuelle comme point de départ (touche R)
	saveState() {
		this._savedPosition.copy( this.object.position );
		this._savedQuaternion.copy( this.object.quaternion );
		this._savedThrottle = this.model.throttle;
		this._savedOnGround = this.model.onGround;
	}

	reset() {
		this.object.position.copy( this._savedPosition );
		this.object.quaternion.copy( this._savedQuaternion );
		this.model.throttle = this._savedThrottle;
		this.model.restart( this._savedOnGround );
		this._controls.set( 0, 0, 0 );
		this.dispatchEvent( _resetEvent );
	}

	update( delta ) {

		if ( this.enabled === false ) return;

		delta = Math.min( delta, _MAX_DELTA );
		if ( delta <= 0 ) return;

		const object = this.object;
		const model = this.model;
		if ( model.crashed ) {
			this._verticalSpeed = 0;
			return;
		}
		const previousY = object.position.y;

		// Gouvernes : suivent les touches progressivement (une touche n'est qu'un "tout ou rien")
		this._controls.lerp( this._rotationVector, 1 - Math.exp( - delta / _CONTROL_SMOOTHING * 3 ) );
		Object.assign( model.controls, {
			pitch: this._controls.x,
			yaw: this._controls.y,
			roll: this._controls.z,
			brake: Math.max( this._moveState.brake, this.parkingBrake ? 1 : 0 ),
		} );
		model.throttle = Math.min( 1, Math.max( 0, model.throttle + this.accel * this.throttleRate * delta ) );
		model.trim = MathUtils.clamp( model.trim + ( this._moveState.trimUp - this._moveState.trimDown ) * _TRIM_RATE * delta,
			model.aircraft.trimTabMin, model.aircraft.trimTabMax );

		model.step( delta );

		// Valeurs pour les instruments
		const front = new Vector3( 0, 0, - 1 ).applyQuaternion( object.quaternion );
		const cam_up = _up.clone().applyQuaternion( object.quaternion );
		const cam_right = front.clone().cross( cam_up );

		this._pitch_rate = front.y / Math.max( _EPS, Math.sqrt( front.x * front.x + front.z * front.z ) );
		this._roll = Math.atan2( cam_right.dot( _up ), cam_up.dot( _up ) );
		this._heading = ( Math.atan2( front.x, - front.z ) * 180 / Math.PI + 360 ) % 360;
		this._verticalSpeed = ( object.position.y - previousY ) / delta;

		if (
			this._lastPosition.distanceToSquared( object.position ) > _EPS ||
			8 * ( 1 - this._lastQuaternion.dot( object.quaternion ) ) > _EPS
		) {
			this.dispatchEvent( _changeEvent );
			this._lastQuaternion.copy( object.quaternion );
			this._lastPosition.copy( object.position );
		}
	}

	// private
	_onKeyEvent( event, value ) {
		if ( this.enabled === false ) return;

		if ( event.code === 'KeyR' ) {
			if ( value ) this.reset();
			return;
		}
		// Volets : G sort un cran, T rentre un cran
		if ( event.code === 'KeyG' || event.code === 'KeyT' ) {
			if ( value && ! event.repeat ) this.setFlapLevel( this.model.flapLevel + ( event.code === 'KeyG' ? 1 : - 1 ) );
			return;
		}

		const action = _KEYS[ event.code ];
		if ( action === undefined ) return;
		event.preventDefault(); // évite le défilement de la page avec Espace
		this._moveState[ action ] = value;
		this._updateVectors();
	}

	_updateVectors() {
		this.accel = - this._moveState.speeddown + this._moveState.speedup;
		this._rotationVector.x = - this._moveState.pitchDown + this._moveState.pitchUp;
		this._rotationVector.y = - this._moveState.yawRight + this._moveState.yawLeft;
		this._rotationVector.z = - this._moveState.rollRight + this._moveState.rollLeft;
	}

	// --- Valeurs pour les instruments, le son et l'affichage ---

	getRoll() {
		return this._roll;
	}
	getPitchRate() {
		return this._pitch_rate;
	}
	getHeading() {
		return this._heading;
	}
	getVerticalSpeed() {
		return this._verticalSpeed;
	}
	getSpeed() {
		return this.model.airspeed;
	}
	getAltitude() {
		return this.object.position.y;
	}
	getThrottle() {
		return this.model.throttle;
	}
	// Commandes du pilote : profondeur (+ = cabrer), ailerons et palonnier (+ = gauche), freins
	getInputs() {
		return {
			pitch: this._controls.x,
			roll: this._controls.z,
			yaw: this._controls.y,
			brake: Math.max( this._moveState.brake, this.parkingBrake ? 1 : 0 ),
		};
	}
	// Trim : angle du tab (degrés, + = à cabrer), repère de décollage et butées
	getTrim() {
		return MathUtils.radToDeg( this.model.trim );
	}
	getTakeoffTrim() {
		return MathUtils.radToDeg( this.model.aircraft.takeoffTrim );
	}
	getTrimLimits() {
		return [ MathUtils.radToDeg( this.model.aircraft.trimTabMin ), MathUtils.radToDeg( this.model.aircraft.trimTabMax ) ];
	}
	// Vitesse tenue manche lâché avec ce trim et ces volets (m/s)
	getTrimSpeed() {
		return this.model.trimSpeed();
	}
	isStalled() {
		return this.model.stalled;
	}
	// Vrai un peu avant le décrochage, pour l'avertisseur sonore (pas au sol)
	isNearStall() {
		return this.model.nearStall();
	}
	// Vitesse de décrochage en vol rectiligne (m/s), plus faible volets sortis
	getStallSpeed() {
		return this.model.stallSpeed();
	}
	setFlapLevel( level ) {
		this.model.setFlapLevel( level );
		this.dispatchEvent( { type: 'flaps', degrees: this.getFlapSetting() } );
	}
	getFlapLevel() {
		return this.model.flapLevel;
	}
	// Cran demandé (degrés) et position réelle des volets (0 -> 1)
	getFlapSetting() {
		return this.model.flapSetting();
	}
	getFlaps() {
		return this.model.flaps;
	}
	isOnGround() {
		return this.model.onGround;
	}
	isCrashed() {
		return this.model.crashed;
	}
	getSurface() {
		return this.model.surface;
	}
}

// Vrai quand le joueur tape dans un champ (pseudo, code de partie…)
function isTyping( event ) {
	return event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
}

function onKeyDown( event ) {
	if ( event.altKey || isTyping( event ) ) return;
	this._onKeyEvent( event, 1 );
}

function onKeyUp( event ) {
	this._onKeyEvent( event, 0 );
}

// Relâche toutes les touches si la fenêtre perd le focus
function onBlur() {
	for ( const key in this._moveState ) this._moveState[ key ] = 0;
	this._updateVectors();
}

export { PlaneControls };
