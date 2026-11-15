import { RHO0 } from './Atmosphere.js';

// Moteur à pistons et hélice à pas fixe (Cessna 172P : Lycoming O-320-D2J de 160 ch à 2 700 tr/min, hélice McCauley
// 1C160/DTM7557 de 75 in, POH 172P sect. 1 p. 1-3). Le régime n'est pas imposé : il résulte de l'équilibre entre le couple
// du moteur et le couple absorbé par l'hélice (inertie de l'ensemble), comme sur le vrai avion : ~2 350 tr/min plein gaz à
// l'arrêt, ~2 450 en montée, 2 700 (ligne rouge) en palier plein gaz au niveau de la mer, ~1 000 en plané moteur réduit.
// - Moteur : puissance à pleine admission P_WOT(régime) = P_nominale × r × (1 + pente × (1 − r)) (r = régime / régime
//   nominal : couple presque plat, courbe Lycoming) ; admission selon la manette (ralenti idleAdmission, courbe en
//   manette^throttleCurve, retard throttleLag s) ; altitude : loi de Gagg et Ferrar σ − (1 − σ) / 7,55 ; mixture : richesse
//   du mélange = levier (richness à plein riche) / √σ (carburateur à flotteur : plus riche en altitude), puissance maxi à la
//   richesse 1 (meilleure puissance), un peu moins plein riche, effondrement appauvri à l'excès ; frottements
//   friction[0] + friction[1] × r (N·m) ; health (0 -> 1, Systems.js : moteur arrêté, une magnéto, alimentation) multiplie
//   la puissance indiquée. Moteur arrêté : les frottements freinent l'hélice, qui tourne en moulinet dans le vent relatif.
// - Hélice : coefficients de traction Ct(J) et de puissance Cp(J) polynomiaux (J = V / (n D), paramètre d'avancement) ;
//   traction = Ct ρ n² D⁴, couple = Cp ρ n² D⁵ / 2π. Négatifs au-delà du J de traction nulle : l'hélice freine (moulinet).
// Unités SI (W, N, N·m, rad/s, m, kg/m³) ; le régime est en tr/min pour les instruments.

const HP = 745.7;   // W par cheval (hp)
const J_MAX = 2;    // paramètre d'avancement au-delà duquel l'hélice est traitée comme une pale en moulinet (voir _rotation)

class PistonPropeller {

	// aircraft.engine et aircraft.propeller : voir Cessna172.js
	constructor( aircraft ) {
		this.engine = aircraft.engine;
		this.propeller = aircraft.propeller;
		this.rpm = this.engine.idleRpm;
		this.thrust = 0;          // N
		this.torque = 0;          // N·m fourni par le moteur (négatif : frottements seuls)
		this.power = 0;           // W au frein
		this.advance = 0;         // J
		this._admission = this.engine.idleAdmission;   // admission réelle, qui suit la manette avec retard
		// Références au niveau de la mer, plein gaz, à l'arrêt : régime statique et poussée statique (effets moteur)
		const rpm = this._equilibriumRpm( 1, 1, RHO0, 0 );
		this.staticRpm = rpm;
		this.staticThrust = this._thrust( rpm, 0, RHO0 );
	}

	// Moteur remis au ralenti (départ) ou arrêté (hélice immobile)
	reset( running = true ) {
		this.rpm = running ? this.engine.idleRpm : 0;
		this._admission = this.engine.idleAdmission;
		this.thrust = this.torque = this.power = this.advance = 0;
	}

	// Facteur de puissance de la mixture : levier 0 -> 1 (1 = plein riche), sigma = ρ / ρ0
	static mixtureFactor( lever, sigma, engine ) {
		const rich = engine.richness * Math.min( 1, Math.max( 0, lever ) / engine.richnessLever ) ** 0.5;   // richesse au niveau de la mer
		const phi = rich / Math.sqrt( Math.max( 0.05, sigma ) );   // richesse réelle (carburateur : plus riche en air raréfié)
		if ( phi >= 1 ) return Math.max( 0, 1 - 0.2 * ( phi - 1 ) );   // trop riche : -2 % plein riche au niveau de la mer, -4 % à 8 000 ft
		return Math.max( 0, 1 - 1.2 * ( 1 - phi ) ** 2 - 4 * Math.max( 0, 0.75 - phi ) ** 2 );
	}

	// Position du levier qui donne la meilleure puissance à une densité (le pilote appauvrit « au régime maxi »)
	static bestMixture( sigma, engine ) {
		return Math.min( 1, engine.richnessLever * ( Math.sqrt( sigma ) / engine.richness ) ** 2 );
	}

