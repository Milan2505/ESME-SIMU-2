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
import { track } from './Loading.js';

let context = null;

function sharedAudioContext() {
    if (!context) {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* non pris en charge */ }
        // (iPadOS < 14.5 : seulement le nom préfixé webkitAudioContext)
        context = new (window.AudioContext ?? window.webkitAudioContext)();
    }
    return context;
}

// Sortie commune de tous les sons, par un limiteur : chaque module (réacteurs, alarmes, radio, armes...) avait sa sortie
// à lui, chacune presque au maximum ; leur somme dépassait le maximum dès que plusieurs jouaient ensemble (alarmes
// sur la postcombustion du F-15) : son saturé. Sous ~-1,3 dB, rien ne change (le limiteur relève ce qu'il baisse
// d'un gain fixe, « makeup » de la norme Web Audio : (1 / gain à 0 dB)^0,6 = +1,7 dB ici, compensé avant lui) ; au-dessus,
// le niveau est plafonné sous 0 dB au lieu d'écrêter
let output = null;
function audioOutput() {
    if (!output) {
        const ctx = sharedAudioContext();
        const limiter = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.2 });
        output = new GainNode(ctx, { gain: 0.821 });
        output.connect(limiter).connect(ctx.destination);
    }
    return output;
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

// Sons : chaque WAV a sa copie FLAC à côté (même son à l'échantillon près, compression sans perte : 10 Mo au lieu de
// 18 ; les boucles du moteur restent sans raccord audible, contrairement au MP3 ou à l'AAC qui ajoutent un silence).
// Navigateur qui ne lit pas le FLAC (ou décodage raté) : le WAV. Chargés dès l'ouverture de la page, sans attendre de
// geste : un contexte audio encore suspendu sait déjà décoder ; il démarre au premier toucher (menu).
// Chaque son est suivi par l'écran de chargement
const flacSupported = (() => {
    try { return new Audio().canPlayType('audio/flac') !== ''; } catch { return false; }
})();

async function decode(audio, url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} : ${response.status}`);
    return audio.decodeAudioData(await response.arrayBuffer());
}

function loadSound(audio, url) {
    const name = url.split('/').pop();
    return track('sons', name, async () => {
        const flac = url.replace(/\.wav$/, '.flac');
        if (flacSupported && flac !== url) {
            try { return await decode(audio, flac); } catch { /* repli sur le WAV */ }
        }
        return decode(audio, url);
    });
}

export { sharedAudioContext, audioOutput, resumeAudio, loadSound };
