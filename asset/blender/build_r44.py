# Robinson R44 Raven II du projet FlightGear (Emmanuel Baranger « helijah » et contributeurs ; licence GPL-2.0,
# https://sourceforge.net/p/flightgear/fgaddon/HEAD/tree/trunk/Aircraft/R44/) converti pour le jeu (Blender 4.2) :
#   blender --background --python asset/blender/build_r44.py -- <dossier R44 du paquet FlightGear>
# Exporte :
#   asset/r44/r44.glb          extérieur (fuselage, rotors, portes, immatriculation)
#   asset/r44/r44-cockpit.glb  intérieur (tableau, instruments, manche cyclique, collectif, palonniers, sièges)
#   asset/r44/r44-anim.json    animations et zones cliquables, relues par js/R44Model.js (FGAnimator)
#   asset/r44/liveries/*.png   livrées (texture du fuselage, interchangeables)
#
# Un appareil FlightGear est fait de fichiers XML qui placent des modèles AC (offsets) et décrivent leurs animations
# (rotate, translate, spin, select, material, textranslate, pick…), objets désignés par leur nom. Ce script :
# - parcourt ces XML récursivement, charge chaque AC à sa place (positions recalculées, dans le repère avion) ;
# - nomme chaque objet <instance>__<nom AC> (une même pièce, l'interrupteur par exemple, sert plusieurs fois) ;
# - traduit chaque animation en un enregistrement JSON : objets visés (noms finaux), propriété FlightGear, table
#   d'interpolation, centre et axe dans le repère du jeu ; le jeu les rejoue avec ses propres valeurs.
# Repère du jeu (glTF) : x vers la droite, y vers le haut, z vers l'arrière ; FlightGear : x arrière, y droite, z haut.
import json
import math
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET

import bpy
from mathutils import Matrix, Vector

SRC = sys.argv[sys.argv.index('--') + 1]
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'asset', 'r44')
MODELS = os.path.join(SRC, 'Models')

# Sous-modèles ignorés : chariot et personnages de remorquage, fumées et étincelles du démarrage, feux (refaits par le
# jeu, voir AircraftLights), cônes de lumière
SKIP = ('HelicopterPushback', 'Effects/cranking', 'Effects/particles', 'light/')
# Liveries gardées : fichier XML de FlightGear -> nom dans le jeu
LIVERIES = ['default', 'N7183C', 'Orange', 'Green', 'POLICIAPR', 'Helitaxi', 'Lemon', 'N176US']

AC_ROOT = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # AC (y haut) -> FlightGear (z haut)


def clean(name):
    return re.sub(r'[^A-Za-z0-9_-]', '_', name)


used_names = set()


def unique(name):
    base, k = clean(name), 1
    out = base
    while out in used_names:
        k += 1
        out = f'{base}_{k}'
    used_names.add(out)
    return out


# --- Lecteur AC (comme ac_import.py, plus : noms uniques, groupes AC -> objets maillés qu'ils contiennent) -------------
material_cache = {}


