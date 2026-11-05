// Fenêtre déplaçable au doigt ou à la souris (glisser sa barre de titre), n'importe où sur l'écran. La position est
// gardée dans le navigateur (storageKey) et la fenêtre est toujours ramenée entièrement dans l'écran (rotation,
// redimensionnement). Le déplacement s'ajoute à sa place normale (propriété CSS translate) : la mise en page n'a pas
// à changer. Les boutons, listes et champs de la barre de titre restent cliquables (ils ne déclenchent pas le glisser).
const INTERACTIVE = 'button, input, select, textarea, a, label';

function makeDraggable(node, handle, storageKey) {
    let offset = { x: 0, y: 0 };
    try { offset = { ...offset, ...JSON.parse(localStorage.getItem(storageKey)) }; } catch { /* stockage indisponible */ }
    const apply = () => { node.style.translate = `${offset.x}px ${offset.y}px`; };
    // Ramène la fenêtre dans l'écran (mesure avec le décalage actuel)
    const clamp = () => {
        if (node.hidden || !node.offsetWidth) return;
        const r = node.getBoundingClientRect();
        const dx = Math.min(0, window.innerWidth - r.right) + Math.max(0, -r.left);
        const dy = Math.min(0, window.innerHeight - r.bottom) + Math.max(0, -r.top);
        if (!dx && !dy) return;
        offset.x += dx;
        offset.y += dy;
        apply();
    };
    apply();
    handle.style.touchAction = 'none';
    handle.style.cursor = 'grab';
    let start = null;
    handle.addEventListener('pointerdown', (event) => {
        if (event.target.closest(INTERACTIVE) || event.button > 0) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        start = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    });
    handle.addEventListener('pointermove', (event) => {
        if (!start || !handle.hasPointerCapture(event.pointerId)) return;
        offset = { x: event.clientX - start.x, y: event.clientY - start.y };
        apply();
        clamp();
    });
    const end = () => {
        if (!start) return;
        start = null;
        try { localStorage.setItem(storageKey, JSON.stringify(offset)); } catch { /* stockage indisponible */ }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => requestAnimationFrame(clamp));
    // Fenêtre rouverte : ramenée dans l'écran (l'écran a pu tourner entre-temps)
    new MutationObserver(() => requestAnimationFrame(clamp)).observe(node, { attributes: true, attributeFilter: ['hidden'] });
}

export { makeDraggable };
