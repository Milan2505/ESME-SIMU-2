// Safari (iPad, iPhone) plafonne la mémoire de tous les canvas d'une page réunis (quelques centaines de Mo selon
// l'appareil). Au-delà, getContext('2d') renvoie null et le canvas WebGL peut ne plus s'afficher : sur iPad, le
// panorama de l'accueil restait vide. Les grandes textures dessinées une seule fois (cadrans, sol des aérodromes,
// livrées : plus de 150 Mo de canvas) ne servent plus une fois envoyées à la carte graphique : leur canvas est
// alors réduit à 1 x 1 pixel, ce qui rend sa mémoire. La texture reste intacte dans la carte graphique.
// À ne pas utiliser pour une texture redessinée ensuite (needsUpdate) : elle serait renvoyée vide.
function releaseAfterUpload(texture) {
    const previous = texture.onUpdate;
    texture.onUpdate = (t) => {
        previous?.(t);
        const canvas = texture.image;
        if (!canvas || texture.userData.canvasReleased) return;
        if (!(canvas instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas))) return;
        texture.userData.canvasReleased = true;
        canvas.width = canvas.height = 1;
    };
    return texture;
}

export { releaseAfterUpload };
