#!/bin/sh
# Numéro de version du simulateur = nombre de commits (celui qu'on prépare compris), écrit dans js/Version.js.
# À lancer juste avant chaque commit (ou depuis un crochet git pre-commit : printf '#!/bin/sh\nsh tools/version.sh\n'
# > .git/hooks/pre-commit). Affiché au menu principal pour vérifier qu'on joue bien la dernière version.
cd "$(git rev-parse --show-toplevel)" || exit 1
count=$(( $(git rev-list --count HEAD 2>/dev/null || echo 0) + 1 ))
printf "// Généré par tools/version.sh avant chaque commit : ne pas modifier à la main\nexport const VERSION = %s;\nexport const VERSION_DATE = '%s';\n" "$count" "$(date +%Y-%m-%d)" > js/Version.js
git add js/Version.js
