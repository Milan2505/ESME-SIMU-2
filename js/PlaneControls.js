import {
	Controls,
	MathUtils,
	Matrix4,
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
const _xAxis = new Vector3( 1, 0, 0 );
const _stallAxis = new Vector3();
const _WING_DROP_MAX = Math.PI / 6;
const _tmpQuaternion = new Quaternion();
const _yawQuaternion = new Quaternion();
const _gustTarget = new Vector3();
const _normal = new Vector3();
const _forward = new Vector3();
const _back = new Vector3();
const _right = new Vector3();
const _planeUp = new Vector3();
const _velocity = new Vector3();
const _previousPosition = new Vector3();
const _basis = new Matrix4();

// Sol : au-delà de ces limites, le contact avec le sol est un crash
const _CRASH_SINK = 6;                                // vitesse d'impact perpendiculaire au sol (m/s)
const _CRASH_BANK = MathUtils.degToRad( 20 );         // inclinaison au toucher (une aile touche)
const _CRASH_NOSE = MathUtils.degToRad( - 8 );        // nez trop bas : l'hélice et la roulette avant touchent
const _CRASH_TAIL = MathUtils.degToRad( 22 );         // queue trop basse
const _MIN_SLOPE_NORMAL = 0.85;                       // terrain trop pentu pour s'y poser
const _MAX_GROUND_PITCH = MathUtils.degToRad( 14 );   // cabré max roues principales au sol
const _GROUND_THRUST = 3;                             // accélération max au sol (m/s²)
const _BRAKES = 5;                                    // décélération des freins (m/s²)
const _ROLLING = { asphalt: 0.3, grass: 1.2 };        // résistance au roulement (m/s²)
const _OBSTACLE_MARGIN = 3;                           // demi-envergure "utile" pour les obstacles (m)
const _CONTROL_SMOOTHING = 0.5;                       // temps (s) pour que les gouvernes suivent les touches : mouvements arrondis
const _FLAP_LEVELS = [ 0, 10, 20, 30 ];               // crans de volets (degrés)
const _FLAP_RATE = 0.25;                              // vitesse de sortie des volets (course complète en 4 s)
const _FLAP_STALL = 0.25;                             // volets sortis : décrochage 25 % plus lent
const _FLAP_LIFT = 0.05;                              // portance supplémentaire (m/s de montée par m/s de vitesse)
const _FLAP_DRAG = 0.25;                              // volets sortis : vitesse max réduite de 25 %

// Touches gérées (event.code = position physique, Z/Q/S/D en AZERTY)
const _KEYS = {
	KeyS: 'pitchUp', KeyW: 'pitchDown',
	KeyA: 'rollLeft', KeyD: 'rollRight',
	KeyQ: 'yawLeft', KeyE: 'yawRight',
	Space: 'speedup', ControlLeft: 'speeddown', ShiftLeft: 'speeddown',
	KeyB: 'brake',
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
		this.minAltitude = 1;        // hauteur du centre de l'avion au-dessus du sol, roues posées
		this.groundHeight = () => 0; // relief : hauteur du sol en (x, z)
		this.surfaceAt = () => 'grass'; // revêtement du sol en (x, z) : 'asphalt' ou 'grass'
		this.obstacles = [];         // boîtes (Box3, repère monde) à ne pas percuter
		this.turbulence = 0;         // 0 = air calme, 1 = tempête
		this.stallSpeed = 12;        // en dessous, l'aile ne porte plus assez (décrochage)
		this.stallRecovery = 1.15;   // marge de vitesse pour sortir du décrochage
		this.rotateSpeed = 14;       // vitesse de rotation : l'avion peut quitter le sol
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
			brake: 0,
		};
		this.accel = 0;
		this._rotationVector = new Vector3( 0, 0, 0 );   // touches enfoncées (-1, 0 ou 1)
		this._controls = new Vector3( 0, 0, 0 );         // position réelle des gouvernes, qui suit les touches en douceur
		this._gust = new Vector3( 0, 0, 0 );
		this._gustTimer = 0;
		this._lastQuaternion = new Quaternion();
		this._lastPosition = new Vector3();
		this._savedPosition = object.position.clone();
		this._savedQuaternion = object.quaternion.clone();
		this._savedThrottle = this.throttle;
		this._savedOnGround = false;
		this._roll = 0;
		this._pitch_rate = 0;
		this._heading = 0;
		this._verticalSpeed = 0;
		this._stalled = false;
		this._lift = 1;              // 1 = portance normale, 0 = plus de portance
		this._sinkSpeed = 0;
		this._wingDrop = 0;          // aile qui tombe au décrochage (-1 gauche, 1 droite)
		this._onGround = false;
		this._groundYaw = 0;         // cap au sol (rad, + = vers la gauche)
		this._groundPitch = 0;       // cabré au sol (rad), 0 = roulette avant posée
		this._surface = 'grass';
		this._crashed = false;
		this._flapLevel = 0;         // cran demandé (indice dans _FLAP_LEVELS)
		this._flaps = 0;             // position réelle des volets : 0 = rentrés, 1 = sortis à fond

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

	// Pose l'avion sur le sol à sa position actuelle (cap conservé), moteur au ralenti
	placeOnGround() {
		const front = _forward.copy( _front ).applyQuaternion( this.object.quaternion );
		this._groundYaw = Math.atan2( - front.x, - front.z );
		this._groundPitch = 0;
		this._onGround = true;
		this.throttle = 0;
		this.movementSpeed = 0;
		this._alignToGround();
	}

	// Mémorise la position actuelle comme point de départ (touche R)
	saveState() {
		this._savedPosition.copy( this.object.position );
		this._savedQuaternion.copy( this.object.quaternion );
		this._savedThrottle = this.throttle;
		this._savedOnGround = this._onGround;
	}

	reset() {
		this.object.position.copy( this._savedPosition );
		this.object.quaternion.copy( this._savedQuaternion );
		this.throttle = this._savedThrottle;
		this._onGround = this._savedOnGround;
		this.movementSpeed = this._onGround ? 0 : this.throttle * this.maxSpeed;
		_forward.copy( _front ).applyQuaternion( this.object.quaternion );
		this._groundYaw = Math.atan2( - _forward.x, - _forward.z );
		this._groundPitch = 0;
		this._gust.set( 0, 0, 0 );
		this._controls.set( 0, 0, 0 );
		this._stalled = false;
		this._lift = 1;
		this._sinkSpeed = 0;
		this._crashed = false;
		this._flapLevel = 0;
		this._flaps = 0;
		this.dispatchEvent( _resetEvent );
	}

	update( delta ) {

		if ( this.enabled === false ) return;

		delta = Math.min( delta, _MAX_DELTA );
		if ( delta <= 0 ) return;

		const object = this.object;
		if ( this._crashed ) {
			this._verticalSpeed = 0;
			return;
		}
		const previousY = object.position.y;
		_previousPosition.copy( object.position );
		const cam_front = new Vector3( 0, 0, - 1 ).applyQuaternion( object.quaternion );

		// Gouvernes : suivent les touches progressivement (une touche n'est qu'un "tout ou rien")
		this._controls.lerp( this._rotationVector, 1 - Math.exp( - delta / _CONTROL_SMOOTHING * 3 ) );

		// Volets : se déplacent progressivement vers le cran demandé
		const flapTarget = _FLAP_LEVELS[ this._flapLevel ] / _FLAP_LEVELS[ _FLAP_LEVELS.length - 1 ];
		this._flaps += MathUtils.clamp( flapTarget - this._flaps, - _FLAP_RATE * delta, _FLAP_RATE * delta );

		// Gaz : la vitesse tend vers la consigne (moins haute volets sortis), la pente accélère ou freine l'avion
		this.throttle = Math.min( 1, Math.max( 0, this.throttle + this.accel * this.throttleRate * delta ) );
		let acceleration = ( this.throttle * this.maxSpeed * ( 1 - _FLAP_DRAG * this._flaps ) - this.movementSpeed ) * this.inertia
			- this.gravity * cam_front.y;

		if ( this._onGround ) {
			// Au sol : poussée limitée, roulement (plus fort dans l'herbe) et freins
			this._surface = this.surfaceAt( object.position.x, object.position.z );
			acceleration = Math.min( acceleration, _GROUND_THRUST )
				- _ROLLING[ this._surface ] - this._moveState.brake * _BRAKES;
			this.movementSpeed = Math.min( this.maxSpeed, Math.max( 0, this.movementSpeed + acceleration * delta ) );
		} else {
			this.movementSpeed += acceleration * delta;
			this.movementSpeed = Math.min( this.maxSpeed * 1.2, Math.max( this.minSpeed, this.movementSpeed ) );
		}

		object.translateZ( - this.movementSpeed * delta );

		if ( this._onGround ) {
			this._updateGround( delta );
		} else {
			this._updateFlight( delta, cam_front );
			this._checkTouchdown( delta );
		}
		this._checkObstacles();

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

	// En vol : décrochage, rafales, gouvernes et virage
	_updateFlight( delta, cam_front ) {
		const object = this.object;

		// Décrochage : la portance chute avec la vitesse, l'avion s'enfonce et pique du nez
		const stallSpeed = this.getStallSpeed();
		if ( ! this._stalled && this.movementSpeed < stallSpeed ) {
			this._stalled = true;
			this._wingDrop = Math.random() < 0.5 ? - 1 : 1;
		} else if ( this._stalled && this.movementSpeed > stallSpeed * this.stallRecovery ) {
			this._stalled = false;
		}
		this._lift = this._stalled ? Math.min( 1, ( this.movementSpeed / stallSpeed ) ** 2 ) : 1;
		const loss = 1 - this._lift;

		this._sinkSpeed += ( loss * this.maxSink - this._sinkSpeed ) * Math.min( 1, delta * 2 );
		object.position.y -= this._sinkSpeed * delta;
		// Volets : surcroît de portance, l'avion a tendance à monter
		object.position.y += _FLAP_LIFT * this._flaps * this._lift * this.movementSpeed * delta;

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
			// Rafale : nouvelle direction toutes les 1 à 2,5 s, atteinte en douceur
			this._gustTimer -= delta;
			if ( this._gustTimer <= 0 ) {
				_gustTarget.set( Math.random() - 0.5, 0, Math.random() - 0.5 ).multiplyScalar( 2 * this.turbulence );
				this._gustTimer = 1 + Math.random() * 1.5;
			}
			this._gust.lerp( _gustTarget, 1 - Math.exp( - delta * 1.5 ) );
		} else {
			this._gust.set( 0, 0, 0 );
		}
		// Gouvernes moins efficaces quand l'aile décroche
		const rotMult = delta * this.rollSpeed * ( 0.3 + 0.7 * this._lift );
		_tmpQuaternion.set(
			( this._controls.x + this._gust.x ) * rotMult,
			this._controls.y * rotMult * 0.5,
			( this._controls.z + this._gust.z ) * rotMult,
			1
		).normalize();
		object.quaternion.multiply( _tmpQuaternion );

		// Virage : l'inclinaison fait tourner l'avion autour de la verticale
		const bank = Math.min( _MAX_BANK, Math.max( - _MAX_BANK, this._roll ) );
		_yawQuaternion.setFromAxisAngle( _up, Math.tan( bank ) * this.turnRate * this._lift * delta );
		object.quaternion.premultiply( _yawQuaternion ).normalize();
	}

	// Au sol : roulette de nez orientable, rotation au décollage, avion collé au relief
	_updateGround( delta ) {
		const object = this.object;
		const speed = this.movementSpeed;
		const input = this._controls;

		// Palonnier (et manche à basse vitesse) : moins d'autorité quand ça va vite
		const steer = MathUtils.clamp( input.y + input.z * 0.5, - 1, 1 );
		const authority = Math.min( 1, speed / 3 ) * ( 1 - 0.6 * Math.min( 1, speed / this.rotateSpeed ) );
		this._groundYaw += steer * 0.6 * authority * delta;

		// Profondeur : le nez ne se lève qu'avec assez de vitesse, sinon il retombe sur sa roulette
		// (volets sortis : l'avion décolle plus tôt)
		const rotateSpeed = this.rotateSpeed * ( 1 - _FLAP_STALL * this._flaps );
		if ( input.x > 0 && speed > rotateSpeed * 0.7 ) {
			this._groundPitch += input.x * 0.4 * Math.min( 1, speed / rotateSpeed ) * delta;
		} else {
			this._groundPitch -= ( input.x < 0 ? 0.6 : 0.25 ) * delta;
		}
		this._groundPitch = MathUtils.clamp( this._groundPitch, 0, _MAX_GROUND_PITCH );

		// Décollage : assez de vitesse et nez levé, l'avion monte dans l'axe de son nez
		const floor = this.groundHeight( object.position.x, object.position.z ) + this.minAltitude;
		if ( speed >= rotateSpeed && this._groundPitch > MathUtils.degToRad( 3 ) && object.position.y >= floor ) {
			this._onGround = false;
			this._lift = 1;
			this._sinkSpeed = 0;
			this.dispatchEvent( { type: 'liftoff' } );
			return;
		}
		this._alignToGround();
	}

	// Avion posé sur ses roues : altitude du sol, assiette suivant la pente du terrain
	_alignToGround() {
		const object = this.object;
		object.position.y = this.groundHeight( object.position.x, object.position.z ) + this.minAltitude;
		this._groundNormal( object.position.x, object.position.z, _normal );

		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		_forward.addScaledVector( _normal, - _forward.dot( _normal ) ).normalize();
		_right.crossVectors( _forward, _normal ).normalize();
		_back.copy( _forward ).negate();
		object.quaternion.setFromRotationMatrix( _basis.makeBasis( _right, _normal, _back ) );
		object.quaternion.multiply( _tmpQuaternion.setFromAxisAngle( _xAxis, this._groundPitch ) );
	}

	// Contact avec le sol en vol : atterrissage si l'avion arrive doucement, à plat et sur ses roues
	_checkTouchdown( delta ) {
		const object = this.object;
		const floor = this.groundHeight( object.position.x, object.position.z ) + this.minAltitude;
		if ( object.position.y >= floor ) return;

		this._groundNormal( object.position.x, object.position.z, _normal );
		_velocity.subVectors( object.position, _previousPosition ).divideScalar( delta );
		const impact = - _velocity.dot( _normal );

		_forward.copy( _front ).applyQuaternion( object.quaternion );
		_right.copy( _xAxis ).applyQuaternion( object.quaternion );
		_planeUp.copy( _up ).applyQuaternion( object.quaternion );
		const bank = Math.asin( MathUtils.clamp( _right.dot( _normal ), - 1, 1 ) );
		const pitch = Math.asin( MathUtils.clamp( _forward.dot( _normal ), - 1, 1 ) );

		let reason = null;
		if ( _planeUp.dot( _normal ) < 0 ) reason = 'Avion sur le dos';
		else if ( _normal.y < _MIN_SLOPE_NORMAL ) reason = 'Collision avec le relief';
		else if ( impact > _CRASH_SINK ) reason = `Impact trop violent (${impact.toFixed( 1 )} m/s)`;
		else if ( Math.abs( bank ) > _CRASH_BANK ) reason = 'Une aile a touché le sol';
		else if ( pitch < _CRASH_NOSE ) reason = 'L\'avion a touché du nez';
		else if ( pitch > _CRASH_TAIL ) reason = 'La queue a touché le sol';

		if ( reason ) {
			object.position.y = floor;
			this._crash( reason );
			return;
		}

		// Atterrissage
		this._onGround = true;
		this._groundYaw = Math.atan2( - _forward.x, - _forward.z );
		this._groundPitch = MathUtils.clamp( pitch, 0, _MAX_GROUND_PITCH );
		this._stalled = false;
		this._lift = 1;
		this._sinkSpeed = 0;
		this._gust.set( 0, 0, 0 );
		this._alignToGround();
		this.dispatchEvent( { type: 'touchdown', impact } );
	}

	_checkObstacles() {
		const position = this.object.position;
		for ( const box of this.obstacles ) {
			if ( box.distanceToPoint( position ) < _OBSTACLE_MARGIN ) {
				this._crash( 'Collision avec un obstacle' );
				return;
			}
		}
	}

	_crash( reason ) {
		this._crashed = true;
		this._stalled = false;
		this.movementSpeed = 0;
		this.throttle = 0;
		this.dispatchEvent( { type: 'crash', reason } );
	}

	// Normale du terrain (différences finies sur le relief)
	_groundNormal( x, z, target ) {
		const h = this.groundHeight;
		return target.set( h( x - 1, z ) - h( x + 1, z ), 2, h( x, z - 1 ) - h( x, z + 1 ) ).normalize();
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
			if ( value && ! event.repeat ) this.setFlapLevel( this._flapLevel + ( event.code === 'KeyG' ? 1 : - 1 ) );
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
	// Commandes du pilote : profondeur (+ = cabrer), ailerons et palonnier (+ = gauche), freins
	getInputs() {
		return {
			pitch: this._controls.x,
			roll: this._controls.z,
			yaw: this._controls.y,
			brake: this._moveState.brake,
		};
	}
	isStalled() {
		return this._stalled;
	}
	// Vrai un peu avant le décrochage, pour l'avertisseur sonore (pas au sol)
	isNearStall() {
		return ! this._onGround && ! this._crashed && this.movementSpeed < this.getStallSpeed() * 1.2;
	}
	// Vitesse de décrochage, plus faible volets sortis
	getStallSpeed() {
		return this.stallSpeed * ( 1 - _FLAP_STALL * this._flaps );
	}
	setFlapLevel( level ) {
		this._flapLevel = MathUtils.clamp( level, 0, _FLAP_LEVELS.length - 1 );
		this.dispatchEvent( { type: 'flaps', degrees: this.getFlapSetting() } );
	}
	getFlapLevel() {
		return this._flapLevel;
	}
	// Cran demandé (degrés) et position réelle des volets (0 -> 1)
	getFlapSetting() {
		return _FLAP_LEVELS[ this._flapLevel ];
	}
	getFlaps() {
		return this._flaps;
	}
	isOnGround() {
		return this._onGround;
	}
	isCrashed() {
		return this._crashed;
	}
	getSurface() {
		return this._surface;
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
