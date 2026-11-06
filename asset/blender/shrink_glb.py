# Copie allégée d'un GLB pour les appareils à peu de mémoire (iPhone, iPad) : chaque texture embarquée plus grande que
# MAX pixels de côté est réduite (et réencodée : JPEG reste JPEG, PNG reste PNG) ; la géométrie ne change pas.
#   python asset/blender/shrink_glb.py entrée.glb sortie.glb MAX
# Sur iOS, Safari ferme l'onglet sans prévenir quand la page dépasse sa mémoire : la photo du cockpit du F-15 en
# 4096 × 4096 occupait à elle seule ~85 Mo de mémoire graphique (et autant décodée), de quoi faire planter un iPhone.
import io
import json
import struct
import sys

from PIL import Image

src, dst, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
data = open(src, 'rb').read()
json_len = struct.unpack('<I', data[12:16])[0]
gltf = json.loads(data[20:20 + json_len])
bin_start = 20 + json_len + 8
binary = data[bin_start:]

views = gltf['bufferViews']
chunks = [binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]
for image in gltf.get('images', []):
    i = image['bufferView']
    picture = Image.open(io.BytesIO(chunks[i]))
    w, h = picture.size
    if max(w, h) <= limit:
        continue
    k = limit / max(w, h)
    picture = picture.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    out = io.BytesIO()
    if image['mimeType'] == 'image/jpeg':
        picture.convert('RGB').save(out, 'JPEG', quality=85, optimize=True)
    else:
        picture.save(out, 'PNG', optimize=True)
    chunks[i] = out.getvalue()
    print(f"{image.get('name')}: {w}x{h} -> {picture.size[0]}x{picture.size[1]}")

# Nouveau tampon : vues remises bout à bout (alignées sur 4 octets)
new_bin = bytearray()
for view, chunk in zip(views, chunks):
    new_bin += b'\0' * (-len(new_bin) % 4)
    view['byteOffset'] = len(new_bin)
    view['byteLength'] = len(chunk)
    new_bin += chunk
new_bin += b'\0' * (-len(new_bin) % 4)
gltf['buffers'][0]['byteLength'] = len(new_bin)

text = json.dumps(gltf, separators=(',', ':')).encode()
text += b' ' * (-len(text) % 4)
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(new_bin))
out += struct.pack('<II', len(text), 0x4E4F534A) + text
out += struct.pack('<II', len(new_bin), 0x004E4942) + bytes(new_bin)
open(dst, 'wb').write(out)
print(dst, len(data) // 1024, '->', len(out) // 1024, 'KB')
