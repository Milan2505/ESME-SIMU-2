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
const _STEP = 1 / 120;             // pas de calcul de la physique (s) : plusieurs pas par image si besoin
const _up = new Vector3( 0, 1, 0 );
const _front = new Vector3( 0, 0, - 1 );
const _xAxis = new Vector3( 1, 0, 0 );
const _tmpQuaternion = new Quaternion();
const _gustTarget = new Vector3();
const _normal = new Vector3();
const _forward = new Vector3();
const _back = new Vector3();
const _right = new Vector3();
const _planeUp = new Vector3();
const _air = new Vector3();
const _liftDirection = new Vector3();
const _force = new Vector3();
const _basis = new Matrix4();

// Cessna 172 : ordres de grandeur réels (masse, aile, moteur de 160 ch)
const _MASS = 1100;                                   // kg (masse au décollage)
const _GRAVITY = 9.81;
const _WING_AREA = 16.2;                              // m²
const _WINGSPAN = 11;                                 // m (effet de sol)
const _AIR_DENSITY = 1.225;                           // kg/m³
const _CL0 = 0.4;                                     // coefficient de portance à incidence nulle (calage de l'aile compris)
const _CL_ALPHA = 4.6;                                // pente de portance (par radian d'incidence)
const _ALPHA_STALL = MathUtils.degToRad( 15 );        // incidence de décrochage
const _CD0 = 0.036;                                   // traînée de forme (train fixe compris)
const _INDUCED_DRAG = 0.06;                           // traînée induite : k·CL² (aile d'allongement 7,5)
const _STALL_DRAG = 0.15;                             // aile décrochée : traînée en plus
const _STATIC_THRUST = 2000;                          // poussée plein gaz à l'arrêt (N)
const _POWER = 75000;                                 // puissance utile de l'hélice (W) : la poussée baisse avec la vitesse ; montée ~3,5 m/s
const _WINDMILL_DRAG = 0.012;                         // hélice au ralenti : elle freine l'avion (finesse ~9 en plané)
const _SIDE_FORCE = 0.6;                              // force latérale du fuselage en dérapage (par radian)

// Rotations (rad/s) à pleine efficacité des gouvernes ; l'efficacité croît avec le carré de la vitesse
const _PITCH_RATE = 0.2;
const _ROLL_RATE = 0.7;
const _YAW_RATE = 0.3;
const _CONTROL_SPEED = 30;                            // vitesse (m/s) où les gouvernes ont leur pleine efficacité
const _PITCH_STABILITY = 2.5;                         // manche lâché : le nez revient à l'incidence compensée
const _YAW_STABILITY = 3;                             // la dérive aligne le nez sur la trajectoire (virage coordonné)
const _DIHEDRAL = 0.8;                                // le dérapage incline l'avion (dièdre des ailes)
const _SPIRAL_STABILITY = 0.1;                        // manche lâché, l'inclinaison se réduit doucement (sinon le virage se resserre)
const _ANGULAR_RESPONSE = 5;                          // rapidité avec laquelle l'avion suit les gouvernes (1/s)
const _STALL_PITCH_DOWN = 0.4;                        // abattée au décrochage (rad/s)
const _STALL_WING_DROP = 0.5;                         // une aile tombe au décrochage (rad/s)

