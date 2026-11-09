import {
	EventDispatcher,
	MathUtils,
	Matrix4,
	Quaternion,
	Vector3
} from 'three';
import { CESSNA_172 } from './Cessna172.js';

// Modèle de vol : portance (calculée sur chaque demi-aile), traînée, poussée et poids selon l'incidence et la vitesse,
// avec effet de sol et décrochage ; au sol, roulage sur les roues jusqu'à ce que l'aile porte l'avion.
// Aucune dépendance au clavier ni à la page : on lui donne des commandes (manche, gaz, trim, volets, freins),
// il fait avancer l'avion (object : position et orientation). Les caractéristiques viennent de Cessna172.js.
// Événements : 'liftoff', 'touchdown' { impact }, 'crash' { reason }.

const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;         // kg/m³ (niveau de la mer)
const SPEED_OF_SOUND = 340;        // m/s (traînée d'onde des avions rapides, voir _dragCoefficient)
const STEP = 1 / 120;              // pas de calcul (s) : plusieurs pas par image si besoin
// Centrage (voir cgOffset) : incidence en plus tenue par le trim, et stabilité en moins, par mètre de recul
const CG_TRIM_ALPHA = MathUtils.degToRad( 12 );   // ~1,2° pour 10 cm
const CG_STABILITY = 2.5;                        // -25 % de stabilité pour 10 cm

const _up = new Vector3( 0, 1, 0 );
const _front = new Vector3( 0, 0, - 1 );
const _xAxis = new Vector3( 1, 0, 0 );
const _zAxis = new Vector3( 0, 0, 1 );
const _tmpQuaternion = new Quaternion();
const _gustTarget = new Vector3();
const _normal = new Vector3();
const _forward = new Vector3();
const _back = new Vector3();
const _right = new Vector3();
const _planeUp = new Vector3();
const _air = new Vector3();
const _liftDirection = new Vector3();
const _panelAir = new Vector3();
const _force = new Vector3();
const _basis = new Matrix4();
const _pathAxis = new Vector3();

// Toucher des roues : l'aile et le nez se posent en douceur (constante de temps), les amortisseurs du train encaissent
// la vitesse de descente (ressort amorti : pulsation, amortissement, course)
const SETTLE_TIME = 0.3;            // s
const GEAR_OMEGA = 11;              // rad/s
const GEAR_DAMPING = 0.75;
const GEAR_TRAVEL = [ - 0.18, 0.05 ];   // m : enfoncement max, détente max
const OBSTACLE_CELL = 64;           // m : côté des cases du rangement des obstacles (voir _checkObstacles)
const WEATHERVANE_BLEND_TIME = 3;   // s : après l'envol, la dérive reprend son effet en douceur
const RELEASE_TIME = 4;             // s au plus : après un relâchement du manche, le nez ne repart pas en sens inverse
                                    // (jusqu'à ce que l'incidence ait rejoint celle visée)
const DRIFT_RATE = 2;              // 1/s : sans l'aide « correction de dérive », l'avion prend la vitesse du vent après l'envol

class FlightModel extends EventDispatcher {

	constructor( object, aircraft = CESSNA_172 ) {
		super();
		this.object = object;
		this.aircraft = aircraft;

		// Environnement
		this.minAltitude = 1;            // hauteur du centre de l'avion au-dessus du sol, roues posées
		this.groundHeight = () => 0;     // relief : hauteur du sol en (x, z)
		this.surfaceAt = () => 'grass';  // revêtement du sol en (x, z) : 'asphalt', 'grass' ou 'water' (lac)
		this.obstacles = [];             // boîtes (Box3, repère monde) à ne pas percuter
		this.turbulence = 0;             // 0 = air calme, 1 = tempête
		this.rotateSpeed = aircraft.rotateSpeed;
		// Aides au pilotage (menu Paramètres > Pilotage), désactivées par défaut
		this.assists = {
			rotation: false,             // au sol, le trim lève le nez tout seul
			stallProtection: false,      // la profondeur seule ne fait pas décrocher
			smoothLiftoff: false,        // après l'envol, manche relâché, le nez se rend progressivement
			crosswindCorrection: false,  // vent de travers : après l'envol, le nez se met tout seul face au vent (pas de dérive)
		};

		// Commandes du pilote
		this.controls = { pitch: 0, roll: 0, yaw: 0, brake: 0 }; // profondeur (+ = cabrer), ailerons et palonnier (+ = gauche), freins
		this.throttle = 0.3;             // 0 -> 1
		this.enginePower = 1;            // puissance disponible (0 = moteur arrêté), voir Systems.js
		this.jetThrust = 0;              // réacteurs (aircraft.jet) : poussée au niveau de la mer (N), voir JetSystems.js
		// Dégâts au combat (voir Damage.js) : poussée restante, portance de chaque demi-aile (gauche, droite), traînée
		// en plus (trous, tôles arrachées), efficacité des gouvernes (empennage touché)
		this.damage = { thrust: 1, wingLift: [ 1, 1 ], drag: 0, control: 1 };
		// Train rentrant (aircraft.gearTime) : demandé sorti ou rentré, position réelle (0 rentré -> 1 sorti) ; aérofrein
		this.gearDown = true;
		this.gearPosition = 1;
		this.speedbrakeOut = false;
		this.speedbrake = 0;             // position réelle (0 -> 1)
		this.flapsPowered = true;        // moteur électrique des volets alimenté
		this.trim = aircraft.takeoffTrim; // tab de profondeur (rad, + = à cabrer)
		this.flapLevel = 0;              // cran demandé (indice dans aircraft.flapLevels)
		// Centrage : écart (m) au centrage de référence (+ = en arrière), voir Masse et centrage. Centrage arrière : nez
		// plus léger (le trim tient une incidence plus forte, l'avion vole plus lentement manche lâché) et moins stable ;
		// avant : nez lourd, plus stable, il faut tirer davantage
		this.cgOffset = 0;

		// État
		this.velocity = new Vector3();   // vitesse (repère monde, m/s)
		this.airspeed = 0;               // vitesse air (m/s) ; au sol : vitesse de roulage
		this.flaps = 0;                  // position réelle des volets : 0 = rentrés, 1 = sortis à fond
		this.alpha = 0;                  // incidence : angle entre le nez et la trajectoire dans l'air (rad)
		this.groundEffect = 0;           // intensité de l'effet de sol (0 = loin du sol)
		this.stalled = false;
		this.onGround = false;
		this.crashed = false;
		this.surface = 'grass';
		this._angularVelocity = new Vector3(); // repère avion (rad/s) : x tangage (+ = cabrer), y lacet, z roulis (+ = gauche)
		this._wind = new Vector3();      // rafales (repère monde, m/s)
		this.wind = new Vector3();       // vent moyen de la météo (repère monde, m/s), voir Wind.js
		this.indicatedSpeed = 0;         // vitesse lue à l'anémomètre (au sol : roulage + vent de face)
		this._gustRoll = 0;
		this._gustRollTarget = 0;
		this._gustTimer = 0;
		this._liftoffAlpha = 0;          // incidence à l'envol...
		this._liftoffBlend = 0;          // ... dont l'avion se détache progressivement (1 -> 0) pour rejoindre celle du trim
		this._weathervaneBlend = 0;      // après l'envol (1 -> 0) : la dérive reprend peu à peu son effet (voir _updateAir)
		this._wingDrop = 0;              // aile qui tombe au décrochage (1 gauche, -1 droite : roulis + = à gauche)
		this._stallBreak = 0;            // abattée en cours (s restantes), voir _updateFlight
		this._prevAir = null;            // vent relatif au pas précédent (rotation de la trajectoire)
		this._pathAngle = null;          // pente de la trajectoire (rad) et sa vitesse de variation (rad/s), lissée
		this._pathRate = 0;
		this._phugoidBlend = 1;          // amortissement de la phugoïde : 1 manche lâché, 0 dès qu'on touche le manche (en douceur)
		this._alphaCommand = null;       // incidence visée au pas précédent (relâchement du manche, voir _updateFlight)
		this._release = 0;               // relâchement du manche en cours (s restantes) et son sens (+ : on tirait)
		this._releaseSign = 0;
		this.wingLift = [ 0, 0 ];         // portance de chaque demi-aile (N) : [gauche, droite]
		this._groundYaw = 0;             // cap au sol (rad, + = vers la gauche)
		this._groundPitch = 0;           // cabré au sol (rad), 0 = roulette avant posée
		this._settleRoll = 0;            // après le toucher : inclinaison et assiette qui restent à résorber (rad)
		this._settlePitch = 0;
		this._gear = 0;                  // enfoncement des amortisseurs (m, < 0 = écrasés) et sa vitesse (m/s)
		this._gearSpeed = 0;
		this.beta = 0;                   // dérapage (rad, + = vent relatif venant de la droite : nez à gauche de la trajectoire)
		this.sideAcceleration = 0;       // accélération latérale ressentie (m/s², + = vers la droite), voir _updateAir
		this.loadFactor = 1;             // facteur de charge (g) : portance / poids (accéléromètre, HUD du F-15)
	}

