import {
	EventDispatcher,
	MathUtils,
	Matrix4,
	Quaternion,
	Vector3
} from 'three';
import { CESSNA_172 } from './Cessna172.js';

// Modèle de vol : mécanique du point (portance, traînée, poussée, poids) selon l'incidence et la vitesse,
// avec effet de sol et décrochage ; au sol, roulage sur les roues jusqu'à ce que l'aile porte l'avion.
// Aucune dépendance au clavier ni à la page : on lui donne des commandes (manche, gaz, trim, volets, freins),
// il fait avancer l'avion (object : position et orientation). Les caractéristiques viennent de Cessna172.js.
// Événements : 'liftoff', 'touchdown' { impact }, 'crash' { reason }.

const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;         // kg/m³
const STEP = 1 / 120;              // pas de calcul (s) : plusieurs pas par image si besoin

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

class FlightModel extends EventDispatcher {

	constructor( object, aircraft = CESSNA_172 ) {
		super();
		this.object = object;
		this.aircraft = aircraft;

		// Environnement
		this.minAltitude = 1;            // hauteur du centre de l'avion au-dessus du sol, roues posées
		this.groundHeight = () => 0;     // relief : hauteur du sol en (x, z)
		this.surfaceAt = () => 'grass';  // revêtement du sol en (x, z) : 'asphalt' ou 'grass'
		this.obstacles = [];             // boîtes (Box3, repère monde) à ne pas percuter
		this.turbulence = 0;             // 0 = air calme, 1 = tempête
		this.rotateSpeed = aircraft.rotateSpeed;
		// Aides au pilotage (menu Paramètres > Pilotage), désactivées par défaut
		this.assists = {
			rotation: false,             // au sol, le trim lève le nez tout seul
			stallProtection: false,      // la profondeur seule ne fait pas décrocher
			smoothLiftoff: false,        // après l'envol, manche relâché, le nez se rend progressivement
		};

		// Commandes du pilote
		this.controls = { pitch: 0, roll: 0, yaw: 0, brake: 0 }; // profondeur (+ = cabrer), ailerons et palonnier (+ = gauche), freins
		this.throttle = 0.3;             // 0 -> 1
		this.trim = aircraft.takeoffTrim; // tab de profondeur (rad, + = à cabrer)
		this.flapLevel = 0;              // cran demandé (indice dans aircraft.flapLevels)

		// État
		this.velocity = new Vector3();   // vitesse (repère monde, m/s)
		this.airspeed = 0;               // vitesse air (m/s) ; au sol : vitesse de roulage
		this.flaps = 0;                  // position réelle des volets : 0 = rentrés, 1 = sortis à fond
		this.alpha = 0;                  // incidence : angle entre le nez et la trajectoire dans l'air (rad)
		this.stalled = false;
		this.onGround = false;
		this.crashed = false;
		this.surface = 'grass';
		this._angularVelocity = new Vector3(); // repère avion (rad/s) : x tangage (+ = cabrer), y lacet, z roulis (+ = gauche)
		this._wind = new Vector3();      // rafales (repère monde, m/s)
		this._gustRoll = 0;
		this._gustRollTarget = 0;
		this._gustTimer = 0;
		this._liftoffAlpha = 0;          // incidence à l'envol...
		this._liftoffBlend = 0;          // ... dont l'avion se détache progressivement (1 -> 0) pour rejoindre celle du trim
		this._wingDrop = 0;              // aile qui tombe au décrochage (-1 gauche, 1 droite)
		this._pathAngle = null;          // pente de la trajectoire (rad) et sa vitesse de variation (rad/s), lissée
		this._pathRate = 0;
		this._groundYaw = 0;             // cap au sol (rad, + = vers la gauche)
		this._groundPitch = 0;           // cabré au sol (rad), 0 = roulette avant posée
	}

	// Pose l'avion sur le sol à sa position actuelle (cap conservé), moteur au ralenti
	placeOnGround() {
		const front = _forward.copy( _front ).applyQuaternion( this.object.quaternion );
		this._groundYaw = Math.atan2( - front.x, - front.z );
		this._groundPitch = 0;
		this.onGround = true;
		this.throttle = 0;
		this.airspeed = 0;
		this.velocity.set( 0, 0, 0 );
		this._alignToGround();
	}

