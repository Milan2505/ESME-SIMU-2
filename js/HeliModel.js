import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { FlightModel } from './FlightModel.js';

// Modèle de vol d'hélicoptère (Robinson R44 Raven II), à la place de FlightModel quand on pilote le R44. Même interface
// que FlightModel pour le reste du jeu (commandes, événements 'liftoff', 'touchdown', 'crash', obstacles…) :
// - commandes : controls.pitch (+ = cyclique en arrière), controls.roll (+ = à gauche), controls.yaw (+ = pied gauche),
//   throttle = pas collectif (0 en bas, 1 en haut) ;
// - rotor principal (théorie de l'élément de pale et de la quantité de mouvement) : traction selon le pas, la vitesse
//   de rotation et l'écoulement à travers le disque (vitesse induite, montée ou descente, vitesse d'avancement :
//   portance de translation, effet de sol, état d'anneaux tourbillonnaires), puissance et couple absorbés ;
// - disque rotor basculé par le cyclique, qui suit avec un léger retard (battement) et recule avec la vitesse : la
//   traction, appliquée au moyeu au-dessus du centre de gravité, fait pencher l'appareil (rotor bipale semi-rigide,
//   comme le vrai : pas de moment au moyeu, d'où le danger du « mast bumping » sous facteur de charge faible) ;
// - régime du rotor : couple du moteur (embrayage, roue libre) moins couple du rotor et du rotor anticouple ;
//   autorotation possible (moteur coupé, pas en bas, l'écoulement montant entraîne le rotor) ;
// - rotor anticouple aux palonniers : il compense le couple du rotor (et pousse l'appareil vers la droite) ;
// - patins : quatre points de contact (ressorts amortis, frottement), d'où posé en pente, glissade, renversement.
// Le moteur (régulateur, embrayage) vient de R44Systems (engine.drive).

const G = 9.81;
const RHO0 = 1.225;
const STEP = 1 / 240;
const deg = MathUtils.degToRad;
// Aide au stationnaire : assiettes et vitesse de lacet obtenues commandes à fond
const HELI_PITCH_RANGE = deg( 30 );
const HELI_ROLL_RANGE = deg( 45 );
const HELI_YAW_RATE = deg( 75 );    // par s (avant : 45°/s)

// Caractéristiques : repère du modèle 3D (x à droite, y en haut, z vers l'arrière, mètres ; origine celle du modèle
// FlightGear, ~2,2 m en arrière du mât)
const R44_HELI = {
	label: 'Robinson R44 Raven II',
	densityAltitude: true,              // performances qui baissent avec l'altitude
	mass: 930,                          // kg : à vide 685 + pilote, passager et ~2/3 du carburant
	cg: new Vector3( 0, - 0.3, - 2.25 ),
	inertia: new Vector3( 1650, 1500, 600 ),   // kg·m² : tangage (x), lacet (y), roulis (z)
	// Rotor principal : bipale, 10,06 m, 400 tr/min (100 %)
	hub: new Vector3( 0, 1.605, - 2.218 ),
	mastTilt: deg( 3 ),                 // mât incliné vers l'avant
	radius: 5.03,
	solidity: 2 * 0.254 / ( Math.PI * 5.03 ),
	liftSlope: 5.7,
	profileDrag: 0.009,
	rotorRpm: 400,
	rotorInertia: 620,                  // kg·m² (pales et moyeu)
	collectiveMin: deg( - 0.5 ),        // pas à 75 % du rayon, collectif en bas…
	collectiveMax: deg( 14 ),           // … et en haut
	cyclicPitch: deg( 10 ),             // basculement du disque, cyclique à fond (avant / arrière)
	cyclicRoll: deg( 8 ),               // (gauche / droite)
	flapTime: 0.09,                     // s : le disque suit le cyclique et le mât
	// Rotor anticouple (à gauche de la queue, poussant la queue vers la droite)
	tailRotor: new Vector3( - 0.247, 0.395, 3.609 ),
	tailThrust: 1350,                   // N, palonniers au neutre … (x tailPitch)
	tailPitchZero: 0.36,
	tailPitchPedal: 0.62,
	tailRadius: 0.73,
	// Fuselage : surfaces de traînée équivalentes (m²) avant, côté, dessus ; stabilité de route et de tangage
	dragArea: new Vector3( 5.5, 5.0, 0.8 ),    // x : côté, y : dessus, z : avant
	finStability: 3.2,                  // m² × bras (dérive et poutre de queue)
	stabilizerStability: 2.4,           // stabilisateur horizontal
	yawDamping: 1400,                   // N·m·s (rotor anticouple, dérive)
	pitchDamping: 500,
	rollDamping: 300,
	// Patins : bas des tubes, à l'avant et à l'arrière, de chaque côté ; sabot de queue
	skids: [
		new Vector3( - 1.05, - 1.64, - 3.603 ), new Vector3( 1.05, - 1.64, - 3.603 ),
		new Vector3( - 1.05, - 1.64, - 1.465 ), new Vector3( 1.05, - 1.64, - 1.465 ),
	],
	tailSkid: new Vector3( 0.183, - 0.445, 4.018 ),
	skidStiffness: 120000,              // N/m par point
	skidDamping: 9000,                  // N·s/m par point
	skidFriction: { asphalt: 0.45, grass: 0.6, water: 0.05 },
	crashSink: 3.6,                     // m/s : au-delà, les patins cassent
	crashBank: deg( 32 ),               // renversement (dynamic rollover) au sol
	vne: 130 * 0.5144,
	obstacleMargin: 5.2,                // rayon du rotor
	// (champs de FlightModel, sans objet ici)
	rotateSpeed: 20, flapLevels: [ 0 ], flapRate: 1, gearTime: 0, airStartSpeed: 25,
	trimTabMin: 0, trimTabMax: 0, takeoffTrim: 0, alphaStall: deg( 40 ), flapStallAlpha: 0,
	minSlopeNormal: 0.85,
};

