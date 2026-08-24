/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { authenticatePluginCandidate } from '../desktop/plugin-candidate-authentication.mjs';
import { snapshotAuthenticatedPluginCandidate } from '../desktop/plugin-candidate-snapshot.mjs';
import { authenticatePluginBinary } from '../desktop/plugin-binary-authentication.mjs';

test('single-file candidates retain their ordinary byte identity', async (context) => {
	const root = await fixture(context);
	const path = join(root, 'effect.clap');
	const bytes = Buffer.from('direct CLAP module');
	await writeFile(path, bytes);
	const identity = await authenticatePluginCandidate(path);
	assert.deepEqual({ kind: identity.kind, byteLength: identity.byteLength, sha256: identity.sha256 }, {
		kind: 'file', byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	});
	assert.ok(await authenticatePluginBinary(path, identity));
});

test('bundle candidates receive one canonical full-tree identity and rebind exactly', async (context) => {
	const root = await fixture(context);
	const bundle = join(root, 'Effect.vst3');
	await mkdir(join(bundle, 'Contents/x86_64-linux'), { recursive: true });
	await writeFile(join(bundle, 'Contents/Info.json'), '{"id":"effect"}\n');
	await writeFile(join(bundle, 'Contents/x86_64-linux/Effect.so'), 'native module');
	const first = await authenticatePluginCandidate(bundle);
	assert.equal(first.kind, 'bundle');
	assert.equal(first.fileCount, 2);
	assert.ok(await authenticatePluginBinary(bundle, first));
	await writeFile(join(bundle, 'Contents/x86_64-linux/Effect.so'), 'changed module');
	const second = await authenticatePluginCandidate(bundle);
	assert.notEqual(second.sha256, first.sha256);
	assert.equal(await authenticatePluginBinary(bundle, first), null);
});

test('bundle authentication rejects symlinks, special names and case collisions', async (context) => {
	const root = await fixture(context);
	for (const fault of ['symlink', 'case']) {
		const bundle = join(root, `${fault}.lv2`);
		await mkdir(bundle);
		await writeFile(join(bundle, 'Plugin.so'), 'one');
		if (fault === 'symlink') await symlink(join(bundle, 'Plugin.so'), join(bundle, 'alias.so'));
		else await writeFile(join(bundle, 'plugin.so'), 'two');
		await assert.rejects(
			() => authenticatePluginCandidate(resolve(bundle)),
			/symbolic|case-colliding/iu,
		);
	}
});

test('isolated custody copies exact file and bundle bytes before original same-inode mutation', async (context) => {
	const root = await fixture(context);
	for (const kind of ['file', 'bundle']) {
		const path = kind === 'file' ? join(root, 'custody.clap') : join(root, 'Custody.vst3');
		if (kind === 'bundle') {
			await mkdir(join(path, 'Contents'), { recursive: true });
			await writeFile(join(path, 'Contents/Custody.so'), 'reviewed bundle');
		} else await writeFile(path, 'reviewed module');
		const expected = await authenticatePluginCandidate(path);
		const snapshot = await snapshotAuthenticatedPluginCandidate(path, expected);
		const inode = (await stat(path)).ino;
		if (kind === 'bundle') await writeFile(join(path, 'Contents/Custody.so'), 'mutated bundle');
		else await writeFile(path, 'mutated module');
		assert.equal((await stat(path)).ino, inode, 'the hostile rewrite retains the admitted root inode');
		const retained = await authenticatePluginCandidate(snapshot.path);
		assert.deepEqual([retained.byteLength, retained.sha256], [expected.byteLength, expected.sha256]);
		await snapshot.dispose();
		await assert.rejects(access(snapshot.path));
	}
});

test('custody refuses a source mutated after copy but before final authentication', async (context) => {
	const root = await fixture(context);
	const path = join(root, 'raced.clap');
	await writeFile(path, 'reviewed module');
	const expected = await authenticatePluginCandidate(path);
	await assert.rejects(() => snapshotAuthenticatedPluginCandidate(path, expected, {
		copy: async (...arguments_) => {
			await cp(...arguments_);
			await writeFile(path, 'same inode replacement');
		},
	}), /changed before immutable isolated custody/iu);
});

async function fixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-plugin-candidate-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}
