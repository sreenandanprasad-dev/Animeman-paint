export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const mid = (a, b) => ({ x: (a.x+b.x)/2, y: (a.y+b.y)/2, p: (a.p+b.p)/2, t: (a.t+b.t)/2 });
export const splitRGBA = hex => (hex.match(/\w\w/g) ?? ['00','00','00']).slice(0,3).map(c => parseInt(c, 16));
export const toHex = rgb => '#' + Array.from(rgb).slice(0, 3).map(i => Math.round(i).toString(16).padStart(2, '0')).join('');

export function scanlineMask(rgba, width, height, x, y, { tolerance = 20, allow, expand = true } = {}) {
  const result = new Uint8Array(width*height);
  if (x < 0 || x >= width || y < 0 || y >= height) return result;
  const start = y*width+x, j=start*4;
  const r=rgba[j], g=rgba[j+1], b=rgba[j+2], alpha=rgba[j+3];
  const match = i => {
    if (result[i] || (allow && !allow(i))) return false;
    const k=i*4, a=rgba[k+3];
    if (Math.abs(a-alpha) > tolerance) return false;
    if (!a && !alpha) return true;
    return Math.abs(rgba[k]-r) <= tolerance && Math.abs(rgba[k+1]-g) <= tolerance && Math.abs(rgba[k+2]-b) <= tolerance;
  };
  const stack = [start];
  while (stack.length) {
    const p = stack.pop();
    if (!match(p)) continue;
    const row = p - (p%width);
    let left = p, right = p;
    while (left > row && match(left-1)) left--;
    while (right < row+width-1 && match(right+1)) right++;
    result.fill(255, left, right+1);
    for (const offset of [-width, width]) {
      if (left+offset < 0 || left+offset >= result.length) continue;
      let span = false;
      for (let i = left+offset; i <= right+offset; i++) {
        const eligible = match(i);
        if (eligible && !span) stack.push(i);
        span = eligible;
      }
    }
  }
  if (!expand) return result;
  // Tag only neighbours of the original filled region; do not grow from a tagged pixel.
  for (let i = 0; i < result.length; i++) {
    if (result[i] !== 255) continue;
    const x = i % width;
    if (x > 0 && !result[i-1] && (!allow || allow(i-1))) result[i-1] = 1;
    if (x < width-1 && !result[i+1] && (!allow || allow(i+1))) result[i+1] = 1;
    if (i >= width && !result[i-width] && (!allow || allow(i-width))) result[i-width] = 1;
    if (i < result.length-width && !result[i+width] && (!allow || allow(i+width))) result[i+width] = 1;
  }
  for (let i=0;i<result.length;i++) if (result[i]===1) result[i]=255;
  return result;
}

export function hsvToRgb(h, s, v) {
  const k = n => (n + ((h % 360) + 360)%360 / 60) % 6;
  const f = n => v-v*s*Math.max(0, Math.min(k(n), 4-k(n), 1));
  return [f(5)*255, f(3)*255, f(1)*255];
}
export function rgbToHsv([r,g,b]) {
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), delta=max-min;
  const h=!delta?0:max===r?((g-b)/delta+6)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
  return [h*60,max?delta/max:0,max];
}

export function brushRadius(brush, p, speed, size, progress = 1) {
  if (brush === 'Cel Block' || brush === 'Cel Soft' || brush === 'Rim Glow' || brush === 'Eraser') return size/2;
  if (brush === 'Cel Wedge') return size/2 * (0.22 + 0.78*clamp(1-speed*.38,.07,1)) * (0.57+.43*clamp(progress/20,0,1));
  if (brush === 'Maru') return size/2 * (.23+.54*p);
  if (brush === 'Pencil') return size/2 * (.5+.5*p);
  return size/2 * (.22+.78*p) * clamp(1-speed*.115,.78,1);
}
