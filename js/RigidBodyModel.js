import { MathUtils, Quaternion, Vector3 } from 'three';
import { FlightModel } from './FlightModel.js';
import { CESSNA_172 } from './Cessna172.js';
import { C172P_AERO } from './data/C172pAero.js';
import { isa, RHO0 } from './Atmosphere.js';

// Modèle de vol « réaliste » du Cessna 172P : corps rigide à 6 degrés de liberté, par forces ET moments.
// - Mêmes commandes, mêmes événements ('liftoff', 'touchdown', 'crash'), mêmes aides, mêmes dégâts, volets, trim, centrage,
//   vent et turbulence que FlightModel (le modèle « simplifié », dont il hérite) : le reste du jeu ne voit pas la différence.
// - Forces : portance, traînée et poussée de FlightModel (polaire et hélice validées contre le manuel de vol, voir
//   tests/perf-c172.test.js), étendues au-delà du décrochage ; force latérale ; poids ; efforts des trois roues.
// - Moments : dérivées de stabilité (données : js/data/C172pAero.js) ; profondeur, ailerons, direction et trim sont des
//   braquages de gouvernes qui créent des moments, plus aucune vitesse de rotation imposée ; effets moteur (couple,
//   souffle hélicoïdal, facteur P, effet gyroscopique) en moments ; tables de décrochage et de vrille (autorotation).
// - Rotation : équations d'Euler avec le tenseur d'inertie, attitude en quaternion, pas fixe de 1/120 s.
// - Train : trois jambes ressort-amortisseur (roulette de nez orientable au palonnier, roues principales freinées
//   séparément : controls.brakeLeft / brakeRight, sinon controls.brake), frottement de roulement, adhérence latérale. Il
//   n'y a pas de « mode sol » : les efforts des roues s'annulent quand elles quittent le sol. onGround, 'liftoff' et
//   'touchdown' se déduisent du contact des roues.
// Repère avion (celui de three.js) : x à droite, y en haut, z vers l'arrière. Vitesse angulaire (_angularVelocity) :
// x tangage (+ = cabrer), y lacet (+ = nez à gauche), z roulis (+ = vers la gauche), comme FlightModel.

const GRAVITY = 9.81;
const STEP = 1 / 120;
const LIFTOFF_TIME = 0.3;          // s sans aucune roue au sol (et roues à plus de LIFTOFF_HEIGHT) : envol
const LIFTOFF_HEIGHT = 0.1;        // m
const AID_LIFTOFF_TIME = 6;        // s : durée des aides « envol en douceur » et « correction de dérive » après l'envol
const AID_CROSSWIND = [ 2, 3 ];     // aide « correction de dérive » : direction par radian de dérapage, et par rad/s de lacet (amortisseur)
const MAX_RATE = 8;                // rad/s : borne de sécurité des vitesses de rotation (vrille comprise)

const _right = new Vector3();
const _up = new Vector3();
const _forward = new Vector3();
const _air = new Vector3();
const _liftDir = new Vector3();
const _force = new Vector3();
const _moment = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _point = new Vector3();
const _arm = new Vector3();
const _pointVelocity = new Vector3();
const _omegaWorld = new Vector3();
const _normal = new Vector3();
const _wheelForward = new Vector3();
const _wheelSide = new Vector3();
const _wheelForce = new Vector3();
const _inverse = new Quaternion();
const _dq = new Quaternion();
const _h = new Vector3();

// y(x) par morceaux sur une table [[x, y], ...] croissante, bornée aux extrémités
function lerpTable( table, x ) {
	if ( x <= table[ 0 ][ 0 ] ) return table[ 0 ][ 1 ];
	for ( let i = 1; i < table.length; i ++ ) {
		if ( x <= table[ i ][ 0 ] ) {
			const [ x0, y0 ] = table[ i - 1 ], [ x1, y1 ] = table[ i ];
			return y0 + ( y1 - y0 ) * ( x - x0 ) / ( x1 - x0 );
		}
	}
	return table[ table.length - 1 ][ 1 ];
}
// Table à deux entrées : lignes [[x, [valeurs pour chaque colonne]], ...], colonnes croissantes
function lerpTable2( columns, rows, x, column ) {
	const at = ( values ) => lerpTable( columns.map( ( c, i ) => [ c, values[ i ] ] ), column );
	return lerpTable( rows.map( ( [ rx, values ] ) => [ rx, at( values ) ] ), x );
}

