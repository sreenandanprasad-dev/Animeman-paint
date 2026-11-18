import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const input = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const output = new URL('../public/vision/wasm/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of await readdir(input)) {
  const src = new URL(name, input), dest = new URL(name, output);
  if (name.endsWith('.js')) {
    const bytes = await readFile(src, 'utf8');
    // TFLite sends this success message to stderr. Preserve genuine errors and warnings.
    const channel = 'Module["printErr"]||console.error.bind(console)';
    const severity = 'Module["printErr"]||((...args)=>(String(args[0]).startsWith("INFO: Created TensorFlow Lite XNNPACK delegate")?console.info:console.error)(...args))';
    if (!bytes.includes(channel)) throw new Error(`Check MediaPipe diagnostics hook in ${name}`);
    await writeFile(dest, bytes.replace(channel, severity));
  } else await copyFile(src, dest);
}
await Promise.all(['pose_landmarker_lite.task', 'hand_landmarker.task'].map(file => access(new URL(`../public/vision/${file}`, import.meta.url))));
