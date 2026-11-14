// Tirage pseudo-aléatoire à graine (mulberry32) : même graine, même suite de nombres dans [0, 1).
// Sert au mode test (?test=1) et aux tests Node : les modèles de vol (FlightModel.random, HeliModel) tirent leurs
// rafales et le côté de l'aile qui tombe au décrochage par une fonction remplaçable, Math.random par défaut.
// (Wind.js, Scenery.js et City.js ont chacun leur propre tirage à graine, inchangé.)
function seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export { seededRandom };