class RigidBodyModel extends FlightModel {

	constructor( object, aircraft = CESSNA_172, data = C172P_AERO ) {
		super( object, aircraft );
		this.realistic = true;
		this.data = data;
		// Gouvernes (rad) : profondeur (+ = piqueur), ailerons (+ = roulis à droite), direction (+ = nez à gauche)
		this.surfaces = { elevator: 0, aileron: 0, rudder: 0 };
		this.wheels = data.gear.map( ( g ) => ( { ...g, load: 0, contact: false, compression: 0 } ) );
		this._airborneTime = 0;
		this._alphaPrev = null;
		this._alphaDot = 0;
		this._sinceLiftoff = Infinity;    // s depuis l'envol (aides)
		this._impact = 0;                 // vitesse d'arrivée au sol pendant le contact en cours (m/s)
		this.pitchAttitude = 0;           // assiette (rad), inclinaison (rad, + = à gauche)
		this.bankAngle = 0;
		this._calibrateTrim();
	}

	// Trim : braquage de profondeur équivalent au tab, réglé pour que, manche lâché, l'avion tienne les mêmes vitesses que
	// le modèle simplifié (tab à 0 : ~110 kt ; repère décollage : ~86 kt), et coefficient de moment à incidence nulle Cm0
	// qui équilibre l'avion profondeur au neutre. (Réglage du jeu, pas une donnée du manuel)
	_calibrateTrim() {
		const A = this.aircraft, D = this.data;
		const KT = 0.514444;
		const lift = ( v ) => this.mass * GRAVITY / ( 0.5 * RHO0 * v * v * A.wingArea );
		const alpha = ( cl ) => ( cl - A.cl0 ) / A.clAlpha;
		this.cm0 = - D.Cma * alpha( lift( 110 * KT ) );
		const need = lift( 86 * KT );
		const de = - ( this.cm0 + D.Cma * ( need - A.cl0 ) / A.clAlpha ) / ( D.Cmde - D.Cma * D.CLde / A.clAlpha );
		this.trimElevatorPerTab = - de / A.takeoffTrim;   // rad de profondeur par rad de tab (+ : tab à cabrer, profondeur vers le haut)
	}

	_trimElevator() {
		return - this.trim * this.trimElevatorPerTab;
	}

	// Vitesse (m/s) tenue manche lâché, en palier, avec le trim, les volets et le centrage actuels : moment de tangage nul
	trimSpeed() {
		const A = this.aircraft, D = this.data;
		const rho = this.airDensity(), de = this._trimElevator();
		const flapsDeg = this.flaps * A.flapLevels[ A.flapLevels.length - 1 ];
		const residual = ( v ) => {
			const cl = this.mass * GRAVITY / ( 0.5 * rho * v * v * A.wingArea ) - D.CLde * de;
			const alpha = ( cl - A.cl0 - A.flapLift * this.flaps ) / A.clAlpha;
			return this.cm0 + D.Cma * alpha + D.Cmde * de + lerpTable( D.Cmdf, flapsDeg ) + cl * this.cgOffset / D.chord;
		};
		let low = 15, high = 120;
		if ( residual( low ) > 0 ) return low;
		if ( residual( high ) < 0 ) return high;
		for ( let i = 0; i < 40; i ++ ) {
			const mid = ( low + high ) / 2;
			if ( residual( mid ) < 0 ) low = mid; else high = mid;
		}
		return ( low + high ) / 2;
	}

	// Incidence tenue manche lâché (rotation automatique, instruments) : celle du vol en palier à la vitesse du trim
	trimAlpha() {
		const A = this.aircraft, v = this.trimSpeed();
		const cl = this.mass * GRAVITY / ( 0.5 * this.airDensity() * v * v * A.wingArea );
		return ( cl - A.cl0 - A.flapLift * this.flaps ) / A.clAlpha;
	}

	restart( onGround ) {
		super.restart( onGround );
		this._angularVelocity.set( 0, 0, 0 );
		this._alphaPrev = null;
		this._alphaDot = 0;
		this._airborneTime = onGround ? 0 : LIFTOFF_TIME;
		this._sinceLiftoff = onGround ? Infinity : 0;   // départ en vol : comme après un envol (aides)
		this._impact = 0;
		for ( const w of this.wheels ) Object.assign( w, { load: 0, contact: false, compression: 0 } );
	}