const _q = new Quaternion();
const _m = new Matrix4();
const _v = new Vector3();
const _w = new Vector3();
const _f = new Vector3();
const _air = new Vector3();
const _bodyAir = new Vector3();
const _shaft = new Vector3();
const _target = new Vector3();
const _hub = new Vector3();
const _arm = new Vector3();
const _moment = new Vector3();
const _force = new Vector3();
const _cg = new Vector3();
const _point = new Vector3();
const _pointVelocity = new Vector3();
const _normal = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _forward = new Vector3();
const _tangent = new Vector3();
const _inverse = new Quaternion();
const _xAxis = new Vector3( 1, 0, 0 );
const _zAxis = new Vector3( 0, 0, 1 );

class HeliModel extends FlightModel {

	constructor( object, aircraft = R44_HELI ) {
		super( object, aircraft );
		this.heli = true;
		this.engine = null;                 // R44Systems : drive(Ω, dt) -> couple au rotor (N·m)
		this.rotorSpeed = 0;                // rad/s
		this.rotorRpm = 0;                  // tr/min
		this.tailRotorRpm = 0;
		this.collective = 0;                // pas (rad) à 75 % du rayon
		this.cyclic = { pitch: 0, roll: 0 };   // position effective du cyclique (-1 -> 1), aussi pour le cockpit
		this.pedal = 0;
		this.rotorThrust = 0;               // N
		this.rotorPower = 0;                // W absorbés par le rotor principal
		this.rotorTorque = 0;               // N·m
		this.tailThrust = 0;
		this.inflow = 0.03;                 // λ (écoulement à travers le disque / vitesse en bout de pale)
		this.vortexRing = 0;                // 0 -> 1 : état d'anneaux tourbillonnaires
		this.rotorBrake = false;
		this.disc = new Vector3( 0, 1, 0 );   // normale au disque rotor (repère monde)
		this.groundLoad = 1;                // part du poids sur les patins (0 -> 1)
		this.lowG = 0;                      // s passées sous faible facteur de charge (mast bumping)
		this.assists.heliStability = true;  // aide au vol stationnaire (assiette tenue, cap tenu)
		this._omega = new Vector3();        // vitesse angulaire (repère appareil) : x tangage, y lacet, z roulis
		this._contact = 0;
		this._airborneTime = 0;
		this._heading = 0;                  // cap tenu par l'aide (rad)
		this._trimPitch = 0;                // intégrateurs de l'aide
		this._trimRoll = 0;
		this._trimYaw = 0;
		this._shake = 0;
	}

	// Rotor à son régime de vol (départ en vol, ou au sol moteur tournant)
	spinUp() {
		this.rotorSpeed = this.aircraft.rotorRpm * Math.PI / 30 * 1.02;
	}

	placeOnGround() {
		super.placeOnGround();
		this._resetDynamics();
		this.onGround = true;
		this.groundLoad = 1;
		this.throttle = 0;
		this.rotorSpeed = 0;   // (prêt à décoller : relancé par le simulateur, voir spinUp)
	}

