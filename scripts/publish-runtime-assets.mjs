#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const bucket = process.env.SOUNDSCAPER_R2_BUCKET || 'soundscaper-assets';
const version = '0.12.10';
const assets = [
	['ffmpeg-core.js', 'text/javascript; charset=utf-8'],
	['ffmpeg-core.wasm', 'application/wasm'],
];

for (const [name, contentType] of assets) {
	const file = resolve(`node_modules/@ffmpeg/core/dist/esm/${name}`);
	const key = `runtime/ffmpeg/${version}/${name}`;
	const result = spawnSync('npx', [
		'--yes', 'wrangler@4', 'r2', 'object', 'put', `${bucket}/${key}`,
		'--file', file,
		'--content-type', contentType,
		'--cache-control', 'public, max-age=31536000, immutable',
		'--remote',
	], { stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status || 1);
}

const cors = spawnSync('npx', [
	'--yes', 'wrangler@4', 'r2', 'bucket', 'cors', 'set', bucket,
	'--file', resolve('r2-cors.json'),
], { stdio: 'inherit' });
if (cors.status !== 0) process.exit(cors.status || 1);