	placeOnGround() {
		super.placeOnGround();
		this._angularVelocity.set( 0, 0, 0 );
		this._airborneTime = 0;
		this._sinceLiftoff = Infinity;
	}

	step( delta ) {
		if ( this.crashed ) return;
		const A = this.aircraft;
		const flapTarget = A.flapLevels[ this.flapLevel ] / A.flapLevels[ A.flapLevels.length - 1 ];
		if ( this.flapsPowered ) this.flaps += MathUtils.clamp( flapTarget - this.flaps, - A.flapRate * delta, A.flapRate * delta );
		if ( A.gearTime ) {
			this.gearPosition = MathUtils.clamp( this.gearPosition + ( this.gearDown ? 1 : - 1 ) * delta / A.gearTime, 0, 1 );
			this.speedbrake = MathUtils.clamp( this.speedbrake + ( this.speedbrakeOut ? 1 : - 1 ) * delta / A.speedbrakeTime, 0, 1 );
		}
		this._updateGusts( delta );
		const steps = Math.ceil( delta / STEP - 1e-9 );
		for ( let i = 0; i < steps && ! this.crashed; i ++ ) this._physics( delta / steps );
		if ( ! this.crashed ) this._checkObstacles();
	}

	// --- Commandes et aides (petites boucles de commande au-dessus du modèle) ---

	_commands( alpha, q, beta, r, qbar ) {
		const A = this.aircraft, D = this.data, c = this.controls, damage = this.damage.control;
		let pitch = c.pitch, yaw = c.yaw;
		const handsOff = Math.abs( c.pitch ) < 0.05;
		// Rotation automatique : au sol, manche au neutre, au-delà de la vitesse de rotation, le nez monte à l'assiette du trim
		if ( this.assists.rotation && this.onGround && handsOff && this.indicatedSpeed > this.rotateSpeed ) {
			const target = MathUtils.clamp( this.trimAlpha(), 0, A.maxGroundPitch );
			pitch = MathUtils.clamp( 3 * ( target - this.pitchAttitude ) - 1.5 * q, 0, 0.8 );
		}
		// Envol en douceur : manche lâché après l'envol, un amortisseur de tangage rend le nez progressivement
		if ( this.assists.smoothLiftoff && handsOff && this._sinceLiftoff < AID_LIFTOFF_TIME ) {
			pitch += - 1.2 * q * ( 1 - this._sinceLiftoff / AID_LIFTOFF_TIME );
		}
		// Protection décrochage : le manche tiré ne peut pas amener l'incidence au-delà de la limite
		if ( this.assists.stallProtection && ! this.onGround && pitch > 0 ) {
			const limit = this.stallAlpha() + A.elevatorLimitProtected;
			pitch = Math.min( pitch, MathUtils.clamp( 0.15 + 8 * ( limit - alpha ) - 0.6 * q, - 1, 1 ) );
		}
		// Correction de dérive : après l'envol, la direction annule le dérapage : le nez se met face au vent et la
		// trajectoire reste dans l'axe
		if ( this.assists.crosswindCorrection && ! this.onGround && this._sinceLiftoff < AID_LIFTOFF_TIME * 2 ) {
			const [ kBeta, kRate ] = this._aidGains ?? AID_CROSSWIND;
			yaw = MathUtils.clamp( yaw - kBeta * beta + kRate * r, - 1, 1 );
		}
		// Commandes en effort (commandes non assistées) : au-delà d'une pression dynamique, un même effort au manche braque de
		// moins en moins la gouverne (le moment de charnière croît comme q) ; gains du fichier c172p (option « stick force
		// per g ») : profondeur 15 psf / q, ailerons et direction 30 psf / q
		const elevatorGain = Math.min( 1, D.forceElevator / Math.max( qbar, 1 ) );
		const lateralGain = Math.min( 1, D.forceLateral / Math.max( qbar, 1 ) );
		pitch = MathUtils.clamp( pitch, - 1, 1 ) * damage * elevatorGain;
		const stick = pitch >= 0 ? - pitch * D.elevatorUp : - pitch * D.elevatorDown;
		this.surfaces.elevator = MathUtils.clamp( stick + this._trimElevator(), - D.elevatorUp, D.elevatorDown );
		this.surfaces.aileron = - MathUtils.clamp( c.roll, - 1, 1 ) * D.aileronMax * damage * lateralGain;
		this.surfaces.rudder = MathUtils.clamp( yaw, - 1, 1 ) * D.rudderMax * damage * ( this.onGround ? 1 : lateralGain );
		return { yaw };
	}

