# Intérieur de la cabine du C172 modélisé dans Blender (script, Blender 4.2) :
#   blender --background --python asset/blender/build_cabin.py
# Construit les pièces à partir du modèle de l'avion (asset/c172p.glb, mêmes coordonnées), enregistre
# asset/blender/cabin.blend (à ouvrir et retoucher dans Blender) et exporte asset/cabin.glb (chargé par le jeu,
# voir C172Model.loadCabinParts). Repère Blender : x vers la droite, y vers l'avant, z vers le haut.
#
# Garniture de montant (une par côté) : plaque moulée dont le contour est dessiné comme une courbe lisse (montant du
# tableau au plafond, arrondi creux, tête ronde qui s'avance vers le pare-brise, dessus noyé dans le plafond), épaissie
# et arrondie par Blender (courbe extrudée à bords biseautés) : surface propre, sans remaillage ni découpe. Le contour
# reste derrière la vraie vitre (mesurée sur le modèle). Aérateur au centre de la tête, petit aérateur plus bas.
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = r"C:\Users\melia\ESME-SIMU-2"
AIRCRAFT = ROOT + r"\asset\c172p.glb"
BLEND = ROOT + r"\asset\blender\cabin.blend"
EXPORT = ROOT + r"\asset\cabin.glb"

# Bord de la vitre contre le flanc (y, z), relevé sur le modèle (pièce « glas »)
GLASS_EDGE = [(0.142, 0.015), (0.105, 0.056), (0.046, 0.19), (-0.128, 0.52), (-0.13, 0.6)]
# Avant de la porte et de sa vitre (y, z)
DOOR_EDGE = [(0.04, -0.06), (0.02, 0.0), (0.011, 0.011), (-0.069, 0.298), (-0.1, 0.35), (-0.16, 0.6)]

OUTER_X = -0.514          # face de la plaque côté flanc (gauche)
EXTRUDE = 0.002           # demi-épaisseur du plat
BEVEL = 0.006             # arrondi des bords (épaisseur totale : 2 × (EXTRUDE + BEVEL) = 1,6 cm)
BOTTOM_Z = 0.0            # pied du montant (contre le tableau)
PILLAR = {'width': 0.08, 'overlap': 0.012, 'door_overlap': 0.03}      # largeur ; débord sur la vitre et la porte
# Profil d'aile de l'emplanture (y, z), relevé sur le modèle (pièce « wing_1Ledge », contre le flanc gauche) : du
# bas arrière, par le nez, au haut arrière
WING_PROFILE = [(-0.087, 0.387), (0.015, 0.403), (0.113, 0.43), (0.138, 0.444), (0.153, 0.46), (0.16, 0.475),
                (0.158, 0.49), (0.153, 0.501), (0.139, 0.51), (0.098, 0.525), (0.058, 0.533), (-0.087, 0.53)]
# Tête : le profil, coupé à top (au-dessus, le haut du pare-brise redescend contre le flanc)
HEAD = {'top': 0.495, 'fillet_from': 0.26}   # tête


def along(points, z):
    # y du bord à la hauteur z (interpolation linéaire entre les points, triés par z)
    pts = sorted(points, key=lambda p: p[1])
    if z <= pts[0][1]:
        return pts[0][0]
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if z <= z1:
            return y0 + (y1 - y0) * (z - z0) / (z1 - z0)
    return pts[-1][0]


def material(name, color, roughness=0.8):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def glass_tree():
    glass = bpy.data.objects['glas']
    mesh = glass.data.copy()
    mesh.transform(glass.matrix_world)
    tree = BVHTree.FromPolygons([v.co.copy() for v in mesh.vertices], [p.vertices[:] for p in mesh.polygons])
    bpy.data.meshes.remove(mesh)
    return tree


