// Lecture des tables du modèle de données (fichiers CSV séparés par ';')

async function loadCSV(url) {
    const response = await fetch(encodeURI(url));
    if (!response.ok) {
        throw new Error(`Impossible de charger ${url} (${response.status})`);
    }
    const text = (await response.text()).replace(/^﻿/, '');
    const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.trim() !== '');
    const keys = header.split(';').map((key) => key.trim());

    return lines.map((line) => {
        const values = line.split(';');
        return Object.fromEntries(keys.map((key, i) => [key, (values[i] ?? '').trim()]));
    });
}

export { loadCSV };