	restart( onGround ) {
		super.restart( onGround );
		this._resetDynamics();
		this.groundLoad = onGround ? 1 : 0;
		this._contact = onGround ? 4 : 0;
		if ( ! onGround ) {
			// Départ en vol : 25 m/s, rotor à son régime, collectif de croisière
			this.spinUp();
			this.throttle = 0.45;
		}
	}

	_resetDynamics() {
		this._omega.set( 0, 0, 0 );
		this.disc.set( 0, 1, 0 ).applyQuaternion( this.object.quaternion );
		this._trimPitch = this._trimRoll = this._trimYaw = 0;
		this._heading = this._currentHeading();
		this.vortexRing = 0;
		this.lowG = 0;
		this.stalled = false;
	}

	// --- Interface de FlightModel (avion) sans objet ici ---
	setFlapLevel() { this.flapLevel = 0; }
	setGear() { return false; }
	stallAlpha() { return this.aircraft.alphaStall; }
	stallSpeed() { return 0; }
	trimAlpha() { return 0; }
	trimSpeed() { return 0; }
	nearStall() { return false; }
	flapSetting() { return 0; }

	// Régime du rotor en % (100 % = 400 tr/min)
	get rotorPercent() {
		return this.rotorSpeed / ( this.aircraft.rotorRpm * Math.PI / 30 ) * 100;
	}

	step( delta ) {
		if ( this.crashed ) return;
		this._updateGusts( delta );
		const steps = Math.ceil( delta / STEP );
		for ( let i = 0; i < steps && ! this.crashed; i ++ ) this._physics( delta / steps );
		this.rotorRpm = this.rotorSpeed * 30 / Math.PI;
		this.tailRotorRpm = this.rotorRpm * 6.0;
		if ( ! this.crashed ) this._checkObstacles();
	}

	_currentHeading() {
		_forward.set( 0, 0, - 1 ).applyQuaternion( this.object.quaternion );
		return Math.atan2( - _forward.x, - _forward.z );
	}

