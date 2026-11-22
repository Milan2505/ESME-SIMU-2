// Données aérodynamiques, inerties et train du Cessna 172P pour le modèle de vol « réaliste » (js/RigidBodyModel.js).
//
// Licence : GNU General Public License, version 2 (GPL-2.0) - https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
// Ce fichier reprend des valeurs de deux fichiers sous GPL-2.0, convertis en unités SI ; il reste sous GPL-2.0 :
// - [UIUC] modèle linéaire du Cessna 172 du groupe d'aérodynamique appliquée de l'université de l'Illinois (J. Scott,
//   M. Selig, 2000), distribué avec FlightGear (fgdata, Aircraft-uiuc/models/cessna172/linear.html). Ses références : le
//   modèle de Tony Peden pour FlightGear 0.7.1 (c172_aero.c, c172_init.c), « très proche des données du Cessna 182 de
//   Roskam, Airplane Flight Dynamics and Automatic Flight Controls, partie I, DARcorporation, 1995, p. 480-482 ».
// - [C172P] modèle JSBSim de l'équipe c172p de FlightGear (https://github.com/c172p-team/c172p, c172p.xml, version 1.41
//   de janvier 2018 ; décrochage et vrille : D. Dubreuil, 2014). Masse à vide 1 467 lb, comme l'exemple du POH 172P.
// Aucune de ces valeurs n'est une mesure en vol du constructeur : ce sont des estimations publiques (en-tête du
// fichier JSBSim : « publicly available data, technical reports, textbooks, and guesses »).
//
// Conventions (comme JSBSim et la littérature) : α incidence, β dérapage (+ = vent relatif venant de la droite) ;
// p roulis (+ = aile droite qui descend), q tangage (+ = cabrer), r lacet (+ = nez à droite) ; p̂ = p b / 2V,
// q̂ = q c / 2V, r̂ = r b / 2V. Coefficients : Cl roulis (+ = vers la droite), Cm tangage (+ = cabrer), Cn lacet (+ = nez à
// droite), CY force latérale (+ = vers la droite). Gouvernes : δe profondeur (+ = bord de fuite vers le bas, piqueur),
// δa ailerons (+ = roulis à droite), δr direction (+ = bord de fuite à gauche, nez à gauche). Angles en radians.

const FT = 0.3048, IN = 0.0254, SLUGFT2 = 1.35582, LB = 0.45359237, LBF = 4.44822;
const deg = ( d ) => d * Math.PI / 180;

