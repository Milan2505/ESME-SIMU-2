# Poignée du manche du F-15 : modèle « F-15 Joystick » de mrhers2 (Thingiverse, thing:2226639, licence Creative
# Commons Attribution : https://www.thingiverse.com/thing:2226639), fichier f15_v1.6.stl (poignée complète, sans les
# découpes pour l'électronique des versions 2.0), converti en GLB pour le cockpit (Blender 4.2) :
#   blender --background --python asset/blender/build_f15_stick.py -- <f15_v1.6.stl>
# Exporte asset/f15/f15-stick.glb : allégé (~20 000 triangles au lieu de 58 000), ombrage lissé ; en millimètres,
# y vers le haut, base de la poignée en y = 0, doigts vers -z (l'avant), tête penchée vers le pilote (+z). La mise en
# place sur la colonne du manche, la bague et les boutons de la tête sont faits par F15Cockpit.js.
import math
import os
import sys

import bpy

src = sys.argv[sys.argv.index('--') + 1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'f15', 'f15-stick.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=src)
grip = bpy.context.selected_objects[0]
grip.name = 'f15-grip'
bpy.context.view_layer.objects.active = grip
decimate = grip.modifiers.new('allege', 'DECIMATE')
decimate.ratio = 0.35
bpy.ops.object.modifier_apply(modifier='allege')
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
print('EXPORT', out, os.path.getsize(out) // 1024, 'KB')
