import { MathUtils } from 'three';

const deg = MathUtils.degToRad;

// Caractéristiques du Cessna 172 pour le modèle de vol (FlightModel.js) : ordres de grandeur réels
// (masse, aile, moteur de 160 ch), ajustés pour la jouabilité. Unités SI : m, kg, N, W, m/s, radians.
// Un autre avion = un autre objet de ce type, sans toucher à la physique.
const TRIM_MID = deg( 6 );
const TRIM_RANGE = deg( 7 );

const CESSNA_172 = {
	// Masse et aile
	mass: 1100,                       // kg (masse au décollage)
	wingArea: 16.2,                   // m²
	wingspan: 11,                     // m (effet de sol)
	cl0: 0.4,                         // coefficient de portance à incidence nulle (calage de l'aile compris)
	clAlpha: 4.6,                     // pente de portance (par radian d'incidence)
	alphaStall: deg( 16 ),            // incidence de décrochage
	cd0: 0.036,                       // traînée de forme (train fixe compris)
	inducedDrag: 0.06,                // traînée induite : k·CL² (aile d'allongement 7,5)
	stallDrag: 0.15,                  // aile décrochée : traînée en plus
	sideForce: 0.6,                   // force latérale du fuselage en dérapage (par radian)

	// Moteur et hélice
	staticThrust: 3400,               // poussée plein gaz à l'arrêt (N) : accélération franche au décollage
	power: 75000,                     // puissance utile de l'hélice (W) : la poussée baisse avec la vitesse
	                                  // (pleine poussée jusqu'à ~80 km/h, puis montée ~4 m/s, assiette ~10°)
	windmillDrag: 0.012,              // hélice au ralenti : elle freine l'avion (finesse ~9 en plané)

	// Gouvernes et stabilité : rotations (rad/s) à pleine efficacité, l'efficacité croît avec le carré de la vitesse
	rollRate: 0.7,
	yawRate: 0.3,
	controlSpeed: 30,                 // vitesse (m/s) où les gouvernes ont leur pleine efficacité
	pitchStability: 3.5,              // manche lâché : le nez revient à l'incidence du trim
	yawStability: 3,                  // la dérive aligne le nez sur la trajectoire (virage coordonné)
	dihedral: 0.8,                    // le dérapage incline l'avion (dièdre des ailes)
	spiralStability: 0.1,             // manche lâché, l'inclinaison se réduit doucement (sinon le virage se resserre)
	angularResponse: 5,               // rapidité avec laquelle l'avion suit les gouvernes (1/s)
	stallPitchDown: 0.4,              // abattée au décrochage (rad/s)
	stallWingDrop: 0.5,               // une aile tombe au décrochage (rad/s)
	// Profondeur : la position du manche fixe l'incidence visée, par rapport à celle du trim
	elevatorUp: deg( 9 ),             // manche tiré à fond : +9° (au trim de décollage, reste sous le décrochage)
	elevatorDown: deg( 10 ),          // manche poussé à fond : -10°
	pitchRateMax: 0.35,               // rotation en tangage au plus 20°/s
	// Incidence visée au plus (par rapport au décrochage)
	elevatorLimit: deg( 2 ),          // sans aide : 2° au-delà (on peut décrocher en tirant)
	elevatorLimitProtected: deg( - 1 ), // aide "protection décrochage" : 1° en deçà

	// Volets
	flapLevels: [ 0, 10, 20, 30 ],    // crans (degrés)
	flapRate: 0.25,                   // vitesse de sortie (course complète en 4 s)
	flapLift: 0.7,                    // volets à fond : portance en plus (décrochage vers 80 km/h au lieu de 90)
	flapDrag: 0.05,                   // volets à fond : traînée en plus
	flapStallAlpha: deg( 2 ),         // volets à fond : l'aile décroche 2° plus tôt

	// Trim (compensateur de profondeur) : manche relâché, l'avion revient à l'incidence qu'il fixe, donc à une vitesse.
	// Position -1 = à piquer à fond (rapide), +1 = à cabrer à fond (lent)
	trimMid: TRIM_MID,                // incidence au trim neutre
	trimRange: TRIM_RANGE,            // incidence : de -1° (piqué à fond, ~220 km/h) à 13° (cabré à fond)
	takeoffTrim: ( deg( 4.5 ) - TRIM_MID ) / TRIM_RANGE, // repère décollage : montée vers 135 km/h
	liftoffReleaseTime: 6,            // aide "envol en douceur" : le nez se rend en ~6 s après l'envol

	// Au sol
	rotateSpeed: 24,                  // vitesse (m/s) où la profondeur peut lever le nez ; décollage vers 27 m/s
	maxGroundPitch: deg( 10 ),        // cabré max roues principales au sol : décollage avec de la marge au décrochage
	brakes: 4,                        // décélération des freins (m/s²), roues chargées
	rolling: { asphalt: 0.2, grass: 1.0 }, // résistance au roulement (m/s²), roues chargées

	// Limites au contact du sol : au-delà, c'est un crash
	crashSink: 6,                     // vitesse d'impact perpendiculaire au sol (m/s)
	crashBank: deg( 20 ),             // inclinaison au toucher (une aile touche)
	crashNose: deg( - 8 ),            // nez trop bas : l'hélice et la roulette avant touchent
	crashTail: deg( 22 ),             // queue trop basse
	minSlopeNormal: 0.85,             // terrain trop pentu pour s'y poser
	obstacleMargin: 3,                // demi-envergure "utile" pour les obstacles (m)
};

export { CESSNA_172 };