def trim_outline(tree):
    # Contour (y, z) du côté gauche, sans l'épaisseur de l'arrondi (BEVEL, ajouté par Blender) : pied, bord avant du
    # montant, arrondi creux, tête ovale qui s'avance, dessus droit noyé dans le plafond, bord arrière
    front = lambda z: along(GLASS_EDGE, z) + PILLAR['overlap'] - BEVEL
    back = lambda z: max(front(z) - PILLAR['width'] + 2 * BEVEL, along(DOOR_EDGE, z) - PILLAR['door_overlap'] + BEVEL)
    def glass_limit(z):
        ys = [hit[0].y for x in (OUTER_X, OUTER_X + 2 * (EXTRUDE + BEVEL))
              for hit in [tree.ray_cast(Vector((x, -0.5, z)), Vector((0, 1, 0)))] if hit[0] is not None]
        return (min(ys) if ys else 1.0) - BEVEL - 0.006

    # Tête : contour du profil d'aile de l'emplanture (dessous qui remonte vers l'avant, nez arrondi), pris à partir du
    # bord avant du montant, jusqu'à HEAD['top'] (au-dessus, la vitre redescend), à sa place exacte : nez bombé du bord
    # d'attaque. Dans le modèle, le nez de l'aile dépasse un peu la vitre à l'emplanture : la tête aussi, cachée dans l'aile
    profile = []
    for (y0, z0_), (y1, z1) in zip(WING_PROFILE, WING_PROFILE[1:]):
        steps = max(1, int(math.hypot(y1 - y0, z1 - z0_) / 0.004))
        profile += [(y0 + (y1 - y0) * k / steps, z0_ + (z1 - z0_) * k / steps) for k in range(steps)]
    inset = []
    for i, (y, z) in enumerate(profile):
        (ya, za), (yb, zb) = profile[max(0, i - 1)], profile[min(len(profile) - 1, i + 1)]
        ty, tz = yb - ya, zb - za
        length = math.hypot(ty, tz) or 1.0
        d = BEVEL + 0.002   # 2 mm sous le profil : vue de dehors, la tête reste dans le volume de l'aile
        inset.append((y - d * tz / length, z + d * ty / length))   # normale vers l'intérieur (sens direct)
    top = HEAD['top'] - BEVEL
    start = next(i for i, (y, z) in enumerate(inset) if y >= front(z) + 0.035)
    head = []
    for y, z in inset[start:]:
        if z > top:   # au-dessus : le haut du pare-brise ; la tête s'arrête là (dessus droit, voir plus bas)
            break
        head.append((y, z))
    # Dessous près du montant descendu de 1,5 cm (rien jusqu'au nez) : couvre le pli du haut du pare-brise, qui se voyait
    # en fil clair sous la tête ; caché de dehors par le fuselage
    nose_y = max(y for y, _ in head)
    i_nose = max(range(len(head)), key=lambda i: head[i][0])
    head = [(y, z - 0.015 * min(1.0, max(0.0, (nose_y - 0.07 - y) / 0.05)) if i < i_nose else z)
            for i, (y, z) in enumerate(head)]
    for _ in range(3):
        head = [head[0]] + [((head[i - 1][0] + 2 * head[i][0] + head[i + 1][0]) / 4,
                             (head[i - 1][1] + 2 * head[i][1] + head[i + 1][1]) / 4) for i in range(1, len(head) - 1)] + [head[-1]]
    pts = [(back(BOTTOM_Z) + (front(BOTTOM_Z) - back(BOTTOM_Z)) * t / 6, BOTTOM_Z) for t in range(7)]
    z0 = HEAD['fillet_from']
    pts += [(front(z), z) for z in (BOTTOM_Z + (z0 - BOTTOM_Z) * i / 12 for i in range(1, 13))]
    # Arrondi creux : du montant vers le début du dessous de la tête, tangent à lui
    head = head[3:]   # premiers points (lissage contre le départ) : l'arrondi creux s'y raccorde plus loin
    (ys, zs), (yn, zn) = head[0], head[min(3, len(head) - 1)]
    slope = (zn - zs) / ((yn - ys) or 1e-6)
    p0, p2 = Vector((front(z0), z0)), Vector((ys, zs))
    p1 = Vector((front(zs), zs - slope * (ys - front(zs))))   # sur la tangente du dessous, à l'aplomb du montant
    for i in range(1, 16):
        t = i / 15
        q = p0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + p2 * t ** 2
        pts.append((q.x, q.y))
    pts += head[1:]
    yc, z_top = head[-1][0], top
    # Coin arrière du dessus arrondi (rayon 3 cm), puis bord arrière jusqu'au pied
    corner = 0.03
    cy, cz = back(z_top - corner) + corner, z_top - corner
    pts.append((yc, z_top))
    pts += [(cy + corner * math.cos(a), cz + corner * math.sin(a))
            for a in (math.pi / 2 + math.pi / 2 * i / 8 for i in range(9))]
    pts += [(back(z), z) for z in (cz - cz * i / 16 for i in range(1, 16))]
    # Contrôle : tout le contour (avec l'arrondi) reste derrière la vitre, sur les deux faces
    worst = 1.0
    for y, z in pts:
        if z > HEAD['fillet_from']:   # tête : dans le volume de l'aile (voir plus haut)
            continue
        for x in (OUTER_X, OUTER_X + 2 * (EXTRUDE + BEVEL)):
            hit = tree.ray_cast(Vector((x, -0.5, z)), Vector((0, 1, 0)))
            if hit[0] is not None and hit[0].y - (y + BEVEL) < worst:
                worst, where = hit[0].y - (y + BEVEL), (round(x, 3), round(y, 3), round(z, 3), round(hit[0].y, 3))
    print('JEU_VITRE_MIN', round(worst, 3), where if worst < 1 else '')
    return pts


