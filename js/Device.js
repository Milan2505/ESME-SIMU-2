// Tablette (iPad, tablette Android) : écran tactile comme pointeur principal. iPadOS se présente comme un Mac dans son
// user agent (« Macintosh », site en version ordinateur, réglage par défaut de Safari) : on le reconnaît à son écran
// tactile (aucun Mac n'en a). En version mobile (Chrome, Firefox, réglage de Safari), il dit « iPad ». Un ordinateur
// portable à écran tactile garde la souris ou le pavé comme pointeur principal : ce n'est pas une tablette.
function isTablet() {
    const touchPoints = navigator.maxTouchPoints ?? 0;
    if (touchPoints > 1 && /Macintosh|iPad|Android/.test(navigator.userAgent)) return true;
    return touchPoints > 0 && (matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches);
}

// Site ouvert depuis l'écran d'accueil (appli web) : déjà en plein écran, sans barre du navigateur
function isStandalone() {
    return navigator.standalone === true || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
}

// iPad / iPhone (tous navigateurs : sur iOS, ce sont tous des Safari déguisés) : écran tactile et « Macintosh », « iPad »
// ou « iPhone » dans l'user agent. Le plein écran du navigateur y est inutilisable (voir simulator.js)
function isIOS() {
    return (navigator.maxTouchPoints ?? 0) > 1 && /Macintosh|iPad|iPhone/.test(navigator.userAgent);
}

export { isTablet, isStandalone, isIOS };
