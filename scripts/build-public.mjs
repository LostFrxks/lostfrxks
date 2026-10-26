import { cp, copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const files = [
  'index.html', 'secret.html', 'styles.css', 'favicon.svg',
  'app.js', 'intro.mjs', 'animation-clock.mjs', 'ascii-torus.js',
  'speaking-gallery.mjs', 'analytics.mjs', 'analytics.css',
  'analytics-visit.mjs', 'analytics-dashboard.mjs', 'robots.txt', 'sitemap.xml',
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map(file => copyFile(path.join(root, file), path.join(output, file))));
await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
console.log(`Built public website in dist (${(await readdir(output)).length} top-level entries).`);
