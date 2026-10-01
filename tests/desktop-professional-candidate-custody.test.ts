/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { exactProfessionalCandidateGrant } from '../desktop/professional-candidate-custody.ts';

import { createSoundscaperProfessionalPluginPeer } from '../desktop/soundscaper-professional-plugin-peer.ts';
import { createSoundscaperProfessionalVampPeer } from '../desktop/soundscaper-professional-vamp-peer.ts';

const descriptor = Object.freeze({ path: '/unused', byteLength: 1, sha256: 'aa'.repeat(32),
	identity: Object.freeze({ dev: 1, ino: 1 }) });
const options = { peerExecutable: descriptor, runtimeReadExecute: [],
	launcher: { launch: async () => { throw new Error('candidate discovery never launches'); } } };
const plugin = createSoundscaperProfessionalPluginPeer({ ...options, pluginFormats: ['clap'] });
const vamp = createSoundscaperProfessionalVampPeer(options);

for (const [owner, list] of [
	['plugin', plugin.listPluginCandidates], ['vamp', vamp.listPluginCandidates],
] as const) {
	test(`${owner} candidates retain English locale ordering, symlink skip, and the 513th sentinel`, async (context) => {
		const root = await realpath(await mkdtemp(join(tmpdir(), `professional-${owner}-walk-`)));
		context.after(() => rm(root, { recursive: true, force: true }));
		const names = Array.from({ length: 514 }, (_, index) => `candidate-${String(index).padStart(3, '0')}.so`);
		names[0] = 'ä.so'; names[1] = 'Z.so'; names[2] = 'a.so';
		await Promise.all(names.map((name) => writeFile(join(root, name), 'candidate')));
		await symlink(join(root, names[0]!), join(root, '00-link.so'));
		const ordered = names.slice().sort((left, right) => left.localeCompare(right, 'en')).slice(0, 513);
		assert.deepEqual(await list(root, '.so'), ordered.map((name) => join(root, name)));
	});

	test(`${owner} walks depth sixteen and refuses a noncanonical root`, async (context) => {
		const root = await realpath(await mkdtemp(join(tmpdir(), `professional-${owner}-depth-`)));
		context.after(() => rm(root, { recursive: true, force: true }));
		let path = root;
		for (let depth = 0; depth <= 17; depth += 1) {
			await mkdir(path, { recursive: true });
			await writeFile(join(path, 'candidate.so'), 'candidate');
			path = join(path, 'nested');
		}
		assert.equal((await list(root, '.so')).length, 17);
		const link = join(root, 'root-link');
		await symlink(root, link);
		await assert.rejects(() => list(link, '.so'), owner === 'plugin'
			? /A plug-in root must remain canonical\./u : /A Vamp library root must remain canonical\./u);
	});
}

test('plug-in discovery admits suffix bundles while Vamp recurses through suffix directories', async (context) => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'professional-candidate-leaves-')));
	context.after(() => rm(root, { recursive: true, force: true }));
	const bundle = join(root, 'bundle.so');
	await mkdir(bundle);
	await writeFile(join(bundle, 'nested.so'), 'library');
	await writeFile(join(root, 'plain.so'), 'library');
	await writeFile(join(root, 'fixture.custom'), 'plugin');
	const external = await realpath(await mkdtemp(join(tmpdir(), 'professional-candidate-outside-')));
	context.after(() => rm(external, { recursive: true, force: true }));
	await writeFile(join(external, 'escape.so'), 'outside');
	await symlink(external, join(root, 'outside'));
	assert.deepEqual(await plugin.listPluginCandidates(root, '.so'), [bundle, join(root, 'plain.so')]);
	assert.deepEqual(await vamp.listPluginCandidates(root, '.so'), [join(bundle, 'nested.so'), join(root, 'plain.so')]);
	assert.deepEqual(await plugin.listPluginCandidates(root, '.custom'), [join(root, 'fixture.custom')]);
	await assert.rejects(() => vamp.listPluginCandidates(root, '.custom'), /Invalid Vamp library suffix\./u);
	await assert.rejects(() => plugin.listPluginCandidates(root, '../so'), /Invalid plug-in suffix\./u);
	assert.equal(await realpath(root), root);
	assert.equal((await stat(bundle)).isDirectory(), true);
});


test('post-snapshot grants refuse inode drift, symlinks and noncanonical parents while preserving owner diagnostics', async (context) => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'professional-candidate-grant-')));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'candidate.so');
	await writeFile(path, 'reviewed snapshot');
	const metadata = await stat(path);
	const expected = { dev: metadata.dev, ino: metadata.ino };
	const granted = await exactProfessionalCandidateGrant(path, expected, false, 'Vamp identity drift');
	assert.equal(granted.kind, 'file');
	assert.deepEqual(granted.identity, { dev: String(metadata.dev), ino: String(metadata.ino) });
	assert.ok(Object.isFrozen(granted));
	assert.ok(Object.isFrozen(granted.identity));
	await assert.rejects(() => exactProfessionalCandidateGrant(path, { ...expected, ino: expected.ino + 1 },
		true, 'Plugin identity drift'), { message: 'Plugin identity drift' });
	await assert.rejects(() => exactProfessionalCandidateGrant(path, { ...expected, dev: expected.dev + 1 },
		false, 'Vamp identity drift'), { message: 'Vamp identity drift' });
	const link = join(root, 'linked.so');
	await symlink(path, link);
	await assert.rejects(() => exactProfessionalCandidateGrant(link, expected, false, 'Vamp identity drift'),
		{ message: 'Vamp identity drift' });
	const directory = join(root, 'bundle.so');
	await mkdir(directory);
	const directoryIdentity = await stat(directory);
	assert.equal((await exactProfessionalCandidateGrant(directory, directoryIdentity, true,
		'Plugin identity drift')).kind, 'directory');
	await assert.rejects(() => exactProfessionalCandidateGrant(directory, directoryIdentity, false,
		'Vamp identity drift'), { message: 'Vamp identity drift' });
	const aliasedRoot = join(root, 'alias');
	await symlink(root, aliasedRoot);
	await assert.rejects(() => exactProfessionalCandidateGrant(join(aliasedRoot, 'candidate.so'), expected,
		true, 'Plugin identity drift'), { message: 'Plugin identity drift' });
});