	// --- Un pas de calcul ---

	_physics( dt ) {
		const A = this.aircraft, D = this.data, object = this.object;
		const quaternion = object.quaternion, position = object.position;
		_right.set( 1, 0, 0 ).applyQuaternion( quaternion );
		_up.set( 0, 1, 0 ).applyQuaternion( quaternion );
		_forward.set( 0, 0, - 1 ).applyQuaternion( quaternion );
		const w = this._angularVelocity;
		this.pitchAttitude = Math.asin( MathUtils.clamp( _forward.y, - 1, 1 ) );
		this.bankAngle = Math.atan2( _right.y, _up.y );

		// Air : atmosphère, vent relatif, incidence, dérapage
		const atmosphere = isa( position.y, this.temperatureOffset );
		const rho = atmosphere.density;
		_air.copy( this.velocity ).sub( this._wind ).sub( this.wind );
		const speed = _air.length();
		const V = Math.max( speed, 0.1 );
		const u = _air.dot( _forward );
		const alpha = speed > 1 ? Math.atan2( - _air.dot( _up ), u ) : 0;
		const beta = speed > 1 ? Math.asin( MathUtils.clamp( _air.dot( _right ) / V, - 1, 1 ) ) : 0;
		this.alpha = alpha;
		this.beta = beta;
		if ( this._alphaPrev !== null ) this._alphaDot += ( ( alpha - this._alphaPrev ) / dt - this._alphaDot ) * Math.min( 1, dt * 20 );
		this._alphaPrev = alpha;
		this.mach = speed / atmosphere.speedOfSound;
		// Vitesses des instruments : en vol la vitesse vraie ; au sol, l'air dans l'axe (roulage + vent de face)
		this._setIndicatedSpeeds( this.onGround ? Math.max( 0, u ) : speed );
		const groundSpeed = Math.max( 0, this.velocity.dot( _tmp.set( _forward.x, 0, _forward.z ).normalize() ) );
		this.airspeed = this.onGround ? groundSpeed : speed;

		// Moteur et hélice (Propulsion.js) : poussée dans l'axe, souffle sur l'empennage
		this._propulsion( dt, Math.max( 0, u ) );
		const thrust = this._thrust();
		const diskArea = A.propeller ? Math.PI * ( A.propeller.diameter / 2 ) ** 2 : 1;
		const uAxial = Math.max( 0, u );
		const inducedVelocity = A.propeller && thrust > 0 ? 0.5 * ( - uAxial + Math.sqrt( uAxial * uAxial + 2 * thrust / ( rho * diskArea ) ) ) : 0;
		const qbar = 0.5 * rho * V * V;
		const qbarTail = 0.5 * rho * ( uAxial + inducedVelocity ) ** 2;   // empennage dans le souffle de l'hélice
		const qbarWash = 0.5 * rho * inducedVelocity * inducedVelocity;
		const power = A.propeller ? MathUtils.clamp( thrust / this._staticThrust(), 0, 1 ) : 0;

		// Vitesses de rotation, conventions des dérivées : p roulis (+ à droite), q tangage, r lacet (+ nez à droite)
		const p = - w.z, q = w.x, r = - w.y;
		const b = D.span, c = D.chord, S = A.wingArea;
		const half = V > 1 ? 1 / ( 2 * V ) : 0;
		const pHat = p * b * half, qHat = q * c * half, rHat = r * b * half;
		const { yaw } = this._commands( alpha, q, beta, r, 0.5 * rho * V * V );
		const { elevator: de, aileron: da, rudder: dr } = this.surfaces;

		// Décrochage : incidence de décrochage de l'aile (volets compris), aile qui tombe ; tables du fichier JSBSim
		// indexées sur une incidence alignée sur ce décrochage (αJ)
		const stallAlpha = this.stallAlpha();
		if ( ! this.stalled && alpha > stallAlpha && ! this.onGround ) {
			this.stalled = true;
			this._stallBreak = A.stallBreakTime + A.stallBreakDelay;
			const left = MathUtils.clamp( 0.5 + 0.35 * power + 4 * beta, 0.1, 0.9 );
			this._wingDrop = ( this.random() < left ? 1 : - 1 ) * ( 0.5 + 0.5 * this.random() );
		} else if ( this.stalled && ( alpha < stallAlpha - A.stallRecovery || this.onGround ) ) {
			this.stalled = false;
		}
		this._stallBreak = Math.max( 0, this._stallBreak - dt );
		const alphaJ = alpha + D.stallJ - stallAlpha;
		const alphaDeg = MathUtils.radToDeg( alpha + D.stallJ - this.aircraft.alphaStall );

		// Effet de sol (formule de FlightModel)
		const wingHeight = Math.max( 0, position.y - this.groundHeight( position.x, position.z ) - this.minAltitude ) + A.wingHeight;
		const kGround = ( 16 * wingHeight / A.wingspan ) ** 2;
		const groundEffect = kGround / ( 1 + kGround );
		this.groundEffect = 1 - groundEffect;

		// Portance et traînée de l'aile : polaire de FlightModel, puis tables de l'aile décrochée aux grandes incidences
		let clWing = this._liftCoefficient( alpha, this.stalled );
		let cdWing = this._dragCoefficient( clWing, groundEffect );
		const absAlpha = Math.abs( alpha );
		if ( absAlpha > 0.3 ) {
			const blend = MathUtils.smoothstep( absAlpha, 0.3, 0.42 );
			const post = absAlpha <= Math.PI / 2 ? lerpTable( D.CLpost, absAlpha ) : 1.1 * Math.sin( 2 * ( Math.PI - absAlpha ) );
			clWing = MathUtils.lerp( clWing, Math.sign( alpha ) * post, blend );
			cdWing = Math.max( cdWing, A.cd0 + lerpTable( D.CDpost, Math.min( absAlpha, Math.PI - absAlpha ) ) );
		}
		const wingLift = this.damage.wingLift;
		const liftScale = ( 1 + A.groundEffectLift * this.groundEffect ) * ( wingLift[ 0 ] + wingLift[ 1 ] ) / 2;
		// Portance de la profondeur : seulement l'écart au braquage d'équilibre (la polaire de l'avion complet, réglée sur les
		// vitesses du manuel, comprend déjà la déportance de l'empennage en vol équilibré)
		const deTrim = - ( this.cm0 + D.Cma * alpha ) / D.Cmde;
		const CL = clWing * liftScale + D.CLq * qHat + D.CLadot * this._alphaDot * c * half + D.CLde * ( de - deTrim );
		const CD = cdWing + D.CDb * Math.abs( beta );
		const CY = D.CYb * beta + D.CYp * pHat + D.CYr * rHat + D.CYdr * dr;
		this.wingLift[ 0 ] = clWing * wingLift[ 0 ] * qbar * S / 2;
		this.wingLift[ 1 ] = clWing * wingLift[ 1 ] * qbar * S / 2;

		// Roulis
		const stalledN = this.stalled ? 1 : 0;
		const clbK = lerpTable( D.ClbStall, alphaJ );
		const clrK = this.stalled || alphaJ > D.stallJ ? lerpTable2( D.ClrStall.r, D.ClrStall.rows, alphaJ, r ) : 1;
		const clr = alphaJ > D.stallJ ? lerpTable( D.ClrBase, 0.09 ) : D.Clr;
		const daK = lerpTable( D.ClDaStall.map( ( [ x, free, stalled ] ) => [ x, free + ( stalled - free ) * stalledN ] ), alphaJ );
		let Cl = D.Clb * beta * clbK + D.Clp * pHat + clr * rHat * clrK + D.Clda * da * daK + D.Cldr * dr;
		Cl += ( wingLift[ 1 ] - wingLift[ 0 ] ) * clWing / 8;   // aile endommagée : elle porte moins
		// Calage des ailes qui compense le couple de l'hélice en croisière (~120 ch à 2 400 tr/min, 110 kt)
		Cl += D.ClRigging;
		// Aile qui tombe au décrochage (côté tiré au hasard, voir FlightModel), plus forte avec la puissance
		if ( this.stalled && this._stallBreak > 0 ) Cl -= this._wingDrop * 0.025 * ( 0.3 + 0.7 * power );
		// Rafales en roulis : moment qui donnerait seul la vitesse de roulis de la rafale (turbulence)
		Cl += D.Clp * this._gustRoll * b * half;

		// Tangage
		const flapsDeg = this.flaps * A.flapLevels[ A.flapLevels.length - 1 ];
		const tail = lerpTable( D.CmaStall, alphaDeg );
		const elevatorK = lerpTable2( D.CmdeStall.alpha, D.CmdeStall.rows, de, alphaDeg );
		let Cm = this.cm0 + D.Cma * alpha * tail + D.Cmq * qHat + D.Cmadot * this._alphaDot * c * half
			+ lerpTable( D.Cmdf, flapsDeg ) + CL * this.cgOffset / c
			// Effet de sol sur l'empennage : moins de déflexion, le nez pique un peu (FlightModel : groundEffectPitch)
			+ D.Cma * A.groundEffectPitch * this.groundEffect;
		const elevatorMoment = D.Cmde * de * elevatorK * qbarTail * S * c;

		// Lacet : dérivées, souffle hélicoïdal, vrille à plat
		let Cn = D.Cnb * beta + D.Cnp * pHat + D.Cnr * rHat + D.Cnda * da;
		if ( alphaJ > D.stallJ ) Cn += lerpTable2( D.CnSpin.alphaJ, D.CnSpin.rows, r, alphaJ ) * b * half;
		const rudderMoment = D.Cndr * dr * qbarTail * S * b;
		const washMoment = D.Cnspw * qbarWash * S * b;
		// Facteur P : la pale descendante (à droite) attaque plus l'air avec l'incidence, la traction se décale à droite
		const pFactor = A.propeller ? thrust * 0.25 * A.propeller.diameter / 2 * MathUtils.clamp( alpha, - 0.3, 0.3 ) : 0;

		// --- Forces (repère monde) ---
		_force.set( 0, 0, 0 );
		_moment.set( 0, 0, 0 );   // repère avion : x tangage, y lacet (+ à gauche), z roulis (+ à gauche)
		if ( speed > 0.5 ) {
			const airHat = _tmp.copy( _air ).divideScalar( speed );
			_liftDir.crossVectors( _right, airHat );
			if ( _liftDir.lengthSq() > 1e-8 ) _liftDir.normalize();
			_force.addScaledVector( _liftDir, CL * qbar * S )
				.addScaledVector( airHat, - CD * qbar * S )
				.addScaledVector( _right, CY * qbar * S );
			_moment.x += Cm * qbar * S * c;
			_moment.y += - Cn * qbar * S * b;
			_moment.z += - Cl * qbar * S * b;
		}
		_moment.x += elevatorMoment;
		_moment.y += - rudderMoment - washMoment + pFactor;
		_force.addScaledVector( _forward, thrust );
		this.loadFactor = _force.dot( _up ) / ( this.mass * GRAVITY );
		// Couple de l'hélice (sens horaire vue de la cabine) : réaction, roulis à gauche
		if ( this.propulsion ) _moment.z += Math.max( 0, this.propulsion.torque );

		// --- Train ---
		this._gearForces( dt, _force, _moment, yaw );
		this.sideAcceleration = _force.dot( _right ) / this.mass;
		_force.y -= this.mass * GRAVITY;

		// --- Intégration : translation, puis rotation (équations d'Euler, inertie diagonale) ---
		this.velocity.addScaledVector( _force, dt / this.mass );
		position.addScaledVector( this.velocity, dt );
		const I = D.inertia, massScale = this.mass / this.aircraft.mass;
		const Ix = I.pitch * massScale, Iy = I.yaw * massScale, Iz = I.roll * massScale;
		// Moment cinétique de l'hélice, vers l'avant (sens horaire vu de la cabine) : effet gyroscopique
		const spin = this.propulsion ? this.propulsion.rpm * Math.PI / 30 * D.propellerInertia : 0;
		_h.set( Ix * w.x, Iy * w.y, Iz * w.z - spin );
		_tmp2.crossVectors( w, _h );
		w.x += ( _moment.x - _tmp2.x ) / Ix * dt;
		w.y += ( _moment.y - _tmp2.y ) / Iy * dt;
		w.z += ( _moment.z - _tmp2.z ) / Iz * dt;
		if ( w.length() > MAX_RATE ) w.setLength( MAX_RATE );
		_dq.set( w.x * dt / 2, w.y * dt / 2, w.z * dt / 2, 1 ).normalize();
		quaternion.multiply( _dq ).normalize();
		this._groundYaw = Math.atan2( - _forward.x, - _forward.z );
		this._groundPitch = Math.max( 0, this.pitchAttitude );

		this._contacts( dt );
	}