	// Pose l'avion sur le sol à sa position actuelle (cap conservé), moteur au ralenti
	placeOnGround() {
		const front = _forward.copy( _front ).applyQuaternion( this.object.quaternion );
		this._groundYaw = Math.atan2( - front.x, - front.z );
		this._groundPitch = 0;
		this._settleRoll = this._settlePitch = this._gear = this._gearSpeed = 0;
		this.onGround = true;
		this.throttle = 0;
		this.airspeed = 0;
		this.velocity.set( 0, 0, 0 );
		this.gearDown = true;
		this.gearPosition = 1;
		this._alignToGround();
	}

	// Repart de la position et de l'orientation actuelles de l'objet (point de départ mémorisé) :
	// au sol arrêté, ou en vol à 45 m/s ; trim au repère de décollage, volets rentrés
	restart( onGround ) {
		const front = _forward.copy( _front ).applyQuaternion( this.object.quaternion );
		this.onGround = onGround;
		this.airspeed = onGround ? 0 : ( this.aircraft.airStartSpeed ?? 45 );
		// Départ en vol : train rentré (avion à train rentrant), aérofrein rentré
		this.gearDown = onGround || ! this.aircraft.gearTime;
		this.gearPosition = this.gearDown ? 1 : 0;
		this.speedbrakeOut = false;
		this.speedbrake = 0;
		this.velocity.copy( front ).multiplyScalar( this.airspeed );
		this._groundYaw = Math.atan2( - front.x, - front.z );
		this._groundPitch = 0;
		this._settleRoll = this._settlePitch = this._gear = this._gearSpeed = 0;
		this._wind.set( 0, 0, 0 );
		this._gustRoll = 0;
		this._angularVelocity.set( 0, 0, 0 );
		this._pathAngle = null;
		this._pathRate = 0;
		this._phugoidBlend = 1;
		this._alphaCommand = null;
		this._release = 0;
		this.stalled = false;
		this._stallBreak = 0;
		this._prevAir = null;
		this.alpha = 0;
		this.trim = this.aircraft.takeoffTrim;
		this._liftoffBlend = 0;
		this._weathervaneBlend = onGround ? 0 : 1;   // départ en vol : comme après un envol (voir _updateFlight)
		this.crashed = false;
		this.flapLevel = 0;
		this.flaps = 0;
	}

	setFlapLevel( level ) {
		this.flapLevel = MathUtils.clamp( level, 0, this.aircraft.flapLevels.length - 1 );
	}

	// Train rentrant : rentré seulement en vol (au sol, la sécurité de la commande l'interdit) ; false si refusé
	setGear( down ) {
		if ( ! this.aircraft.gearTime || this.crashed ) return false;
		if ( ! down && this.onGround ) return false;
		this.gearDown = down;
		return true;
	}

	// Masse volumique de l'air (kg/m³) à l'altitude de l'avion (atmosphère type), pour les avions qui montent haut
	airDensity() {
		if ( ! this.aircraft.densityAltitude ) return AIR_DENSITY;
		const h = Math.max( 0, this.object.position.y );
		return AIR_DENSITY * Math.max( 0.05, 1 - 2.2558e-5 * h ) ** 4.2559;
	}