// Sol : au-delà de ces limites, le contact avec le sol est un crash
const _CRASH_SINK = 6;                                // vitesse d'impact perpendiculaire au sol (m/s)
const _CRASH_BANK = MathUtils.degToRad( 20 );         // inclinaison au toucher (une aile touche)
const _CRASH_NOSE = MathUtils.degToRad( - 8 );        // nez trop bas : l'hélice et la roulette avant touchent
const _CRASH_TAIL = MathUtils.degToRad( 22 );         // queue trop basse
const _MIN_SLOPE_NORMAL = 0.85;                       // terrain trop pentu pour s'y poser
const _MAX_GROUND_PITCH = MathUtils.degToRad( 14 );   // cabré max roues principales au sol
const _BRAKES = 4;                                    // décélération des freins (m/s²), roues chargées
const _ROLLING = { asphalt: 0.3, grass: 1.2 };        // résistance au roulement (m/s²), roues chargées
const _OBSTACLE_MARGIN = 3;                           // demi-envergure "utile" pour les obstacles (m)
const _CONTROL_SMOOTHING = 0.5;                       // temps (s) pour que les gouvernes suivent les touches : mouvements arrondis
const _FLAP_LEVELS = [ 0, 10, 20, 30 ];               // crans de volets (degrés)
const _FLAP_RATE = 0.25;                              // vitesse de sortie des volets (course complète en 4 s)
const _FLAP_LIFT = 0.7;                               // volets à fond : portance en plus (décrochage vers 80 km/h au lieu de 95)
const _FLAP_DRAG = 0.05;                              // volets à fond : traînée en plus
const _FLAP_STALL_ALPHA = MathUtils.degToRad( 2 );    // volets à fond : l'aile décroche 2° plus tôt

// Touches gérées (event.code = position physique, Z/Q/S/D en AZERTY)
const _KEYS = {
	KeyS: 'pitchUp', KeyW: 'pitchDown',
	KeyA: 'rollLeft', KeyD: 'rollRight',
	KeyQ: 'yawLeft', KeyE: 'yawRight',
	Space: 'speedup', ControlLeft: 'speeddown', ShiftLeft: 'speeddown',
	KeyB: 'brake',
};

// Modèle de vol : mécanique du point (portance, traînée, poussée, poids) selon l'incidence et la vitesse,
// avec effet de sol et décrochage ; au sol, roulage sur les roues jusqu'à ce que l'aile porte l'avion.
class PlaneControls extends Controls {