	// Un pas de calcul (dt s)
	_physics( dt ) {
		const A = this.aircraft;
		const object = this.object;
		const q = object.quaternion;
		const rho = this.airDensity();
		_right.set( 1, 0, 0 ).applyQuaternion( q );
		_up.set( 0, 1, 0 ).applyQuaternion( q );
		_forward.set( 0, 0, - 1 ).applyQuaternion( q );
		_inverse.copy( q ).invert();

		// Vent relatif (repère monde) et dans le repère de l'appareil
		_air.copy( this.velocity ).sub( this._wind ).sub( this.wind );
		_bodyAir.copy( _air ).applyQuaternion( _inverse );
		const speed = _air.length();
		this.airspeed = speed;
		// Anémomètre : vitesse d'avancement (peu fiable sous ~20 kt, comme le vrai)
		this.indicatedSpeed = Math.max( 0, - _bodyAir.z ) * Math.sqrt( rho / RHO0 );
		this.beta = speed > 3 ? Math.asin( MathUtils.clamp( _bodyAir.x / speed, - 1, 1 ) ) : 0;
		this.alpha = speed > 3 ? Math.atan2( _bodyAir.y, - _bodyAir.z ) : 0;

		// --- Commandes : collectif, cyclique (aide au vol stationnaire), palonniers ---
		const input = this.controls;
		this.collective = MathUtils.lerp( A.collectiveMin, A.collectiveMax, MathUtils.clamp( this.throttle, 0, 1 ) );
		let cyclicPitch = input.pitch, cyclicRoll = input.roll, pedal = input.yaw;
		if ( this.assists.heliStability ) [ cyclicPitch, cyclicRoll, pedal ] = this._stabilize( dt, input, speed );
		this.cyclic.pitch = MathUtils.clamp( cyclicPitch, - 1, 1 );
		this.cyclic.roll = MathUtils.clamp( cyclicRoll, - 1, 1 );
		this.pedal = MathUtils.clamp( pedal, - 1, 1 );

		// --- Rotor principal ---
		const omega100 = A.rotorRpm * Math.PI / 30;
		const Omega = Math.max( 0, this.rotorSpeed );
		const tip = Math.max( 1, Omega * A.radius );
		const area = Math.PI * A.radius * A.radius;
		// Arbre (mât) et disque visé : cyclique (en arrière : disque basculé vers l'arrière), recul du disque avec la
		// vitesse (il faut pousser le cyclique pour avancer vite)
		_shaft.set( 0, Math.cos( A.mastTilt ), - Math.sin( A.mastTilt ) );
		const mu = Math.min( 0.45, Math.hypot( _bodyAir.x, _bodyAir.z ) / tip );
		const blowback = Omega > 5 ? 2 * mu * ( 4 / 3 * this.collective - this.inflow ) : 0;
		const flowDir = Math.hypot( _bodyAir.x, _bodyAir.z ) > 0.5 ? Math.atan2( _bodyAir.x, - _bodyAir.z ) : 0;
		// Basculement (rad) : + tangage = disque vers l'arrière (cabrer) ; + roulis = disque vers la gauche
		const tiltPitch = this.cyclic.pitch * A.cyclicPitch + blowback * Math.cos( flowDir ) * 0.5;
		const tiltRoll = this.cyclic.roll * A.cyclicRoll - blowback * Math.sin( flowDir ) * 0.25;
		_target.copy( _shaft ).applyAxisAngle( _xAxis, tiltPitch ).applyAxisAngle( _zAxis, tiltRoll ).applyQuaternion( q );
		// Le disque suit (battement) : plus lentement si le rotor tourne lentement
		const follow = Omega > 3 ? Math.min( 1, dt / A.flapTime * Omega / omega100 ) : 1;
		this.disc.lerp( _target, follow ).normalize();

		// Écoulement : composante du vent relatif perpendiculaire au disque (montée : > 0), vitesse d'avancement
		const climb = _air.dot( this.disc );         // vitesse le long de la normale du disque (montée : > 0)
		const lambdaC = climb / tip;
		const muDisc = Math.sqrt( Math.max( 0, speed * speed - climb * climb ) ) / tip;
		const theta = this.collective;
		const sa = A.solidity * A.liftSlope;
		// Effet de sol : hauteur du moyeu au-dessus du sol, en rayons (s'estompe avec la vitesse)
		_hub.copy( A.hub ).applyQuaternion( q ).add( object.position );
		const hubHeight = Math.max( 0.3, _hub.y - this.groundHeight( _hub.x, _hub.z ) );
		const ige = MathUtils.clamp( ( A.radius / ( 4 * hubHeight ) ) ** 2, 0, 0.28 ) * MathUtils.clamp( 1 - muDisc / 0.12, 0, 1 );
		this.groundEffect = ige;
		// Vitesse induite (point fixe sur λ) : CT de l'élément de pale, λi de la quantité de mouvement (Glauert)
		let lambda = this.inflow, ct = 0;
		for ( let k = 0; k < 6; k ++ ) {
			ct = sa / 2 * ( theta * ( 1 / 3 + muDisc * muDisc / 2 ) - lambda / 2 );
			const lambdaI = Math.max( 0, ct ) / ( 2 * Math.sqrt( muDisc * muDisc + lambda * lambda + 1e-4 ) ) * ( 1 - ige );
			lambda += ( lambdaC + lambdaI - lambda ) * 0.5;
		}
		this.inflow = lambda;
		// Régime faible : les pales décrochent (sous ~80 %, la traction s'effondre)
		const rpmFraction = Omega / omega100;
		const bladeStall = MathUtils.smoothstep( rpmFraction, 0.62, 0.82 );
		// État d'anneaux tourbillonnaires : descente verticale entre ~0,4 et 1,5 vitesse induite, peu de vitesse
		const vh = Math.sqrt( Math.max( 1, this.aircraft.mass * G ) / ( 2 * rho * area ) );
		const descent = - climb / vh;
		const vrs = MathUtils.smoothstep( descent, 0.3, 0.7 ) * ( 1 - MathUtils.smoothstep( descent, 1.4, 2 ) )
			* ( 1 - MathUtils.smoothstep( speed, 6, 12 ) );
		this.vortexRing += ( vrs - this.vortexRing ) * Math.min( 1, dt * 2 );
		const vrsLoss = 1 - 0.3 * this.vortexRing * ( 0.7 + 0.3 * Math.sin( this._airborneTime * 7.3 ) );
		const thrust = Math.max( 0, ct ) * rho * area * tip * tip * bladeStall * vrsLoss;
		this.rotorThrust = thrust;
		// Puissance : induite et de montée (T·λ·ΩR) + profil des pales ; en descente rapide elle devient négative
		// (autorotation : l'air entraîne le rotor)
		const profile = A.solidity * A.profileDrag / 8 * ( 1 + 4.65 * muDisc * muDisc ) * rho * area * tip ** 3
			* ( 1 + 3 * ( 1 - bladeStall ) );
		// (puissance induite : × 1,15, pertes du sillage non uniforme)
		this.rotorPower = thrust * lambda * tip * ( lambda > 0 ? 1.15 : 1 ) / Math.max( 0.3, bladeStall ) + profile;
		this.rotorTorque = Omega > 0.5 ? this.rotorPower / Omega : 0;

		// --- Rotor anticouple ---
		const tailPitch = A.tailPitchZero + A.tailPitchPedal * this.pedal;
		const tailThrust = A.tailThrust * tailPitch * rpmFraction * rpmFraction * ( rho / RHO0 )
			// (vent de travers sur le rotor anticouple : sa poussée change, le nez part)
			* ( 1 - 0.25 * MathUtils.clamp( _bodyAir.x / 15, - 1, 1 ) * Math.sign( tailPitch ) );
		this.tailThrust = tailThrust;
		const tailPower = Math.abs( tailThrust ) ** 1.5 / Math.sqrt( 2 * rho * Math.PI * A.tailRadius ** 2 ) + 0.02 * profile;
		const tailTorque = Omega > 0.5 ? tailPower / Omega : 0;

		// --- Régime du rotor : moteur (embrayage, roue libre), rotor, rotor anticouple, frottements, frein ---
		const drive = this.engine ? this.engine.drive( Omega, dt ) : 0;
		const friction = 25 + 0.6 * Omega + ( this.rotorBrake ? 900 : 0 );
		this.rotorSpeed = Math.max( 0, Omega + ( drive - this.rotorTorque - tailTorque - friction * Math.sign( Omega ) ) / A.rotorInertia * dt );

		// --- Forces (repère monde) ---
		_force.set( 0, - A.mass * G, 0 );
		_force.addScaledVector( this.disc, thrust );
		// Traînée du fuselage (repère appareil), et le souffle du rotor sur le dessus de la cabine
		_f.set(
			- 0.5 * rho * A.dragArea.x * Math.abs( _bodyAir.x ) * _bodyAir.x,
			- 0.5 * rho * A.dragArea.y * Math.abs( _bodyAir.y ) * _bodyAir.y,
			- 0.5 * rho * A.dragArea.z * Math.abs( _bodyAir.z ) * _bodyAir.z );
		_f.applyQuaternion( q );
		_force.add( _f );
		// Poussée du rotor anticouple : vers la droite de l'appareil (dérive vers la droite en stationnaire)
		_force.addScaledVector( _right, tailThrust );

		// --- Moments (repère appareil) ---
		_moment.set( 0, 0, 0 );
		// Traction appliquée au moyeu : r × F (repère appareil, par rapport au centre de gravité)
		_arm.copy( A.hub ).sub( A.cg );
		_f.copy( this.disc ).applyQuaternion( _inverse ).multiplyScalar( thrust );
		_moment.add( _w.crossVectors( _arm, _f ) );
		// Couple du rotor (sens inverse d'horloge vu de dessus) : l'appareil tourne en sens horaire (nez à droite)
		_moment.y -= this.rotorTorque;
		// Rotor anticouple : poussée vers la droite à la queue -> nez à gauche (et un peu de roulis)
		_arm.copy( A.tailRotor ).sub( A.cg );
		_moment.add( _w.crossVectors( _arm, _f.set( tailThrust, 0, 0 ) ) );
		// Stabilité de route (dérive) et de tangage (stabilisateur) : pression dynamique × dérapage / incidence
		const dyn = 0.5 * rho * speed * speed;
		_moment.y += - A.finStability * dyn * this.beta;
		_moment.x += - A.stabilizerStability * dyn * ( speed > 8 ? Math.atan2( - _bodyAir.y, - _bodyAir.z ) : 0 ) * 0.5;
		// Amortissements
		_moment.x -= A.pitchDamping * this._omega.x;
		_moment.y -= A.yawDamping * this._omega.y * ( 0.3 + 0.7 * rpmFraction );
		_moment.z -= A.rollDamping * this._omega.z;
		// Anneaux tourbillonnaires : secousses
		if ( this.vortexRing > 0.2 ) {
			_moment.x += ( Math.random() - 0.5 ) * 3000 * this.vortexRing;
			_moment.z += ( Math.random() - 0.5 ) * 3000 * this.vortexRing;
		}

		// --- Patins : contacts avec le sol ---
		this._contactForces( dt, _force, _moment );

		// --- Intégration ---
		_cg.copy( A.cg ).applyQuaternion( q ).add( object.position );
		this.velocity.addScaledVector( _force, dt / A.mass );
		_cg.addScaledVector( this.velocity, dt );
		const I = A.inertia;
		this._omega.x += _moment.x / I.x * dt;
		this._omega.y += _moment.y / I.y * dt;
		this._omega.z += _moment.z / I.z * dt;
		this._omega.clampScalar( - 4, 4 );
		_q.set( this._omega.x * dt / 2, this._omega.y * dt / 2, this._omega.z * dt / 2, 1 ).normalize();
		q.multiply( _q ).normalize();
		object.position.copy( _cg ).sub( _v.copy( A.cg ).applyQuaternion( q ) );

		// Facteur de charge (traction / poids) et accélération latérale (bille)
		this.loadFactor = thrust / ( A.mass * G );
		this.sideAcceleration = _f.copy( _force ).setY( _force.y + A.mass * G ).dot( _right ) / A.mass;
		this._airborneTime += dt;
		this._checkHazards( dt );
	}