	// Fait avancer la simulation de delta secondes
	step( delta ) {
		if ( this.crashed ) return;
		const A = this.aircraft;

		// Volets : se déplacent progressivement vers le cran demandé
		const flapTarget = A.flapLevels[ this.flapLevel ] / A.flapLevels[ A.flapLevels.length - 1 ];
		if ( this.flapsPowered ) this.flaps += MathUtils.clamp( flapTarget - this.flaps, - A.flapRate * delta, A.flapRate * delta );
		if ( A.gearTime ) {
			this.gearPosition = MathUtils.clamp( this.gearPosition + ( this.gearDown ? 1 : - 1 ) * delta / A.gearTime, 0, 1 );
			this.speedbrake = MathUtils.clamp( this.speedbrake + ( this.speedbrakeOut ? 1 : - 1 ) * delta / A.speedbrakeTime, 0, 1 );
		}
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
		return Math.sqrt( 2 * A.mass * GRAVITY / ( this.airDensity() * A.wingArea * maxLift ) );
	}

	// Incidence que fixe le tab de trim (manche lâché)
	trimAlpha() {
		const A = this.aircraft;
		// Côté piqué (sous le neutre), effet réduit : le trim soulage l'effort à pousser sans faire plonger l'avion
		const tab = this.trim < 0 ? this.trim * A.trimNoseDownEffect : this.trim;
		return A.trimAlphaZero + tab * A.trimAlphaPerTab + this.cgOffset * CG_TRIM_ALPHA;
	}

	// Vitesse (m/s) que l'avion tient manche lâché avec le trim et les volets actuels : la puissance fait monter
	// ou descendre à cette vitesse, pas accélérer (pour aller plus vite : trimer à piquer)
	trimSpeed() {
		const A = this.aircraft;
		const alpha = Math.min( this.trimAlpha(), this.stallAlpha() - MathUtils.degToRad( 5 ) );
		return Math.sqrt( 2 * A.mass * GRAVITY / ( this.airDensity() * A.wingArea * this._liftCoefficient( alpha ) ) );
	}

