/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { motionReleasePackageNames, pinMotionReleaseFile, validateMotionReleaseReceipt, verifyMotionReleaseReceiptFiles } from '../scripts/lib/motionscaper-release-inventory.ts';
import { downloadMotionReleaseSource, motionReleaseSourcePlan } from '../scripts/lib/motionscaper-release-sources.ts';
import { assembleMotionRelease } from '../scripts/motionscaper-release-assets.ts';
import { qualifyMotionReleaseTarget } from '../scripts/motionscaper-release-target.ts';

test('Motion release inventory requires nine own packages, target evidence and exact source identity', async () => {
	const version = '0.1.0-alpha.1'; const targets = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'] as const;
	assert.equal(targets.flatMap(target => motionReleasePackageNames(target, version)).length, 9);
	assert.deepEqual(motionReleasePackageNames('linux-x64', version), ['Motionscaper-0.1.0-alpha.1-linux-x64.AppImage', 'Motionscaper-0.1.0-alpha.1-linux-x64.deb']);
	const evidence = ['stage-manifest.json', 'native-build-result.json', 'native-payload.json', 'smoke.txt'];
	const files = [...motionReleasePackageNames('linux-x64', version), ...evidence].map(path => ({ path, byteLength: 3, sha256: 'a'.repeat(64) }));
	const receipt = { schemaVersion: 1, productId: 'motionscaper', target: 'linux-x64', applicationVersion: version, sourceRevision: 'b'.repeat(40), files };
	assert.equal(validateMotionReleaseReceipt(receipt).target, 'linux-x64');
	for (const changed of [{ ...receipt, productId: 'framescaper' }, { ...receipt, sourceRevision: 'main' }, { ...receipt, files: files.slice(1) }, { ...receipt, files: [...files, files[0]] }, { ...receipt, applicationVersion: '../bad' }]) {
		assert.throws(() => validateMotionReleaseReceipt(changed));
	}
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-release-inventory-'));
	try {
		await writeFile(join(root, 'smoke.txt'), 'abc'); const pin = await pinMotionReleaseFile(root, 'smoke.txt');
		assert.deepEqual(pin, { path: 'smoke.txt', byteLength: 3, sha256: createHash('sha256').update('abc').digest('hex') });
		await verifyMotionReleaseReceiptFiles(root, [pin]); await writeFile(join(root, 'smoke.txt'), 'def');
		await assert.rejects(verifyMotionReleaseReceiptFiles(root, [pin]), /changed/u);
		await assert.rejects(pinMotionReleaseFile(root, '../smoke.txt'), /path/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Motion corresponding-source plan includes every pinned linked library and Boost source before assembly', async () => {
	const plan = await motionReleaseSourcePlan(join(import.meta.dirname, '..'));
	assert.deepEqual(plan.map(source => source.id), ['ffmpeg', 'boost', 'x264', 'x265', 'libvpx', 'libopus', 'zlib']);
	assert.ok(plan.every(source => source.byteLength > 0 && /^[a-f\d]{64}$/u.test(source.sha256)));
	assert.equal(new Set(plan.map(source => source.path)).size, plan.length);
	assert.ok(plan.reduce((sum, source) => sum + source.byteLength, 0) < 384 * 1024 * 1024);
});

test('Motion source assembly authenticates bytes and removes an incomplete or corrupted download', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-release-source-')); const path = join(root, 'source.tar.gz');
	const source = { id: 'fixture', path: 'source.tar.gz', url: 'https://example.test/source.tar.gz', byteLength: 3, sha256: createHash('sha256').update('abc').digest('hex') };
	const response = (body: string): typeof fetch => async () => { const result = new Response(body); Object.defineProperty(result, 'url', { value: source.url }); return result; };
	try {
		await downloadMotionReleaseSource(source, path, response('abc')); assert.equal(await readFile(path, 'utf8'), 'abc'); await rm(path);
		for (const bytes of ['abd', 'ab', 'abcd']) {
			await assert.rejects(downloadMotionReleaseSource(source, path, response(bytes)), /changed|exceeds/u);
			await assert.rejects(access(path), /ENOENT/u);
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Motion release entry points refuse foreign tags and non-native smoke before creating candidate output', async () => {
	const root = join(import.meta.dirname, '..');
	await assert.rejects(assembleMotionRelease({ root, inputs: '/missing', nativeResults: '/missing', output: '/missing', evidence: '/missing', sourceInputs: '/missing', tag: 'framescaper-v1.0.0-rc.13' }), /Motion preview/u);
	await assert.rejects(qualifyMotionReleaseTarget({ root, target: process.platform === 'win32' ? 'linux-x64' : 'win-x64', nativeResult: '/missing', productRoot: '/missing', output: '/missing' }), /native target/u);
});
