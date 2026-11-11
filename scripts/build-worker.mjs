import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'web-dist');
const assets = {};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};
async function walk(folder) {
  for (const item of await fs.readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, item.name);
    if (item.isDirectory()) await walk(full);
    else if (!item.name.startsWith('_')) {
      const relative = '/' + path.relative(directory, full).replaceAll('\\', '/');
      assets[relative] = {
        body: (await fs.readFile(full)).toString('base64'),
        type: types[path.extname(item.name)] || 'application/octet-stream',
      };
    }
  }
}
await walk(directory);
if (!assets['/index.html']) throw new Error('Run npm run build first');
const headers = {};
for (const line of (await fs.readFile(path.join(directory, '_headers'), 'utf8')).split('\n')) {
  const match = line.match(/^\s+([^:]+):\s*(.*)$/);
  if (match) headers[match[1].trim()] = match[2].trim();
}
const outfile = path.resolve(root, process.argv[2] || '.standalone/sova-worker.js');
await fs.mkdir(path.dirname(outfile), { recursive: true });
await build({
  stdin: {
    sourcefile: 'standalone-worker.ts',
    resolveDir: root,
    contents: `
import {handleRequest} from './server/gateway';
const assets=${JSON.stringify(assets)};
const headers=${JSON.stringify(headers)};
export default { async fetch(request,env) {
  const path=new URL(request.url).pathname;
  if(path.startsWith('/api/'))return handleRequest(request,env);
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers});
  const asset=assets[path==='/'?'/index.html':path];
  if(!asset)return new Response('Not found',{status:404,headers});
  return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{headers:{...headers,'Content-Type':asset.type,'Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-store'}});
}};`,
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile,
});
console.log(`Standalone Worker built (${Object.keys(assets).length} embedded assets): ${outfile}`);
