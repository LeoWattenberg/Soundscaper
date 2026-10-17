/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadMotionAuthoredRaster, motionAuthoredRasterIdentity, verifyMotionAuthoredRasterIdentity } from '../desktop/motionscaper-authored-raster-authority.ts';
import type manifestType from '../config/motionscaper-raster-runtime.json';

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'motion-authored-raster-'));
	const manifest = JSON.parse(await readFile(resolve('config/motionscaper-raster-runtime.json'), 'utf8')) as typeof manifestType;
	const put = async (path: string, value: string) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), value); };
	for (const asset of manifest.assets.filter(value => ['loader', 'wasm', 'inter-latin'].includes(value.id))) {
		const bytes = asset.id === 'loader' ? 'throw new Error("fixture loader must never execute");' : `synthetic-${asset.id}`;
		asset.byteLength = Buffer.byteLength(bytes); asset.sha256 = createHash('sha256').update(bytes).digest('hex'); await put(`node_modules/${asset.source}`, bytes);
	}
	await put('config/motionscaper-raster-runtime.json', JSON.stringify(manifest));
	await put('package.json', JSON.stringify({ dependencies: { [manifest.package]: manifest.version } }));
	await put('package-lock.json', JSON.stringify({ packages: { [`node_modules/${manifest.package}`]: { version: manifest.version, resolved: manifest.tarball, integrity: manifest.integrity }, [`node_modules/${manifest.fontPackage}`]: { version: manifest.fontVersion } } }));
	await put('node_modules/canvaskit-wasm/package.json', JSON.stringify({ name: manifest.package, version: manifest.version, main: 'bin/canvaskit.js' }));
	await put('node_modules/@fontsource/inter/package.json', JSON.stringify({ name: manifest.fontPackage, version: manifest.fontVersion }));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
	git('init', '-q'); git('add', 'config', 'package.json', 'package-lock.json');
	git('-c', 'user.name=Motion fixture', '-c', 'user.email=motion@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic committed authority');
	return { root, put };
}

test('Motionscaper authored CPU authority binds resolved loader/WASM/font bytes without executing the loader', async () => {
	const { root, put } = await fixture();
	try {
		const authority = await motionAuthoredRasterIdentity(root); await verifyMotionAuthoredRasterIdentity(authority);
		assert.deepEqual(authority.assets.map(asset => asset.id), ['loader', 'wasm', 'inter-latin']);
		for (const asset of authority.assets) assert.ok(asset.file.path.startsWith(`${root}/node_modules/`));
		await put('node_modules/canvaskit-wasm/bin/canvaskit.wasm', 'changed wasm');
		await assert.rejects(verifyMotionAuthoredRasterIdentity(authority), /identity/u);
		await assert.rejects(loadMotionAuthoredRaster(authority), /identity/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

for (const path of ['node_modules/canvaskit-wasm/bin/canvaskit.js', 'node_modules/canvaskit-wasm/bin/canvaskit.wasm', 'config/motionscaper-raster-runtime.json', 'package-lock.json']) {
	test(`Motionscaper authored CPU admission refuses changed ${path} before importing code`, async () => {
		const { root, put } = await fixture();
		try { await put(path, '{}'); await assert.rejects(motionAuthoredRasterIdentity(root), /identity|committed|digest/u); }
		finally { await rm(root, { recursive: true, force: true }); }
	});
}
