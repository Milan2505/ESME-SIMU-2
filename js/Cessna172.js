import { MathUtils } from 'three';

const deg = MathUtils.degToRad;

// Caractéristiques du Cessna 172 pour le modèle de vol (FlightModel.js) : ordres de grandeur réels
// (masse, aile, moteur de 160 ch), ajustés pour la jouabilité. Unités SI : m, kg, N, W, m/s, radians.
// Un autre avion = un autre objet de ce type, sans toucher à la physique.

const CESSNA_172 = {
	// Masse et aile
	mass: 1100,                       // kg (masse au décollage)
	wingArea: 16.2,                   // m²
	wingspan: 11,                     // m (effet de sol)
	wingHeight: 2.6,                  // hauteur de l'aile au-dessus du sol, roues posées (m)
	// Effet de sol : à moins d'une envergure du sol, l'air "coincé" sous l'aile réduit le tourbillon de bout d'aile.
	// Facteur de traînée induite φ = 33 (h/b)^1,5 / (1 + 33 (h/b)^1,5) : ~0,8 roues au sol, ~0,95 à une demi-envergure
	groundEffectLift: 0.5,            // portance en plus : ~+3,5 % roues au sol (l'avion flotte un peu s'il arrive trop vite)
	groundEffectPitch: deg( 5 ),      // moins de déflexion sur l'empennage : le nez pique un peu (~0,35° au sol), il faut tirer plus
	cl0: 0.4,                         // coefficient de portance à incidence nulle (calage de l'aile compris)
	clAlpha: 4.6,                     // pente de portance (par radian d'incidence)
	alphaStall: deg( 15 ),            // incidence de décrochage : ~51 kt en lisse, ~44 kt volets sortis (manuel : 48 / 40 KIAS à masse réduite)
	cd0: 0.032,                       // traînée de forme (train caréné)
	inducedDrag: 0.06,                // traînée induite : k·CL² (aile d'allongement 7,5)
	stallDrag: 0.15,                  // aile décrochée : traînée en plus
	sideForce: 0.6,                   // force latérale du fuselage en dérapage (par radian)

	// Moteur et hélice
	staticThrust: 3400,               // poussée plein gaz à l'arrêt (N) : accélération franche au décollage
	power: 110000,                    // puissance utile de l'hélice (W) : la poussée baisse avec la vitesse ; croisière ~125 kt
	                                  // (pleine poussée jusqu'à ~80 km/h, puis montée ~4 m/s, assiette ~10°)
	windmillDrag: 0.012,              // hélice au ralenti : elle freine l'avion (finesse ~9 en plané)

	// Gouvernes et stabilité : rotations (rad/s) à pleine efficacité, l'efficacité croît avec le carré de la vitesse
	rollRate: 0.7,
	yawRate: 0.45,                    // palonnier à fond : ~11° de dérapage en vol (avec yawStability)
	controlSpeed: 30,                 // vitesse (m/s) où les gouvernes ont leur pleine efficacité
	pitchStability: 3.5,              // manche lâché : le nez revient à l'incidence du trim
	yawStability: 2.4,                // la dérive aligne le nez sur la trajectoire (virage coordonné)
	dihedral: 0.6,                    // le dérapage incline l'avion (dièdre des ailes : l'aile au vent se soulève)
	yawRoll: 0.4,                     // le nez qui tourne incline l'avion du même côté (l'aile extérieure, plus rapide, porte plus)
	sideslipDrag: 0.6,                // traînée en plus en dérapage (par rad²) : glissade, l'avion ralentit
	spiralStability: 0.1,             // manche lâché, l'inclinaison se réduit doucement (sinon le virage se resserre)
	angularResponse: 5,               // rapidité avec laquelle l'avion suit les gouvernes (1/s)
	stallPitchDown: 0.4,              // abattée au décrochage (rad/s)
	stallWingDrop: 0.5,               // une aile tombe au décrochage (rad/s)
	// Profondeur : la position du manche fixe l'incidence visée, par rapport à celle du trim
	elevatorUp: deg( 6 ),             // manche tiré : +6° par course de manche près du neutre ; à fond, jusqu'à la limite ci-dessous
	elevatorDown: deg( 10 ),          // manche poussé à fond : -10°
	pitchRateMax: 0.35,               // rotation en tangage au plus 20°/s
	phugoidDamping: 1.5,              // manche lâché : amortit les longues oscillations de trajectoire (s)
	phugoidFilter: 30,                // réactivité de cet amortissement (1/s) : trop lent, il fait osciller le nez
	// Incidence visée au plus (par rapport au décrochage)
	elevatorLimit: deg( 2 ),          // sans aide : 2° au-delà (on peut décrocher en tirant)
	elevatorLimitProtected: deg( - 1 ), // aide "protection décrochage" : 1° en deçà

	// Volets
	flapLevels: [ 0, 10, 20, 30 ],    // crans (degrés)
	flapRate: 0.25,                   // vitesse de sortie (course complète en 4 s)
	flapLift: 0.7,                    // volets à fond : portance en plus (décrochage vers 80 km/h au lieu de 90)
	flapDrag: 0.05,                   // volets à fond : traînée en plus
	flapStallAlpha: deg( 2 ),         // volets à fond : l'aile décroche 2° plus tôt

	// Trim : tab de la gouverne de profondeur, en degrés (+ = à cabrer). Manche lâché, l'avion revient à l'incidence
	// que fixe le tab, donc à une vitesse. Réglé pour rester au-dessus du second régime (vitesse de puissance
	// minimale ~55 kt) : 20° (décollage) -> ~72 kt en montée (Vy du 172 : 74 kt) ; 0° -> ~105 kt, croisière. Vers le
	// piqué, la vitesse tenue reste à la portée du moteur en palier (avant : 125 kt au neutre, 138 kt en butée, l'avion
	// ne pouvait les tenir qu'en descendant et plongeait en accélérant dès qu'on passait le neutre)
	trimTabMin: deg( - 15 ),          // à piquer à fond : ~115 kt (voir trimNoseDownEffect)
	trimTabMax: deg( 55 ),            // à cabrer à fond : ~62 kt volets rentrés (approche manche lâché)
	takeoffTrim: deg( 20 ),           // repère décollage
	trimAlphaZero: deg( - 0.76 ),     // incidence tenue tab à 0° : ~110 kt
	trimAlphaPerTab: 0.13,            // incidence tenue en plus par radian de tab à cabrer : +20° (décollage) -> ~72 kt
	                                  // (avant : 0,105, le trim se sentait à peine : toute sa course ne valait que 6° d'incidence)
	trimNoseDownEffect: 0.6,          // sous le neutre, effet réduit (60 %) : l'avion pique et accélère sans plonger
	                                  // (avant : 0,2 avec une butée à -4°, trim « en bas » presque sans effet)
	liftoffReleaseTime: 6,            // aide "envol en douceur" : le nez se rend en ~6 s après l'envol

	// Au sol
	rotateSpeed: 24,                  // vitesse (m/s) où la profondeur peut lever le nez ; décollage vers 27 m/s
	maxGroundPitch: deg( 8 ),         // cabré max roues principales au sol : envol avec une bonne marge au décrochage
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