	// Repart de la position et de l'orientation actuelles de l'objet (point de départ mémorisé) :
	// au sol arrêté, ou en vol à 45 m/s ; trim au repère de décollage, volets rentrés
	restart( onGround ) {
		const front = _forward.copy( _front ).applyQuaternion( this.object.quaternion );
		this.onGround = onGround;
		this.airspeed = onGround ? 0 : 45;
		this.velocity.copy( front ).multiplyScalar( this.airspeed );
		this._groundYaw = Math.atan2( - front.x, - front.z );
		this._groundPitch = 0;
		this._wind.set( 0, 0, 0 );
		this._gustRoll = 0;
		this._angularVelocity.set( 0, 0, 0 );
		this._pathAngle = null;
		this.stalled = false;
		this.alpha = 0;
		this.trim = this.aircraft.takeoffTrim;
		this._liftoffBlend = 0;
		this.crashed = false;
		this.flapLevel = 0;
		this.flaps = 0;
	}

	setFlapLevel( level ) {
		this.flapLevel = MathUtils.clamp( level, 0, this.aircraft.flapLevels.length - 1 );
	}

	// Fait avancer la simulation de delta secondes
	step( delta ) {
		if ( this.crashed ) return;
		const A = this.aircraft;

		// Volets : se déplacent progressivement vers le cran demandé
		const flapTarget = A.flapLevels[ this.flapLevel ] / A.flapLevels[ A.flapLevels.length - 1 ];
		this.flaps += MathUtils.clamp( flapTarget - this.flaps, - A.flapRate * delta, A.flapRate * delta );
		this._updateGusts( delta );

		// Physique en petits pas réguliers : même comportement quelle que soit la fréquence d'images
		const steps = Math.ceil( delta / STEP );
		for ( let i = 0; i < steps && ! this.crashed; i ++ ) {
			if ( this.onGround ) {
				this._updateGround( delta / steps );
			} else {
				this._updateFlight( delta / steps );
				this._checkTouchdown();
			}
		}
		if ( ! this.crashed ) this._checkObstacles();
	}

	// --- Valeurs dérivées ---

	// Incidence de décrochage (rad), plus faible volets sortis
	stallAlpha() {
		return this.aircraft.alphaStall - this.aircraft.flapStallAlpha * this.flaps;
	}

	// Vitesse de décrochage en vol rectiligne (m/s), plus faible volets sortis
	stallSpeed() {
		const A = this.aircraft;
		const maxLift = this._liftCoefficient( this.stallAlpha() );
		return Math.sqrt( 2 * A.mass * GRAVITY / ( AIR_DENSITY * A.wingArea * maxLift ) );
	}

	// Incidence que fixe le tab de trim (manche lâché)
	trimAlpha() {
		return this.aircraft.trimAlphaZero + this.trim * this.aircraft.trimAlphaPerTab;
	}

	// Vitesse (m/s) que l'avion tient manche lâché avec le trim et les volets actuels : la puissance fait monter
	// ou descendre à cette vitesse, pas accélérer (pour aller plus vite : trimer à piquer)
	trimSpeed() {
		const A = this.aircraft;
		const alpha = Math.min( this.trimAlpha(), this.stallAlpha() - MathUtils.degToRad( 5 ) );
		return Math.sqrt( 2 * A.mass * GRAVITY / ( AIR_DENSITY * A.wingArea * this._liftCoefficient( alpha ) ) );
	}

	// Vrai un peu avant le décrochage (incidence à moins de 3° de la limite), pas au sol
	nearStall() {
		return ! this.onGround && ! this.crashed && this.alpha > this.stallAlpha() - MathUtils.degToRad( 3 );
	}

	flapSetting() {
		return this.aircraft.flapLevels[ this.flapLevel ];
	}

	// --- Aérodynamique ---

