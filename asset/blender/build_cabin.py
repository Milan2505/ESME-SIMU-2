# Intérieur de la cabine du C172 modélisé dans Blender (script, Blender 4.2) :
#   blender --background --python asset/blender/build_cabin.py -- [--render dossier]
# Construit les pièces à partir du modèle de l'avion (asset/c172p.glb, mêmes coordonnées), enregistre
# asset/blender/cabin.blend (à ouvrir et retoucher dans Blender) et exporte asset/cabin.glb (chargé par le jeu,
# voir C172Model.loadCabinParts). Repère Blender : x vers la droite, y vers l'avant, z vers le haut.
#
# Garniture de montant (une par côté) : une seule pièce moulée qui habille le montant du pare-brise, du tableau au
# plafond, et s'évase en haut en une tête arrondie en forme d'emplanture d'aile (nez contre la vitre, dessus sous le
# plafond). Volumes simples fondus ensemble (remaillage par voxels) puis lissés : raccords arrondis comme une pièce de
# plastique moulé. Aérateur sur la tête, petit aérateur plus bas sur le montant.
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = r"C:\Users\melia\ESME-SIMU-2"
AIRCRAFT = ROOT + r"\asset\c172p.glb"
BLEND = ROOT + r"\asset\blender\cabin.blend"
EXPORT = ROOT + r"\asset\cabin.glb"

WALL_X = 0.518            # flanc gauche/droit (|x|) au montant
GLASS_GAP = 0.008         # la garniture reste à ce jeu derrière la vitre
# Bord de la vitre au montant (y, z), relevé sur le modèle (pièce « glas »)
GLASS_EDGE = [(0.142, 0.015), (0.105, 0.056), (0.046, 0.19), (-0.128, 0.52), (-0.13, 0.6)]
# Avant de la porte et de sa vitre (y, z) : le montant habillé s'arrête 1 cm dessus
DOOR_EDGE = [(0.04, -0.06), (0.02, 0.0), (0.011, 0.011), (-0.069, 0.298), (-0.1, 0.35), (-0.16, 0.6)]
CEILING_Z = 0.515         # plafond au coin du pare-brise
PILLAR = {'bottom': 0.0, 'thickness': 0.028}
HEAD = {'back': -0.16, 'depth': 0.05}


def along(points, z):
    # y du bord à la hauteur z (interpolation linéaire entre les points, triés par z)
    pts = sorted(points, key=lambda p: p[1])
    if z <= pts[0][1]:
        return pts[0][0]
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if z <= z1:
            return y0 + (y1 - y0) * (z - z0) / (z1 - z0)
    return pts[-1][0]


def glass_y(z):
    return along(GLASS_EDGE, z) - GLASS_GAP


