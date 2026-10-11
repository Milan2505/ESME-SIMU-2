// Livrées de l'avion : couleur des bandes du Cessna (bleu marine d'origine repeint sur les textures), le fuselage
// reste blanc.
// La livrée choisie est envoyée aux autres joueurs : chacun voit les vraies couleurs des autres avions.

import { setLiveryColor } from './C172Model.js';

const LIVERIES = {
    origine: { label: 'Origine (bleu marine)', stripe: null, color: '#25348a' },
    bleu:    { label: 'Bleu',            stripe: 0x1f5fbf, color: '#2e78d6' },
    vert:    { label: 'Vert',            stripe: 0x1e8449, color: '#27a35a' },
    jaune:   { label: 'Jaune',           stripe: 0xf1c40f, color: '#f1c40f' },
    orange:  { label: 'Orange',          stripe: 0xe67e22, color: '#e67e22' },
    violet:  { label: 'Violet',          stripe: 0x7d3c98, color: '#a052c4' },
    noir:    { label: 'Noir',            stripe: 0x222222, color: '#9aa0a6' },
};
const DEFAULT_LIVERY = 'origine';

function isLivery(id) {
    return Object.hasOwn(LIVERIES, id);
}

// Peint un modèle de Cessna (copie du modèle ou avion du joueur) ; peut être rappelée pour changer de livrée
function paintAircraft(model, id) {
    setLiveryColor(model, LIVERIES[isLivery(id) ? id : DEFAULT_LIVERY].stripe);
}

export { LIVERIES, DEFAULT_LIVERY, isLivery, paintAircraft };