def load_ac(path, prefix, transform, collection):
    folder = os.path.dirname(path)
    lines = open(path, encoding='latin-1').read().splitlines()
    i = 1
    mats = []
    names = {}                     # nom AC (objet ou groupe) -> noms Blender des maillages qu'il contient
    created = []

    def blender_mat(m, tex):
        rgb, trans, name = mats[m]
        key = (path, m, tex)
        if key in material_cache:
            return material_cache[key]
        mat = bpy.data.materials.new(f"{name or 'mat'}_{os.path.basename(tex or '')}")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = 0.6
        if trans > 0:
            bsdf.inputs['Alpha'].default_value = 1 - trans
            mat.blend_method = 'BLEND'
        if tex and os.path.exists(os.path.join(folder, tex)):
            node = mat.node_tree.nodes.new('ShaderNodeTexImage')
            node.image = bpy.data.images.load(os.path.join(folder, tex), check_existing=True)
            mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
            alpha = list(node.image.pixels)[3::4] if node.image.channels == 4 else []
            if trans == 0 and alpha and min(alpha) < 0.5:
                mat.node_tree.links.new(node.outputs['Alpha'], bsdf.inputs['Alpha'])
                mat.blend_method = 'CLIP'
        material_cache[key] = mat
        return mat

    while lines[i].startswith('MATERIAL'):
        t = lines[i].split()
        name = lines[i].split('"')[1]
        k = t.index('rgb')
        rgb = tuple(float(x) for x in t[k + 1:k + 4])
        trans = float(t[t.index('trans') + 1])
        mats.append((rgb, trans, name))
        i += 1

    def read_object(i, parent_matrix):
        name, loc, rot, tex, verts, surfs = 'obj', Vector(), Matrix.Identity(3), None, [], []
        texrep, texoff = (1, 1), (0, 0)
        i += 1
        while True:
            t = lines[i].split()
            if not t:
                i += 1
                continue
            if t[0] == 'name':
                name = lines[i].split('"')[1]
            elif t[0] == 'loc':
                loc = Vector([float(x) for x in t[1:4]])
            elif t[0] == 'rot':
                r = [float(x) for x in t[1:10]]
                rot = Matrix((r[0:3], r[3:6], r[6:9])).transposed()
            elif t[0] == 'texture':
                tex = lines[i].split('"')[1]
            elif t[0] == 'texrep':
                texrep = (float(t[1]), float(t[2]))
            elif t[0] == 'texoff':
                texoff = (float(t[1]), float(t[2]))
            elif t[0] == 'numvert':
                n = int(t[1])
                for k in range(n):
                    verts.append(Vector([float(x) for x in lines[i + 1 + k].split()[:3]]))
                i += n
            elif t[0] == 'numsurf':
                n = int(t[1])
                i += 1
                for _ in range(n):
                    flags = int(lines[i].split()[1], 16)
                    i += 1
                    m = 0
                    while not lines[i].startswith('refs'):
                        if lines[i].startswith('mat'):
                            m = int(lines[i].split()[1])
                        i += 1
                    nr = int(lines[i].split()[1])
                    refs = [lines[i + 1 + k].split() for k in range(nr)]
                    i += nr + 1
                    surfs.append((flags, m, [(int(r[0]), float(r[1]) * texrep[0] + texoff[0],
                                              float(r[2]) * texrep[1] + texoff[1]) for r in refs]))
                continue
            elif t[0] == 'kids':
                kids = int(t[1])
                i += 1
                world = parent_matrix @ Matrix.Translation(loc) @ rot.to_4x4()
                mine = []
                if verts and surfs:
                    polys = [s for s in surfs if (s[0] & 0xF) == 0 and len(s[2]) >= 3]
                    if polys:
                        mesh = bpy.data.meshes.new(name)
                        mesh.from_pydata([world @ v for v in verts], [], [[r[0] for r in s[2]] for s in polys])
                        uv = mesh.uv_layers.new()
                        for p, s in zip(mesh.polygons, polys):
                            for li, r in zip(p.loop_indices, s[2]):
                                uv.data[li].uv = (r[1], r[2])
                        for p, s in zip(mesh.polygons, polys):
                            mat = blender_mat(s[1], tex)
                            if mat.name not in [mm.name for mm in mesh.materials]:
                                mesh.materials.append(mat)
                            p.material_index = [mm.name for mm in mesh.materials].index(mat.name)
                            p.use_smooth = False
                        mesh.validate()
                        mesh.update()
                        o = bpy.data.objects.new(unique(prefix + name), mesh)
                        collection.objects.link(o)
                        created.append(o)
                        mine.append(o.name)
                for _ in range(kids):
                    i, sub = read_object(i, world)
                    mine += sub
                names.setdefault(name, []).extend(mine)
                return i, mine
            i += 1

    root = transform @ AC_ROOT
    while i < len(lines):
        if lines[i].startswith('OBJECT'):
            i, _ = read_object(i, root)
        else:
            i += 1
    return created, names


# --- Animations --------------------------------------------------------------------------------------------------
anims = []
picks = []
counter = [0]


def num(el, tag, default=0.0):
    v = el.findtext(tag) if el is not None else None
    try:
        return float(v) if v is not None and v.strip() != '' else default
    except ValueError:
        return default


def text(el, tag):  # (texte d'une balise, sans espaces ; None si absente)
    v = el.findtext(tag) if el is not None else None
    return v.strip() if v is not None else None


def offsets_matrix(el):
    o = el.find('offsets')
    if o is None:
        return Matrix.Identity(4)
    rot = (Matrix.Rotation(math.radians(num(o, 'heading-deg')), 4, 'Z')
           @ Matrix.Rotation(math.radians(num(o, 'roll-deg')), 4, 'X')
           @ Matrix.Rotation(math.radians(num(o, 'pitch-deg')), 4, 'Y'))
    return Matrix.Translation((num(o, 'x-m'), num(o, 'y-m'), num(o, 'z-m'))) @ rot


