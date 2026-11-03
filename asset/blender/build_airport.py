# Bâtiments des aérodromes (tours de contrôle, aérogares) : modèles de la base de scènes FlightGear (AC3D, GPL-2.0,
# voir asset/airport/LICENSE.txt) convertis en glTF pour le jeu (chargés par Airport.js) :
#   blender --background --python asset/blender/build_airport.py
# Chaque modèle est recentré (centre de son emprise au sol à l'origine, base à z = 0) ; repère Blender : z vers le haut
# (exporté en glTF, y vers le haut). Les verres (matières transparentes) s'appellent « Vitrage » : Airport.js les
# allume la nuit
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = r"C:\Users\melia\ESME-SIMU-2"
sys.path.insert(0, ROOT + r"\asset\blender")
from ac_import import load_ac   # noqa: E402

SOURCE = ROOT + r"\asset\airport\source"
OUT = ROOT + r"\asset\airport"
# Modèle -> pièces gardées (None : toutes). tower_EPRZ : la tour et son aile, sans l'entrepôt ni le mur annexes
MODELS = {'Tour_Controle': None, 'generic-terminal': None, 'RJTF-terminal': None, 'tower_EPRZ': ['tower']}

for name, keep in MODELS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects = load_ac(os.path.join(SOURCE, name + '.ac'))
    if keep:
        dropped = [o for o in objects if o.name not in keep]
        objects = [o for o in objects if o.name in keep]
        for o in dropped:
            bpy.data.objects.remove(o)
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    low = Vector([min(p[k] for p in points) for k in range(3)])
    high = Vector([max(p[k] for p in points) for k in range(3)])
    shift = Matrix.Translation(-Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z)))
    for o in objects:
        o.data.transform(shift)
    for material in bpy.data.materials:
        if material.blend_method == 'BLEND':
            material.name = 'Vitrage'
    size = high - low
    print('BATIMENT', name, 'emprise', round(size.x, 1), 'x', round(size.y, 1), 'm, hauteur', round(size.z, 1), 'm')
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', export_apply=True)
