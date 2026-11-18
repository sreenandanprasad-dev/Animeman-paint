import { copyFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const dest = new URL('dist/licenses/', root);
await mkdir(dest, { recursive: true });
await copyFile(new URL('LICENSE', root), new URL('Apache-2.0.txt', dest));
const licenses = {
  react: 'react.txt', 'react-dom': 'react-dom.txt', scheduler: 'scheduler.txt',
  'lucide-react': 'lucide.txt', three: 'three.txt', '@pixiv/three-vrm': 'three-vrm.txt',
  '@fontsource-variable/inter': 'inter.txt', '@fontsource-variable/outfit': 'outfit.txt',
};
await Promise.all(Object.entries(licenses).map(([pkg, name]) => copyFile(new URL(`node_modules/${pkg}/LICENSE`, root), new URL(name, dest))));
await copyFile(new URL('THIRD_PARTY_NOTICES.md', root), new URL('NOTICES.txt', dest));
