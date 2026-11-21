// Givrage du carburateur du 172P (Lycoming O-320-D2J, carburateur à flotteur Marvel-Schebler) et réchauffe (tirette
// CARB HEAT), lot 3. Module pur (testé par tests/carb-icing.test.js), utilisé par Systems.js.
//
// Sources :
// - POH 172P (édition du 30/05/1980, même texte que 1981 ; lu par l'OCR de ManualsLib, scan D1251-13 non relu) :
//   p. 3-16 « A gradual loss of RPM and eventual engine roughness may result from the formation of carburetor ice » ;
//   remède : plein gaz et réchauffe tirée à fond jusqu'à ce que le moteur tourne rond, puis repoussée.
//   p. 4-16 : glace = « unexplained drop in RPM », enlevée par la pleine réchauffe ; l'air chaud enrichit le mélange.
//   p. 7-15 : air chaud pris autour d'un tuyau d'échappement, non filtré ; « Use of full carburetor heat at full
//   throttle will result in a loss of approximately 75 to 150 RPM ».
//   p. 4-23 : plage critique de l'air au carburateur de 0 à 21 °C.
// - CAA Safety Sense Leaflet 14 « Piston Engine Icing » (juin 2023) : abaque p. 5 (zones ci-dessous, en température et
//   point de rosée, relevées sur le PDF) ; « note the greater risk of serious icing at descent power » ; p. 8 : chute
//   de régime à l'essai « typically 75–100 rpm » ; si la glace est déjà formée, la réchauffe peut d'abord faire tourner
//   le moteur plus irrégulièrement pendant la fonte (« at least 15 seconds »), puis le régime remonte plus haut qu'avant.
// - EASA SIB 2010-03 / FAA SAIB CE-09-35 : risque maximal à puissance réduite (papillon presque fermé : effet venturi
//   plus fort), ratés brefs à la fonte, arrêt du moteur au pire.
// Non relu (choix de jeu, aucune source chiffrée) : vitesses de formation et de fonte ci-dessous, perte de puissance par
// la glace, échauffement de l'air de la réchauffe.

// Zones de l'abaque (CAA SSL 14 p. 5), de la plus large à la plus étroite : chaque zone est bornée par la diagonale
// T = Td (100 % d'humidité, de diag[0] à diag[1] °C) et par une courbe de points [T, Td] (°C)
export const ICING_ZONES = [
	{ name: 'léger (croisière et descente)', diag: [ -15, 30 ], curve: [ [ -12.5, -14.4 ], [ -6, -12.5 ], [ 3.2, -9 ], [ 14.2, -4 ], [ 25.5, 2.9 ], [ 33.8, 10.6 ], [ 37.2, 17.5 ], [ 36.8, 23.2 ], [ 34, 27.4 ], [ 29.9, 29.8 ] ] },
	{ name: 'sérieux en descente', diag: [ -8, 27 ], curve: [ [ -6, -7.7 ], [ -0.6, -6.6 ], [ 7.1, -4.3 ], [ 15.8, -0.3 ], [ 24.7, 5.7 ], [ 30.5, 12.4 ], [ 32.1, 18.2 ], [ 31, 22.8 ], [ 28.9, 25.8 ], [ 27.4, 27 ] ] },
	{ name: 'modéré en croisière, sérieux en descente', diag: [ -2.4, 23 ], curve: [ [ -0.8, -2.4 ], [ 3.5, -1.7 ], [ 9.3, -0.2 ], [ 15.5, 2.4 ], [ 21, 6.5 ], [ 24.4, 11 ], [ 25.8, 15 ], [ 25.7, 18.3 ], [ 24.6, 20.9 ], [ 23, 22.8 ] ] },
	{ name: 'sérieux à toute puissance', diag: [ -0.6, 15.5 ], curve: [ [ 0.3, -0.8 ], [ 2.7, -0.6 ], [ 6.1, 0.1 ], [ 9.8, 1.9 ], [ 13.3, 5 ], [ 15.5, 8.7 ], [ 16.3, 11.6 ], [ 16.3, 13.7 ], [ 15.8, 15 ] ] },
];
// Sévérité par zone (0 aucune, 1 légère, 2 modérée, 3 sérieuse) en croisière et en descente (légende de l'abaque, lecture
// non relue)
const SEVERITY = [ [ 0, 0 ], [ 1, 1 ], [ 1, 3 ], [ 2, 3 ], [ 3, 3 ] ];
// Temps (s) pour que la glace bouche le carburateur jusqu'à l'arrêt, gaz tenus, selon la sévérité (non relu : choix de
// jeu ; un givrage sérieux se voit au compte-tours en quelques minutes)
export const ICING_TIME = [ Infinity, 3600, 1500, 900 ];
export const MELT_TIME = 20;        // s pour fondre une glace complète, réchauffe tirée (CAA SSL 14 p. 8 : 15 s au moins)
export const CARB_HEAT_RISE = 24;   // K : air chaud de la réchauffe au-dessus de l'air extérieur (non relu ; calé pour une
                                    // chute de ~100 tr/min à l'essai moteur, POH p. 7-15 et SSL 14 p. 8, tests)