	// Aide au vol stationnaire (assists.heliStability) : le cyclique commande une assiette (tenue d'elle-même manche
	// lâché, et l'appareil s'arrête de glisser à basse vitesse), les palonniers une vitesse de lacet (cap tenu)
	_stabilize( dt, input, speed ) {
		const q = this.object.quaternion;
		_forward.set( 0, 0, - 1 ).applyQuaternion( q );
		_right.set( 1, 0, 0 ).applyQuaternion( q );
		const pitch = Math.asin( MathUtils.clamp( _forward.y, - 1, 1 ) );
		const roll = Math.asin( MathUtils.clamp( _right.y, - 1, 1 ) );   // + = penché à gauche (aile droite haute)
		const onGround = this.groundLoad > 0.5;
		// Vitesse sol dans le repère de l'appareil (glissade à arrêter près du stationnaire)
		const fl = Math.hypot( _forward.x, _forward.z ) || 1, rl = Math.hypot( _right.x, _right.z ) || 1;
		const vForward = ( this.velocity.x * _forward.x + this.velocity.z * _forward.z ) / fl;
		const vRight = ( this.velocity.x * _right.x + this.velocity.z * _right.z ) / rl;
		const hover = 1 - MathUtils.smoothstep( speed, 8, 18 );
		// Vol en avant (au-delà de ~25 kt) : vol « bille au centre » (sans glissade), comme le pilote qui penche un peu
		// à gauche contre la poussée du rotor anticouple. Avant, ailes à plat et cap bloqué : l'appareil avançait en crabe
		// (5 à 11° de glissade) et l'aide la corrigeait d'un côté puis de l'autre à chaque touche : il se balançait
		const cruise = MathUtils.smoothstep( speed, 10, 16 );
		const beta = this.beta;
		// Maintien en stationnaire (manche lâché, à basse vitesse) : il s'installe et s'efface en douceur (avant : d'un
		// coup au lâcher de la touche, un à-coup d'assiette)
		const holdTarget = ( Math.abs( input.pitch ) < 0.05 && Math.abs( input.roll ) < 0.05 ) ? hover : 0;
		this._hold = ( this._hold ?? 0 ) + ( holdTarget - ( this._hold ?? 0 ) ) * Math.min( 1, dt * 1.5 );
		const hold = this._hold;
		// Assiettes visées (rad) : manche à fond = ±30° en tangage, ±45° en roulis (avant : ±18° et ±22°, l'appareil
		// semblait bridé : virages et accélérations mous) ; près du stationnaire, manche lâché, contre la glissade
		const pitchTarget = input.pitch * HELI_PITCH_RANGE + hold * MathUtils.clamp( vForward * 0.035, - 0.18, 0.18 );
		// Route tenue en vol en avant, manche lâché (+ = à gauche, comme le cap) : l'aide penche du côté où revenir
		const track = Math.atan2( - this.velocity.x, - this.velocity.z );
		if ( Math.abs( input.roll ) > 0.05 || this._track === undefined || cruise < 0.5 ) this._track = track;
		const trackError = Math.atan2( Math.sin( this._track - track ), Math.cos( this._track - track ) );
		const rollTarget = input.roll * HELI_ROLL_RANGE - hold * MathUtils.clamp( - vRight * 0.035, - 0.18, 0.18 )
			+ cruise * ( MathUtils.clamp( beta * 0.8, - 0.2, 0.2 ) + MathUtils.clamp( trackError * 1.2, - 0.15, 0.15 ) );
		// (gain plus fort qu'avant, 2,2 : l'assiette demandée est prise plus vite ; amortissement relevé d'autant)
		const kp = 2.8, kd = 1.3, ki = 0.6;
		const ePitch = pitchTarget - pitch, eRoll = rollTarget - roll;
		if ( ! onGround ) {
			this._trimPitch = MathUtils.clamp( this._trimPitch + ePitch * ki * dt, - 0.6, 0.6 );
			this._trimRoll = MathUtils.clamp( this._trimRoll + eRoll * ki * dt, - 0.6, 0.6 );
		}
		let cyclicPitch = kp * ePitch - kd * this._omega.x + this._trimPitch;
		let cyclicRoll = kp * eRoll - kd * this._omega.z + this._trimRoll;
		// Au sol : manche au neutre (sauf ce que demande le pilote) pour ne pas basculer sur les patins
		if ( onGround ) {
			cyclicPitch = input.pitch * 0.7;
			cyclicRoll = input.roll * 0.7;
		}
		// Lacet : vitesse de lacet visée (palonniers : ±HELI_YAW_RATE), cap tenu palonniers lâchés
		// (appareil bien posé, rotor lent : cap pris tel quel ; dès qu'il s'allège, il est tenu)
		const heading = this._currentHeading();
		const firm = this.groundLoad > 0.85;
		// (vol en avant : le cap suit la trajectoire, voir plus bas ; il est repris tel quel au retour en stationnaire)
		if ( Math.abs( input.yaw ) > 0.05 || firm || cruise > 0.5 ) this._heading = heading;
		let headingError = this._heading - heading;
		headingError = Math.atan2( Math.sin( headingError ), Math.cos( headingError ) );
		// Palonniers lâchés : stationnaire, cap tenu ; vol en avant, nez dans la trajectoire (glissade annulée : + = vent
		// relatif de la droite, le nez doit venir à droite)
		const yawRateTarget = Math.abs( input.yaw ) > 0.05 ? input.yaw * HELI_YAW_RATE
			: ( 1 - cruise ) * headingError * 1.5 - cruise * MathUtils.clamp( beta * 2, - 0.6, 0.6 );
		const eYaw = yawRateTarget - this._omega.y;
		if ( ! onGround ) this._trimYaw = MathUtils.clamp( this._trimYaw + eYaw * 0.8 * dt, - 0.8, 0.8 );
		// Palonnier qui compense le couple du collectif (anticipation) + correction de la vitesse de lacet
		const torqueFeed = - 0.3 + 0.6 * this.throttle;
		const pedal = firm ? input.yaw : 1.6 * eYaw + this._trimYaw + torqueFeed;
		return [ cyclicPitch, cyclicRoll, pedal ];
	}

