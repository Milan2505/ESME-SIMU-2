# Lecteur AC3D minimal pour Blender : objets, matériaux (rgb, trans), textures, UV ; repère AC (y en haut) -> Blender (z en haut)
import bpy, os
from mathutils import Matrix, Vector

def load_ac(path, collection=None):
    folder = os.path.dirname(path)
    lines = open(path, encoding='latin-1').read().splitlines()
    i = 1
    mats = []
    tex_cache = {}
    def blender_mat(m, tex):
        key = (m, tex)
        if key in tex_cache: return tex_cache[key]
        rgb, trans, name = mats[m]
        mat = bpy.data.materials.new(f"{name or 'mat'}_{tex or ''}")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        if trans > 0:
            bsdf.inputs['Alpha'].default_value = 1 - trans
            mat.blend_method = 'BLEND'
        if tex and os.path.exists(os.path.join(folder, tex)):
            node = mat.node_tree.nodes.new('ShaderNodeTexImage')
            node.image = bpy.data.images.load(os.path.join(folder, tex))
            mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
            # Alpha de la texture seulement s'il y a de vrais trous (sinon exportée transparente : tri des faces faux)
            alpha = list(node.image.pixels)[3::4] if node.image.channels == 4 else []
            if trans == 0 and alpha and min(alpha) < 0.5:
                mat.node_tree.links.new(node.outputs['Alpha'], bsdf.inputs['Alpha'])
                mat.blend_method = 'CLIP'
        tex_cache[key] = mat
        return mat
    while lines[i].startswith('MATERIAL'):
        t = lines[i].split()
        name = lines[i].split('"')[1]
        k = t.index('rgb'); rgb = tuple(float(x) for x in t[k + 1:k + 4])
        trans = float(t[t.index('trans') + 1])
        mats.append((rgb, trans, name))
        i += 1
    objs = []
    def read_object(i, parent_matrix):
        assert lines[i].startswith('OBJECT'), lines[i]
        name, loc, rot, tex, verts, surfs, crease = 'obj', Vector(), Matrix.Identity(3), None, [], [], None
        texrep = (1, 1); texoff = (0, 0)
        i += 1
        while True:
            t = lines[i].split()
            if not t: i += 1; continue
            if t[0] == 'name': name = lines[i].split('"')[1]
            elif t[0] == 'loc': loc = Vector([float(x) for x in t[1:4]])
            elif t[0] == 'rot':
                r = [float(x) for x in t[1:10]]; rot = Matrix((r[0:3], r[3:6], r[6:9])).transposed()
            elif t[0] == 'texture': tex = lines[i].split('"')[1]
            elif t[0] == 'texrep': texrep = (float(t[1]), float(t[2]))
            elif t[0] == 'texoff': texoff = (float(t[1]), float(t[2]))
            elif t[0] == 'numvert':
                n = int(t[1])
                for k in range(n): verts.append(Vector([float(x) for x in lines[i + 1 + k].split()[:3]]))
                i += n
            elif t[0] == 'numsurf':
                n = int(t[1]); i += 1
                for _ in range(n):
                    flags = int(lines[i].split()[1], 16); i += 1
                    m = 0
                    while not lines[i].startswith('refs'):
                        if lines[i].startswith('mat'): m = int(lines[i].split()[1])
                        i += 1
                    nr = int(lines[i].split()[1])
                    refs = [lines[i + 1 + k].split() for k in range(nr)]
                    i += nr + 1
                    surfs.append((flags, m, [(int(r[0]), float(r[1]) * texrep[0] + texoff[0], float(r[2]) * texrep[1] + texoff[1]) for r in refs]))
                continue
            elif t[0] == 'kids':
                kids = int(t[1]); i += 1
                world = parent_matrix @ Matrix.Translation(loc) @ rot.to_4x4()
                if verts and surfs:
                    polys = [s for s in surfs if (s[0] & 0xF) == 0 and len(s[2]) >= 3]
                    if polys:
                        mesh = bpy.data.meshes.new(name)
                        mesh.from_pydata([world @ v for v in verts], [], [[r[0] for r in s[2]] for s in polys])
                        uv = mesh.uv_layers.new()
                        for p, s in zip(mesh.polygons, polys):
                            for li, r in zip(p.loop_indices, s[2]): uv.data[li].uv = (r[1], r[2])
                        keys = []
                        for p, s in zip(mesh.polygons, polys):
                            mat = blender_mat(s[1], tex)
                            if mat.name not in [m.name for m in mesh.materials]: mesh.materials.append(mat)
                            p.material_index = [m.name for m in mesh.materials].index(mat.name)
                            p.use_smooth = False
                        mesh.validate(); mesh.update()
                        o = bpy.data.objects.new(name, mesh)
                        (collection or bpy.context.scene.collection).objects.link(o)
                        objs.append(o)
                for _ in range(kids): i = read_object(i, world)
                return i
            i += 1
    # AC : y en haut, z vers l'observateur -> Blender : z en haut, y vers l'arrière
    root = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    while i < len(lines):
        if lines[i].startswith('OBJECT'): i = read_object(i, root)
        else: i += 1
    return objs
