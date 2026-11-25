// Repères du badin et vitesses limites du Cessna 172P (KIAS), une seule source pour le badin du tableau
// (InstrumentArt.js), le badin du HUD (FlightHud.js), le débriefing (FlightReview.js) et les leçons.
// Sources : POH 172P section 2 (fig. 2-1 « Airspeed limitations », fig. 2-2 « Airspeed indicator markings ») ; supplément
// FAA Air Plains 1987 du 172P : trait rouge 158, arc jaune 127-158. Les 163 KIAS (trait rouge) et l'arc vert jusqu'à
// 129 KIAS utilisés jusqu'au 25/11/2026 sont ceux des 172R/S, pas du 172P.
export const C172P_SPEEDS = Object.freeze({
    vne: 158,                    // trait rouge : vitesse à ne jamais dépasser
    vno: 127,                    // vitesse maximale en air agité (haut de l'arc vert, bas de l'arc jaune)
    va: 99,                      // vitesse de manœuvre à 2 400 lb (POH fig. 2-1 : plus basse aux masses plus faibles)
    vfe10: 110,                  // volets sortis jusqu'à 10°
    vfe: 85,                     // volets sortis au-delà de 10° (haut de l'arc blanc)
    arcs: Object.freeze({
        white: Object.freeze([33, 85]),    // plage d'utilisation des volets
        green: Object.freeze([44, 127]),   // plage d'utilisation normale
        yellow: Object.freeze([127, 158]), // prudence : air calme seulement
    }),
});
