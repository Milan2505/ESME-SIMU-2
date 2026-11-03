# Intérieur de la cabine du C172 modélisé dans Blender (script, Blender 4.2) :
#   blender --background --python asset/blender/build_cabin.py -- [--render chemin.png]
# Construit les pièces à partir du modèle de l'avion (asset/c172p.glb, mêmes coordonnées), enregistre
# asset/blender/cabin.blend (à ouvrir et retoucher dans Blender) et exporte asset/cabin.glb (chargé par le jeu,
# voir C172Model.loadCabinParts). Repère Blender : x vers la droite, y vers l'avant, z vers le haut.
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = r"C:\Users\melia\ESME-SIMU-2"
AIRCRAFT = ROOT + r"\asset\c172p.glb"
BLEND = ROOT + r"\asset\blender\cabin.blend"
EXPORT = ROOT + r"\asset\cabin.glb"

FAIRING_DEPTH = 0.07      # avancée du carénage d'emplanture depuis le flanc (m)
GLASS_GAP = 0.012         # le nez du carénage reste à ce jeu derrière la vitre du pare-brise
BEVEL = 0.016             # arrondi des arêtes du carénage


def material(name, color, roughness=0.8):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def world_points(obj):
    return [obj.matrix_world @ v.co for v in obj.data.vertices]


def profile_outline(edge):
    # Contour du profil d'aile : boucle extérieure du bord (côté flanc), ordonnée autour de son centre, en (y, z)
    pts = world_points(edge)
    outer = max(abs(p.x) for p in pts)
    loop = [p for p in pts if abs(p.x) > outer - 0.003]
    cy = sum(p.y for p in loop) / len(loop)
    cz = sum(p.z for p in loop) / len(loop)
    loop.sort(key=lambda p: math.atan2(p.z - cz, p.y - cy))
    out = []
    for p in loop:   # sommets en double (coutures)
        if not out or (Vector((p.y, p.z)) - Vector((out[-1].y, out[-1].z))).length > 1e-4:
            out.append(p)
    # Lissage (Chaikin, 3 passes) : contour arrondi, sans les facettes du maillage d'origine
    for _ in range(3):
        smooth = []
        for i, a in enumerate(out):
            b = out[(i + 1) % len(out)]
            smooth += [a.lerp(b, 0.25), a.lerp(b, 0.75)]
        out = smooth
    return out, outer


def glass_line(glass, side, z_low, z_high):
    # Vitre du pare-brise au coin : y(z) le long du flanc (droite par les sommets les plus proches du flanc)
    pts = [p for p in world_points(glass) if side * p.x > 0.42 and z_low - 0.05 < p.z < z_high + 0.05 and p.y > -0.3]
    def front_at(z):
        near = sorted(pts, key=lambda p: abs(p.z - z))[:6]
        return min(p.y for p in near)   # la vitre est devant (y grand) : on prend le plus en arrière, côté cabine
    return front_at(z_low), front_at(z_high)