def molded_trim(name, mat, tree):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    curve.extrude = EXTRUDE
    curve.bevel_depth = BEVEL
    curve.bevel_resolution = 6
    spline = curve.splines.new('POLY')
    outline = trim_outline(tree)
    spline.points.add(len(outline) - 1)
    for point, (y, z) in zip(spline.points, outline):
        point.co = (y, z, 0, 1)
    spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    # Plan de la courbe (x, y locaux) -> (y, z) de l'avion ; épaisseur (z local) -> x, vers l'intérieur
    obj.matrix_world = Matrix(((0, 0, 1, OUTER_X + EXTRUDE + BEVEL), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    obj.data.materials.append(mat)
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

    tree = glass_tree()
    left = molded_trim('garniture_montant_L', trim, tree)
    parts = [left]
    # Aérateurs sur la face intérieure : au centre de la tête, et plus bas sur le montant ; tournés vers les sièges
    inner_x = OUTER_X + 2 * (EXTRUDE + BEVEL)
    outline = trim_outline(tree)
    # Centre de la tête : à 6 cm du nez, à mi-hauteur entre le dessous du profil et le dessus
    nose = max(y for y, z in outline if z > 0.4)
    head_y = nose - 0.06
    below = min((z for y, z in outline if z > 0.35 and abs(y - head_y) < 0.006), default=0.43)
    head_center = Vector((inner_x, head_y, (below + HEAD['top']) / 2))
    low_z = 0.15
    low_ys = [y for y, z in outline if abs(z - low_z) < 0.02]
    low_center = Vector((inner_x, (min(low_ys) + max(low_ys)) / 2, low_z))
    for vname, at, scale, facing in (('aerateur_L', head_center, 0.62, Vector((1, -0.25, -0.2))),
                                     ('aerateur_bas_L', low_center, 0.7, Vector((1, -0.35, 0.05)))):
        vent, hole = air_vent(vname, scale, rubber, dark)
        place((vent, hole), at - Vector((0.003, 0, 0)), facing)
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
    print('TRIANGLES', sum(len(o.data.polygons) for o in cabin.all_objects), 'NEZ', round(nose, 3))


main()