	// Efforts des trois roues (repère monde) et leurs moments (repère avion), ajoutés à force et moment
	_gearForces( dt, force, moment, yaw ) {
		const A = this.aircraft, D = this.data, object = this.object, position = object.position;
		const quaternion = object.quaternion;
		_inverse.copy( quaternion ).invert();
		_omegaWorld.copy( this._angularVelocity ).applyQuaternion( quaternion );
		// Charge statique de chaque roue (masse et centrage actuels) : la longueur des jambes au repos en tient compte,
		// l'origine de l'avion reste à minAltitude du sol à l'arrêt
		const cg = D.cgReference + this.cgOffset;
		const [ nose, ...mains ] = this.wheels;
		const noseArm = cg - nose.station, mainArm = mains[ 0 ].station - cg;
		const weight = this.mass * GRAVITY;
		const noseShare = weight * mainArm / ( noseArm + mainArm );
		const surface = this.surface = this.surfaceAt( position.x, position.z );
		const onWater = surface === 'water';
		const rolling = ( A.rolling[ surface ] ?? A.rolling.grass ) / GRAVITY;
		const grip = onWater ? D.gearGrip * A.waterSteering : surface === 'grass' ? 0.6 : D.gearGrip;
		const c = this.controls;
		const steer = MathUtils.clamp( yaw + c.roll * 0.5 * ( 1 - MathUtils.smoothstep( this.airspeed, 5, 12 ) ), - 1, 1 );
		let any = false;
		for ( const wheel of this.wheels ) {
			wheel.contact = false;
			wheel.load = 0;
			if ( ! this.gearDown && A.gearTime ) continue;
			const share = wheel === nose ? noseShare : ( weight - noseShare ) / 2;
			const rest = share / wheel.spring;
			_arm.set( wheel.lateral, - this.minAltitude - rest, wheel.station - cg ).applyQuaternion( quaternion );
			_point.copy( position ).add( _arm );
			const ground = this.groundHeight( _point.x, _point.z );
			const depth = ground - _point.y;
			if ( depth <= 0 ) { wheel.compression = 0; continue; }
			this._groundNormal( _point.x, _point.z, _normal );
			const penetration = depth * _normal.y;
			_pointVelocity.crossVectors( _omegaWorld, _arm ).add( this.velocity );
			const approach = - _pointVelocity.dot( _normal );
			if ( ! this.onGround ) this._impact = Math.max( this._impact, approach );
			const load = Math.max( 0, wheel.spring * penetration + wheel.damper * approach );
			wheel.compression = penetration;
			if ( load <= 0 ) continue;
			wheel.contact = true;
			wheel.load = load;
			any = true;
			// Axe de la roue (roulette de nez braquée au palonnier), projeté sur le sol
			const angle = wheel.steer * steer;
			_wheelForward.set( - Math.sin( angle ), 0, - Math.cos( angle ) ).applyQuaternion( quaternion );
			_wheelForward.addScaledVector( _normal, - _wheelForward.dot( _normal ) ).normalize();
			_wheelSide.crossVectors( _wheelForward, _normal ).normalize();   // vers la droite de la roue
			const vLong = _pointVelocity.dot( _wheelForward ), vSide = _pointVelocity.dot( _wheelSide );
			const brake = wheel.brake ? Math.max( c.brake ?? 0, ( wheel.brake === 'left' ? c.brakeLeft : c.brakeRight ) ?? 0 ) : 0;
			const brakeGrip = onWater ? 0 : A.brakes / GRAVITY * brake;
			let longitudinal = - load * ( rolling * Math.tanh( vLong / 0.5 ) + brakeGrip * Math.tanh( vLong / 0.05 ) );
			if ( onWater ) longitudinal -= A.waterDrag * vLong * Math.abs( vLong ) * this.mass * load / weight;
			const lateral = - load * grip * MathUtils.clamp( vSide / 0.4, - 1, 1 );
			_wheelForce.copy( _normal ).multiplyScalar( load ).addScaledVector( _wheelForward, longitudinal ).addScaledVector( _wheelSide, lateral );
			force.add( _wheelForce );
			moment.add( _tmp.crossVectors( _arm, _wheelForce ).applyQuaternion( _inverse ) );
		}
		// Patin de queue : il touche quand le nez est trop levé au sol (frotte, n'empêche pas de rouler)
		const skid = D.tailSkid;
		if ( skid ) {
			_arm.set( 0, - this.minAltitude + skid.height, skid.station - cg ).applyQuaternion( quaternion );
			_point.copy( position ).add( _arm );
			const depth = this.groundHeight( _point.x, _point.z ) - _point.y;
			if ( depth > 0 ) {
				this._groundNormal( _point.x, _point.z, _normal );
				_pointVelocity.crossVectors( _omegaWorld, _arm ).add( this.velocity );
				const approach = - _pointVelocity.dot( _normal );
				if ( ! this.onGround ) this._impact = Math.max( this._impact, approach );
				const load = Math.max( 0, skid.spring * depth * _normal.y + skid.damper * approach );
				if ( load > 0 ) {
					_tmp.copy( _pointVelocity ).addScaledVector( _normal, - _pointVelocity.dot( _normal ) );
					const slide = _tmp.length();
					_wheelForce.copy( _normal ).multiplyScalar( load );
					if ( slide > 1e-4 ) _wheelForce.addScaledVector( _tmp, - load * skid.friction * Math.min( 1, slide / 0.3 ) / slide );
					force.add( _wheelForce );
					moment.add( _tmp.crossVectors( _arm, _wheelForce ).applyQuaternion( _inverse ) );
					any = true;
				}
			}
		}
		this._anyWheel = any;
	}

