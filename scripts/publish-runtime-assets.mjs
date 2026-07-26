#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bucket = process.env.SOUNDSCAPER_R2_BUCKET || 'soundscaper-assets';
const version = '0.12.10';
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const assets = [
	['ffmpeg-core.js', 'text/javascript; charset=utf-8'],
	['ffmpeg-core.wasm', 'application/wasm'],
];

for (const [name, contentType] of assets) {
	const file = resolve(root, `node_modules/@ffmpeg/core/dist/esm/${name}`);
	const key = `runtime/ffmpeg/${version}/${name}`;
	const result = spawnSync(process.execPath, [
		wrangler, 'r2', 'object', 'put', `${bucket}/${key}`,
		'--file', file,
		'--content-type', contentType,
		'--cache-control', 'public, max-age=31536000, immutable',
		'--remote',
	], { cwd: root, stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status || 1);
}

const cors = spawnSync(process.execPath, [
	wrangler, 'r2', 'bucket', 'cors', 'set', bucket,
	'--file', resolve(root, 'r2-cors.json'),
], { cwd: root, stdio: 'inherit' });
if (cors.status !== 0) process.exit(cors.status || 1);
