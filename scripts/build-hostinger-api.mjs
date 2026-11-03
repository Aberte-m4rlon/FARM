import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = join(projectRoot, 'api');
const outputDirectory = join(projectRoot, 'hostinger-api');

async function findRoutes(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findRoutes(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

const routes = await findRoutes(apiRoot);
if (!routes.length) throw new Error('No API route handlers were found.');
const entryPoints = Object.fromEntries(routes.map((route) => {
  const name = relative(apiRoot, route).replace(/\\/g, '/').replace(/\.ts$/, '');
  const input = `./${relative(projectRoot, route).split(sep).join('/')}`;
  return [name, input];
}));

await build({
  absWorkingDir: projectRoot,
  entryPoints,
  outdir: relative(projectRoot, outputDirectory).split(sep).join('/'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  logLevel: 'info',
});

console.log(`Built ${routes.length} Hostinger API routes into ${relative(projectRoot, outputDirectory).split(sep).join('/')}.`);
