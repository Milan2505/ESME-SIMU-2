// Montée progressive des commandes au clavier et au tactile (modèle de vol réaliste, voir RigidBodyModel.js) : une
// touche ne braque pas la gouverne à fond d'un coup. Chaque axe (profondeur, ailerons, direction) va vers la position
// demandée à vitesse limitée : `rise` secondes pour aller de 0 à fond, `fall` secondes pour revenir de fond à 0 (touche
// relâchée, ou sens inversé). Une touche tapée brièvement donne donc un petit braquage, une touche tenue un braquage qui
// augmente, comme une main qui tire de plus en plus fort sur le manche. Rien de physique ici : c'est la main du pilote.
// Les manches USB (lot 2) gardent l'entrée directe.

const AXES = [ 'pitch', 'roll', 'yaw' ];
const DEFAULTS = {
	rise: { pitch: 2.0, roll: 1.0, yaw: 1.0 },   // s de 0 à fond
	fall: { pitch: 0.4, roll: 0.3, yaw: 0.3 },   // s de fond à 0
};

class InputRamp {

	constructor( { rise = DEFAULTS.rise, fall = DEFAULTS.fall } = {} ) {
		this.rise = { ...DEFAULTS.rise, ...rise };
		this.fall = { ...DEFAULTS.fall, ...fall };
		this.value = { pitch: 0, roll: 0, yaw: 0 };
	}

	// Douceur réglable (Paramètres) : multiplie les temps de montée (0,5 : vive ; 1 : normale ; 1,5 : douce)
	setScale( scale ) {
		for ( const axis of AXES ) this.rise[ axis ] = DEFAULTS.rise[ axis ] * scale;
	}

	reset() {
		for ( const axis of AXES ) this.value[ axis ] = 0;
	}

	// target : { pitch, roll, yaw } (-1 -> 1) demandés par les touches ou le tactile ; dt (s). Rend la position atteinte
	update( target, dt ) {
		for ( const axis of AXES ) {
			const current = this.value[ axis ], wanted = Math.max( - 1, Math.min( 1, target[ axis ] ?? 0 ) );
			// Vers 0 ou à travers 0 : retour (main qui relâche) ; en s'éloignant de 0 : montée (main qui tire)
			const releasing = Math.abs( wanted ) < Math.abs( current ) || wanted * current < 0;
			const rate = 1 / Math.max( 1e-3, releasing ? this.fall[ axis ] : this.rise[ axis ] );
			const step = Math.max( - rate * dt, Math.min( rate * dt, wanted - current ) );
			this.value[ axis ] = current + step;
		}
		return this.value;
	}
}

export { InputRamp };
