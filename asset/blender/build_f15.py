# F-15C du projet FlightGear (Richard Harrison, modèle extérieur d'Enrique Laso « flying_toaster », cockpit photo de
# geneb ; licence GPL-2.0, https://github.com/Zaretto/fg-aircraft) converti en GLB pour le jeu (Blender 4.2) :
#   blender --background --python asset/blender/build_f15.py -- <dossier aircraft/F-15 du dépôt fg-aircraft>
# Exporte :
#   asset/f15/f15.glb          extérieur (gouvernes, train, trappes, verrière, tuyères : pièces séparées, nommées)
#   asset/f15/f15-cockpit.glb  cockpit (tableau, instruments avec leurs aiguilles, siège, manche, palonniers)
#   asset/f15/liveries/*.jpg   livrées (textures du fuselage, interchangeables)
# Repère de sortie (glTF, comme l'avion du jeu) : x vers la droite, y vers le haut, z vers l'arrière (nez vers -z),
# en mètres, origine celle du modèle FlightGear. Le modèle FlightGear (Blender après import AC : x vers l'arrière,
# y vers la droite, z vers le haut) est tourné de -90° autour de z avant l'export (glTF : y en haut).
import math
import os
import shutil
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ac_import import load_ac   # noqa: E402

SRC = sys.argv[sys.argv.index('--') + 1]
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'asset', 'f15')

# Pièces retirées de l'extérieur : armement, réservoirs et pylônes, réservoirs conformes (CFT), échelle, verrière du
# biplace (F-15D), enveloppe de collision de FlightGear
DROP_EXTERIOR = {'CFT-left', 'CFT-right', 'CFT-left-pylons', 'CFT-right-pylons', 'radio-call', 'aim-9', 'aim-120',
                 'mk-84', 'rails', 'aim-7', 'tanks', 'f15d-canopy', 'aircraft-ladder', 'convexhull', 'Holes'}
DROP_COCKPIT = {'convexhull', 'mm_f15-interior-back', 'avionics-bay'}   # (poste arrière du biplace)

# Livrées gardées : fichier FlightGear -> nom affiché
LIVERIES = {
    'livery.AF80-0007.jpg': 'af80-0007',
    'livery.AF78-538 Aggressor Desert.jpg': 'aggressor',
    'livery.Regal Eagle 71291.jpg': 'regal-eagle',
    'livery.nasa.jpg': 'nasa',
    'livery.AF90-250.jpg': 'tiger',
    'livery.IAF 235-69 SQ HAMMERS.jpg': 'iaf',
}


def filtered_ac(path, drop, out):
    """Copie du fichier AC sans les objets (et leurs enfants) nommés dans drop."""
    lines = open(path, encoding='latin-1').read().splitlines()
    keep = []

    def walk(i, parent_keep):
        start = i
        name = None
        i += 1
        while True:
            t = lines[i].split()
            if t and t[0] == 'name':
                name = lines[i].split('"')[1]
            if t and t[0] == 'kids':
                kids = int(t[1])
                header = lines[start:i + 1]
                me = parent_keep and name not in drop
                i += 1
                children = []
                for _ in range(kids):
                    while not lines[i].startswith('OBJECT'):
                        i += 1
                    i, block, kept = walk(i, me)
                    if kept:
                        children.append(block)
                if not me:
                    return i, [], False
                header[-1] = f'kids {len(children)}'
                return i, header + [l for c in children for l in c], True
            i += 1

    i = 0
    while not lines[i].startswith('OBJECT'):
        keep.append(lines[i])
        i += 1
    _, block, _ = walk(i, True)
    open(out, 'w', encoding='latin-1').write('\n'.join(keep + block) + '\n')
    return out


def smooth(objs, degrees=40):
    """Ombrage lissé sous l'angle donné (le modèle AC est importé en facettes)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(degrees), keep_sharp_edges=True)


def to_game_frame(objs):
    """FlightGear (x arrière, y droite, z haut) -> repère glTF du jeu après export (x droite, y haut, z arrière)."""
    turn = Matrix.Rotation(math.radians(-90), 4, 'Z')
    for o in objs:
        o.data.transform(turn)
        o.data.update()


def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='AUTO', export_jpeg_quality=88,
                              export_extras=False, export_materials='EXPORT')
    print('EXPORT', path, os.path.getsize(path) // 1024, 'KB')


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


os.makedirs(os.path.join(OUT, 'liveries'), exist_ok=True)
tmp = os.path.join(OUT, '_tmp')
os.makedirs(tmp, exist_ok=True)
models = os.path.join(SRC, 'Models')

# --- Extérieur (+ tuyères à pétales) ---
clear()
ext = load_ac(filtered_ac(os.path.join(models, 'f15c.ac'), DROP_EXTERIOR, os.path.join(models, '_f15c-ext.ac')))
for side in ('L', 'R'):
    ext += load_ac(os.path.join(models, f'nozzle{side}.ac'))
ext = [o for o in ext if len(o.data.polygons)]
smooth(ext)
to_game_frame(ext)
print('EXTERIEUR', len(ext), 'objets', sum(len(o.data.polygons) for o in ext), 'faces')
export(os.path.join(OUT, 'f15.glb'), ext)

# --- Cockpit ---
clear()
cockpit_dir = os.path.join(models, 'Cockpit')
cp = load_ac(filtered_ac(os.path.join(cockpit_dir, 'all-interior.ac'), DROP_COCKPIT, os.path.join(cockpit_dir, '_cockpit.ac')))
cp = [o for o in cp if len(o.data.polygons)]
smooth(cp, 35)
to_game_frame(cp)
print('COCKPIT', len(cp), 'objets', sum(len(o.data.polygons) for o in cp), 'faces')
export(os.path.join(OUT, 'f15-cockpit.glb'), cp)

# --- Livrées ---
for source, name in LIVERIES.items():
    shutil.copyfile(os.path.join(models, 'Liveries', source), os.path.join(OUT, 'liveries', name + '.jpg'))
shutil.rmtree(tmp, ignore_errors=True)
for f in ('_f15c-ext.ac', os.path.join('Cockpit', '_cockpit.ac')):
    try:
        os.remove(os.path.join(models, f))
    except OSError:
        pass
print('OK')