def fairing(side, edge, glass, mat):
    outline, outer = profile_outline(edge)
    z_low = min(p.z for p in outline)
    z_high = max(p.z for p in outline)
    y_low, y_high = glass_line(glass, side, z_low, z_high)
    mesh = bpy.data.meshes.new(f'fairing_{"L" if side < 0 else "R"}')
    bm = bmesh.new()
    wall_x = side * (outer + 0.005)   # 5 mm dans le flanc : soudé à la carlingue
    verts = [bm.verts.new((wall_x, p.y, p.z)) for p in outline]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(-side * (FAIRING_DEPTH + 0.005), 0, 0), verts=moved)
    # Coupe le long de la vitre (plan qui suit sa pente au coin), nez GLASS_GAP derrière
    p0 = Vector((wall_x, y_low - GLASS_GAP, z_low))
    p1 = Vector((wall_x, y_high - GLASS_GAP, z_high))
    along = (p1 - p0).normalized()
    normal = along.cross(Vector((1, 0, 0))).normalized()
    if normal.y < 0:
        normal = -normal   # vers l'avant (vers la vitre)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    cut = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=p0, plane_no=normal, clear_outer=True)
    cut_edges = [e for e in cut['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if cut_edges:
        bmesh.ops.holes_fill(bm, edges=cut_edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(mesh.name, mesh)
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new('Arrondi', 'BEVEL')
    bevel.width = BEVEL
    bevel.segments = 8
    bevel.limit_method = 'ANGLE'
    bevel.angle_limit = math.radians(50)   # arêtes vives seulement (pourtour des faces), pas le contour déjà lissé
    bevel.harden_normals = True
    obj.data.shade_smooth()
    # Centre de la face intérieure (pour l'aérateur)
    inner = [obj.matrix_world @ v.co for v in obj.data.vertices if abs(v.co.x) < abs(wall_x) - FAIRING_DEPTH + 0.001]
    center = sum(inner, Vector()) / max(1, len(inner))
    return obj, center


def air_vent(name, at, facing, mat_rubber, mat_dark):
    # Aérateur : profil tourné (collerette plate, rotule, buse conique en caoutchouc), axe local z vers facing
    profile = [(x * 1.3, y * 1.3) for x, y in [(0.0, 0.0), (0.03, 0.0), (0.031, 0.004), (0.026, 0.007), (0.021, 0.008),
               (0.02, 0.018), (0.017, 0.03), (0.013, 0.042), (0.0115, 0.046), (0.009, 0.046), (0.009, 0.02), (0.0, 0.02)]]
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    prev = [bm.verts.new((r, 0, h)) for r, h in profile]
    edges = [bm.edges.new((prev[i], prev[i + 1])) for i in range(len(prev) - 1)]
    bmesh.ops.spin(bm, geom=prev + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=40, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat_rubber)
    obj.data.shade_smooth()
    rot = Vector((0, 0, 1)).rotation_difference(facing.normalized()).to_matrix().to_4x4()
    obj.matrix_world = Matrix.Translation(at) @ rot
    # Trou de la buse
    bpy.ops.mesh.primitive_circle_add(vertices=24, radius=0.0117, fill_type='NGON', location=(0, 0, 0))
    hole = bpy.context.active_object
    hole.name = name + '_trou'
    hole.data.materials.append(mat_dark)
    hole.parent = obj
    hole.matrix_parent_inverse = Matrix.Identity(4)
    hole.location = (0, 0, 0.0575)
    return obj


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    render_path = args[args.index('--render') + 1] if '--render' in args else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=AIRCRAFT)
    aircraft = bpy.data.collections.new('Avion (référence, non exporté)')
    bpy.context.scene.collection.children.link(aircraft)
    for obj in list(bpy.context.scene.collection.objects):
        bpy.context.scene.collection.objects.unlink(obj)
        aircraft.objects.link(obj)
    cabin = bpy.data.collections.new('Cabine')
    bpy.context.scene.collection.children.link(cabin)

    trim = material('Garniture', (0.55, 0.57, 0.6), 0.85)
    rubber = material('Caoutchouc', (0.02, 0.02, 0.025), 0.6)
    dark = material('Trou', (0.0, 0.0, 0.0), 1.0)
    glass = bpy.data.objects['glas']
    for side, edge_name in ((-1, 'wing_1Ledge'), (1, 'wing_1Redge')):
        obj, center = fairing(side, bpy.data.objects[edge_name], glass, trim)
        cabin.objects.link(obj)
        facing = Vector((-side, -0.2, -0.15))   # vers les sièges : vers l'intérieur, l'arrière, un peu vers le bas
        vent = air_vent(f'aerateur_{"L" if side < 0 else "R"}', center + Vector((side * 0.002, -0.03, 0)), facing, rubber, dark)
        for o in (vent, *vent.children):
            for c in o.users_collection:
                c.objects.unlink(o)
            cabin.objects.link(o)

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    # Export : seulement la collection Cabine, modificateurs appliqués
    bpy.ops.object.select_all(action='DESELECT')
    for o in cabin.all_objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=EXPORT, use_selection=True, export_apply=True, export_format='GLB')

    if render_path:
        render(render_path)


def render(path):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.device = 'CPU'
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    world = bpy.data.worlds.new('Ciel')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.6, 0.8, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.2
    scene.world = world
    sun = bpy.data.objects.new('Soleil', bpy.data.lights.new('Soleil', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(40), 0, math.radians(30))
    scene.collection.objects.link(sun)
    # Œil du pilote (repère du jeu : CABIN_ORIGIN + EYE, moins MODEL_OFFSET), regard vers le coin gauche du pare-brise
    cam = bpy.data.objects.new('Pilote', bpy.data.cameras.new('Pilote'))
    cam.data.lens = 20
    cam.location = (-0.2, -0.33, 0.293)
    target = Vector((-0.5, 0.05, 0.45))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


main()
