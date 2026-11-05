// Tablette (iPad, tablette Android) : écran tactile comme pointeur principal. iPadOS se présente comme un Mac dans son
// user agent (« Macintosh ») : on le reconnaît à son écran tactile (aucun Mac n'en a). Un ordinateur portable à écran
// tactile garde la souris ou le pavé comme pointeur principal : ce n'est pas une tablette.
function isTablet() {
    const touchPoints = navigator.maxTouchPoints ?? 0;
    if (touchPoints > 1 && /Macintosh/.test(navigator.userAgent)) return true;   // iPad (même avec clavier et pavé)
    return touchPoints > 0 && matchMedia('(pointer: coarse)').matches;
}

export { isTablet };