def game_point(world, v):
    w = world @ Vector(v)
    return [round(w.y, 5), round(w.z, 5), round(w.x, 5)]


def game_dir(world, v):
    w = world.to_3x3() @ Vector(v)
    if w.length > 0:
        w.normalize()
    return [round(w.y, 6), round(w.z, 6), round(w.x, 6)]


def condition(el):
    """Condition FlightGear -> arbre JSON ({and: [...]}, {not: x}, {op, a, b}, {property})."""
    if el is None:
        return None
    parts = [c for c in el if c.tag not in ('description',)]
    out = [cond_node(c) for c in parts]
    out = [c for c in out if c is not None]
    if not out:
        return None
    return out[0] if len(out) == 1 else {'and': out}


def cond_node(c):
    tag = c.tag
    if tag == 'property':
        return {'property': (c.text or "").strip()}
    if tag in ('and', 'or'):
        return {tag: [x for x in (cond_node(k) for k in c) if x is not None]}
    if tag == 'not':
        kids = [x for x in (cond_node(k) for k in c) if x is not None]
        return {'not': kids[0] if len(kids) == 1 else {'and': kids}}
    if tag in ('equals', 'not-equals', 'less-than', 'greater-than', 'less-than-equals', 'greater-than-equals'):
        props = [(p.text or "").strip() for p in c.findall('property') if p.text]
        value = c.findtext('value')
        operand = {'value': parse_value(value)} if value is not None else {'property': props[1] if len(props) > 1 else None}
        return {'op': tag, 'a': props[0] if props else None, 'b': operand}
    return None


def parse_value(v):
    v = v.strip()
    if v in ('true', 'false'):
        return v == 'true'
    try:
        return float(v)
    except ValueError:
        return v


def interpolation(a):
    el = a.find('interpolation')
    if el is None:
        return None
    return [[num(e, 'ind'), num(e, 'dep')] for e in el.findall('entry')]


def axis_and_center(a, world):
    ax = a.find('axis')
    ce = a.find('center')
    if ax is not None and ax.find('x1-m') is not None:
        p1 = Vector((num(ax, 'x1-m'), num(ax, 'y1-m'), num(ax, 'z1-m')))
        p2 = Vector((num(ax, 'x2-m'), num(ax, 'y2-m'), num(ax, 'z2-m')))
        return game_dir(world, p2 - p1), game_point(world, p1)
    axis = (num(ax, 'x'), num(ax, 'y'), num(ax, 'z')) if ax is not None else (0, 0, 1)
    center = (num(ce, 'x-m'), num(ce, 'y-m'), num(ce, 'z-m')) if ce is not None else (0, 0, 0)
    return game_dir(world, axis), game_point(world, center)


def bindings(action):
    out = []
    for b in action.findall('binding'):
        rec = {'command': text(b, 'command'), 'property': text(b, 'property')}
        for key in ('value', 'step', 'min', 'max', 'factor'):
            if b.find(key) is not None:
                rec[key] = parse_value(b.findtext(key) or '0')
        if b.find('wrap') is not None:
            rec['wrap'] = text(b, 'wrap') == 'true'
        props = [(p.text or "").strip() for p in b.findall("property") if p.text]
        if len(props) > 1:
            rec['properties'] = props
        if rec['command'] == 'nasal':
            rec['script'] = (b.findtext('script') or '').strip()[:400]
        out.append(rec)
    return out