	// Rafales (tempête) : vent qui change toutes les 1 à 2,5 s, atteint en douceur, et secousses en roulis
	_updateGusts( delta ) {
		if ( this.turbulence <= 0 || this.onGround ) {
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
		const A = this.aircraft;
		const base = A.cl0 + A.flapLift * this.flaps;
		const stallAlpha = this.stallAlpha();
		if ( alpha <= stallAlpha ) return Math.max( - 1, base + A.clAlpha * alpha );
		const peak = base + A.clAlpha * stallAlpha;
		return Math.max( peak * 0.55, peak - 3.5 * ( alpha - stallAlpha ) );
	}

	// Poussée de l'hélice (N) : limitée à l'arrêt, puis à puissance constante (elle baisse avec la vitesse)
	_thrust( speed ) {
		return this.throttle * Math.min( this.aircraft.staticThrust, this.aircraft.power / Math.max( 1, speed ) );
	}

	// Coefficient de traînée : forme + volets + induite (réduite près du sol) + hélice au ralenti + aile décrochée
	_dragCoefficient( lift, groundEffect = 1 ) {
		const A = this.aircraft;
		return A.cd0 + A.flapDrag * this.flaps + A.inducedDrag * lift * lift * groundEffect
			+ A.windmillDrag * ( 1 - this.throttle ) + ( this.stalled ? A.stallDrag : 0 );
	}

	// --- En vol ---

	// Portance, traînée, poussée et poids font évoluer la vitesse ; l'avion pivote selon les gouvernes
	// et sa stabilité (le nez s'aligne sur la trajectoire). Au manche on choisit l'incidence, donc la vitesse ;
	// aux gaz on monte ou on descend.
	_updateFlight( dt ) {
		const A = this.aircraft;
		const object = this.object;
		const quaternion = object.quaternion;
		_forward.copy( _front ).applyQuaternion( quaternion );
		_planeUp.copy( _up ).applyQuaternion( quaternion );
		_right.copy( _xAxis ).applyQuaternion( quaternion );

		// Vent relatif : incidence (dans le plan de symétrie de l'avion) et dérapage
		_air.subVectors( this.velocity, this._wind );
		const speed = Math.max( 0.1, _air.length() );
		this.airspeed = speed;
		const alpha = Math.atan2( - _air.dot( _planeUp ), _air.dot( _forward ) );
		const beta = Math.asin( MathUtils.clamp( _air.dot( _right ) / speed, - 1, 1 ) );
		this.alpha = alpha;

		const stallAlpha = this.stallAlpha();
		if ( ! this.stalled && alpha > stallAlpha ) {
			this.stalled = true;
			this._wingDrop = Math.random() < 0.5 ? - 1 : 1;
		} else if ( this.stalled && alpha < stallAlpha - MathUtils.degToRad( 2 ) ) {
			this.stalled = false;
		}

		// Effet de sol : à moins d'une envergure du sol, la traînée induite chute (l'avion "flotte" à l'arrondi)
		const wingHeight = Math.max( 0, object.position.y - this.groundHeight( object.position.x, object.position.z ) - this.minAltitude + 1.5 );
		const h = 16 * ( wingHeight / A.wingspan ) ** 2;
		const groundEffect = h / ( 1 + h );

		const pressure = 0.5 * AIR_DENSITY * speed * speed * A.wingArea;
		const lift = this._liftCoefficient( alpha );
		_liftDirection.crossVectors( _right, _air ).normalize(); // perpendiculaire au vent relatif
		_force.copy( _liftDirection ).multiplyScalar( lift * pressure )
			.addScaledVector( _air, - this._dragCoefficient( lift, groundEffect ) * pressure / speed )
			.addScaledVector( _right, - A.sideForce * beta * pressure )
			.addScaledVector( _forward, this._thrust( speed ) );
		_force.y -= A.mass * GRAVITY;
		this.velocity.addScaledVector( _force, dt / A.mass );
		object.position.addScaledVector( this.velocity, dt );

		// Gouvernes : efficacité selon la vitesse. Manche relâché, la stabilité ramène l'avion à l'incidence du trim
		const effect = Math.min( 1, ( speed / A.controlSpeed ) ** 2 );
		// La stabilité garde de l'effet à basse vitesse : le nez suit la trajectoire (sinon, en chandelle, l'incidence
		// dépassait le décrochage sans action du pilote)
		const stability = MathUtils.clamp( ( speed / 20 ) ** 2, 0.6, 1 );
		const input = this.controls;
		let trimAlpha = Math.min( this.trimAlpha(), stallAlpha - MathUtils.degToRad( 5 ) ); // trim seul : jamais de décrochage
		// Aide "envol en douceur" : juste après l'envol, on part de l'incidence d'envol et on rejoint le trim en douceur
		if ( this._liftoffBlend > 0 ) {
			this._liftoffBlend = Math.max( 0, this._liftoffBlend - dt / A.liftoffReleaseTime );
			trimAlpha = MathUtils.lerp( trimAlpha, this._liftoffAlpha, this._liftoffBlend );
		}

		// Profondeur : le manche décale l'incidence visée par rapport au trim (moins d'autorité à très basse vitesse) ;
		// la stabilité y amène l'avion
		const limit = stallAlpha + ( this.assists.stallProtection ? A.elevatorLimitProtected : A.elevatorLimit );
		const authority = Math.min( 1, effect * 1.5 );
		let alphaTarget = trimAlpha + input.pitch * ( input.pitch > 0 ? A.elevatorUp : A.elevatorDown ) * authority;
		if ( input.pitch > 0 ) alphaTarget = Math.min( alphaTarget, Math.max( limit, trimAlpha ) );
		// Manche lâché : amortissement des longues oscillations de trajectoire (phugoïde) ; quand la trajectoire
		// se redresse, l'incidence baisse un peu, et inversement (sans effet en vol stabilisé, ni à l'arrondi)
		const pathAngle = Math.asin( MathUtils.clamp( this.velocity.y / Math.max( 0.1, this.velocity.length() ), - 1, 1 ) );
		if ( this._pathAngle !== null ) {
			this._pathRate += ( ( pathAngle - this._pathAngle ) / dt - this._pathRate ) * Math.min( 1, dt * A.phugoidFilter );
		}
		this._pathAngle = pathAngle;
		if ( Math.abs( input.pitch ) < 0.1 ) alphaTarget -= A.phugoidDamping * this._pathRate;
		let pitchRate = MathUtils.clamp( A.pitchStability * ( alphaTarget - alpha ) * stability, - A.pitchRateMax, A.pitchRateMax );
		const bank = Math.atan2( _right.y, _planeUp.y ); // > 0 : penché à gauche (aile droite haute)
		let rollRate = input.roll * A.rollRate * effect + ( A.dihedral * beta - A.spiralStability * bank ) * stability + this._gustRoll;
		const yawRate = input.yaw * A.yawRate * effect - A.yawStability * beta * stability;
		if ( this.stalled ) {
			pitchRate -= A.stallPitchDown;                  // abattée : le nez tombe
			rollRate += this._wingDrop * A.stallWingDrop;   // une aile tombe
		}
		const response = Math.min( 1, A.angularResponse * dt );
		const w = this._angularVelocity;
		w.x += ( pitchRate - w.x ) * response;
		w.y += ( yawRate - w.y ) * response;
		w.z += ( rollRate - w.z ) * response;
		_tmpQuaternion.set( w.x * dt / 2, w.y * dt / 2, w.z * dt / 2, 1 ).normalize();
		quaternion.multiply( _tmpQuaternion ).normalize();
	}

	// --- Au sol ---

	// Poussée, traînée, roulement et freins (sur la part du poids que portent encore les roues),
	// roulette de nez orientable ; l'avion décolle quand la portance dépasse le poids
	_updateGround( dt ) {
		const A = this.aircraft;
		const object = this.object;
		const input = this.controls;
		this.surface = this.surfaceAt( object.position.x, object.position.z );

		let speed = this.airspeed;
		const pressure = 0.5 * AIR_DENSITY * speed * speed * A.wingArea;
		const lift = this._liftCoefficient( this._groundPitch );
		const wheelLoad = Math.max( 0, 1 - lift * pressure / ( A.mass * GRAVITY ) );
		// Pente de la piste dans l'axe de roulage (sans le cabré de l'avion) : > 0 en montée
		this._groundNormal( object.position.x, object.position.z, _normal );
		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		const slope = _forward.addScaledVector( _normal, - _forward.dot( _normal ) ).normalize().y;
		speed += ( ( this._thrust( speed ) - this._dragCoefficient( lift ) * pressure ) / A.mass - GRAVITY * slope ) * dt;
		speed -= ( A.rolling[ this.surface ] + input.brake * A.brakes ) * wheelLoad * dt;
		this.airspeed = speed = Math.max( 0, speed );

		// Palonnier (et manche à basse vitesse) : moins d'autorité quand ça va vite
		const steer = MathUtils.clamp( input.yaw + input.roll * 0.5, - 1, 1 );
		const authority = Math.min( 1, speed / 3 ) * ( 1 - 0.6 * Math.min( 1, speed / this.rotateSpeed ) );
		this._groundYaw += steer * 0.6 * authority * dt;

		// Profondeur : le nez ne se lève qu'avec assez de vitesse, sinon il retombe sur sa roulette
		// Aide "rotation automatique" : manche au neutre, le trim lève doucement le nez jusqu'à son assiette
		const trimPitch = MathUtils.clamp( this.trimAlpha(), 0, A.maxGroundPitch );
		if ( input.pitch > 0 && speed > this.rotateSpeed * 0.85 ) {
			this._groundPitch += input.pitch * 0.12 * Math.min( 1, ( speed / this.rotateSpeed ) ** 2 ) * dt; // ~7°/s
		} else if ( this.assists.rotation && Math.abs( input.pitch ) < 0.05 && speed > this.rotateSpeed && this._groundPitch < trimPitch ) {
			this._groundPitch = Math.min( trimPitch, this._groundPitch + 0.06 * dt );
		} else {
			this._groundPitch -= ( input.pitch < 0 ? 0.6 : 0.25 ) * ( 0.3 + 0.7 * wheelLoad ) * dt;
		}
		this._groundPitch = MathUtils.clamp( this._groundPitch, 0, A.maxGroundPitch );

		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		object.position.addScaledVector( _forward, speed * dt );
		this._alignToGround();

		// Décollage : la portance dépasse le poids, l'avion quitte le sol le long de la piste, nez levé
		if ( wheelLoad <= 0 ) {
			this.onGround = false;
			this._groundNormal( object.position.x, object.position.z, _normal );
			_forward.addScaledVector( _normal, - _forward.dot( _normal ) ).normalize();
			this.velocity.copy( _forward ).multiplyScalar( speed );
			this.alpha = this._groundPitch;
			this._liftoffAlpha = this._groundPitch;
			this._liftoffBlend = this.assists.smoothLiftoff ? 1 : 0;
			this._angularVelocity.set( 0, 0, 0 );
		this._pathAngle = null;
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
		const A = this.aircraft;
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
		else if ( _normal.y < A.minSlopeNormal ) reason = 'Collision avec le relief';
		else if ( impact > A.crashSink ) reason = `Impact trop violent (${Math.round( impact / 0.3048 * 60 )} ft/min)`;
		else if ( Math.abs( bank ) > A.crashBank ) reason = 'Une aile a touché le sol';
		else if ( pitch < A.crashNose ) reason = 'L\'avion a touché du nez';
		else if ( pitch > A.crashTail ) reason = 'La queue a touché le sol';

		if ( reason ) {
			object.position.y = floor;
			this._crash( reason );
			return;
		}

		// Atterrissage : l'avion continue de rouler à sa vitesse horizontale
		this.onGround = true;
		this._groundYaw = Math.atan2( - _forward.x, - _forward.z );
		this._groundPitch = MathUtils.clamp( pitch, 0, A.maxGroundPitch );
		this.airspeed = Math.max( 0, this.velocity.dot( _forward.setY( 0 ).normalize() ) );
		this.velocity.set( 0, 0, 0 );
		this._angularVelocity.set( 0, 0, 0 );
		this._pathAngle = null;
		this.stalled = false;
		this._wind.set( 0, 0, 0 );
		this._alignToGround();
		this.dispatchEvent( { type: 'touchdown', impact } );
	}

	_checkObstacles() {
		const position = this.object.position;
		for ( const box of this.obstacles ) {
			if ( box.distanceToPoint( position ) < this.aircraft.obstacleMargin ) {
				this._crash( 'Collision avec un obstacle' );
				return;
			}
		}
	}

	_crash( reason ) {
		this.crashed = true;
		this.stalled = false;
		this.airspeed = 0;
		this.velocity.set( 0, 0, 0 );
		this.throttle = 0;
		this.dispatchEvent( { type: 'crash', reason } );
	}

	// Normale du terrain (différences finies sur le relief)
	_groundNormal( x, z, target ) {
		const h = this.groundHeight;
		return target.set( h( x - 1, z ) - h( x + 1, z ), 2, h( x, z - 1 ) - h( x, z + 1 ) ).normalize();
	}
}

export { FlightModel };
