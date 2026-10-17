/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const manifest = await readJson('config/motionscaper-raster-runtime.json');
const lock = await readJson('package-lock.json');
const packageJson = await readJson('package.json');
const entry = lock.packages[`node_modules/${manifest.package}`];
if (manifest.schemaVersion !== 1 || manifest.package !== 'canvaskit-wasm' || !/^[a-f0-9]{40}$/u.test(manifest.sourceRevision)
	|| packageJson.dependencies[manifest.package] !== manifest.version || entry.version !== manifest.version
	|| entry.resolved !== manifest.tarball || entry.integrity !== manifest.integrity) throw new Error('Motionscaper CanvasKit provenance differs from its pinned dependency.');
if (lock.packages[`node_modules/${manifest.fontPackage}`].version !== manifest.fontVersion) throw new Error('Motionscaper fallback font version differs from its retained pin.');
const expected = ['loader', 'wasm', 'inter-latin', 'inter-latin-ext', 'inter-greek', 'inter-greek-ext', 'inter-cyrillic', 'inter-cyrillic-ext', 'inter-vietnamese'];
if (JSON.stringify(manifest.assets.map(({ id }) => id)) !== JSON.stringify(expected)) throw new Error('Motionscaper runtime inventory is incomplete.');
for (const asset of manifest.assets) {
	if (typeof asset.source !== 'string' || asset.source.includes('..') || !/^(?:canvaskit-wasm|@fontsource\/inter)\//u.test(asset.source)) throw new Error('Invalid Motionscaper runtime source path.');
	const bytes = await readFile(resolve(root, 'node_modules', asset.source));
	if (bytes.length !== asset.byteLength || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Motionscaper runtime asset ${asset.id} differs from its retained digest.`);
}
console.log(`Verified Motionscaper CanvasKit ${manifest.version} and ${manifest.assets.length} runtime assets.`);
