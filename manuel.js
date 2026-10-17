// Manuel : sommaire construit à partir des titres de partie (h2), lien actif selon la partie lue
const main = document.querySelector('main');
const titles = [...main.querySelectorAll('h2')];
const nav = document.createElement('nav');
nav.className = 'manuel-sommaire';
nav.setAttribute('aria-label', 'Sommaire');
const heading = document.createElement('strong');
heading.textContent = 'Sommaire';
nav.append(heading);
const links = titles.map((title, i) => {
    title.id ||= `partie-${i + 1}`;
    const link = document.createElement('a');
    link.href = `#${title.id}`;
    link.textContent = title.textContent.replace(/\s*:\s*$/, '');
    nav.append(link);
    return link;
});
main.prepend(nav);

function updateActive() {
    let current = 0;
    titles.forEach((title, i) => { if (title.getBoundingClientRect().top < 140) current = i; });
    links.forEach((link, i) => link.classList.toggle('actif', i === current));
}
window.addEventListener('scroll', updateActive, { passive: true });
updateActive();
