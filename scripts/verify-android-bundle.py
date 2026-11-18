#!/usr/bin/env python3
"""Check the release's packaged web payload and native entry/dependency classes."""
import re
import struct
import sys
import zipfile
from pathlib import Path


def dex_classes(data):
    def u32(offset): return struct.unpack_from('<I', data, offset)[0]
    index = lambda i: u32(u32(60)+4*i)
    for n in range(u32(96)):
        class_index = u32(u32(100)+32*n)
        string_index = u32(u32(68)+4*class_index)
        start = index(string_index)
        while data[start] >= 128: start += 1  # skip the length's ULEB128
        start += 1
        yield data[start:data.index(0, start)].decode('utf-8', 'replace')


apk, web = (Path(s) for s in sys.argv[1:])
with zipfile.ZipFile(apk) as z:
    if z.testzip(): raise SystemExit('APK ZIP CRC check failed')
    paths = set(z.namelist())
    classes = {cls for p in paths if re.fullmatch(r'classes\d*\.dex', p) for cls in dex_classes(z.read(p))}
    expected = {
        'Lstudio/koma/app/MainActivity;', 'Lstudio/koma/app/SharedExportProvider;',
        'Landroidx/webkit/WebViewAssetLoader;', 'Landroidx/core/util/Pair;',
        'Landroidx/activity/result/contract/ActivityResultContracts$PickVisualMedia;',
        'Landroidx/activity/result/contract/ActivityResultContracts$OpenDocument;',
        'Lkotlin/jvm/internal/Intrinsics;',
    }
    if expected - classes: raise SystemExit(f'Missing native class definitions: {expected-classes}')
    manifest = z.read('AndroidManifest.xml')
    for perm in ('CAMERA','INTERNET','READ_EXTERNAL_STORAGE','WRITE_EXTERNAL_STORAGE','READ_MEDIA_IMAGES'):
        name = 'android.permission.' + perm
        if any(name.encode(encoding) in manifest for encoding in ('utf-16-le','utf-8')):
            raise SystemExit('Unexpected manifest permission: ' + perm)
    checked = 0
    for f in web.rglob('*'):
        if not f.is_file(): continue
        name = 'assets/' + f.relative_to(web).as_posix()
        if name not in paths or z.read(name) != f.read_bytes(): raise SystemExit('Missing or stale bundled asset: ' + name)
        checked += 1
    print(f'APK payload verified: {checked} web assets, AndroidX picker and asset loader classes, no network/camera/storage permissions.')