	// Contacts des patins (ressort amorti le long de la normale du sol, frottement) ; atterrissage, envol, chocs
	_contactForces( dt, force, moment ) {
		const A = this.aircraft;
		const object = this.object;
		const q = object.quaternion;
		this.surface = this.surfaceAt( object.position.x, object.position.z );
		const friction = A.skidFriction[ this.surface ] ?? 0.55;
		let contacts = 0, load = 0, impact = 0;
		_cg.copy( A.cg ).applyQuaternion( q ).add( object.position );
		for ( const skid of A.skids ) {
			_point.copy( skid ).applyQuaternion( q ).add( object.position );
			const ground = this.groundHeight( _point.x, _point.z );
			const depth = ground - _point.y;
			if ( depth <= 0 ) continue;
			contacts ++;
			this._groundNormal( _point.x, _point.z, _normal );
			// Vitesse du point : v + ω × r (ω en repère monde)
			_w.copy( this._omega ).applyQuaternion( q );
			_arm.copy( _point ).sub( _cg );
			_pointVelocity.crossVectors( _w, _arm ).add( this.velocity );
			const vn = _pointVelocity.dot( _normal );
			impact = Math.max( impact, - vn );
			const normalForce = Math.max( 0, A.skidStiffness * Math.min( depth, 0.4 ) - A.skidDamping * vn );
			_f.copy( _normal ).multiplyScalar( normalForce );
			// Frottement : opposé au glissement, borné par μ·N (adhérence presque totale à l'arrêt)
			_tangent.copy( _pointVelocity ).addScaledVector( _normal, - vn );
			const slide = _tangent.length();
			if ( slide > 1e-4 ) {
				const limit = friction * normalForce;
				const stick = 20000 * slide;   // (visqueux à très faible vitesse : pas de tremblement)
				_f.addScaledVector( _tangent, - Math.min( limit, stick ) / slide );
			}
			force.add( _f );
			// Moment : r × F, dans le repère de l'appareil
			_v.copy( _arm ).applyQuaternion( _inverse );
			_f.applyQuaternion( _inverse );
			moment.add( _w.crossVectors( _v, _f ) );
			load += normalForce;
		}
		this.groundLoad = MathUtils.clamp( load / ( A.mass * G ), 0, 1 );
		// Patins touchés trop vite : ils cassent (et l'appareil avec)
		if ( contacts && ! this.onGround && impact > A.crashSink ) {
			return this._crash( `Atterrissage trop dur (${Math.round( impact / 0.3048 * 60 )} ft/min)` );
		}
		const touching = contacts >= 2 && this.groundLoad > 0.03;
		if ( touching ) {
			this._contact = 0;
			if ( ! this.onGround ) {
				this.onGround = true;
				this._airborneTime = 0;
				this.dispatchEvent( { type: 'touchdown', impact } );
			}
		} else if ( this.onGround ) {
			// Envol : plus aucun appui depuis 0,2 s (pas sur un simple rebond)
			this._contact += dt;
			if ( this._contact > 0.2 ) {
				this.onGround = false;
				this._contact = 0;
				this._heading = this._currentHeading();
				this.dispatchEvent( { type: 'liftoff' } );
			}
		}
		if ( this.onGround ) {
			// Vitesse de roulage (instruments) : vitesse sur le sol
			this.airspeed = Math.hypot( this.velocity.x, this.velocity.z );
		}
	}

