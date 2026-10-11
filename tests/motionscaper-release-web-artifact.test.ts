/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureMotionReleaseWebArtifact, verifyMotionReleaseWebArtifact } from '../scripts/lib/motionscaper-release-web-artifact.ts';
import type { MotionReleaseIdentity } from '../scripts/lib/motionscaper-release-policy.ts';

const identity: MotionReleaseIdentity = { productId: 'motionscaper', tag: 'motionscaper-v1.0.0', channel: 'stable', version: '1.0.0', sourceRevision: 'a'.repeat(40) };
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-release-web-')); const directory = join(root, 'dist'); const evidence = join(root, 'web-artifact.json');
	await mkdir(join(directory, 'en'), { recursive: true }); await mkdir(join(directory, 'docs'));
	await writeFile(join(directory, 'en/index.html'), '<html data-product="motionscaper"><link rel="canonical" href="https://motionscaper.org/en/"></html>');
	await writeFile(join(directory, 'docs/index.html'), '<html><link rel="canonical" href="https://motionscaper.org/docs/"></html>');
	await writeFile(join(directory, 'manifest-motionscaper.webmanifest'), '{}');
	await writeFile(join(directory, 'offline-shell.json'), JSON.stringify({ schemaVersion: 2, workers: { motionscaper: { scope: '/', scriptUrl: '/service-worker.js' } } }));
	await writeFile(join(directory, 'service-worker.js'), '// retained own worker');
	return { root, directory, evidence, identity };
}
test('Motion production artifact binds every browser and handbook byte to independent source, tag, version and origin', async () => {
	const f = await fixture();
	try {
		const captured = await captureMotionReleaseWebArtifact(f);
		assert.equal(captured.files.length, 5);
		assert.ok(captured.files.some(file => file.path === 'docs/index.html'));
		assert.deepEqual(await verifyMotionReleaseWebArtifact(f), captured);
		for (const changed of [{ ...identity, sourceRevision: 'b'.repeat(40) }, { ...identity, version: '1.0.1', tag: 'motionscaper-v1.0.1' }, { ...identity, channel: 'candidate' as const }]) {
			await assert.rejects(verifyMotionReleaseWebArtifact({ ...f, identity: changed }), /identity|version|channel/u);
		}
		const original = await readFile(f.evidence, 'utf8');
		for (const patch of [{ origin: 'http://127.0.0.1:4346' }, { productId: 'soundscaper' }, { sourceRevision: 'b'.repeat(40) }]) {
			await writeFile(f.evidence, JSON.stringify({ ...captured, ...patch }));
			await assert.rejects(verifyMotionReleaseWebArtifact(f), /identity/u);
		}
		await writeFile(f.evidence, original);
		await writeFile(join(f.directory, 'service-worker.js'), '// changed');
		await assert.rejects(verifyMotionReleaseWebArtifact(f), /bytes|inventory/u);
	} finally { await rm(f.root, { recursive: true, force: true }); }
});
test('Motion production artifact refuses loopback or foreign builds, symlinks and oversized files before publication', async () => {
	const f = await fixture();
	try {
		await writeFile(join(f.directory, 'en/index.html'), '<html data-product="motionscaper"><link rel="canonical" href="http://127.0.0.1:4346/en/"></html>');
		await assert.rejects(captureMotionReleaseWebArtifact(f), /origin/u);
		await writeFile(join(f.directory, 'en/index.html'), '<html data-product="motionscaper"><link rel="canonical" href="https://motionscaper.org/en/"></html>');
		await writeFile(join(f.directory, 'docs/index.html'), '<html><link rel="canonical" href="https://soundscaper.org/docs/"></html>');
		await assert.rejects(captureMotionReleaseWebArtifact(f), /handbook/u);
		await writeFile(join(f.directory, 'docs/index.html'), '<html><link rel="canonical" href="https://motionscaper.org/docs/"></html>');
		await writeFile(join(f.directory, 'invalid\nname.js'), '// invalid');
		await assert.rejects(captureMotionReleaseWebArtifact(f), /path/u); await rm(join(f.directory, 'invalid\nname.js'));
		await symlink(join(f.directory, 'service-worker.js'), join(f.directory, 'linked.js'));
		await assert.rejects(captureMotionReleaseWebArtifact(f), /symlink|regular/u); await rm(join(f.directory, 'linked.js'));
		await writeFile(join(f.directory, 'large.bin'), ''); await truncate(join(f.directory, 'large.bin'), 25 * 1024 * 1024 + 1);
		await assert.rejects(captureMotionReleaseWebArtifact(f), /bound/u);
		await assert.rejects(readFile(f.evidence), /ENOENT/u);
	} finally { await rm(f.root, { recursive: true, force: true }); }
});
test('Motion production artifact rejects extra, omitted and duplicate inventory entries', async () => {
	const f = await fixture();
	try {
		const captured = await captureMotionReleaseWebArtifact(f);
		await writeFile(join(f.directory, 'extra.js'), '// unexpected');
		await assert.rejects(verifyMotionReleaseWebArtifact(f), /inventory/u); await rm(join(f.directory, 'extra.js'));
		await writeFile(f.evidence, JSON.stringify({ ...captured, files: [...captured.files, captured.files[0]] }));
		await assert.rejects(verifyMotionReleaseWebArtifact(f), /inventory/u);
		await writeFile(f.evidence, JSON.stringify(captured)); await rm(join(f.directory, 'service-worker.js'));
		await assert.rejects(verifyMotionReleaseWebArtifact(f), /inventory/u);
	} finally { await rm(f.root, { recursive: true, force: true }); }
});
