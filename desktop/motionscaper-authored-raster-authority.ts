/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type CanvasKitInit from 'canvaskit-wasm';
import type manifestType from '../config/motionscaper-raster-runtime.json';
import { motionAuthoredFileIdentity, verifyMotionAuthoredFileIdentity } from './motionscaper-authored-identity.ts';

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function record(value: unknown): Record<string, unknown> { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
async function committed(root: string, path: string) {
	const file = await motionAuthoredFileIdentity(join(root, path)), bytes = await readFile(file.path);
	assert.equal(sha(bytes), file.sha256, 'CPU reference source identity changed.');
	const source = await promisify(execFile)('git', ['show', `HEAD:${path}`], { cwd: root, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 10000 });
	assert.ok(bytes.equals(source.stdout), 'CPU reference metadata differs from committed source.');
	return { file, value: JSON.parse(bytes.toString('utf8')) as unknown };
}

/** Same committed dependency/provenance and digest authority as audit-motionscaper-raster-runtime;
 * this qualification consumes only the loader, WASM and the saved Inter Latin font. */
export async function motionAuthoredRasterIdentity(root: string) {
	const [manifestInput, packageInput, lockInput] = await Promise.all(['config/motionscaper-raster-runtime.json', 'package.json', 'package-lock.json'].map(path => committed(root, path)));
	assert.ok(manifestInput && packageInput && lockInput);
	const manifest = record(manifestInput.value) as unknown as typeof manifestType;
	const dependencies = record(record(packageInput.value).dependencies), packages = record(record(lockInput.value).packages);
	const entry = record(packages[`node_modules/${manifest.package}`]);
	assert.ok(manifest.schemaVersion === 1 && manifest.package === 'canvaskit-wasm' && /^[a-f0-9]{40}$/u.test(manifest.sourceRevision));
	assert.equal(dependencies[manifest.package], manifest.version); assert.equal(entry.version, manifest.version);
	assert.equal(entry.resolved, manifest.tarball); assert.equal(entry.integrity, manifest.integrity);
	assert.equal(manifest.fontPackage, '@fontsource/inter'); assert.equal(record(packages[`node_modules/${manifest.fontPackage}`]).version, manifest.fontVersion);
	const require = createRequire(join(root, 'package.json'));
	const packageFile = await motionAuthoredFileIdentity(await realpath(require.resolve('canvaskit-wasm/package.json')));
	const installed = record(JSON.parse(await readFile(packageFile.path, 'utf8')) as unknown);
	assert.equal(installed.version, manifest.version); assert.equal(installed.name, manifest.package);
	const assets = [];
	for (const [id, source] of [['loader', 'canvaskit-wasm/bin/canvaskit.js'], ['wasm', 'canvaskit-wasm/bin/canvaskit.wasm'], ['inter-latin', '@fontsource/inter/files/inter-latin-400-normal.woff2']] as const) {
		const pin = manifest.assets.find(asset => asset.id === id); assert.ok(pin); assert.equal(pin.source, source);
		const file = await motionAuthoredFileIdentity(await realpath(require.resolve(source)));
		assert.equal(file.byteLength, pin.byteLength, 'CPU reference asset digest length differs.'); assert.equal(file.sha256, pin.sha256, 'CPU reference asset digest differs.');
		if (id !== 'inter-latin') assert.equal(file.path, join(dirname(packageFile.path), 'bin', id === 'loader' ? 'canvaskit.js' : 'canvaskit.wasm'));
		assets.push({ id, file });
	}
	assert.equal(await realpath(require.resolve('canvaskit-wasm')), assets[0]!.file.path, 'CanvasKit default export differs from its pinned loader.');
	return { root, packageVersion: manifest.version, sourceRevision: manifest.sourceRevision, metadata: [manifestInput.file, packageInput.file, lockInput.file, packageFile], assets };
}
export type MotionAuthoredRasterAuthority = Awaited<ReturnType<typeof motionAuthoredRasterIdentity>>;
export async function verifyMotionAuthoredRasterIdentity(authority: MotionAuthoredRasterAuthority): Promise<void> {
	for (const file of [...authority.metadata, ...authority.assets.map(asset => asset.file)]) await verifyMotionAuthoredFileIdentity(file);
}
/** No loader evaluation or WASM instantiation precedes the closed source/byte checks. */
export async function loadMotionAuthoredRaster(authority: MotionAuthoredRasterAuthority) {
	await verifyMotionAuthoredRasterIdentity(authority);
	const loader = authority.assets.find(asset => asset.id === 'loader'), wasm = authority.assets.find(asset => asset.id === 'wasm'); assert.ok(loader && wasm);
	const bytes = await readFile(wasm.file.path); assert.equal(bytes.length, wasm.file.byteLength); assert.equal(sha(bytes), wasm.file.sha256);
	const module: unknown = await import(pathToFileURL(loader.file.path).href); const initialize: unknown = record(module).default;
	assert.equal(typeof initialize, 'function');
	const options = { wasmBinary: new Uint8Array(bytes), locateFile: (name: string) => { assert.equal(name, 'canvaskit.wasm'); return wasm.file.path; } };
	return (initialize as typeof CanvasKitInit)(options);
}
