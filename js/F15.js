import { MathUtils } from 'three';

const deg = MathUtils.degToRad;

// Caractéristiques du F-15C Eagle pour le modèle de vol (FlightModel.js), comme Cessna172.js pour le Cessna : ordres
// de grandeur réels (masse, aile de 56,5 m², deux réacteurs F100-PW-220 de 65 kN chacun, 106 kN avec postcombustion),
// ajustés pour la jouabilité. Unités SI : m, kg, N, m/s, radians.
// Réacteurs : la poussée vient des systèmes (JetSystems.js : régime, postcombustion), donnée au modèle de vol par
// model.jetThrust ; jet: true remplace la poussée de l'hélice et retire ses effets (couple, souffle, facteur P).
// Repères de vitesse (masse ~18 t) : rotation ~120 kt, envol ~140 kt, approche ~140 kt (incidence ~12°), décrochage
// vers 105 kt volets sortis ; au niveau de la mer, ~Mach 1,15 au plus avec la postcombustion (traînée d'onde).

const F15 = {
	jet: true,
	airStartSpeed: 130,               // m/s : départ en vol (~250 kt)
	// Masse et aile
	emptyMass: 12900,                 // kg : avion vide + pilote (la masse suit le carburant, voir JetSystems.fuelMass)
	mass: 18000,                      // kg (recalculée en vol)
	wingArea: 56.5,                   // m²
	wingspan: 13.05,                  // m (effet de sol)
	wingHeight: 2.5,                  // hauteur de l'aile au-dessus du sol, roues posées (m)
	groundEffectLift: 0.3,
	groundEffectPitch: deg( 2 ),
	cl0: 0.05,                        // aile cambrée à peine : presque pas de portance à incidence nulle
	clAlpha: 3.2,                     // pente de portance (aile delta tronquée de faible allongement, ~3)
	alphaStall: deg( 26 ),            // incidence maxi (le F-15 tient de très fortes incidences ; au-delà, il s'enfonce)
	cd0: 0.021,                       // traînée de forme, lisse (sans charges)
	inducedDrag: 0.13,                // k·CL² : allongement 3, e ≈ 0,8
	stallDrag: 0.3,
	sideForce: 0.8,

	// Réacteurs (voir JetSystems.js) : poussée maxi des deux réacteurs, référence des effets moteur
	staticThrust: 211000,             // N (2 × 105,7 kN, postcombustion à fond)
	power: Infinity,                  // (hélice : sans objet)
	windmillDrag: 0,
	densityAltitude: true,            // air moins dense en altitude : portance, traînée et poussée baissent
	// Traînée d'onde : au-delà de Mach 0,88, la traînée monte en flèche jusqu'à Mach 1,05, puis se stabilise
	machCritical: 0.88,
	waveDrag: 0.028,
	gLimit: 9,                        // commandes de vol : facteur de charge limité à +9 g (manche au ventre à grande vitesse)
	gLimitNegative: - 3,

	// Gouvernes et stabilité (commandes de vol électriques d'appoint, CAS : avion stable, virages coordonnés)
	rollRate: 3.2,                    // ~180°/s à pleine efficacité
	yawRate: 0.35,
	controlSpeed: 75,                 // m/s (~145 kt) : pleine efficacité des gouvernes
	pitchStability: 4.5,
	yawStability: 3.5,
	dihedral: 0.25,
	rollInertia: 28700,               // kg·m² : inertie en roulis (F-15C, ordre de grandeur réel)
	sideslipDrag: 0.5,
	spiralStability: 0.15,
	spiralBank: deg( 75 ),
	adverseYaw: 0,                    // interconnexion ailerons-direction (ARI) : pas de lacet inverse
	engineEffectSpeed: 1,             // (pas d'effets d'hélice)
	engineYaw: 0,
	engineRoll: 0,
	engineGroundYaw: 0,
	angularResponse: 7,
	stallPitchDown: 0.15,             // à l'incidence maxi : l'avion s'enfonce, le nez retombe doucement
	stallBreakTime: 1.0,
	stallBreakDelay: 0.6,
	stallWingDrop: 0.3,
	stallLift: 0.85,
	stallRecovery: deg( 3 ),
	lowSpeedStability: 0.15,
	elevatorUp: deg( 12 ),            // (plus d'autorité en tangage : avant 8°)
	elevatorDown: deg( 18 ),          // (avant 12°)
	pitchRateMax: 0.65,               // ~37°/s (avant 26°/s)
	phugoidDamping: 1.5,
	phugoidFilter: 30,
	elevatorLimit: deg( 6 ),
	elevatorLimitProtected: deg( - 2 ),

	// Volets (deux positions : rentrés, sortis à 30°)
	flapLevels: [ 0, 30 ],
	flapRate: 0.3,
	flapLift: 0.2,
	flapDrag: 0.03,
	elevatorGroundDrag: 0.01,
	flapStallAlpha: 0,

	// Train rentrant et aérofrein
	gearTime: 5,                      // s : sortie ou rentrée complète
	gearDrag: 0.02,
	speedbrakeTime: 2,                // s
	speedbrakeDrag: 0.16,             // aérofrein dorsal sorti (~45°) ; avant 0,08 : on ne le sentait presque pas

	// Trim (manche lâché : incidence tenue, donc vitesse) : 0° -> ~340 kt ; décollage +10° -> ~235 kt (montée) ;
	// à cabrer à fond (+30°) -> ~150 kt volets sortis (approche)
	trimTabMin: deg( - 8 ),
	trimTabMax: deg( 30 ),
	takeoffTrim: deg( 10 ),
	trimAlphaZero: deg( 2 ),
	trimAlphaPerTab: 0.33,
	trimNoseDownEffect: 0.6,
	liftoffReleaseTime: 6,

	// Au sol
	rotateSpeed: 60,                  // m/s (~117 kt)
	maxGroundPitch: deg( 12 ),        // au-delà, les tuyères touchent la piste
	brakes: 5,
	rolling: { asphalt: 0.25, grass: 1.5, water: 4 },
	waterDrag: 0.02,
	waterSteering: 0.2,

	// Limites au contact du sol
	crashSink: 4.5,                   // m/s (~900 ft/min : train de chasseur, pas de porte-avions)
	crashBank: deg( 12 ),
	crashNose: deg( - 4 ),
	crashTail: deg( 15 ),
	minSlopeNormal: 0.95,
	obstacleMargin: 6.5,
};

export { F15 };
