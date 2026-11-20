// Montée progressive des commandes au clavier et au tactile (modèle de vol réaliste, voir RigidBodyModel.js) : une
// touche ne braque pas la gouverne à fond d'un coup. Chaque axe (profondeur, ailerons, direction) va vers la position
// demandée à vitesse limitée : `rise` secondes pour aller de 0 à fond, `fall` secondes pour revenir de fond à 0 (touche
// relâchée, ou sens inversé). Une touche tapée brièvement donne donc un petit braquage, une touche tenue un braquage qui
// augmente, comme une main qui tire de plus en plus fort sur le manche. Rien de physique ici : c'est la main du pilote.
// Les manches USB (lot 2) gardent l'entrée directe.

// Profondeur seulement, dans les deux sens (essayé à cabrer seulement le 20/11/2026 : le joueur naïf, qui dépasse
// l'assiette puis pousse, fait alors piquer le nez à 26°/s et rebondit à l'arrondi), à basse vitesse : montée plus lente (`factor` fois le temps de montée jusqu'à `slow` kt indiqués,
// retour au temps normal à `normal` kt, linéaire entre les deux). À la rotation, plein gaz, le souffle de l'hélice sur la
// profondeur fait cabrer très vite : une touche tenue jusqu'à l'assiette voulue y donnait près de 30°/s ; avec ce
// réglage, 17°/s (tests/keyboard-pilot.test.js, joueur naïf, mesuré le 20/11/2026). Réglage du jeu, pas une donnée.
const LOW_SPEED = { factor: 4, slow: 60, normal: 90 };

const AXES = [ 'pitch', 'roll', 'yaw' ];
const DEFAULTS = {
	rise: { pitch: 2.0, roll: 1.0, yaw: 1.0 },   // s de 0 à fond
	fall: { pitch: 0.4, roll: 0.3, yaw: 0.3 },   // s de fond à 0
};

class InputRamp {

	constructor( { rise = DEFAULTS.rise, fall = DEFAULTS.fall, lowSpeed = LOW_SPEED } = {} ) {
		this.rise = { ...DEFAULTS.rise, ...rise };
		this.fall = { ...DEFAULTS.fall, ...fall };
		this.lowSpeed = lowSpeed ? { ...LOW_SPEED, ...lowSpeed } : null;
		this.value = { pitch: 0, roll: 0, yaw: 0 };
	}

	// Multiplicateur du temps de montée de la profondeur à la vitesse indiquée `kias` (nœuds ; inconnue : 1)
	pitchFactor( kias ) {
		const low = this.lowSpeed;
		if ( ! low || ! Number.isFinite( kias ) ) return 1;
		const t = Math.max( 0, Math.min( 1, ( kias - low.slow ) / Math.max( 1e-6, low.normal - low.slow ) ) );
		return low.factor + ( 1 - low.factor ) * t;
	}

	// Douceur réglable (Paramètres) : multiplie les temps de montée (0,5 : vive ; 1 : normale ; 1,5 : douce)
	setScale( scale ) {
		for ( const axis of AXES ) this.rise[ axis ] = DEFAULTS.rise[ axis ] * scale;
	}

	reset() {
		for ( const axis of AXES ) this.value[ axis ] = 0;
	}

	// target : { pitch, roll, yaw } (-1 -> 1) demandés par les touches ou le tactile ; dt (s) ; kias : vitesse indiquée
	// (nœuds, montée de la profondeur plus lente à basse vitesse). Rend la position atteinte
	update( target, dt, kias ) {
		for ( const axis of AXES ) {
			const current = this.value[ axis ], wanted = Math.max( - 1, Math.min( 1, target[ axis ] ?? 0 ) );
			// Vers 0 ou à travers 0 : retour (main qui relâche) ; en s'éloignant de 0 : montée (main qui tire)
			const releasing = Math.abs( wanted ) < Math.abs( current ) || wanted * current < 0;
			const rise = this.rise[ axis ] * ( axis === 'pitch' ? this.pitchFactor( kias ) : 1 );
			const rate = 1 / Math.max( 1e-3, releasing ? this.fall[ axis ] : rise );
			const step = Math.max( - rate * dt, Math.min( rate * dt, wanted - current ) );
			this.value[ axis ] = current + step;
		}
		return this.value;
	}
}

export { InputRamp };