	// Couple des frottements (N·m) à un régime
	_friction( rpm ) {
		return this.engine.friction[ 0 ] + this.engine.friction[ 1 ] * rpm / this.engine.ratedRpm;
	}

	// Couple au frein du moteur (N·m) : admission (0 -> 1), facteur de densité et de mixture, santé
	_engineTorque( rpm, admission, sigma, mixtureFactor, health ) {
		const E = this.engine, r = rpm / E.ratedRpm;
		const ratedTorque = E.ratedPower / ( 2 * Math.PI * E.ratedRpm / 60 );
		const friction = this._friction( rpm );
		const altitude = Math.max( 0, sigma - ( 1 - sigma ) / 7.55 );   // Gagg et Ferrar
		const indicated = ( ratedTorque * ( 1 + E.torqueSlope * ( 1 - r ) ) + friction ) * admission * altitude * mixtureFactor * health;
		return indicated - friction;
	}

	// Coefficients de l'hélice à un paramètre d'avancement
	_ct( j ) { const c = this.propeller.ct; return c[ 0 ] + c[ 1 ] * j + c[ 2 ] * j * j; }
	_cp( j ) { const c = this.propeller.cp; return c[ 0 ] + c[ 1 ] * j + c[ 2 ] * j * j; }

	// Hélice lente ou arrêtée dans le vent relatif (moulinet) : au-delà de J_MAX, les coefficients sont figés et le terme en
	// n² est pris à la vitesse de rotation qui donnerait J_MAX (sinon rien ne tourne : traction et couple seraient nuls à n = 0)
	_rotation( rpm, speed ) {
		const n = rpm / 60, D = this.propeller.diameter;
		const floor = Math.max( 0, speed ) / ( J_MAX * D );
		const nEff = Math.max( n, floor );
		return { nEff, j: nEff > 0 ? Math.max( 0, speed ) / ( nEff * D ) : 0 };
	}
	_advance( rpm, speed ) {
		return this._rotation( rpm, speed ).j;
	}
	_thrust( rpm, speed, density ) {
		const { nEff, j } = this._rotation( rpm, speed );
		return this._ct( j ) * density * nEff * nEff * this.propeller.diameter ** 4;
	}
	_propellerTorque( rpm, speed, density ) {
		const { nEff, j } = this._rotation( rpm, speed );
		return this._cp( j ) * density * nEff * nEff * this.propeller.diameter ** 5 / ( 2 * Math.PI );
	}

	// Régime d'équilibre (tr/min) à admission, mixture et santé données, vitesse air et densité fixées (dichotomie)
	_equilibriumRpm( admission, mixtureFactor, density, speed, health = 1 ) {
		let low = 100, high = 4000;
		for ( let i = 0; i < 40; i ++ ) {
			const mid = ( low + high ) / 2;
			const excess = this._engineTorque( mid, admission, density / RHO0, mixtureFactor, health ) - this._propellerTorque( mid, speed, density );
			if ( excess > 0 ) low = mid; else high = mid;
		}
		return ( low + high ) / 2;
	}

	// Un pas de temps : manette (0 -> 1), levier de mixture (0 -> 1), santé (0 -> 1), vitesse de l'air le long de l'axe de
	// l'hélice (m/s), masse volumique (kg/m³). Met à jour régime, poussée, couple et puissance
	update( dt, { throttle, mixture = 1, health = 1, axialSpeed = 0, density = RHO0 } ) {
		const E = this.engine;
		const target = E.idleAdmission + ( 1 - E.idleAdmission ) * Math.min( 1, Math.max( 0, throttle ) ) ** E.throttleCurve;
		this._admission += ( target - this._admission ) * Math.min( 1, dt / E.throttleLag );
		const sigma = density / RHO0;
		this.torque = this._engineTorque( this.rpm, this._admission, sigma, PistonPropeller.mixtureFactor( mixture, sigma, E ), health );
		const load = this._propellerTorque( this.rpm, axialSpeed, density );
		const omega = Math.max( 0, this.rpm * 2 * Math.PI / 60 + ( this.torque - load ) / E.inertia * dt );
		this.rpm = omega * 60 / ( 2 * Math.PI );
		// Hélice presque immobile, moteur arrêté, pas de vent relatif qui la lance : elle s'arrête (les frottements ne la
		// font pas tourner à l'envers)
		if ( this.rpm < 30 && this.torque <= 0 && load >= - 1e-6 ) this.rpm = 0;
		this.advance = this._advance( this.rpm, axialSpeed );
		this.thrust = this._thrust( this.rpm, axialSpeed, density );
		this.power = this.torque * omega;
		return this.thrust;
	}
}

export { PistonPropeller, HP };