	constructor( object, domElement = null ) {

		super( object, domElement );

		this.minAltitude = 1;        // hauteur du centre de l'avion au-dessus du sol, roues posées
		this.groundHeight = () => 0; // relief : hauteur du sol en (x, z)
		this.surfaceAt = () => 'grass'; // revêtement du sol en (x, z) : 'asphalt' ou 'grass'
		this.obstacles = [];         // boîtes (Box3, repère monde) à ne pas percuter
		this.turbulence = 0;         // 0 = air calme, 1 = tempête
		this.rotateSpeed = 24;       // vitesse (m/s) où la profondeur peut lever le nez au sol ; décollage vers 27 m/s
		this.throttleRate = 0.4;     // variation de la manette des gaz par seconde

		this.throttle = 0.3;
		this.movementSpeed = 0;      // vitesse air (m/s)
		this.velocity = new Vector3(); // vitesse (repère monde, m/s)

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
		this._angularVelocity = new Vector3( 0, 0, 0 );  // repère avion (rad/s) : x tangage (+ = cabrer), y lacet, z roulis (+ = gauche)
		this._wind = new Vector3( 0, 0, 0 );             // rafales (repère monde, m/s)
		this._gustRoll = 0;
		this._gustRollTarget = 0;
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
		this._alpha = 0;             // incidence : angle entre le nez et la trajectoire dans l'air (rad)
		this._alphaTrim = 0;         // incidence que l'avion garde manche lâché (compensation automatique)
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
		this.velocity.set( 0, 0, 0 );
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
		_forward.copy( _front ).applyQuaternion( this.object.quaternion );
		this.movementSpeed = this._onGround ? 0 : 45;
		this.velocity.copy( _forward ).multiplyScalar( this.movementSpeed );
		this._groundYaw = Math.atan2( - _forward.x, - _forward.z );
		this._groundPitch = 0;
		this._wind.set( 0, 0, 0 );
		this._gustRoll = 0;
		this._controls.set( 0, 0, 0 );
		this._angularVelocity.set( 0, 0, 0 );
		this._stalled = false;
		this._alpha = 0;
		this._alphaTrim = 0;
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

		// Gouvernes : suivent les touches progressivement (une touche n'est qu'un "tout ou rien")
		this._controls.lerp( this._rotationVector, 1 - Math.exp( - delta / _CONTROL_SMOOTHING * 3 ) );

		// Volets : se déplacent progressivement vers le cran demandé
		const flapTarget = _FLAP_LEVELS[ this._flapLevel ] / _FLAP_LEVELS[ _FLAP_LEVELS.length - 1 ];
		this._flaps += MathUtils.clamp( flapTarget - this._flaps, - _FLAP_RATE * delta, _FLAP_RATE * delta );

		this.throttle = Math.min( 1, Math.max( 0, this.throttle + this.accel * this.throttleRate * delta ) );
		this._updateGusts( delta );

		// Physique en petits pas réguliers : même comportement quelle que soit la fréquence d'images
		const steps = Math.ceil( delta / _STEP );
		for ( let i = 0; i < steps && ! this._crashed; i ++ ) {
			if ( this._onGround ) {
				this._updateGround( delta / steps );
			} else {
				this._updateFlight( delta / steps );
				this._checkTouchdown();
			}
		}
		if ( ! this._crashed ) this._checkObstacles();

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

	// Rafales (tempête) : vent qui change toutes les 1 à 2,5 s, atteint en douceur, et secousses en roulis
	_updateGusts( delta ) {
		if ( this.turbulence <= 0 || this._onGround ) {
			this._wind.set( 0, 0, 0 );
			this._gustRoll = 0;
			return;
		}
		this._gustTimer -= delta;
		if ( this._gustTimer <= 0 ) {
			_gustTarget.set( Math.random() - 0.5, ( Math.random() - 0.5 ) * 0.5, Math.random() - 0.5 ).multiplyScalar( 10 * this.turbulence );
			this._gustRollTarget = ( Math.random() - 0.5 ) * 0.6 * this.turbulence;
			this._gustTimer = 1 + Math.random() * 1.5;
		}
		const k = 1 - Math.exp( - delta * 1.5 );
		this._wind.lerp( _gustTarget, k );
		this._gustRoll += ( this._gustRollTarget - this._gustRoll ) * k;
	}

	// Coefficient de portance selon l'incidence (rad) ; au-delà de l'incidence de décrochage, il s'effondre
	_liftCoefficient( alpha ) {
		const base = _CL0 + _FLAP_LIFT * this._flaps;
		const stallAlpha = this._stallAlpha();
		if ( alpha <= stallAlpha ) return Math.max( - 1, base + _CL_ALPHA * alpha );
		const peak = base + _CL_ALPHA * stallAlpha;
		return Math.max( peak * 0.55, peak - 3.5 * ( alpha - stallAlpha ) );
	}

	_stallAlpha() {
		return _ALPHA_STALL - _FLAP_STALL_ALPHA * this._flaps;
	}

	// Poussée de l'hélice (N) : limitée à l'arrêt, puis à puissance constante (elle baisse avec la vitesse)
	_thrust( speed ) {
		return this.throttle * Math.min( _STATIC_THRUST, _POWER / Math.max( 1, speed ) );
	}

	// Coefficient de traînée : forme + volets + induite (réduite près du sol) + hélice au ralenti + aile décrochée
	_dragCoefficient( lift, groundEffect = 1 ) {
		return _CD0 + _FLAP_DRAG * this._flaps + _INDUCED_DRAG * lift * lift * groundEffect
			+ _WINDMILL_DRAG * ( 1 - this.throttle ) + ( this._stalled ? _STALL_DRAG : 0 );
	}

	// En vol : portance, traînée, poussée et poids font évoluer la vitesse ; l'avion pivote selon les gouvernes
	// et sa stabilité (le nez s'aligne sur la trajectoire). Au manche on choisit l'incidence, donc la vitesse ;
	// aux gaz on monte ou on descend.
	_updateFlight( dt ) {
		const object = this.object;
		const quaternion = object.quaternion;
		_forward.copy( _front ).applyQuaternion( quaternion );
		_planeUp.copy( _up ).applyQuaternion( quaternion );
		_right.copy( _xAxis ).applyQuaternion( quaternion );

		// Vent relatif : incidence (dans le plan de symétrie de l'avion) et dérapage
		_air.subVectors( this.velocity, this._wind );
		const speed = Math.max( 0.1, _air.length() );
		this.movementSpeed = speed;
		const alpha = Math.atan2( - _air.dot( _planeUp ), _air.dot( _forward ) );
		const beta = Math.asin( MathUtils.clamp( _air.dot( _right ) / speed, - 1, 1 ) );
		this._alpha = alpha;

		const stallAlpha = this._stallAlpha();
		if ( ! this._stalled && alpha > stallAlpha ) {
			this._stalled = true;
			this._wingDrop = Math.random() < 0.5 ? - 1 : 1;
		} else if ( this._stalled && alpha < stallAlpha - MathUtils.degToRad( 2 ) ) {
			this._stalled = false;
		}

		// Effet de sol : à moins d'une envergure du sol, la traînée induite chute (l'avion "flotte" à l'arrondi)
		const wingHeight = Math.max( 0, object.position.y - this.groundHeight( object.position.x, object.position.z ) - this.minAltitude + 1.5 );
		const h = 16 * ( wingHeight / _WINGSPAN ) ** 2;
		const groundEffect = h / ( 1 + h );

		const pressure = 0.5 * _AIR_DENSITY * speed * speed * _WING_AREA;
		const lift = this._liftCoefficient( alpha );
		_liftDirection.crossVectors( _right, _air ).normalize(); // perpendiculaire au vent relatif
		_force.copy( _liftDirection ).multiplyScalar( lift * pressure )
			.addScaledVector( _air, - this._dragCoefficient( lift, groundEffect ) * pressure / speed )
			.addScaledVector( _right, - _SIDE_FORCE * beta * pressure )
			.addScaledVector( _forward, this._thrust( speed ) );
		_force.y -= _MASS * _GRAVITY;
		this.velocity.addScaledVector( _force, dt / _MASS );
		object.position.addScaledVector( this.velocity, dt );

		// Gouvernes : efficacité selon la vitesse. Compensation automatique : manche lâché, l'incidence
		// (donc la vitesse) est conservée, comme un avion bien compensé
		const effect = Math.min( 1, ( speed / _CONTROL_SPEED ) ** 2 );
		const stability = effect;
		const input = this._controls;
		if ( this._rotationVector.x !== 0 ) this._alphaTrim = alpha;
		this._alphaTrim = MathUtils.clamp( this._alphaTrim, MathUtils.degToRad( - 5 ), stallAlpha - MathUtils.degToRad( 3 ) );

		let pitchRate = input.x * _PITCH_RATE * effect + _PITCH_STABILITY * ( this._alphaTrim - alpha ) * stability;
		const bank = Math.atan2( _right.y, _planeUp.y ); // > 0 : penché à gauche (aile droite haute)
		let rollRate = input.z * _ROLL_RATE * effect + ( _DIHEDRAL * beta - _SPIRAL_STABILITY * bank ) * stability + this._gustRoll;
		const yawRate = input.y * _YAW_RATE * effect - _YAW_STABILITY * beta * stability;
		if ( this._stalled ) {
			pitchRate -= _STALL_PITCH_DOWN;                  // abattée : le nez tombe
			rollRate += this._wingDrop * _STALL_WING_DROP;   // une aile tombe
		}
		const response = Math.min( 1, _ANGULAR_RESPONSE * dt );
		const w = this._angularVelocity;
		w.x += ( pitchRate - w.x ) * response;
		w.y += ( yawRate - w.y ) * response;
		w.z += ( rollRate - w.z ) * response;
		_tmpQuaternion.set( w.x * dt / 2, w.y * dt / 2, w.z * dt / 2, 1 ).normalize();
		quaternion.multiply( _tmpQuaternion ).normalize();
	}

	// Au sol : poussée, traînée, roulement et freins (sur la part du poids que portent encore les roues),
	// roulette de nez orientable ; l'avion décolle quand la portance dépasse le poids
	_updateGround( dt ) {
		const object = this.object;
		const input = this._controls;
		this._surface = this.surfaceAt( object.position.x, object.position.z );

		let speed = this.movementSpeed;
		const pressure = 0.5 * _AIR_DENSITY * speed * speed * _WING_AREA;
		const lift = this._liftCoefficient( this._groundPitch );
		const wheelLoad = Math.max( 0, 1 - lift * pressure / ( _MASS * _GRAVITY ) );
		// Pente de la piste dans l'axe de roulage (sans le cabré de l'avion) : > 0 en montée
		this._groundNormal( object.position.x, object.position.z, _normal );
		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		const slope = _forward.addScaledVector( _normal, - _forward.dot( _normal ) ).normalize().y;
		speed += ( ( this._thrust( speed ) - this._dragCoefficient( lift ) * pressure ) / _MASS - _GRAVITY * slope ) * dt;
		speed -= ( _ROLLING[ this._surface ] + this._moveState.brake * _BRAKES ) * wheelLoad * dt;
		this.movementSpeed = speed = Math.max( 0, speed );

		// Palonnier (et manche à basse vitesse) : moins d'autorité quand ça va vite
		const steer = MathUtils.clamp( input.y + input.z * 0.5, - 1, 1 );
		const authority = Math.min( 1, speed / 3 ) * ( 1 - 0.6 * Math.min( 1, speed / this.rotateSpeed ) );
		this._groundYaw += steer * 0.6 * authority * dt;

		// Profondeur : le nez ne se lève qu'avec assez de vitesse, sinon il retombe sur sa roulette
		if ( input.x > 0 && speed > this.rotateSpeed * 0.85 ) {
			this._groundPitch += input.x * 0.25 * Math.min( 1, ( speed / this.rotateSpeed ) ** 2 ) * dt;
		} else {
			this._groundPitch -= ( input.x < 0 ? 0.6 : 0.25 ) * ( 0.3 + 0.7 * wheelLoad ) * dt;
		}
		this._groundPitch = MathUtils.clamp( this._groundPitch, 0, _MAX_GROUND_PITCH );

		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		object.position.addScaledVector( _forward, speed * dt );
		this._alignToGround();

		// Décollage : la portance dépasse le poids, l'avion quitte le sol le long de la piste, nez levé
		if ( wheelLoad <= 0 ) {
			this._onGround = false;
			this._groundNormal( object.position.x, object.position.z, _normal );
			_forward.addScaledVector( _normal, - _forward.dot( _normal ) ).normalize();
			this.velocity.copy( _forward ).multiplyScalar( speed );
			this._alpha = this._alphaTrim = this._groundPitch;
			this._angularVelocity.set( 0, 0, 0 );
			this.dispatchEvent( { type: 'liftoff' } );
		}
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
	_checkTouchdown() {
		const object = this.object;
		const floor = this.groundHeight( object.position.x, object.position.z ) + this.minAltitude;
		if ( object.position.y >= floor ) return;

		this._groundNormal( object.position.x, object.position.z, _normal );
		const impact = - this.velocity.dot( _normal );

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

		// Atterrissage : l'avion continue de rouler à sa vitesse horizontale
		this._onGround = true;
		this._groundYaw = Math.atan2( - _forward.x, - _forward.z );
		this._groundPitch = MathUtils.clamp( pitch, 0, _MAX_GROUND_PITCH );
		this.movementSpeed = Math.max( 0, this.velocity.dot( _forward.setY( 0 ).normalize() ) );
		this.velocity.set( 0, 0, 0 );
		this._angularVelocity.set( 0, 0, 0 );
		this._stalled = false;
		this._wind.set( 0, 0, 0 );
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
		this.velocity.set( 0, 0, 0 );
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
	// Vrai un peu avant le décrochage (incidence à moins de 4° de la limite), pour l'avertisseur sonore (pas au sol)
	isNearStall() {
		return ! this._onGround && ! this._crashed && this._alpha > this._stallAlpha() - MathUtils.degToRad( 4 );
	}
	// Vitesse de décrochage en vol rectiligne (m/s), plus faible volets sortis
	getStallSpeed() {
		const maxLift = this._liftCoefficient( this._stallAlpha() );
		return Math.sqrt( 2 * _MASS * _GRAVITY / ( _AIR_DENSITY * _WING_AREA * maxLift ) );
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