function inside( [ x, y ], polygon ) {
	let hit = false;
	for ( let i = 0, j = polygon.length - 1; i < polygon.length; j = i ++ ) {
		const [ xi, yi ] = polygon[ i ], [ xj, yj ] = polygon[ j ];
		if ( ( yi > y ) !== ( yj > y ) && x < ( xj - xi ) * ( y - yi ) / ( yj - yi ) + xi ) hit = ! hit;
	}
	return hit;
}
const POLYGONS = ICING_ZONES.map( ( z ) => [ [ z.diag[ 0 ], z.diag[ 0 ] ], ...z.curve, [ z.diag[ 1 ], z.diag[ 1 ] ] ] );

// Zone de l'abaque (0 = hors abaque, 1 à 4 de la plus large à la plus étroite) pour une température et un point de rosée
// (°C ; un point de rosée au-dessus de la température est ramené à la saturation)
export function icingZone( temp, dew ) {
	const point = [ temp, Math.min( dew, temp ) - 1e-6 ];
	let zone = 0;
	POLYGONS.forEach( ( polygon, i ) => { if ( inside( point, polygon ) ) zone = i + 1; } );
	return zone;
}

// Sévérité continue (0 -> 3) selon la zone et la puissance (manette 0 -> 1) : descente sous ~25 % de manette,
// croisière au-dessus de ~60 %
export function icingSeverity( temp, dew, throttle ) {
	const [ cruise, descent ] = SEVERITY[ icingZone( temp, dew ) ];
	const low = Math.min( 1, Math.max( 0, ( 0.6 - throttle ) / 0.35 ) );
	return cruise + ( descent - cruise ) * low;
}
function formationRate( severity ) {
	if ( severity <= 0 ) return 0;
	const i = Math.min( 2, Math.floor( severity ) ), f = severity - i;
	const rate = ( k ) => ( k === 0 ? 0 : 1 / ICING_TIME[ k ] );
	return rate( i ) + ( rate( i + 1 ) - rate( i ) ) * f;
}

// Densité de l'air admis réchauffe tirée, par rapport à l'air extérieur (°C)
export const carbHeatDensity = ( temp ) => ( temp + 273.15 ) / ( temp + 273.15 + CARB_HEAT_RISE );

// Glace dans le carburateur : 0 (rien) -> 1 (venturi bouché : le moteur s'arrête)
export class CarbIce {
	constructor() { this.reset(); }
	reset() {
		this.ice = 0;
		this.melting = false;
		this._t = 0;
	}
	// dt (s) ; temp, dew (°C) ; throttle (0 -> 1) ; heat : réchauffe tirée ; running : moteur en marche ; scale : vitesse de
	// formation (réglage « Effets de l'atmosphère » : 1 réaliste, 1/3 doux, 0 aucun)
	update( dt, { temp, dew, throttle, heat, running, scale = 1 } ) {
		this._t += dt;
		this.melting = false;
		// Moteur arrêté : la glace reste ; réchauffe tirée, la chaleur restante de l'échappement peut la fondre (CAA SSL 14
		// p. 8), lentement
		if ( ! running ) {
			if ( heat ) this.ice = Math.max( 0, this.ice - dt / 120 );
			return this;
		}
		if ( heat ) {
			// Air chaud : plus de formation, la glace fond (avec des ratés : l'eau passe dans les cylindres)
			this.melting = this.ice > 0;
			this.ice = Math.max( 0, this.ice - dt / MELT_TIME );
		} else {
			const rate = formationRate( icingSeverity( temp, dew, throttle ) ) * scale;
			// Hors abaque : la glace s'en va doucement (air plus chaud que la plage critique)
			this.ice = rate > 0 ? Math.min( 1, this.ice + rate * dt ) : Math.max( 0, this.ice - dt / 300 );
		}
		return this;
	}
	// Moteur étouffé par la glace
	get choked() { return this.ice >= 1; }
	// Rugosité (0 -> 1) : glace avancée (ratés), fonte (eau dans les cylindres)
	get roughness() {
		const ice = Math.max( 0, ( this.ice - 0.3 ) / 0.7 );
		return Math.min( 1, Math.max( ice, this.melting ? 0.45 + 0.55 * this.ice : 0 ) );
	}
	// Facteur de puissance (0 -> 1) : venturi rétréci par la glace, ratés brefs (déterministes) quand le moteur tousse
	get power() {
		const blocked = 1 - 0.55 * this.ice ** 1.5;
		const r = this.roughness;
		const cough = r > 0 ? 1 - 0.35 * r * Math.max( 0, Math.sin( this._t * 7.3 ) * Math.sin( this._t * 2.9 + 1 ) ) : 1;
		return Math.max( 0, blocked * cough );
	}
}