def parse_animation(a, kind, world):
    rec = {'type': kind}
    prop = text(a, 'property')
    if prop:
        rec['property'] = prop
    for key in ('factor', 'offset-deg', 'offset-m', 'min-deg', 'max-deg', 'min-m', 'max-m', 'step', 'scroll', 'bias',
                'min', 'max'):
        if a.find(key) is not None:
            rec[key] = num(a, key)
    table = interpolation(a)
    if table:
        rec['interpolation'] = table
    cond = condition(a.find('condition'))
    if cond:
        rec['condition'] = cond
    if kind in ('rotate', 'spin', 'knob'):
        rec['axis'], rec['center'] = axis_and_center(a, world)
    elif kind in ('translate', 'slider'):
        ax, _ = axis_and_center(a, world)
        rec['axis'] = ax
    elif kind == 'textranslate':
        ax = a.find('axis')
        rec['axis'] = [num(ax, 'x'), num(ax, 'y')]
    elif kind == 'material':
        em = a.find('emission')
        if em is not None:
            rec['emission'] = [num(em, 'red'), num(em, 'green'), num(em, 'blue')]
            if text(em, 'factor-prop'):
                rec['emission-factor-prop'] = text(em, 'factor-prop')
        if text(a, 'texture'):
            rec['texture'] = text(a, 'texture')
    elif kind == 'scale':
        rec['scale'] = [num(a, 'x-factor', 0), num(a, 'y-factor', 0), num(a, 'z-factor', 0)]
    elif kind == 'select':
        pass
    else:
        return None
    # Commandes à la souris (pick, knob, slider) : boutons, répétition, liaisons
    actions = []
    for act in a.findall('action'):
        actions.append({'buttons': [int(b.text) for b in act.findall('button')], 'repeatable': text(act, 'repeatable') == 'true',
                        'interval': num(act, 'interval-sec', 0), 'bindings': bindings(act)})
    for key in ('increase', 'decrease'):
        el = a.find(f'action/{key}')
        if el is not None:
            rec[key] = bindings(el)
    if actions:
        rec['actions'] = actions
    return rec


