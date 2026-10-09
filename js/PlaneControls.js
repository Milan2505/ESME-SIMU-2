import {
	Controls,
	Quaternion,
	Vector3
} from 'three';

const _changeEvent = { type: 'change' };
const _resetEvent = { type: 'reset' };

const _EPS = 0.000001;
const _MAX_DELTA = 0.1;            // évite les sauts après un onglet en arrière-plan
const _MAX_BANK = Math.PI / 3;     // inclinaison max prise en compte pour le virage (60°)
const _up = new Vector3( 0, 1, 0 );
const _front = new Vector3( 0, 0, - 1 );
const _stallAxis = new Vector3();
const _WING_DROP_MAX = Math.PI / 6;
const _tmpQuaternion = new Quaternion();
const _yawQuaternion = new Quaternion();
const _gustTarget = new Vector3();

// Touches gérées (event.code = position physique, Z/Q/S/D en AZERTY)
const _KEYS = {
	KeyS: 'pitchUp', KeyW: 'pitchDown',
	KeyA: 'rollLeft', KeyD: 'rollRight',
	KeyQ: 'yawLeft', KeyE: 'yawRight',
	Space: 'speedup', ControlLeft: 'speeddown', ShiftLeft: 'speeddown',
};

class PlaneControls extends Controls {