	// Passages sol / vol déduits du contact des roues : toucher (contrôle de l'arrivée : mêmes limites que FlightModel),
	// envol ; et, roues au sol, ce qui touche le sol en plus des roues (aile, nez, queue)
	_contacts( dt ) {
		const A = this.aircraft, object = this.object, position = object.position;
		const floor = this.groundHeight( position.x, position.z );
		this._groundNormal( position.x, position.z, _normal );
		const upDot = _up.set( 0, 1, 0 ).applyQuaternion( object.quaternion ).dot( _normal );
		const bank = Math.asin( MathUtils.clamp( _right.set( 1, 0, 0 ).applyQuaternion( object.quaternion ).dot( _normal ), - 1, 1 ) );
		const pitch = Math.asin( MathUtils.clamp( _forward.set( 0, 0, - 1 ).applyQuaternion( object.quaternion ).dot( _normal ), - 1, 1 ) );
		const height = position.y - floor;
		// Le fuselage touche le sol sans les roues (atterrissage sur le ventre, train écrasé, avion à l'envers)
		const touching = this._anyWheel || height < this.minAltitude * 0.6;
		if ( touching ) {
			let reason = null;
			if ( upDot < 0 ) reason = 'Avion sur le dos';
			else if ( _normal.y < A.minSlopeNormal ) reason = 'Collision avec le relief';
			else if ( ! this.onGround && this._impact > A.crashSink ) reason = `Impact trop violent (${Math.round( this._impact / 0.3048 * 60 )} ft/min)`;
			else if ( height < this.minAltitude * 0.6 ) reason = A.gearTime && this.gearPosition < 0.95 ? 'Atterrissage train rentré' : 'Impact trop violent';
			else if ( Math.abs( bank ) > A.crashBank ) reason = 'Une aile a touché le sol';
			else if ( pitch < A.crashNose ) reason = 'L\'avion a touché du nez';
			else if ( pitch > A.crashTail ) reason = 'La queue a touché le sol';
			if ( reason ) {
				this._crash( reason );
				return;
			}
		}
		if ( this._anyWheel ) {
			this._airborneTime = 0;
			if ( ! this.onGround ) {
				this.onGround = true;
				this.stalled = false;
				this._stallBreak = 0;
				this._wind.set( 0, 0, 0 );
				this.dispatchEvent( { type: 'touchdown', impact: this._impact } );
			}
			this._impact = 0;
		} else {
			this._airborneTime += dt;
			this._sinceLiftoff += dt;
			const clearance = height - this.minAltitude;
			if ( this.onGround && this._airborneTime >= LIFTOFF_TIME && clearance > LIFTOFF_HEIGHT ) {
				this.onGround = false;
				this._sinceLiftoff = 0;
				this._impact = 0;
				this.dispatchEvent( { type: 'liftoff' } );
			}
		}
	}

	_crash( reason ) {
		this._angularVelocity.set( 0, 0, 0 );
		super._crash( reason );
	}
}

export { RigidBodyModel };