def process(xml_path, world, collection, depth=0):
    """Charge un XML FlightGear (son AC, ses sous-modèles, ses animations) ; renvoie les maillages créés."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    # Alias vers les paramètres du fichier (<property alias="../../params/x"/> -> texte de <params><x>) : radios
    for el in root.iter():
        alias = el.get('alias')
        if alias and 'params/' in alias:
            el.text = root.findtext('params/' + alias.split('params/', 1)[1]) or ''
    base = os.path.dirname(xml_path)
    inst = f'm{counter[0]}'
    counter[0] += 1
    ns = {}
    meshes = []
    path = text(root, 'path')
    if path and path.endswith('.ac'):
        objs, names = load_ac(resolve(path, base), inst + '__', world, collection)
        meshes += [o.name for o in objs]
        ns.update(names)
    for m in root.findall('model'):
        sub_path = text(m, 'path')
        if not sub_path or any(s in sub_path.replace('\\', '/') for s in SKIP):
            continue
        full = resolve(sub_path, base)
        if not os.path.exists(full):
            print('ABSENT', full)
            continue
        mw = world @ offsets_matrix(m)
        # Intérieur (tableau, instruments, sièges, pilote) : dans sa collection, exporté à part (r44-cockpit.glb)
        target = INTERIOR if sub_path.replace('\\', '/').endswith('Interior/interior.xml') else collection
        if full.endswith('.xml'):
            sub = process(full, mw, target, depth + 1)
        else:
            objs, names = load_ac(full, f'm{counter[0]}__', mw, collection)
            counter[0] += 1
            sub = [o.name for o in objs]
        name = text(m, 'name')
        if name:
            ns[name] = sub
        meshes += sub
    for a in root.findall('animation'):
        targets = []
        for t in a.findall('object-name'):
            targets += ns.get((t.text or '').strip(), [])
        kind = text(a, 'type') or ''
        gname = text(a, 'name')
        if gname:
            ns[gname] = targets
        if not kind or kind == 'none' or not targets:
            continue
        where = os.path.relpath(xml_path, MODELS).replace('\\', '/')
        if kind == 'pick':
            acts = []
            for act in a.findall('action'):
                acts.append({'buttons': [int(b.text) for b in act.findall('button')],
                             'repeatable': text(act, 'repeatable') == 'true',
                             'interval': num(act, 'interval-sec', 0), 'bindings': bindings(act)})
            picks.append({'objects': targets, 'actions': acts, 'file': where})
            continue
        rec = parse_animation(a, kind, world)
        if rec is None:
            continue
        rec['objects'] = targets
        rec['file'] = where
        # Bouton ou curseur (knob, slider) : aussi une zone cliquable
        if 'actions' in rec or 'increase' in rec:
            picks.append({'objects': targets, 'actions': rec.pop('actions', []), 'increase': rec.pop('increase', None),
                          'decrease': rec.pop('decrease', None), 'file': where})
        anims.append(rec)
    return meshes


def resolve(path, base):
    path = path.replace('\\', '/')
    if path.startswith('Aircraft/R44/'):
        return os.path.join(SRC, path[len('Aircraft/R44/'):])
    return os.path.normpath(os.path.join(base, path))


def smooth(objs, degrees=40):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(degrees), keep_sharp_edges=True)


def to_game_frame(objs):
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


# --- Construction -------------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
os.makedirs(os.path.join(OUT, 'liveries'), exist_ok=True)
scene = bpy.context.scene
EXTERIOR = bpy.data.collections.new('exterieur')
INTERIOR = bpy.data.collections.new('interieur')
scene.collection.children.link(EXTERIOR)
scene.collection.children.link(INTERIOR)
process(os.path.join(MODELS, 'r44.xml'), Matrix.Identity(4), EXTERIOR)

summary = {}
for kind in [a['type'] for a in anims]:
    summary[kind] = summary.get(kind, 0) + 1
print('ANIMATIONS', summary, 'ZONES CLIQUABLES', len(picks))

parts = {}
for collection, file in ((EXTERIOR, 'r44.glb'), (INTERIOR, 'r44-cockpit.glb')):
    objs = [o for o in collection.objects if o.type == 'MESH' and len(o.data.polygons)]
    smooth(objs, 40)
    to_game_frame(objs)
    print(file, len(objs), 'objets', sum(len(o.data.polygons) for o in objs), 'faces')
    parts[file] = [o.name for o in objs]
    for o in collection.objects:
        if o not in objs:
            o.hide_set(True)
    export(os.path.join(OUT, file), objs)

# Versions légères pour téléphones et tablettes (comme le F-15) : textures réduites à 1024 px au plus, même géométrie
for image in bpy.data.images:
    w, h = image.size
    print('IMAGE', image.name, w, h)
    if max(w, h) > 1024:
        k = 1024 / max(w, h)
        image.scale(max(1, round(w * k)), max(1, round(h * k)))
for file, names in [('r44.glb', parts['r44.glb'])]:   # (cockpit : textures déjà de 1024 px au plus, rien à réduire)
    export(os.path.join(OUT, file.replace('.glb', '-mobile.glb')), [bpy.data.objects[n] for n in names])

json.dump({'source': 'FlightGear R44 (GPL-2.0)', 'animations': anims, 'picks': picks}, open(os.path.join(OUT, 'r44-anim.json'), 'w'),
          separators=(',', ':'))
print('JSON', os.path.getsize(os.path.join(OUT, 'r44-anim.json')) // 1024, 'KB')

def save_livery(path, name):
    """Texture de livrée enregistrée en JPEG (opaque : la peinture du fuselage) : 2048 px, et 1024 px pour les
    téléphones et tablettes (liveries/mobile/)."""
    os.makedirs(os.path.join(OUT, 'liveries', 'mobile'), exist_ok=True)
    settings = bpy.context.scene.render.image_settings
    settings.file_format = 'JPEG'
    settings.color_mode = 'RGB'
    settings.quality = 88
    for size, folder in ((2048, ''), (1024, 'mobile')):
        image = bpy.data.images.load(path)
        w, h = image.size
        if max(w, h) > size:
            k = size / max(w, h)
            image.scale(max(1, round(w * k)), max(1, round(h * k)))
        out = os.path.join(OUT, 'liveries', folder, name + '.jpg')
        image.save_render(out, scene=bpy.context.scene)
        print('LIVREE', out, os.path.getsize(out) // 1024, 'KB', image.size[:])
        bpy.data.images.remove(image)


# Livrées : texture du fuselage de chaque livrée (Models/Liveries/<nom>.xml -> sim/model/livery/texture)
for name in LIVERIES:
    xml = os.path.join(MODELS, 'Liveries', name + '.xml')
    if not os.path.exists(xml):
        print('LIVREE ABSENTE', name)
        continue
    tex = ET.parse(xml).getroot().findtext('sim/model/livery/texture')
    if not tex:
        continue
    tex = tex.strip()
    for candidate in (os.path.join(MODELS, tex), os.path.join(MODELS, 'Liveries', '2048x2048', tex),
                      os.path.join(MODELS, 'Liveries', tex)):
        if os.path.exists(candidate):
            save_livery(candidate, name.lower())
            break
    else:
        print('TEXTURE ABSENTE', name, tex)
print('OK')
