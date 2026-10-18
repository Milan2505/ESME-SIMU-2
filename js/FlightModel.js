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
// Centrage (voir cgOffset) : incidence en plus tenue par le trim, et stabilité en moins, par mètre de recul
const CG_TRIM_ALPHA = MathUtils.degToRad( 12 );   // ~1,2° pour 10 cm
const CG_STABILITY = 2.5;                        // -25 % de stabilité pour 10 cm

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
const _pathAxis = new Vector3();

const WEATHERVANE_BLEND_TIME = 3;   // s : après l'envol, la dérive reprend son effet en douceur
const DRIFT_RATE = 2;               // 1/s : sans l'aide « correction de dérive », l'avion prend la vitesse du vent après l'envol

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
			crosswindCorrection: false,  // vent de travers : après l'envol, le nez se met tout seul face au vent (pas de dérive)
		};

		// Commandes du pilote
		this.controls = { pitch: 0, roll: 0, yaw: 0, brake: 0 }; // profondeur (+ = cabrer), ailerons et palonnier (+ = gauche), freins
		this.throttle = 0.3;             // 0 -> 1
		this.enginePower = 1;            // puissance disponible (0 = moteur arrêté), voir Systems.js
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
		this._groundYaw = 0;             // cap au sol (rad, + = vers la gauche)
		this._groundPitch = 0;           // cabré au sol (rad), 0 = roulette avant posée
		this.beta = 0;                   // dérapage (rad, + = vent relatif venant de la droite : nez à gauche de la trajectoire)
		this.sideAcceleration = 0;       // accélération latérale ressentie (m/s², + = vers la droite), voir _updateAir
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

	// Fait avancer la simulation de delta secondes
	step( delta ) {
		if ( this.crashed ) return;
		const A = this.aircraft;

		// Volets : se déplacent progressivement vers le cran demandé
		const flapTarget = A.flapLevels[ this.flapLevel ] / A.flapLevels[ A.flapLevels.length - 1 ];
		if ( this.flapsPowered ) this.flaps += MathUtils.clamp( flapTarget - this.flaps, - A.flapRate * delta, A.flapRate * delta );
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
		return Math.sqrt( 2 * A.mass * GRAVITY / ( AIR_DENSITY * A.wingArea * this._liftCoefficient( alpha ) ) );
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
		return this.throttle * this.enginePower * Math.min( this.aircraft.staticThrust, this.aircraft.power / Math.max( 1, speed ) );
	}

	// Coefficient de traînée : forme + volets + induite (réduite près du sol) + hélice au ralenti + aile décrochée
	_dragCoefficient( lift, groundEffect = 1 ) {
		const A = this.aircraft;
		return A.cd0 + A.flapDrag * this.flaps + A.inducedDrag * lift * lift * groundEffect
			+ A.windmillDrag * ( 1 - this.throttle * this.enginePower ) + ( this.stalled ? A.stallDrag : 0 );
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
		this.airspeed = this.indicatedSpeed = speed;
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
			this._stallBreak = A.stallBreakTime;
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

		const pressure = 0.5 * AIR_DENSITY * speed * speed * A.wingArea;
		const lift = this._liftCoefficient( alpha, this.stalled ) * ( 1 + A.groundEffectLift * this.groundEffect );
		_liftDirection.crossVectors( _right, _air ).normalize(); // perpendiculaire au vent relatif
		_force.copy( _liftDirection ).multiplyScalar( lift * pressure )
			.addScaledVector( _air, - ( this._dragCoefficient( lift, groundEffect ) + A.sideslipDrag * beta * beta ) * pressure / speed )
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
		const input = this.controls;
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
			? A.elevatorUp * pull + Math.max( 0, limit - trimAlpha - A.elevatorUp ) * pull ** 3
			: A.elevatorDown * input.pitch;
		let alphaTarget = trimAlpha + elevator * authority - A.groundEffectPitch * this.groundEffect;
		if ( input.pitch > 0 ) alphaTarget = Math.min( alphaTarget, Math.max( limit, trimAlpha ) );
		// Manche lâché : amortissement des longues oscillations de trajectoire (phugoïde) ; quand la trajectoire
		// se redresse, l'incidence baisse un peu, et inversement (sans effet en vol stabilisé, ni à l'arrondi)
		const pathAngle = Math.asin( MathUtils.clamp( this.velocity.y / Math.max( 0.1, this.velocity.length() ), - 1, 1 ) );
		if ( this._pathAngle !== null ) {
			this._pathRate += ( ( pathAngle - this._pathAngle ) / dt - this._pathRate ) * Math.min( 1, dt * A.phugoidFilter );
		}
		this._pathAngle = pathAngle;
		if ( Math.abs( input.pitch ) < 0.1 ) alphaTarget -= A.phugoidDamping * this._pathRate;
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
		let pitchRate = MathUtils.clamp( ( pathPitchRate + A.pitchStability * cgStability * ( alphaTarget - alpha ) ) * stability, - A.pitchRateMax, A.pitchRateMax );
		const bank = Math.atan2( _right.y, _planeUp.y ); // > 0 : penché à gauche (aile droite haute)
		// Envol avec du vent de travers : au sol, les roues tenaient l'axe de piste ; en l'air, la dérive aligne le nez
		// sur le vent relatif. Effet amené en ~3 s (avant : le nez pivotait d'un coup à la rotation, un dérapage brusque)
		this._weathervaneBlend = Math.max( 0, this._weathervaneBlend - dt / WEATHERVANE_BLEND_TIME );
		const vane = 1 - MathUtils.smoothstep( this._weathervaneBlend, 0, 1 );
		// Spirale : en faible inclinaison, manche lâché, l'avion revient doucement à plat ; au-delà de spiralBank, il
		// s'incline de plus en plus (virage engagé : l'aile extérieure, plus rapide, porte plus), le nez descend et la
		// vitesse monte si le pilote ne remet pas les ailes à plat
		const steep = Math.max( 0, Math.abs( bank ) - A.spiralBank ) * Math.sign( bank );
		const settle = 1 - MathUtils.smoothstep( Math.abs( bank ), A.spiralBank * 0.55, A.spiralBank );   // rappel à plat qui s'efface
		const spiral = - A.spiralStability * bank * settle + A.spiralDivergence * steep;
		// Moteur (hélice tournant à droite vue de la cabine) : couple -> roulis à gauche ; souffle hélicoïdal sur la
		// dérive et facteur P (pale descendante, à droite, qui mord plus, d'autant plus que l'incidence est forte) ->
		// lacet à gauche. Forts plein gaz à basse vitesse (montée, remise de gaz), nuls en croisière : du pied droit
		const pFactor = 0.6 + 0.4 * MathUtils.clamp( alpha / stallAlpha, 0, 1.5 );
		let rollRate = input.roll * A.rollRate * effect + ( A.dihedral * beta * vane + spiral ) * stability + this._gustRoll
			+ A.yawRoll * this._angularVelocity.y   // lacet à gauche (+) : roulis à gauche (+)
			+ A.engineRoll * power * slow;
		// Lacet inverse : l'aileron baissé (aile qui monte) traîne plus, le nez part du côté opposé au virage : on
		// coordonne au palonnier
		const yawRate = input.yaw * A.yawRate * effect - A.yawStability * beta * stability * vane
			- A.adverseYaw * input.roll * effect + A.engineYaw * power * slow * pFactor;
		if ( this._stallBreak > 0 ) {
			// Abattée : le nez tombe franchement (centrage avant, moteur lourd), la profondeur ne peut pas le retenir ;
			// d'abord en cabré (l'aile décroche nez haut), puis le nez passe sous l'horizon
			this._stallBreak -= dt;
			const k = Math.min( 1, this._stallBreak / ( A.stallBreakTime * 0.4 ) );   // s'atténue à la fin
			// (manche tenu en arrière : la profondeur freine l'abattée, le nez tombe moins et l'aile reste décrochée)
			pitchRate = Math.min( pitchRate, 0 ) - A.stallPitchDown * k * ( 1 - 0.6 * Math.max( 0, input.pitch ) );
		}
		// Une aile tombe, pendant l'abattée : à peine moteur réduit (le 172 est docile), nettement plein gaz
		if ( this.stalled && this._stallBreak > 0 ) rollRate += this._wingDrop * A.stallWingDrop * ( 0.3 + 0.7 * power );
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
		this.beta = this.sideAcceleration = 0;
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
		const pressure = 0.5 * AIR_DENSITY * air * air * A.wingArea;
		const lift = this._liftCoefficient( this._groundPitch );
		const wheelLoad = Math.max( 0, 1 - lift * pressure / ( A.mass * GRAVITY ) );
		// Pente de la piste dans l'axe de roulage (sans le cabré de l'avion) : > 0 en montée
		this._groundNormal( object.position.x, object.position.z, _normal );
		_forward.set( - Math.sin( this._groundYaw ), 0, - Math.cos( this._groundYaw ) );
		const slope = _forward.addScaledVector( _normal, - _forward.dot( _normal ) ).normalize().y;
		speed += ( ( this._thrust( air ) - this._dragCoefficient( lift ) * pressure ) / A.mass - GRAVITY * slope ) * dt;
		speed -= ( A.rolling[ this.surface ] + input.brake * A.brakes ) * wheelLoad * dt;
		this.airspeed = speed = Math.max( 0, speed );
		this.indicatedSpeed = air = Math.max( 0, speed + headwind );

		// Palonnier (et manche à basse vitesse) : moins d'autorité quand ça va vite
		const steer = MathUtils.clamp( input.yaw + input.roll * 0.5, - 1, 1 );
		const authority = Math.min( 1, speed / 3 ) * ( 1 - 0.6 * Math.min( 1, speed / this.rotateSpeed ) );
		this._groundYaw += steer * 0.6 * authority * dt;
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
			this._weathervaneBlend = 1;
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
		this._stallBreak = 0;
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
