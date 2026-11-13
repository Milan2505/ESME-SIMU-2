# Allège un GLB : chaque texture PNG qu'aucun matériau transparent (alphaMode MASK/BLEND) n'utilise est réencodée en
# JPEG (son canal alpha, inutilisé, est perdu) ; la géométrie ne change pas.
#   python asset/blender/jpeg_glb.py entrée.glb sortie.glb [qualité=85]
# (Les textures du porte-avions de FlightGear sont des PNG RGBA 2048 sans transparence : ~18 Mo -> quelques Mo)
import io
import json
import struct
import sys

from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
quality = int(sys.argv[3]) if len(sys.argv) > 3 else 85
data = open(src, 'rb').read()
json_len = struct.unpack('<I', data[12:16])[0]
gltf = json.loads(data[20:20 + json_len])
binary = data[20 + json_len + 8:]

views = gltf['bufferViews']
chunks = [binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]

# Images lues par un matériau transparent (alpha utilisé) : gardées en PNG
keep = set()
for material in gltf.get('materials', []):
    if material.get('alphaMode', 'OPAQUE') == 'OPAQUE':
        continue
    tex = material.get('pbrMetallicRoughness', {}).get('baseColorTexture')
    if tex is not None:
        keep.add(gltf['textures'][tex['index']]['source'])

for index, image in enumerate(gltf.get('images', [])):
    if image.get('mimeType') != 'image/png' or index in keep:
        continue
    picture = Image.open(io.BytesIO(chunks[image['bufferView']]))
    out = io.BytesIO()
    picture.convert('RGB').save(out, 'JPEG', quality=quality, optimize=True)
    chunks[image['bufferView']] = out.getvalue()
    image['mimeType'] = 'image/jpeg'
    print('JPEG', image.get('name'), picture.size, len(out.getvalue()) // 1024, 'KB')

# Tampon binaire reconstruit (chaque vue alignée sur 4 octets)
blob = bytearray()
for view, chunk in zip(views, chunks):
    while len(blob) % 4:
        blob.append(0)
    view['byteOffset'] = len(blob)
    view['byteLength'] = len(chunk)
    blob += chunk
while len(blob) % 4:
    blob.append(0)
gltf['buffers'][0]['byteLength'] = len(blob)
text = json.dumps(gltf, separators=(',', ':')).encode()
text += b' ' * (-len(text) % 4)
total = 12 + 8 + len(text) + 8 + len(blob)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(text), 0x4E4F534A) + text)
    f.write(struct.pack('<II', len(blob), 0x004E4942) + blob)
print(dst, total // 1024, 'KB')
