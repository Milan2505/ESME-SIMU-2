// Atmosphère type OACI (ISA) et vitesses air, pour tous les appareils (FlightModel.js, HeliModel.js) :
// - isa(altitude, deltaT) : température, pression, masse volumique et vitesse du son à une altitude (m), avec l'écart de
//   température de la météo (K) par rapport à l'atmosphère type. La pression reste celle de l'atmosphère type à cette
//   altitude (l'altitude du jeu vaut altitude-pression : l'altimètre lit juste à 1013 hPa) ; la température change la
//   masse volumique, donc la portance, la traînée et la puissance du moteur (altitude-densité) ;
// - vitesses : TAS (vitesse vraie, celle du modèle), CAS (vitesse corrigée : ce que mesurerait un tube de Pitot parfait,
//   formule compressible, donc juste aussi pour le F-15), IAS (vitesse indiquée : CAS plus l'erreur de position de la prise
//   statique de l'avion, table du manuel de vol par cran de volets). Unités SI ; les tables du manuel sont en nœuds.

const T0 = 288.15;            // K au niveau de la mer
const P0 = 101325;            // Pa
const RHO0 = 1.225;           // kg/m³
const A0 = 340.294;           // m/s : vitesse du son au niveau de la mer
const LAPSE = 0.0065;         // K/m : gradient de la troposphère
const R = 287.05287;          // J/(kg·K)
const G0 = 9.80665;           // m/s²
const GAMMA = 1.4;
const TROPOPAUSE = 11000;     // m
const T11 = T0 - LAPSE * TROPOPAUSE;                     // 216,65 K
const P11 = P0 * ( T11 / T0 ) ** ( G0 / ( LAPSE * R ) );  // 22 632 Pa
const KT = 0.514444;          // m/s par nœud

// État de l'atmosphère à une altitude (m, bornée de -1 000 à 20 000 m) ; deltaT : écart à l'ISA (K), 0 par défaut
function isa( altitude, deltaT = 0 ) {
	const h = Math.min( 20000, Math.max( - 1000, altitude || 0 ) );
	let standard, pressure;
	if ( h <= TROPOPAUSE ) {
		standard = T0 - LAPSE * h;
		pressure = P0 * ( standard / T0 ) ** ( G0 / ( LAPSE * R ) );
	} else {
		standard = T11;
		pressure = P11 * Math.exp( - G0 * ( h - TROPOPAUSE ) / ( R * T11 ) );
	}
	const temperature = Math.max( 150, standard + deltaT );
	const density = pressure / ( R * temperature );
	return { altitude: h, temperature, pressure, density, sigma: density / RHO0, speedOfSound: Math.sqrt( GAMMA * R * temperature ) };
}

// Température ISA (K) à une altitude : sert à convertir une température de METAR (°C au sol) en écart à l'ISA
function isaTemperature( altitude ) {
	return isa( altitude ).temperature;
}

// Nombre de Mach d'une vitesse vraie (m/s)
function mach( tas, altitude, deltaT = 0 ) {
	return tas / isa( altitude, deltaT ).speedOfSound;
}

// Vitesse vraie (m/s) -> vitesse corrigée (m/s) : pression d'impact du tube de Pitot (écoulement compressible,
// subsonique), lue sur l'échelle étalonnée au niveau de la mer. À basse vitesse, vaut TAS × √σ à mieux que 0,5 %
function tasToCas( tas, altitude, deltaT = 0 ) {
	const air = isa( altitude, deltaT );
	const m = Math.min( 1, tas / air.speedOfSound );
	const impact = air.pressure * ( ( 1 + 0.2 * m * m ) ** 3.5 - 1 );
	return A0 * Math.sqrt( 5 * ( ( impact / P0 + 1 ) ** ( 2 / 7 ) - 1 ) );
}

// Vitesse corrigée (m/s) -> vitesse vraie (m/s), inverse de tasToCas
function casToTas( cas, altitude, deltaT = 0 ) {
	const air = isa( altitude, deltaT );
	const impact = P0 * ( ( 1 + 0.2 * ( cas / A0 ) ** 2 ) ** 3.5 - 1 );
	const m = Math.sqrt( 5 * ( ( impact / air.pressure + 1 ) ** ( 2 / 7 ) - 1 ) );
	return m * air.speedOfSound;
}

// Table d'étalonnage la plus proche d'une position des volets (0 -> 1)
function nearestTable( calibration, flaps ) {
	let table = calibration[ 0 ];
	for ( const candidate of calibration ) if ( Math.abs( candidate.flaps - flaps ) < Math.abs( table.flaps - flaps ) ) table = candidate;
	return table;
}

// Erreur de position : CAS (m/s) -> IAS (m/s) d'après la table d'étalonnage du manuel de vol, [ { flaps, kcas: [...],
// kias: [...] }, ... ] (flaps : position des volets 0 -> 1 de la table ; on prend la table la plus proche). Interpolation
// linéaire, prolongée en ligne droite au-delà des points ; sans table, IAS = CAS
function iasFromCas( cas, calibration, flaps = 0 ) {
	if ( ! calibration || calibration.length === 0 ) return cas;
	const table = nearestTable( calibration, flaps );
	return Math.max( 0, interpolate( table.kcas, table.kias, cas / KT ) * KT );
}

// IAS (m/s) -> CAS (m/s), inverse de iasFromCas (table lue dans l'autre sens)
function casFromIas( ias, calibration, flaps = 0 ) {
	if ( ! calibration || calibration.length === 0 ) return ias;
	const table = nearestTable( calibration, flaps );
	return Math.max( 0, interpolate( table.kias, table.kcas, ias / KT ) * KT );
}

// y(x) par morceaux sur des abscisses croissantes, prolongé par les segments extrêmes
function interpolate( xs, ys, x ) {
	const n = xs.length;
	if ( n === 1 ) return ys[ 0 ] + ( x - xs[ 0 ] );
	let i = 1;
	while ( i < n - 1 && x > xs[ i ] ) i ++;
	const t = ( x - xs[ i - 1 ] ) / ( xs[ i ] - xs[ i - 1 ] );
	return ys[ i - 1 ] + ( ys[ i ] - ys[ i - 1 ] ) * t;
}

export { isa, isaTemperature, mach, tasToCas, casToTas, iasFromCas, casFromIas, T0, P0, RHO0, A0 };
