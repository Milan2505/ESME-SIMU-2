// Un seul contexte audio pour tout le simulateur (moteur, alarmes, bruitages, radio, voix), débloqué à chaque geste.
// Sur tablette (iPad), le son du moteur manquait une fois sur deux :
// - chaque module créait son propre AudioContext (6 au total) ; iOS en limite le nombre, le dernier créé pouvait rester
//   muet ;
// - ils étaient créés au premier « pointerdown » ; pour iOS, seul un toucher relâché (touchend) ou un clic autorise le
//   son : un contexte créé avant reste suspendu, et rien ne le relançait ensuite ;
// - iOS suspend aussi le son (état « interrupted ») quand on change d'appli, qu'on verrouille l'écran ou qu'un appel
//   arrive : il n'était jamais repris.
// Ici, chaque geste (toucher relâché, clic, touche) et chaque retour sur la page relance le contexte s'il ne tourne pas,
// et joue un son vide d'un échantillon (nécessaire sur iOS pour vraiment ouvrir la sortie audio).
// Mode silencieux de l'iPad / de l'iPhone : par défaut, iOS classe le son Web Audio d'une page comme « ambiant », coupé
// par le mode silencieux (alors qu'une vidéo, elle, joue) : alarmes et moteur muets. Safari 17+ (iPadOS 17) permet de
// le déclarer comme « lecture » (navigator.audioSession), comme une vidéo : il joue alors même en mode silencieux.
// Plus ancien : pas de moyen fiable, le mode silencieux coupe le son. Le volume de l'appareil reste, lui, toujours respecté
let context = null;

function sharedAudioContext() {
    if (!context) {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* non pris en charge */ }
        // (iPadOS < 14.5 : seulement le nom préfixé webkitAudioContext)
        context = new (window.AudioContext ?? window.webkitAudioContext)();
    }
    return context;
}

function resumeAudio() {
    if (!context || context.state === 'running' || context.state === 'closed') return;
    context.resume().catch(() => { /* pas encore autorisé : réessayé au geste suivant */ });
    try {
        const silence = context.createBufferSource();
        silence.buffer = context.createBuffer(1, 1, context.sampleRate);
        silence.connect(context.destination);
        silence.start();
    } catch { /* contexte indisponible */ }
}

for (const type of ['touchend', 'click', 'keydown', 'pointerup']) window.addEventListener(type, resumeAudio, true);
document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeAudio(); });
window.addEventListener('pageshow', resumeAudio);
window.addEventListener('focus', resumeAudio);

export { sharedAudioContext, resumeAudio };