	// Dangers propres à l'hélicoptère : pales ou queue dans le sol, renversement, mast bumping, survitesse
	_checkHazards( dt ) {
		const A = this.aircraft;
		const object = this.object;
		const q = object.quaternion;
		_up.set( 0, 1, 0 ).applyQuaternion( q );
		// Sur le dos, ou trop penché sur les patins
		if ( _up.y < 0 ) return this._crash( 'Hélicoptère sur le dos' );
		if ( this.groundLoad > 0.05 && Math.acos( MathUtils.clamp( _up.y, - 1, 1 ) ) > A.crashBank ) {
			return this._crash( 'Renversement sur un patin (dynamic rollover)' );
		}
		// Pales du rotor (tournant) qui touchent le sol : bout de pale devant, derrière, à gauche, à droite du moyeu
		_hub.copy( A.hub ).applyQuaternion( q ).add( object.position );
		if ( this.rotorSpeed > 5 ) {
			_right.set( 1, 0, 0 ).applyQuaternion( q );
			_forward.set( 0, 0, - 1 ).applyQuaternion( q );
			for ( const [ dx, dz ] of [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ] ) {
				_point.copy( _hub ).addScaledVector( _right, dx * A.radius ).addScaledVector( _forward, dz * A.radius );
				_point.addScaledVector( this.disc, - 0.15 );   // (conicité)
				if ( _point.y < this.groundHeight( _point.x, _point.z ) + 0.1 ) return this._crash( 'Les pales du rotor ont touché le sol' );
			}
		}
		// Queue (sabot, rotor anticouple) dans le sol
		_point.copy( A.tailSkid ).applyQuaternion( q ).add( object.position );
		const tailDepth = this.groundHeight( _point.x, _point.z ) - _point.y;
		if ( tailDepth > 0.25 ) return this._crash( 'Le rotor anticouple a touché le sol' );
		// Facteur de charge faible (poussée sur le cyclique) : le moyeu tape le mât au moindre roulis
		if ( ! this.onGround && this.loadFactor < 0.25 && this.rotorSpeed > 5 ) {
			this.lowG += dt;
			if ( this.lowG > 0.6 && Math.abs( this._omega.z ) > 0.6 ) return this._crash( 'Mast bumping : le moyeu a heurté le mât (facteur de charge trop faible)' );
		} else this.lowG = 0;
		// Plus de rotor en vol (régime effondré) : l'appareil tombe ; au sol, les pales s'arrêtent seules
	}

	_crash( reason ) {
		this._omega.set( 0, 0, 0 );
		super._crash( reason );
	}
}

export { HeliModel, R44_HELI };