	// Vrai un peu avant le décrochage (incidence à moins de 4° de la limite : 5 à 7 kt avant, comme l'avertisseur du
	// vrai C172), pas au sol
	nearStall() {
		return ! this.onGround && ! this.crashed && this.alpha > this.stallAlpha() - MathUtils.degToRad( 4 );
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
	// stalled : aile décrochée (filets d'air décollés) : la portance chute d'un coup (A.stallLift) et ne revient
	// qu'une fois l'incidence nettement réduite (voir _updateFlight)
	_liftCoefficient( alpha, stalled = false ) {
		const A = this.aircraft;
		const base = A.cl0 + A.flapLift * this.flaps;
		const stallAlpha = this.stallAlpha();
		const linear = Math.max( - 1, base + A.clAlpha * alpha );
		const peak = base + A.clAlpha * stallAlpha;
		if ( stalled ) return Math.min( linear, Math.max( peak * 0.45, peak * A.stallLift - 2.5 * Math.max( 0, alpha - stallAlpha ) ) );
		if ( alpha <= stallAlpha ) return linear;
		return Math.max( peak * 0.55, peak - 3.5 * ( alpha - stallAlpha ) );
	}

	// Poussée de l'hélice (N) : limitée à l'arrêt, puis à puissance constante (elle baisse avec la vitesse)
	_thrust( speed ) {
		// Réacteurs : poussée donnée par les systèmes, qui baisse avec la densité de l'air
		if ( this.aircraft.jet ) return this.jetThrust * this.damage.thrust * ( this.airDensity() / AIR_DENSITY ) ** 0.75;
		return this.throttle * this.enginePower * this.damage.thrust * Math.min( this.aircraft.staticThrust, this.aircraft.power / Math.max( 1, speed ) );
	}

	// Coefficient de traînée : forme + volets + induite (réduite près du sol) + hélice au ralenti + aile décrochée
	_dragCoefficient( lift, groundEffect = 1, speed = 0 ) {
		const A = this.aircraft;
		let cd = A.cd0 + A.flapDrag * this.flaps + A.inducedDrag * lift * lift * groundEffect
			+ A.windmillDrag * ( 1 - this.throttle * this.enginePower ) + ( this.stalled ? A.stallDrag : 0 ) + this.damage.drag;
		// Train sorti, aérofrein ; traînée d'onde à l'approche de Mach 1 (avions rapides)
		if ( A.gearTime ) cd += A.gearDrag * this.gearPosition + A.speedbrakeDrag * this.speedbrake;
		if ( A.waveDrag ) cd += A.waveDrag * MathUtils.smoothstep( speed / SPEED_OF_SOUND, A.machCritical, 1.05 );
		return cd;
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

		// Juste après l'envol (ou un départ en vol), l'avion garde la vitesse que les roues tenaient dans l'axe de la piste :
		// le vent de travers le prend de côté. Sans l'aide « correction de dérive », il part avec la masse d'air en ~1 s,
		// nez gardé sur son cap : il dérive, au pilote de prendre un cap de correction. Avec l'aide, la dérive fait
		// pivoter le nez face au vent (voir vane) juste de l'angle qui garde la trajectoire dans l'axe
		if ( ! this.assists.crosswindCorrection && this._weathervaneBlend > 0 ) {
			const side = _air.subVectors( this.velocity, this._wind ).sub( this.wind ).dot( _right );
			this.velocity.addScaledVector( _right, - side * Math.min( 1, dt * DRIFT_RATE ) );
		}

		// Vent relatif : incidence (dans le plan de symétrie de l'avion) et dérapage
		_air.subVectors( this.velocity, this._wind ).sub( this.wind );
		const speed = Math.max( 0.1, _air.length() );
		// Vitesse indiquée (anémomètre) : la vitesse vraie corrigée de la densité de l'air (en altitude, elle est plus faible)
		this.airspeed = speed;
		this.indicatedSpeed = A.densityAltitude ? speed * Math.sqrt( this.airDensity() / AIR_DENSITY ) : speed;
		const alpha = Math.atan2( - _air.dot( _planeUp ), _air.dot( _forward ) );
		const beta = Math.asin( MathUtils.clamp( _air.dot( _right ) / speed, - 1, 1 ) );
		this.alpha = alpha;
		this.beta = beta;

		const stallAlpha = this.stallAlpha();
		// Effets du moteur : part de la poussée maxi (0 -> 1) et poids de la basse vitesse (0 en croisière, ~0,5 près du
		// décrochage) ; voir plus bas (couple, souffle hélicoïdal, facteur P)
		const power = this._thrust( speed ) / A.staticThrust;
		const slow = MathUtils.clamp( 1 - speed / A.engineEffectSpeed, 0, 1 );
		if ( ! this.stalled && alpha > stallAlpha ) {
			this.stalled = true;
			// Abattée : le nez, lourd (moteur à l'avant), tombe franchement pendant ~1,5 s, quoi que fasse le manche
			this._stallBreak = A.stallBreakTime + A.stallBreakDelay;
			// Aile qui tombe : force au hasard ; côté au hasard moteur réduit, plutôt la gauche avec de la puissance (couple,
			// facteur P) ou en dérapant vers la gauche (nez à gauche de la trajectoire : l'aile droite avance, porte plus)
			const left = MathUtils.clamp( 0.5 + 0.35 * power + 4 * beta, 0.1, 0.9 );
			this._wingDrop = ( Math.random() < left ? 1 : - 1 ) * ( 0.5 + 0.5 * Math.random() );
		} else if ( this.stalled && alpha < stallAlpha - A.stallRecovery ) {
			this.stalled = false;
		}

		// Effet de sol : à moins d'une envergure du sol, la traînée induite chute et la portance augmente (l'avion
		// "flotte" à l'arrondi, surtout s'il arrive trop vite), et le nez a tendance à piquer
		const wingHeight = Math.max( 0, object.position.y - this.groundHeight( object.position.x, object.position.z ) - this.minAltitude ) + A.wingHeight;
		// Formule de McCormick : traînée induite × (16 h/b)² / (1 + (16 h/b)²). Roues posées (aile à 2,6 m, envergure
		// 11 m) : -7 % ; à une demi-envergure : -1,5 %. L'ancienne formule (-21 % au sol, +12 % de portance) faisait
		// flotter et remonter l'avion à l'arrondi dès qu'il restait un peu de gaz
		const k = ( 16 * wingHeight / A.wingspan ) ** 2;
		const groundEffect = k / ( 1 + k );        // 1 = loin du sol
		this.groundEffect = 1 - groundEffect;      // 0 -> ~0,07 : intensité de l'effet de sol (instruments, tests)

		const pressure = 0.5 * this.airDensity() * speed * speed * A.wingArea;
		// Portance appliquée aux ailes, pas seulement au centre de gravité : chaque demi-aile (centre de poussée à un quart
		// d'envergure du fuselage) a son propre vent relatif, celui de l'avion plus la vitesse que lui donne la rotation
		// de l'avion (ω × r). En virage (lacet), l'aile extérieure va plus vite et porte plus : l'avion s'incline de
		// plus en plus (virage engagé) ; l'aile qui descend en roulis voit le vent venir d'en dessous, son incidence monte
		// et elle porte plus : c'est l'amortissement du roulis (et, aile décrochée, l'inverse : l'autorotation). Les deux
		// portances s'ajoutent (force sur l'avion) et leur différence, multipliée par le bras de levier, est un moment de
		// roulis qui fait tourner l'avion selon son inertie (voir plus bas)
		const groundLift = 1 + A.groundEffectLift * this.groundEffect;
		const arm = A.wingspan / 4;
		const w = this._angularVelocity;
		let liftForce = 0, rollMoment = 0;
		_force.set( 0, 0, 0 );
		for ( const side of [ - 1, 1 ] ) {   // -1 : aile gauche, 1 : aile droite
			// Vitesse de la demi-aile due à la rotation (repère avion : x à droite, y en haut, z vers l'arrière) :
			// roulis à gauche (+) : l'aile droite monte ; lacet à gauche (+) : l'aile droite avance
			_panelAir.set( 0, w.z * side * arm, - w.y * side * arm ).applyQuaternion( quaternion ).add( _air );
			const panelSpeed = Math.max( 0.1, _panelAir.length() );
			const panelAlpha = Math.atan2( - _panelAir.dot( _planeUp ), _panelAir.dot( _forward ) );
			const panelLift = this._liftCoefficient( panelAlpha, this.stalled ) * groundLift * this.damage.wingLift[ side < 0 ? 0 : 1 ]
				* 0.5 * this.airDensity() * panelSpeed * panelSpeed * A.wingArea / 2;
			_liftDirection.crossVectors( _right, _panelAir ).normalize();   // perpendiculaire au vent relatif de cette aile
			_force.addScaledVector( _liftDirection, panelLift );
			liftForce += panelLift;
			// Aile droite qui porte plus : elle se soulève, roulis à gauche (+)
			rollMoment += side * panelLift * _liftDirection.dot( _planeUp ) * arm;
			this.wingLift[ side < 0 ? 0 : 1 ] = panelLift;
		}
		const lift = liftForce / pressure;   // coefficient de portance de l'avion entier (traînée induite, facteur de charge)
		this.loadFactor = liftForce / ( A.mass * GRAVITY );
		_force.addScaledVector( _air, - ( this._dragCoefficient( lift, groundEffect, speed ) + A.sideslipDrag * beta * beta ) * pressure / speed )
			.addScaledVector( _right, - A.sideForce * beta * pressure )
			.addScaledVector( _forward, this._thrust( speed ) );
		// Accélération latérale ressentie (sans la pesanteur, repère avion, + = vers la droite) : bille de l'indicateur
		// de virage. Centrée en virage coordonné ; en dérapage, la force latérale du fuselage la déporte
		this.sideAcceleration = _force.dot( _right ) / A.mass;
		_force.y -= A.mass * GRAVITY;
		this.velocity.addScaledVector( _force, dt / A.mass );
		object.position.addScaledVector( this.velocity, dt );

		// Gouvernes : efficacité selon la vitesse. Manche relâché, la stabilité ramène l'avion à l'incidence du trim
		const effect = Math.min( 1, ( speed / A.controlSpeed ) ** 2 );
		// Stabilité (empennage, dérive) : elle croît avec la pression dynamique. À très basse vitesse (chandelle, montée
		// trop raide), elle ne suffit plus à garder le nez sur la trajectoire qui s'incurve vers le bas : l'incidence
		// monte et l'avion décroche, comme un vrai (avant : stabilité gardée à 60 %, l'avion tombait à 20 kt sans décrocher)
		const stability = MathUtils.clamp( ( speed / 25 ) ** 2, A.lowSpeedStability, 1 );
		// Empennage ou commandes touchés : les gouvernes répondent moins
		const control = this.damage.control;
		const input = control < 1 ? { ...this.controls, pitch: this.controls.pitch * control, roll: this.controls.roll * control,
			yaw: this.controls.yaw * control } : this.controls;
		let trimAlpha = Math.min( this.trimAlpha(), stallAlpha - MathUtils.degToRad( 5 ) ); // trim seul : jamais de décrochage
		// Aide "envol en douceur" : juste après l'envol, on part de l'incidence d'envol et on rejoint le trim en douceur
		if ( this._liftoffBlend > 0 ) {
			this._liftoffBlend = Math.max( 0, this._liftoffBlend - dt / A.liftoffReleaseTime );
			trimAlpha = MathUtils.lerp( trimAlpha, this._liftoffAlpha, this._liftoffBlend );
		}

		// Profondeur : le manche décale l'incidence visée par rapport au trim, quelle que soit la vitesse (comme sur un
		// vrai avion : à une position du manche correspond une incidence) ; la stabilité y amène l'avion, d'autant plus
		// lentement que la vitesse est faible. Avant, l'autorité baissait sous ~48 kt : manche au ventre, l'incidence
		// restait sous le décrochage et l'avion tombait à 15 kt sans décrocher
		const limit = stallAlpha + ( this.assists.stallProtection ? A.elevatorLimitProtected : A.elevatorLimit );
		const authority = 1;
		// Manche tiré : +elevatorUp près du neutre (pilotage fin inchangé), puis, en fin de course, jusqu'à la limite :
		// manche à fond, on atteint l'alarme et le décrochage quel que soit le trim
		const pull = Math.max( 0, input.pitch );
		const elevator = input.pitch > 0
			? A.elevatorUp * pull + Math.max( 0, limit - trimAlpha - A.elevatorUp ) * pull ** 2
			: A.elevatorDown * input.pitch;
		let alphaTarget = trimAlpha + elevator * authority - A.groundEffectPitch * this.groundEffect;
		if ( input.pitch > 0 ) alphaTarget = Math.min( alphaTarget, Math.max( limit, trimAlpha ) );
		// Commandes de vol électriques (aircraft.gLimit) : l'incidence visée est limitée pour ne pas dépasser le facteur
		// de charge maxi (à grande vitesse, manche au ventre : 9 g, pas 15)
		if ( A.gLimit ) {
			const base = A.cl0 + A.flapLift * this.flaps;
			const weight = A.mass * GRAVITY / Math.max( 1, pressure );
			alphaTarget = MathUtils.clamp( alphaTarget, ( A.gLimitNegative * weight - base ) / A.clAlpha, ( A.gLimit * weight - base ) / A.clAlpha );
		}
		// Relâchement du manche (voir pitchRate plus bas) : il commence quand l'incidence visée revient vers celle du
		// trim (touche relâchée) ; il s'arrête dès que le pilote reprend le manche, dans un sens ou dans l'autre (sinon,
		// tirer juste après avoir poussé était bloqué : de la latence), ou quand l'incidence a rejoint celle visée.
		// (Pas de lissage de l'incidence visée : il retardait chaque mouvement de manche d'~0,1 s)
		this._alphaCommand ??= alphaTarget;
		const fromTrim = this._alphaCommand - trimAlpha;   // (pas précédent)
		const toTrim = Math.abs( alphaTarget - trimAlpha );
		const returning = toTrim < Math.abs( fromTrim ) - 1e-5;
		if ( returning && Math.abs( fromTrim ) > MathUtils.degToRad( 0.5 ) && input.pitch * Math.sign( fromTrim ) >= 0 ) {
			this._release = RELEASE_TIME;
			this._releaseSign = Math.sign( fromTrim );
		} else if ( this._release > 0 && ( input.pitch * this._releaseSign < - 0.02 || toTrim > Math.abs( fromTrim ) + 1e-5
			|| Math.abs( alpha - alphaTarget ) < MathUtils.degToRad( 0.5 ) ) ) {
			this._release = 0;   // manche repris (autre sens, ou de nouveau dans le même), ou incidence revenue
		} else {
			this._release = Math.max( 0, this._release - dt );
		}
		this._alphaCommand = alphaTarget;
		// Manche lâché : amortissement des longues oscillations de trajectoire (phugoïde) ; quand la trajectoire
		// se redresse, l'incidence baisse un peu, et inversement (sans effet en vol stabilisé, ni à l'arrondi).
		// Il entre en douceur une fois le manche lâché (~2 s), sort en douceur dès qu'on le touche (0,25 s) et reste
		// limité (±10°). Avant, il s'enclenchait d'un coup sous 10 % de manche, sans limite : en relâchant après une
		// ressource (trajectoire qui tourne vite), l'incidence visée sautait de ~15° et le nez partait d'un coup dans le
		// sens opposé au mouvement qu'on venait de faire (et au début d'un mouvement, il s'y opposait)
		const pathAngle = Math.asin( MathUtils.clamp( this.velocity.y / Math.max( 0.1, this.velocity.length() ), - 1, 1 ) );
		if ( this._pathAngle !== null ) {
			this._pathRate += ( ( pathAngle - this._pathAngle ) / dt - this._pathRate ) * Math.min( 1, dt * A.phugoidFilter );
		}
		this._pathAngle = pathAngle;
		// (seulement une fois la phase de relâchement finie : juste après une ressource, la trajectoire tourne encore
		// vite et il rabattrait le nez)
		const handsOff = Math.abs( input.pitch ) < 0.05 && this._release <= 0;
		this._phugoidBlend = MathUtils.clamp( this._phugoidBlend + ( handsOff ? dt / 2 : - dt / 0.25 ), 0, 1 );
		const phugoidLimit = MathUtils.degToRad( 10 );
		// Seulement ailes à plat : la pente de la trajectoire ne dépend de la profondeur qu'en proportion de cos(inclinaison).
		// Avant, en virage serré, l'avion qui s'enfonce lui faisait cabrer l'avion de lui-même (jusqu'à +10° à 90°
		// d'inclinaison) : le virage se resserrait seul et pousser sur le manche n'avait presque plus d'effet
		const level = Math.max( 0, _planeUp.y ) ** 2;   // 1 ailes à plat, 0 à 90° d'inclinaison, sur le dos ou nez vertical
		alphaTarget -= this._phugoidBlend * level * MathUtils.clamp( A.phugoidDamping * this._pathRate, - phugoidLimit, phugoidLimit );
		const cgStability = MathUtils.clamp( 1 - this.cgOffset * CG_STABILITY, 0.5, 1.5 );
		// Stabilité en tangage : elle tient l'incidence voulue pendant que la trajectoire tourne (ressource, virage,
		// arrondi) : le nez suit la rotation du vent relatif autour de l'axe de tangage, plus un rappel vers l'incidence
		// visée. Le tout faiblit avec la vitesse (stability) : à très basse vitesse, la trajectoire s'incurve sans le nez et
		// l'incidence monte (décrochage). Avant, sans ce suivi, l'incidence restait ~5° sous la visée en ressource : manche
		// au ventre à 90 kt, l'avion bouclait sans jamais décrocher
		let pathPitchRate = 0;
		if ( this._prevAir ) pathPitchRate = MathUtils.clamp( _pathAxis.crossVectors( this._prevAir, _air ).dot( _right ) / ( speed * speed ) / dt, - 1, 1 );
		( this._prevAir ??= new Vector3() ).copy( _air );
		// Aile décrochée : le nez ne suit plus qu'à moitié la trajectoire qui plonge (l'avion s'enfonce plus vite que le
		// nez ne tombe), l'incidence reste forte : manche tenu en arrière, l'avion reste décroché (il s'enfonce, le nez
		// oscille) jusqu'à ce que le pilote rende la main
		if ( this.stalled ) pathPitchRate *= 0.5;
		let pitchRate = MathUtils.clamp( ( pathPitchRate + A.pitchStability * cgStability * ( alphaTarget - alpha ) ) * stability, - A.pitchRateMax, A.pitchRateMax );		// Relâchement du manche : le nez s'arrête, il ne repart pas dans l'autre sens. L'incidence en trop se résorbe
		// parce que la trajectoire, portée par la portance en excès, rejoint le nez (comme sur un vrai avion). Avant, le
		// rappel vers l'incidence du trim rabattait le nez d'un coup (jusqu'à ~20°/s) : un à-coup en sens opposé à chaque
		// touche relâchée. (Le décrochage garde son abattée, appliquée après)
		if ( this._release > 0 && ! this.stalled ) {
			const slack = MathUtils.degToRad( 1 );
			pitchRate = this._releaseSign > 0 ? Math.max( pitchRate, - slack ) : Math.min( pitchRate, slack );
		}
		const bank = Math.atan2( _right.y, _planeUp.y ); // > 0 : penché à gauche (aile droite haute)
		// Envol avec du vent de travers : au sol, les roues tenaient l'axe de piste ; en l'air, la dérive aligne le nez
		// sur le vent relatif. Effet amené en ~3 s (avant : le nez pivotait d'un coup à la rotation, un dérapage brusque)
		this._weathervaneBlend = Math.max( 0, this._weathervaneBlend - dt / WEATHERVANE_BLEND_TIME );
		const vane = 1 - MathUtils.smoothstep( this._weathervaneBlend, 0, 1 );
		// Spirale : en faible inclinaison, manche lâché, l'avion revient doucement à plat ; au-delà de spiralBank, il
		// s'incline de plus en plus (virage engagé : l'aile extérieure, plus rapide, porte plus), le nez descend et la
		// vitesse monte si le pilote ne remet pas les ailes à plat
		const settle = 1 - MathUtils.smoothstep( Math.abs( bank ), A.spiralBank * 0.55, A.spiralBank );   // rappel à plat qui s'efface
		// (le virage engagé lui-même vient de la portance des deux demi-ailes : plus de terme ajouté pour lui, voir plus haut ;
		// reste le rappel à plat des faibles inclinaisons, effet du dièdre en virage)
		const spiral = - A.spiralStability * bank * settle;
		// Moteur (hélice tournant à droite vue de la cabine) : couple -> roulis à gauche ; souffle hélicoïdal sur la
		// dérive et facteur P (pale descendante, à droite, qui mord plus, d'autant plus que l'incidence est forte) ->
		// lacet à gauche. Forts plein gaz à basse vitesse (montée, remise de gaz), nuls en croisière : du pied droit
		const pFactor = 0.6 + 0.4 * MathUtils.clamp( alpha / stallAlpha, 0, 1.5 );
		// (le roulis dû au lacet ne vient plus d'un coefficient : il sort de la portance des deux demi-ailes, voir plus haut)
		let rollRate = input.roll * A.rollRate * effect + ( A.dihedral * beta * vane + spiral ) * stability + this._gustRoll
			+ A.engineRoll * power * slow;
		// Lacet inverse : l'aileron baissé (aile qui monte) traîne plus, le nez part du côté opposé au virage : on
		// coordonne au palonnier
		const yawRate = input.yaw * A.yawRate * effect - A.yawStability * beta * stability * vane
			- A.adverseYaw * input.roll * effect + A.engineYaw * power * slow * pFactor;
		if ( this._stallBreak > 0 ) {
			// Abattée : l'aile décroche en cabrant (stallBreakDelay : le manche fait encore monter le nez), puis le nez tombe
			// franchement (centrage avant, moteur lourd) et passe sous l'horizon ; le manche garde un peu d'effet
			this._stallBreak -= dt;
			if ( this._stallBreak < A.stallBreakTime ) {
				const k = Math.min( 1, this._stallBreak / ( A.stallBreakTime * 0.4 ) );   // s'atténue à la fin
				// (manche tenu en arrière : la profondeur freine l'abattée, le nez tombe moins et l'aile reste décrochée)
				pitchRate = Math.min( pitchRate, pitchRate * 0.35 ) - A.stallPitchDown * k * ( 1 - 0.6 * Math.max( 0, input.pitch ) );
			}
		}
		// Une aile tombe, pendant l'abattée : à peine moteur réduit (le 172 est docile), nettement plein gaz
		if ( this.stalled && this._stallBreak > 0 && this._stallBreak < A.stallBreakTime ) rollRate += this._wingDrop * A.stallWingDrop * ( 0.3 + 0.7 * power );
		const response = Math.min( 1, A.angularResponse * dt );
		w.x += ( pitchRate - w.x ) * response;
		w.y += ( yawRate - w.y ) * response;
		// Roulis : dynamique de l'avion autour de son axe (inertie) sous les moments de la portance des deux demi-ailes,
		// amortissement compris (voir plus haut). Ailerons, dièdre, rafales, couple moteur, aile qui tombe au décrochage :
		// chacun donné comme la vitesse de roulis qu'il produirait seul (rollRate), traduit en moment par l'amortissement
		// en roulis des ailes (dampRoll : pente de portance × pression × bras² / vitesse) : à vitesse égale, le manche
		// donne le même taux de roulis qu'avant, mais l'aile extérieure d'un virage, plus rapide, l'emporte désormais
		// d'elle-même (virage engagé), et une aile décrochée n'amortit plus rien
		// Empennage et fuselage amortissent aussi le roulis (bodyDamping, part de celui des ailes) : peu en vol normal,
		// mais aile décrochée ils sont seuls à le faire (sinon autorotation à plus de 100°/s dès le moindre décrochage)
		const dampRoll = A.clAlpha * pressure * arm * arm / speed;
		const bodyDamping = this.stalled ? 1 : 0.1;
		w.z += ( dampRoll * ( 1 + bodyDamping ) * rollRate - dampRoll * bodyDamping * w.z + rollMoment ) / A.rollInertia * dt;
		const rollLimit = Math.max( 2 * A.rollRate, 2 );
		w.z = MathUtils.clamp( w.z, - rollLimit, rollLimit );
		_tmpQuaternion.set( w.x * dt / 2, w.y * dt / 2, w.z * dt / 2, 1 ).normalize();
		quaternion.multiply( _tmpQuaternion ).normalize();
	}

	// --- Au sol ---

	// Poussée, traînée, roulement et freins (sur la part du poids que portent encore les roues),
	// roulette de nez orientable ; l'avion décolle quand la portance dépasse le poids
	_updateGround( dt ) {
		this.beta = this.sideAcceleration = 0;
		this.loadFactor = 1;
		this._prevAir = null;   // en l'air : suivi de la trajectoire repris sans à-coup (voir _updateFlight)
		const A = this.aircraft;
		const object = this.object;
		const input = this.controls;
		this.surface = this.surfaceAt( object.position.x, object.position.z );

		let speed = this.airspeed;       // au sol : vitesse de roulage
		// Vent de face (ou arrière) : il s'ajoute à la vitesse de l'air sur l'aile (décollage plus court face au vent)
		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		const headwind = - ( this.wind.x * _forward.x + this.wind.z * _forward.z );
		let air = Math.max( 0, speed + headwind );
		const pressure = 0.5 * this.airDensity() * air * air * A.wingArea;
		const lift = this._liftCoefficient( this._groundPitch );
		const wheelLoad = Math.max( 0, 1 - lift * pressure / ( A.mass * GRAVITY ) );
		// Pente de la piste dans l'axe de roulage (sans le cabré de l'avion) : > 0 en montée
		this._groundNormal( object.position.x, object.position.z, _normal );
		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		const slope = _forward.addScaledVector( _normal, - _forward.dot( _normal ) ).normalize().y;
		// Manche tiré au sol : la profondeur braquée vers le haut freine un peu l'avion (aérofrein léger)
		const elevatorDrag = A.elevatorGroundDrag * Math.max( 0, input.pitch );
		speed += ( ( this._thrust( air ) - ( this._dragCoefficient( lift, 1, air ) + elevatorDrag ) * pressure ) / A.mass - GRAVITY * slope ) * dt;
		const onWater = this.surface === 'water';
		speed -= ( A.rolling[ this.surface ] + ( onWater ? 0 : input.brake * A.brakes ) ) * wheelLoad * dt;
		// Eau : traînée des roues et des carénages qui fendent l'eau (encore un peu quand l'aile porte : ils trempent)
		if ( onWater ) speed -= A.waterDrag * speed * speed * Math.max( 0.3, wheelLoad ) * dt;
		this.airspeed = speed = Math.max( 0, speed );
		this.indicatedSpeed = air = Math.max( 0, speed + headwind );

		// Palonnier (et manche à basse vitesse) : moins d'autorité quand ça va vite
		const steer = MathUtils.clamp( input.yaw + input.roll * 0.5, - 1, 1 );
		const authority = Math.min( 1, speed / 3 ) * ( 1 - 0.6 * Math.min( 1, speed / this.rotateSpeed ) );
		this._groundYaw += steer * 0.6 * authority * ( onWater ? A.waterSteering : 1 ) * dt;
		// Plein gaz au roulage (décollage) : couple et souffle de l'hélice tirent le nez à gauche, du pied droit
		this._groundYaw += A.engineGroundYaw * ( this._thrust( air ) / A.staticThrust ) * Math.min( 1, speed / 8 ) * dt;

		// Profondeur : le nez ne se lève qu'avec assez de vitesse, sinon il retombe sur sa roulette
		// Aide "rotation automatique" : manche au neutre, le trim lève doucement le nez jusqu'à son assiette
		const trimPitch = MathUtils.clamp( this.trimAlpha(), 0, A.maxGroundPitch );
		if ( input.pitch > 0 && air > this.rotateSpeed * 0.85 ) {
			this._groundPitch += input.pitch * 0.12 * Math.min( 1, ( air / this.rotateSpeed ) ** 2 ) * dt; // ~7°/s
		} else if ( this.assists.rotation && Math.abs( input.pitch ) < 0.05 && air > this.rotateSpeed && this._groundPitch < trimPitch ) {
			this._groundPitch = Math.min( trimPitch, this._groundPitch + 0.06 * dt );
		} else {
			this._groundPitch -= ( input.pitch < 0 ? 0.6 : 0.12 ) * ( 0.3 + 0.7 * wheelLoad ) * dt;   // ~5°/s manche relâché
		}
		this._groundPitch = MathUtils.clamp( this._groundPitch, 0, A.maxGroundPitch );

		// Après le toucher : inclinaison et assiette de l'arrivée résorbées en douceur, amortisseurs (ressort amorti)
		const settle = Math.exp( - dt / SETTLE_TIME );
		this._settleRoll *= settle;
		this._settlePitch *= settle;
		this._gearSpeed += ( - GEAR_OMEGA * GEAR_OMEGA * this._gear - 2 * GEAR_DAMPING * GEAR_OMEGA * this._gearSpeed ) * dt;
		this._gear = MathUtils.clamp( this._gear + this._gearSpeed * dt, GEAR_TRAVEL[ 0 ], GEAR_TRAVEL[ 1 ] );

		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		object.position.addScaledVector( _forward, speed * dt );
		this._alignToGround();

		// Décollage : la portance dépasse le poids, l'avion quitte le sol le long de la piste, nez levé
		if ( wheelLoad <= 0 ) {
			this.onGround = false;
			object.position.y -= this._gear;   // rebond : repart du sol, sans l'enfoncement des amortisseurs
			this._settleRoll = this._settlePitch = this._gear = this._gearSpeed = 0;
			this._groundNormal( object.position.x, object.position.z, _normal );
			_forward.addScaledVector( _normal, - _forward.dot( _normal ) ).normalize();
			this.velocity.copy( _forward ).multiplyScalar( speed );
			this.alpha = this._groundPitch;
			this._liftoffAlpha = this._groundPitch;
			this._liftoffBlend = this.assists.smoothLiftoff ? 1 : 0;
			this._weathervaneBlend = 1;
			this._angularVelocity.set( 0, 0, 0 );
			this._pathAngle = null;
			this._alphaCommand = null;
			this._release = 0;
			this.dispatchEvent( { type: 'liftoff' } );
		}
	}

	// Avion posé sur ses roues : altitude du sol, assiette suivant la pente du terrain
	_alignToGround() {
		const object = this.object;
		object.position.y = this.groundHeight( object.position.x, object.position.z ) + this.minAltitude + this._gear;
		this._groundNormal( object.position.x, object.position.z, _normal );

		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		_forward.addScaledVector( _normal, - _forward.dot( _normal ) ).normalize();
		_right.crossVectors( _forward, _normal ).normalize();
		_back.copy( _forward ).negate();
		object.quaternion.setFromRotationMatrix( _basis.makeBasis( _right, _normal, _back ) );
		object.quaternion.multiply( _tmpQuaternion.setFromAxisAngle( _xAxis, this._groundPitch + this._settlePitch ) );
		if ( this._settleRoll ) object.quaternion.multiply( _tmpQuaternion.setFromAxisAngle( _zAxis, this._settleRoll ) );
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
		else if ( A.gearTime && this.gearPosition < 0.95 ) reason = this.gearPosition < 0.05 ? 'Atterrissage train rentré' : 'Train pas complètement sorti';

		if ( reason ) {
			object.position.y = floor;
			this._crash( reason );
			return;
		}

		// Atterrissage : l'avion continue de rouler à sa vitesse horizontale ; l'inclinaison et l'assiette de l'arrivée se
		// résorbent en quelques dixièmes de seconde, les amortisseurs encaissent la vitesse de descente (voir _updateGround)
		this.onGround = true;
		this._groundYaw = Math.atan2( - _forward.x, - _forward.z );
		this._groundPitch = MathUtils.clamp( pitch, 0, A.maxGroundPitch );
		this._settlePitch = pitch - this._groundPitch;
		this._settleRoll = bank;
		this._gear = 0;
		this._gearSpeed = - Math.max( 0, impact );
		this.airspeed = Math.max( 0, this.velocity.dot( _forward.setY( 0 ).normalize() ) );
		this.velocity.set( 0, 0, 0 );
		this._angularVelocity.set( 0, 0, 0 );
		this._pathAngle = null;
		this.stalled = false;
		this._stallBreak = 0;
		this._wind.set( 0, 0, 0 );
		this._alignToGround();
		this.dispatchEvent( { type: 'touchdown', impact } );
	}

	// Obstacles (bâtiments, arbres, décor) : rangés une fois par cases de OBSTACLE_CELL m ; à chaque pas de calcul, seules
	// les boîtes de la case de l'avion sont testées (au lieu de toutes, des milliers avec le décor)
	set obstacles( list ) {
		this._obstacleList = list;
		this._obstacleGrid = null;
	}
	get obstacles() {
		return this._obstacleList;
	}

	_buildObstacleGrid() {
		const grid = new Map(), margin = this.aircraft.obstacleMargin;
		const cell = ( v ) => Math.floor( v / OBSTACLE_CELL );
		for ( const box of this._obstacleList ?? [] ) {
			for ( let ix = cell( box.min.x - margin ); ix <= cell( box.max.x + margin ); ix ++ ) {
				for ( let iz = cell( box.min.z - margin ); iz <= cell( box.max.z + margin ); iz ++ ) {
					const key = ix * 100000 + iz;
					if ( ! grid.has( key ) ) grid.set( key, [] );
					grid.get( key ).push( box );
				}
			}
		}
		return grid;
	}

	_checkObstacles() {
		const position = this.object.position;
		this._obstacleGrid ??= this._buildObstacleGrid();
		const boxes = this._obstacleGrid.get( Math.floor( position.x / OBSTACLE_CELL ) * 100000 + Math.floor( position.z / OBSTACLE_CELL ) );
		if ( ! boxes ) return;
		for ( const box of boxes ) {
			if ( box.distanceToPoint( position ) < this.aircraft.obstacleMargin ) {
				this._crash( 'Collision avec un obstacle' );
				return;
			}
		}
	}

	// Fin du vol décidée hors du modèle (avion coulé dans un lac)
	crash( reason ) {
		if ( ! this.crashed ) this._crash( reason );
	}

	// Choc détecté hors du modèle de vol (autre avion, voir PlaneCollision.js)
	collide( reason ) {
		if ( ! this.crashed ) this._crash( reason );
	}

	_crash( reason ) {
		this.crashed = true;
		this.stalled = false;
		this._stallBreak = 0;
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
