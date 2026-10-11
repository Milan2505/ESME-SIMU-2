# Serveur local de développement (F5 « Simulateur », ou tâche "Serveur local").
# - Sert le dossier du projet, quel que soit le dossier d'où il est lancé
# - Ouvre le simulateur dans le navigateur (OPEN_BROWSER=0 pour ne pas l'ouvrir)
# - Si ce même serveur tourne déjà, ouvre simplement la page au lieu d'échouer
# - Désactive le cache du navigateur : chaque rechargement prend la dernière version des fichiers
# - Refuse de démarrer si le port est déjà pris (sinon, sous Windows, un ancien serveur
#   lancé depuis un autre dossier peut continuer à répondre à sa place)
import functools
import http.server
import os
import socket
import sys
import threading
import urllib.request
import webbrowser

PORT = 8080
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = f'http://localhost:{PORT}'
OPEN_BROWSER = os.environ.get('OPEN_BROWSER', '1') != '0'


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class DualStackServer(http.server.ThreadingHTTPServer):
    # Écoute en IPv6 et IPv4 à la fois ("localhost" peut désigner l'un ou l'autre)
    address_family = socket.AF_INET6
    allow_reuse_address = False

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):  # Windows : personne d'autre sur ce port
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def port_in_use(port):
    for host in ('127.0.0.1', '::1'):
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            pass
    return False


def serves_this_project():
    # Le serveur déjà lancé renvoie-t-il notre index.html ?
    try:
        with urllib.request.urlopen(URL + '/index.html', timeout=2) as response:
            remote = response.read()
        with open(os.path.join(ROOT, 'index.html'), 'rb') as f:
            return remote == f.read()
    except OSError:
        return False


if port_in_use(PORT) and serves_this_project():
    print(f'Le serveur tourne déjà : ouverture de {URL}')
    if OPEN_BROWSER:
        webbrowser.open(URL)
    sys.exit(0)

try:
    if port_in_use(PORT):
        raise OSError
    server = DualStackServer(('::', PORT), functools.partial(NoCacheHandler, directory=ROOT))
except OSError:
    print(f'Le port {PORT} est déjà utilisé par un autre serveur (peut-être un autre projet).')
    print('Fermez-le (terminal où il tourne, ou Gestionnaire des tâches > python.exe) puis relancez.')
    sys.exit(1)

print(f'Serving HTTP on port {PORT} : {ROOT}', flush=True)
print(f'Simulateur : {URL}   (Shift+F5 ou Ctrl+C pour arrêter)', flush=True)
if OPEN_BROWSER:
    threading.Timer(0.5, webbrowser.open, (URL,)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