def material(name, color, roughness=0.8):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def prism(name, outline, x0, x1):
    # Polygone (y, z) extrudé en x de x0 (dans le flanc) à x1 (côté cabine) : volume fermé
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((x0, y, z)) for y, z in outline])
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(x1 - x0, 0, 0), verts=[v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def pillar_outline():
    # Entre l'avant de la porte (1 cm dessus) et le bord de la vitre, du tableau jusque dans le plafond
    zs = [PILLAR['bottom'] + i * (CEILING_Z - PILLAR['bottom']) / 24 for i in range(25)]
    front = [(glass_y(z) + 0.004, z) for z in zs]
    back = [(along(DOOR_EDGE, z) - 0.012, z) for z in reversed(zs)]
    return front + back


def convex_hull(points):
    pts = sorted(set(points))
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    hull = []
    for seq in (pts, pts[::-1]):
        start = len(hull)
        for p in seq:
            while len(hull) >= start + 2 and cross(hull[-2], hull[-1], p) <= 0:
                hull.pop()
            hull.append(p)
        hull.pop()
    return hull


def head_outline():
    # Silhouette de l'emplanture d'aile (bord du profil d'origine, contre le flanc, dans le coin du pare-brise),
    # prolongée vers l'arrière jusqu'au haut du montant
    edge = bpy.data.objects['wing_1Ledge']
    pts = [(round(p.y, 4), round(p.z, 4)) for p in (edge.matrix_world @ v.co for v in edge.data.vertices)]
    top = max(z for _, z in pts)
    pts += [(HEAD['back'], top), (HEAD['back'], top - 0.06)]
    return convex_hull(pts)


def glass_tree():
    glass = bpy.data.objects['glas']
    mesh = glass.data.copy()
    mesh.transform(glass.matrix_world)
    tree = BVHTree.FromPolygons([v.co.copy() for v in mesh.vertices], [p.vertices[:] for p in mesh.polygons])
    bpy.data.meshes.remove(mesh)
    return tree


def molded_trim(name, mat):
    # Côté gauche : montant et tête fondus (voxels), lissés ; puis chaque point qui dépasse devant la vraie vitre (mesurée
    # à sa hauteur et à sa distance du flanc) est ramené GLASS_GAP derrière
    pillar = prism('montant', pillar_outline(), -WALL_X - 0.012, -WALL_X + PILLAR['thickness'])
    head = prism('tete', head_outline(), -WALL_X - 0.012, -WALL_X + HEAD['depth'])
    bpy.ops.object.select_all(action='DESELECT')
    pillar.select_set(True)
    head.select_set(True)
    bpy.context.view_layer.objects.active = pillar
    bpy.ops.object.join()
    obj = pillar
    obj.name = obj.data.name = name
    remesh = obj.modifiers.new('Fusion', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = 0.004
    smooth = obj.modifiers.new('Moulage', 'LAPLACIANSMOOTH')
    smooth.iterations = 10
    smooth.lambda_factor = 1.0
    smooth.use_volume_preserve = True
    bpy.ops.object.modifier_apply(modifier='Fusion')
    bpy.ops.object.modifier_apply(modifier='Moulage')
    tree = glass_tree()

    def clamp_to_glass():
        for v in obj.data.vertices:
            hit = tree.ray_cast(Vector((v.co.x, v.co.y - 0.4, v.co.z)), Vector((0, 1, 0)))
            if hit[0] is not None and v.co.y > hit[0].y - GLASS_GAP:
                v.co.y = hit[0].y - GLASS_GAP

    # Découpe, lissage (efface les stries de la découpe), découpe à nouveau
    clamp_to_glass()
    polish = obj.modifiers.new('Poli', 'LAPLACIANSMOOTH')
    polish.iterations = 8
    polish.lambda_factor = 0.8
    polish.use_volume_preserve = True
    bpy.ops.object.modifier_apply(modifier='Poli')
    clamp_to_glass()
    decimate = obj.modifiers.new('Allegement', 'DECIMATE')
    decimate.ratio = 0.25
    bpy.ops.object.modifier_apply(modifier='Allegement')
    obj.data.materials.append(mat)
    obj.data.shade_smooth()
    return obj


def air_vent(name, scale, rubber, dark):
    # Aérateur : profil tourné (collerette plate, rotule, buse conique en caoutchouc), axe local z = sortie ; trou
    profile = [(x * scale, y * scale) for x, y in [
        (0.0, 0.0), (0.039, 0.0), (0.04, 0.005), (0.034, 0.009), (0.027, 0.01), (0.026, 0.023),
        (0.022, 0.039), (0.017, 0.055), (0.015, 0.06), (0.0117, 0.06), (0.0117, 0.026), (0.0, 0.026)]]
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, h)) for r, h in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=40, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(rubber)
    obj.data.shade_smooth()
    hole_bm = bmesh.new()
    bmesh.ops.create_circle(hole_bm, cap_ends=True, segments=24, radius=0.0115 * scale)
    bmesh.ops.translate(hole_bm, vec=(0, 0, 0.058 * scale), verts=hole_bm.verts)
    hole_mesh = bpy.data.meshes.new(name + '_trou')
    hole_bm.to_mesh(hole_mesh)
    hole_bm.free()
    hole = bpy.data.objects.new(name + '_trou', hole_mesh)
    hole.data.materials.append(dark)
    return obj, hole