	constructor( object, domElement = null ) {

		super( object, domElement );

		this.rollSpeed = 0.05;       // vitesse de rotation sur les commandes
		this.turnRate = 0.25;        // lacet induit par l'inclinaison (rad/s pour tan(roulis) = 1)
		this.minSpeed = 5;
		this.maxSpeed = 60;
		this.throttleRate = 0.4;     // variation de la manette des gaz par seconde
		this.inertia = 0.5;          // rapidité avec laquelle la vitesse suit les gaz
		this.gravity = 9.81;         // accélération en piqué / décélération en montée
		this.minAltitude = 1;        // hauteur mini au-dessus du sol
		this.groundHeight = () => 0; // relief : hauteur du sol en (x, z)
		this.turbulence = 0;         // 0 = air calme, 1 = tempête
		this.stallSpeed = 12;        // en dessous, l'aile ne porte plus assez (décrochage)
		this.stallRecovery = 1.15;   // marge de vitesse pour sortir du décrochage
		this.maxSink = 15;           // vitesse de chute max quand l'aile ne porte plus (m/s)
		this.noseDrop = 0.8;         // abattée : vitesse à laquelle le nez tombe (rad/s)

		this.throttle = 0.3;
		this.movementSpeed = this.throttle * this.maxSpeed;

		// internals
		this._moveState = {
			pitchUp: 0, pitchDown: 0,
			rollLeft: 0, rollRight: 0,
			speedup: 0, speeddown: 0,
			yawLeft: 0, yawRight: 0,
		};
		this.accel = 0;
		this._rotationVector = new Vector3( 0, 0, 0 );
		this._gust = new Vector3( 0, 0, 0 );
		this._lastQuaternion = new Quaternion();
		this._lastPosition = new Vector3();
		this._savedPosition = object.position.clone();
		this._savedQuaternion = object.quaternion.clone();
		this._roll = 0;
		this._pitch_rate = 0;
		this._heading = 0;
		this._verticalSpeed = 0;
		this._stalled = false;
		this._lift = 1;              // 1 = portance normale, 0 = plus de portance
		this._sinkSpeed = 0;
		this._wingDrop = 0;          // aile qui tombe au décrochage (-1 gauche, 1 droite)

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

	// Mémorise la position actuelle comme point de départ (touche R)
	saveState() {
		this._savedPosition.copy( this.object.position );
		this._savedQuaternion.copy( this.object.quaternion );
	}

	reset() {
		this.object.position.copy( this._savedPosition );
		this.object.quaternion.copy( this._savedQuaternion );
		this.throttle = 0.3;
		this.movementSpeed = this.throttle * this.maxSpeed;
		this._gust.set( 0, 0, 0 );
		this._stalled = false;
		this._lift = 1;
		this._sinkSpeed = 0;
		this.dispatchEvent( _resetEvent );
	}

	update( delta ) {

		if ( this.enabled === false ) return;

		delta = Math.min( delta, _MAX_DELTA );
		if ( delta <= 0 ) return;

		const object = this.object;
		const previousY = object.position.y;
		const cam_front = new Vector3( 0, 0, - 1 ).applyQuaternion( object.quaternion );

		// Gaz : la vitesse tend vers la consigne, la pente accélère ou freine l'avion
		this.throttle = Math.min( 1, Math.max( 0, this.throttle + this.accel * this.throttleRate * delta ) );
		this.movementSpeed += (
			( this.throttle * this.maxSpeed - this.movementSpeed ) * this.inertia
			- this.gravity * cam_front.y
		) * delta;
		this.movementSpeed = Math.min( this.maxSpeed * 1.2, Math.max( this.minSpeed, this.movementSpeed ) );

		object.translateZ( - this.movementSpeed * delta );

		// Décrochage : la portance chute avec la vitesse, l'avion s'enfonce et pique du nez
		if ( ! this._stalled && this.movementSpeed < this.stallSpeed ) {
			this._stalled = true;
			this._wingDrop = Math.random() < 0.5 ? - 1 : 1;
		} else if ( this._stalled && this.movementSpeed > this.stallSpeed * this.stallRecovery ) {
			this._stalled = false;
		}
		this._lift = this._stalled ? Math.min( 1, ( this.movementSpeed / this.stallSpeed ) ** 2 ) : 1;
		const loss = 1 - this._lift;

		this._sinkSpeed += ( loss * this.maxSink - this._sinkSpeed ) * Math.min( 1, delta * 2 );
		object.position.y -= this._sinkSpeed * delta;

		if ( this._stalled ) {
			// Abattée : le nez descend vers le sol (axe horizontal), jusqu'à ~35° de piqué
			const dive = Math.max( 0, cam_front.y + 0.6 );
			_stallAxis.crossVectors( cam_front, _up );
			if ( _stallAxis.lengthSq() > _EPS ) {
				_tmpQuaternion.setFromAxisAngle( _stallAxis.normalize(), - this.noseDrop * ( loss + 0.2 ) * dive * delta );
				object.quaternion.premultiply( _tmpQuaternion );
			}
			// Une aile tombe, jusqu'à ~30° d'inclinaison
			if ( this._roll * this._wingDrop > - _WING_DROP_MAX ) {
				_tmpQuaternion.setFromAxisAngle( _front, this._wingDrop * this.noseDrop * 0.5 * ( loss + 0.2 ) * delta );
				object.quaternion.multiply( _tmpQuaternion );
			}
		}

		// Commandes (repère avion) + rafales de vent
		if ( this.turbulence > 0 ) {
			_gustTarget.set( Math.random() - 0.5, 0, Math.random() - 0.5 ).multiplyScalar( 2 * this.turbulence );
			this._gust.lerp( _gustTarget, Math.min( 1, delta * 2 ) );
		} else {
			this._gust.set( 0, 0, 0 );
		}
		// Gouvernes moins efficaces quand l'aile décroche
		const rotMult = delta * this.rollSpeed * ( 0.3 + 0.7 * this._lift );
		_tmpQuaternion.set(
			( this._rotationVector.x + this._gust.x ) * rotMult,
			this._rotationVector.y * rotMult * 0.5,
			( this._rotationVector.z + this._gust.z ) * rotMult,
			1
		).normalize();
		object.quaternion.multiply( _tmpQuaternion );

		// Virage : l'inclinaison fait tourner l'avion autour de la verticale
		const bank = Math.min( _MAX_BANK, Math.max( - _MAX_BANK, this._roll ) );
		_yawQuaternion.setFromAxisAngle( _up, Math.tan( bank ) * this.turnRate * this._lift * delta );
		object.quaternion.premultiply( _yawQuaternion ).normalize();

		// Sol
		const floor = this.groundHeight( object.position.x, object.position.z ) + this.minAltitude;
		if ( object.position.y < floor ) {
			object.position.y = floor;
		}

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
		return this.movementSpeed;
	}
	getAltitude() {
		return this.object.position.y;
	}
	getThrottle() {
		return this.throttle;
	}
	isStalled() {
		return this._stalled;
	}
	// Vrai un peu avant le décrochage, pour l'avertisseur sonore
	isNearStall() {
		return this.movementSpeed < this.stallSpeed * 1.2;
	}
}

// Vrai quand le joueur tape dans un champ (pseudo, code de partie…)
function isTyping( event ) {
	return event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
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
