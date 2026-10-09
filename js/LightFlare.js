import { CanvasTexture, SRGBColorSpace } from 'three';

// Texture de feu lumineux "vu à travers une optique" : noyau éclatant, halo doux,
// rayons en étoile (diffraction) et traînée horizontale (reflet d'objectif). En blanc : la couleur
// est donnée par le matériau. Une seule texture partagée par tous les feux.
let texture = null;

function flareTexture() {
    if (texture) return texture;
    const size = 256, c = size / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'lighter';

    // Halo large et doux
    let g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.025)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    // Rayons : 4 longs (croix) et 4 plus courts (diagonales)
    const ray = (angle, length, width, alpha) => {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(angle);
        const r = ctx.createLinearGradient(0, 0, length, 0);
        r.addColorStop(0, `rgba(255,255,255,${alpha})`);
        r.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = r;
        ctx.beginPath();
        ctx.moveTo(0, -width);
        ctx.lineTo(length, 0);
        ctx.lineTo(0, width);
        ctx.fill();
        ctx.restore();
    };
    // (discrets : un vrai feu vu à l'œil nu n'a qu'une légère étoile)
    for (let i = 0; i < 4; i++) ray((i * Math.PI) / 2, c * 0.55, 1.2, 0.16);
    for (let i = 0; i < 4; i++) ray(Math.PI / 4 + (i * Math.PI) / 2, c * 0.25, 0.8, 0.06);

    // Traînée horizontale (reflet d'objectif)
    g = ctx.createLinearGradient(0, 0, size, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(size * 0.2, c - 1, size * 0.6, 2);

    // Noyau éclatant
    g = ctx.createRadialGradient(c, c, 0, c, c, size * 0.07);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

export { flareTexture };
