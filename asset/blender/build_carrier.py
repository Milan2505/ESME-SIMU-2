# Porte-avions USS Harry S. Truman (CVN-75, classe Nimitz) du projet FlightGear (fgdata, Models/Geometry/Nimitz ;
# modèle de « karla », complété par Vivian Meazza, Alexis Bory, Michael Habarta et Thorsten Renk ; licence GPL-2.0)
# converti pour le jeu (Blender 4.2) :
#   blender --background --python asset/blender/build_carrier.py -- <dossier contenant truman.ac et ses textures>
# Exporte asset/carrier/truman.glb (taille réelle : pont de 333 m, 20 m au-dessus de l'eau).
#
# - Les quatre ascenseurs d'avions sont remontés au niveau du pont (dans le modèle, deux sont en bas, au hangar) ;
# - équipage, sillage et lignes de construction (câbles en traits : sans faces) ne sont pas repris ;
# - repère du jeu (glTF) : x vers tribord, y vers le haut, z vers l'arrière, origine au milieu du pont (CENTER m
#   derrière l'origine du modèle FlightGear), à la hauteur de la flottaison. Repère AC : x vers l'arrière, y en haut,
#   z vers bâbord. Voir js/Carrier.js (positions des catapultes, des brins, de l'îlot, relevées dans ce modèle).
import math
import os
import re
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ac_import import load_ac   # noqa: E402

SRC = sys.argv[sys.argv.index('--') + 1]
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'asset', 'carrier')
CENTER = 52.5        # m : milieu du pont (de l'étrave, x = -112, à la poupe, x = 217), repère AC
ELEVATOR_LIFT = 11.92
SKIP = re.compile(r'^(Wake|crew_.*|line.*|wire-.*|Hangar-Deckhead.*-lights)$')

# Ascenseurs en haut : la translation des groupes Elevator-1..4 (animation FlightGear, 11,92 m) appliquée au fichier
text = open(os.path.join(SRC, 'truman.ac'), encoding='latin-1').read()
for n in range(1, 5):
    m = re.search(r'name "Elevator-%d"\nloc (\S+) (\S+) (\S+)\n' % n, text)
    assert m, n
    x, y, z = (float(v) for v in m.groups())
    text = text[:m.start()] + f'name "Elevator-{n}"\nloc {x} {y + ELEVATOR_LIFT} {z}\n' + text[m.end():]
patched = os.path.join(SRC, 'truman-game.ac')
open(patched, 'w', encoding='latin-1').write(text)

bpy.ops.wm.read_factory_settings(use_empty=True)
objs = load_ac(patched)
keep = []
for o in objs:
    if SKIP.match(o.name.split('.')[0]):
        bpy.data.objects.remove(o)
    else:
        keep.append(o)

# Antennes fouet du bord du pont rabattues vers l'extérieur, comme pendant les opérations aériennes (animation
# « whip-antennas » de truman.xml, position 1). Debout, elles gênaient les ailes au catapultage et au roulage.
# Repère Blender après lecture AC = repère FlightGear du XML (x arrière, y tribord, z haut) ; rotation de facteur°
# autour de l'axe donné (sens direct)
ANTENNAS = {
    1: ((0, 16.063, 18.515), (1, 0, 0), -100), 2: ((0, 19.752, 18.515), (1, 0, 0), -100),
    3: ((-18.083, 35.109, 18.515), (2.231, 1.533, 0), -100), 4: ((-18.083, 35.109, 18.515), (2.231, 1.533, 0), -100),
    5: ((0, 38.090, 18.515), (1, 0, 0), -100), 6: ((0, 38.960, 18.515), (1, 0, 0), -100),
    7: ((0, 38.488, 18.515), (1, 0, 0), -100), 8: ((0, -38.200, 18.515), (1, 0, 0), 100),
    9: ((0, -38.190, 18.515), (1, 0, 0), 100), 10: ((0, -37.430, 18.515), (1, 0, 0), 100),
    11: ((0, -16.304, 18.515), (1, 0, 0), 100),
}
folded = 0
for o in keep:
    m = re.match(r'^antenna-(\d+)$', o.name.split('.')[0])
    if not m or int(m.group(1)) not in ANTENNAS:
        continue
    center, axis, angle = ANTENNAS[int(m.group(1))]
    turn = Matrix.Translation(center) @ Matrix.Rotation(math.radians(angle), 4, Vector(axis).normalized()) @ Matrix.Translation(Vector(center) * -1)
    o.data.transform(turn)
    o.data.update()
    folded += 1
assert folded == len(ANTENNAS), folded

# Textures opaques : les PNG du modèle ont des zones transparentes, mais seulement hors des faces (fond de l'atlas).
# Lues en transparence, tout le pont et la coque passaient en « BLEND » (tri des faces, pas d'ombres, JPEG impossible)
for mat in bpy.data.materials:
    if not mat.use_nodes or mat.blend_method == 'BLEND' and mat.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value < 1:
        continue   # (vitres : vraie transparence du matériau AC)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    for link in list(bsdf.inputs['Alpha'].links):
        mat.node_tree.links.remove(link)
    mat.blend_method = 'OPAQUE'

# Repère du jeu : Blender (après lecture AC : x arrière, y tribord, z haut) -> tourné de -90° autour de z, puis
# recentré sur le milieu du pont (glTF z = -y Blender)
frame = Matrix.Translation((0, CENTER, 0)) @ Matrix.Rotation(math.radians(-90), 4, 'Z')
for o in keep:
    o.data.transform(frame)
    o.data.update()

# Une seule maille par matériau (quelques dizaines d'appels de dessin au lieu de ~250)
bpy.ops.object.select_all(action='DESELECT')
by_material = {}
for o in keep:
    key = tuple(sorted(m.name for m in o.data.materials))
    by_material.setdefault(key, []).append(o)
merged = []
for group in by_material.values():
    bpy.ops.object.select_all(action='DESELECT')
    for o in group:
        o.select_set(True)
    bpy.context.view_layer.objects.active = group[0]
    if len(group) > 1:
        bpy.ops.object.join()
    merged.append(bpy.context.view_layer.objects.active)

os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'truman.glb')
bpy.ops.object.select_all(action='DESELECT')
for o in merged:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                          export_yup=True, export_image_format='AUTO', export_jpeg_quality=85,
                          export_extras=False, export_materials='EXPORT')
print('EXPORT', path, os.path.getsize(path) // 1024, 'KB', len(merged), 'mailles')