def place(objs, at, facing):
    rot = Vector((0, 0, 1)).rotation_difference(facing.normalized()).to_matrix().to_4x4()
    for o in objs:
        o.matrix_world = Matrix.Translation(at) @ rot


def mirrored(obj, name):
    # Copie côté droit : symétrie en x (géométrie et placement), normales retournées
    flip = Matrix.Scale(-1, 4, (1, 0, 0))
    mesh = obj.data.copy()
    mesh.transform(obj.matrix_world)
    mesh.transform(flip)
    mesh.flip_normals()
    return bpy.data.objects.new(name, mesh)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    render_dir = args[args.index('--render') + 1] if '--render' in args else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=AIRCRAFT)
    aircraft = bpy.data.collections.new('Avion (référence, non exporté)')
    bpy.context.scene.collection.children.link(aircraft)
    for obj in list(bpy.context.scene.collection.objects):
        bpy.context.scene.collection.objects.unlink(obj)
        aircraft.objects.link(obj)
    cabin = bpy.data.collections.new('Cabine')
    bpy.context.scene.collection.children.link(cabin)

    trim = material('Garniture', (0.42, 0.44, 0.47), 0.85)
    rubber = material('Caoutchouc', (0.025, 0.027, 0.032), 0.55)
    dark = material('Trou', (0.0, 0.0, 0.0), 1.0)

    left = molded_trim('garniture_montant_L', trim)
    bpy.context.view_layer.update()
    parts = [left]
    # Aérateurs : surface de la tête (milieu de sa face intérieure) et du montant plus bas, tournés vers les sièges
    head_mid = Vector((-WALL_X + 0.2, 0.02, 0.46))
    pillar_mid = Vector((-WALL_X + 0.2, (glass_y(0.13) + along(DOOR_EDGE, 0.13)) / 2, 0.13))
    for vname, probe, scale, facing in (('aerateur_L', head_mid, 0.9, Vector((1, -0.3, -0.25))),
                                        ('aerateur_bas_L', pillar_mid, 0.75, Vector((1, -0.4, 0.1)))):
        hit, at, _, _ = left.ray_cast(probe, Vector((-1, 0, 0)))
        if not hit:
            print('AERATEUR NON PLACE', vname)
            continue
        vent, hole = air_vent(vname, scale, rubber, dark)
        place((vent, hole), at - Vector((0.004, 0, 0)), facing)
        parts += [vent, hole]
    for o in list(parts):
        parts.append(mirrored(o, o.name.replace('_L', '_R')))
    for o in parts:
        for c in o.users_collection:
            c.objects.unlink(o)
        cabin.objects.link(o)

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    bpy.ops.object.select_all(action='DESELECT')
    for o in cabin.all_objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=EXPORT, use_selection=True, export_apply=True, export_format='GLB')
    print('TRIANGLES', sum(len(o.data.polygons) for o in cabin.all_objects))

    if render_dir:
        render(render_dir)


def render(folder):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 1000, 700
    world = bpy.data.worlds.new('Ciel')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.6, 0.8, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    scene.world = world
    sun = bpy.data.objects.new('Soleil', bpy.data.lights.new('Soleil', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('Vue', bpy.data.cameras.new('Vue'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Œil du pilote (repère du jeu : CABIN_ORIGIN + EYE, moins MODEL_OFFSET) ; montant gauche, droit, vue de dehors
    views = {
        'gauche': ((-0.2, -0.33, 0.293), (-0.5, -0.05, 0.3), 24),
        'droite': ((-0.2, -0.33, 0.293), (0.5, -0.05, 0.3), 24),
        'dehors': ((-0.9, 0.9, 0.75), (-0.45, -0.1, 0.35), 30),
    }
    for label, (eye, target, lens) in views.items():
        cam.data.lens = lens
        cam.location = eye
        cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f'{folder}/montant_{label}.png'
        bpy.ops.render.render(write_still=True)


main()