const C172P_AERO = {
	// Géométrie de référence [UIUC] : envergure 35,8 ft, corde moyenne 4,9 ft, surface 174 ft²
	span: 35.8 * FT,
	chord: 4.9 * FT,
	area: 174 * FT * FT,

	// Inerties (kg·m², repère avion) [C172P] : avion vide (Ixx 948, Iyy 1 285, Izz 1 906 slug·ft², Ixz 0), plus le carburant
	// plein des réservoirs standard (240 lb dans les ailes, à ~±1,8 m de l'axe : +345 kg·m² en roulis et en lacet) et les
	// occupants (~+125 kg·m² en tangage)
	inertia: {
		roll: 948 * SLUGFT2 + 345,
		pitch: 1285 * SLUGFT2 + 125,
		yaw: 1906 * SLUGFT2 + 345,
	},
	// Débattements des gouvernes [UIUC] : profondeur 28° vers le haut, 23° vers le bas ; ailerons +20 / -15° (moyenne
	// 17,5°) ; direction ±16°
	elevatorUp: deg( 28 ),
	elevatorDown: deg( 23 ),
	aileronMax: deg( 17.5 ),
	rudderMax: deg( 16 ),
	// Commandes en effort [C172P, option « stick-force-per-g »] : gain = min(1, seuil / q), q en Pa (15 et 30 psf ; la
	// profondeur à piquer n'en a plus depuis le 22/11/2026, voir RigidBodyModel)
	forceElevator: 15 * 47.880,
	forceLateral: 30 * 47.880,

	// Dérivées linéaires [UIUC]
	CLq: 3.9, CLadot: 1.7, CLde: 0.43,
	Cma: - 0.89, Cmq: - 12.4, Cmadot: - 5.2, Cmde: - 1.28,
	CYb: - 0.31, CYp: - 0.037, CYr: 0.21, CYdr: 0.187,
	Clb: - 0.089, Clp: - 0.47, Clr: 0.096, Clda: 0.178, Cldr: 0.0147,
	Cnb: 0.065, Cnp: - 0.03, Cnr: - 0.099, Cnda: - 0.053, Cndr: - 0.0657,
	// Volets [C172P] : moment piqueur (ΔCm à 10, 20, 30°) ; traînée en dérapage (CD par radian de |β|)
	Cmdf: [ [ 0, 0 ], [ 10, - 0.008 ], [ 20, - 0.016 ], [ 30, - 0.024 ] ],
	CDb: 0.15,

	// Décrochage et vrille [C172P] : tables indexées sur l'incidence de l'aile αJ (JSBSim : décrochage à 0,279 rad,
	// aile décrochée à 0,297 ; voir RigidBodyModel : alignée sur l'incidence de décrochage de notre aile)
	stallJ: 0.279,
	// Effet de dièdre multiplié au décrochage (l'aile basse au vent tombe) : 1 -> 3,5
	ClbStall: [ [ 0.279, 1 ], [ 0.297, 3.5 ] ],
	// Ailerons moins efficaces aile décrochée, puis inversés : [αJ, non décrochée, décrochée]
	ClDaStall: [ [ 0, 1, 0.3 ], [ 0.279, 1, 0.3 ], [ 0.297, 0.3, 0.3 ], [ 0.611, - 0.1, - 0.1 ] ],
	// Roulis dû au lacet, aile décrochée : multiplicateur selon αJ (lignes) et r en rad/s (colonnes) : c'est
	// l'autorotation (l'aile extérieure, décrochée moins profondément, porte plus)
	ClrStall: {
		r: [ - 0.15, - 0.1, 0, 0.1, 0.15 ],
		rows: [ [ 0.279, [ 1, 1, 1, 1, 1 ] ], [ 0.297, [ 35, 30, 1, 30, 35 ] ], [ 0.5, [ 5, 5, 1, 5, 5 ] ] ],
	},
	// Clr de base selon αJ (avant le multiplicateur ci-dessus) [C172P] ; en vol normal, la valeur [UIUC] (Clr)
	ClrBase: [ [ 0, 0.0798 ], [ 0.07, 0.2039 ], [ 0.09, 0.1869 ] ],
	// Empennage horizontal qui décroche aux grandes incidences (vrille à plat) : multiplicateur de Cmα, α en degrés
	CmaStall: [ [ 20, 1 ], [ 25, 0.6 ], [ 35, 0.4 ], [ 45, 0.5 ], [ 55, 0.4 ], [ 65, 0.2 ], [ 90, 0.1 ] ],
	// Efficacité de la profondeur selon son braquage (rad, lignes) et l'incidence (degrés, colonnes)
	CmdeStall: {
		alpha: [ 18, 25, 35, 45, 55, 65, 90 ],
		rows: [ [ - 0.49, [ 1, 0.5, 0.2, 0.1, 0.1, 0.1, 0.1 ] ], [ 0, [ 1, 0.6, 0.3, 0.15, 0.1, 0.1, 0.1 ] ], [ 0.40, [ 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4 ] ] ],
	},
	// Vrille à plat : Cn supplémentaire (× b/2V) selon r (rad/s, lignes) et αJ (colonnes 0,279 et 0,4)
	CnSpin: {
		alphaJ: [ 0.279, 0.4 ],
		rows: [ [ - 15, [ 0, 0 ] ], [ - 5, [ 0, 0 ] ], [ - 3, [ 0, - 0.25 ] ], [ - 1, [ 0, 0 ] ], [ 0, [ 0, 0 ] ], [ 1, [ 0, 0 ] ], [ 3, [ 0, 0.25 ] ], [ 5, [ 0, 0 ] ], [ 15, [ 0, 0 ] ] ],
	},
	// Portance et traînée au-delà du décrochage (aile décrochée) [C172P, CLwbh et CDwbh, colonne lisse] : α en radians
	CLpost: [ [ 0.36, 1.15 ], [ 0.52, 1.47 ], [ 0.70, 1.65 ], [ 0.87, 1.47 ], [ 1.05, 1.17 ], [ 1.57, 0.01 ] ],
	CDpost: [ [ 0.3491, 0.2537 ], [ 0.5236, 0.45 ], [ 0.6981, 0.7 ], [ 0.8727, 1 ], [ 1.0472, 1.35 ], [ 1.2217, 1.5 ], [ 1.3963, 1.57 ], [ 1.5710, 1.6 ] ],

	// Train tricycle [C172P] (repère du constructeur : pouces en arrière de la référence, la cloison pare-feu) : roulette de
	// nez à -7,3 in, roues principales à 57,3 in et à ±43 in de l'axe ; ressorts 3 600 lbf/ft (nez) et 5 400 lbf/ft
	// (chaque roue principale), amortisseurs 1 200 et 1 800 lbf·s/ft ; frottement 0,8 (adhérence), 0,02 (roulement) ;
	// roulette de nez orientable de ±10° au palonnier
	gear: [
		{ name: 'nose', station: - 7.3 * IN, lateral: 0, spring: 3600 * LBF / FT, damper: 1200 * LBF / FT, steer: deg( 10 ), brake: null },
		{ name: 'left', station: 57.3 * IN, lateral: - 43 * IN, spring: 5400 * LBF / FT, damper: 1800 * LBF / FT, steer: 0, brake: 'left' },
		{ name: 'right', station: 57.3 * IN, lateral: 43 * IN, spring: 5400 * LBF / FT, damper: 1800 * LBF / FT, steer: 0, brake: 'right' },
	],
	gearGrip: 0.8,
	// Patin de queue [C172P] : station 226,7 in, 32,3 in au-dessus du contact des roues principales (assiette maxi au sol
	// ~11°), ressort 2 000 lbf/ft, amortisseur 1 000 lbf·s/ft, frottement 0,5
	tailSkid: { station: 226.7 * IN, height: 32.3 * IN, spring: 2000 * LBF / FT, damper: 1000 * LBF / FT, friction: 0.5 },
	// Centrage de référence du modèle (FlightModel.cgOffset = 0) : 1,0 m en arrière de la référence (voir simulator.js)
	cgReference: 1.0,
	// (masses : pour mémoire, masse à vide de l'exemple du POH = masse à vide du fichier JSBSim)
	emptyMass: 1467 * LB,
};

export { C172P_AERO };
