/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { LocalModelCapacity } from '../desktop/local-model-capacity.ts';
import { relocateLocalModelStore } from '../desktop/local-model-relocation.ts';
import { FileLocalModelStore, type LocalModelArtifact } from '../desktop/local-model-store.ts';

const CONTENTS = 'relocatable model bytes';
const ARTIFACT: LocalModelArtifact = Object.freeze({
	fileName: 'model.onnx', byteLength: Buffer.byteLength(CONTENTS),
	sha256: createHash('sha256').update(CONTENTS).digest('hex'),
});

async function fixture(t: { after: (fn: () => unknown) => void }) {
	const parent = await mkdtemp(join(tmpdir(), 'scape-model-relocate-'));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const sourceRoot = join(parent, 'source');
	const targetRoot = join(parent, 'destination', 'models');
	const store = new FileLocalModelStore(sourceRoot);
	await store.initialize();
	const staged = await store.stagingPath();
	await writeFile(staged, CONTENTS);
	await store.publishBlob(staged, ARTIFACT);
	await store.commitInstall({ modelId: 'relocatable-model', version: '1', artifacts: [ARTIFACT] });
	await writeFile(await store.partialPath('b'.repeat(64)), 'resumable prefix');
	return { parent, sourceRoot, targetRoot, store };
}

test('relocation copies, verifies, swaps settings, then removes the source', async (t) => {
	const { sourceRoot, targetRoot, store } = await fixture(t);
	const events: string[] = [];
	const statfsCalls: unknown[][] = [];
	const capacity = new LocalModelCapacity({
		statfsImpl: async (...args: unknown[]) => {
			statfsCalls.push(args);
			return { bavail: 1_000_000n, bsize: 1n };
		},
	});

	const result = await relocateLocalModelStore({
		source: store,
		targetDirectory: targetRoot,
		capacity,
		persistTarget: async (path) => {
			events.push(`persist:${path}`);
			assert.equal((await new FileLocalModelStore(path).listInstalled())[0]?.modelId, 'relocatable-model');
			assert.equal((await lstat(sourceRoot)).isDirectory(), true, 'source survives until settings swap');
		},
	});

	assert.equal(result.modelsDirectory, targetRoot);
	assert.equal(result.sourceRemoved, true);
	assert.ok(result.fileCount >= 3, 'manifest, blob, and resumable partial are preserved');
	assert.deepEqual(events, [`persist:${targetRoot}`]);
	assert.deepEqual(statfsCalls, [[dirname(targetRoot), { bigint: true }]]);
	await assert.rejects(lstat(sourceRoot), /ENOENT/u);
	assert.equal(String(await readFile(join(targetRoot, 'staging', `sha256-${'b'.repeat(64)}.part`))), 'resumable prefix');
});

test('an existing target is a collision even when it is empty', async (t) => {
	const { sourceRoot, targetRoot, store } = await fixture(t);
	await mkdir(targetRoot, { recursive: true });
	let settingsCalls = 0;

	await assert.rejects(
		relocateLocalModelStore({
			source: store, targetDirectory: targetRoot,
			persistTarget: async () => { settingsCalls += 1; },
		}),
		/target.*already exists|collision/iu,
	);
	assert.equal(settingsCalls, 0);
	assert.equal((await lstat(sourceRoot)).isDirectory(), true);
	assert.deepEqual(await readdir(targetRoot), []);
});

test('corrupt source bytes reject before target creation or settings mutation', async (t) => {
	const { sourceRoot, targetRoot, store } = await fixture(t);
	await writeFile(store.blobPath(ARTIFACT.sha256), CONTENTS.replace('model', 'modEl'));
	let settingsCalls = 0;

	await assert.rejects(
		relocateLocalModelStore({
			source: store, targetDirectory: targetRoot,
			persistTarget: async () => { settingsCalls += 1; },
		}),
		/source.*digest|authenticated.*source|blob.*digest/iu,
	);
	assert.equal(settingsCalls, 0);
	assert.equal((await lstat(sourceRoot)).isDirectory(), true);
	await assert.rejects(lstat(targetRoot), /ENOENT/u);
});

test('partial copy verification removes the target and leaves source and settings unchanged', async (t) => {
	const { sourceRoot, targetRoot, store } = await fixture(t);
	let settingsCalls = 0;
	const copyFileImpl = async (source: string, target: string, mode: number) => {
		assert.equal(mode, fsConstants.COPYFILE_EXCL);
		await copyFile(source, target, mode);
		if (target.includes(`${join('blobs', 'sha256-')}`)) {
			await writeFile(target, CONTENTS.replace('model', 'modEl'));
		}
	};

	await assert.rejects(
		relocateLocalModelStore({
			source: store, targetDirectory: targetRoot, copyFileImpl,
			persistTarget: async () => { settingsCalls += 1; },
		}),
		/destination.*source|digest|verification/iu,
	);
	assert.equal(settingsCalls, 0);
	assert.equal((await lstat(sourceRoot)).isDirectory(), true);
	await assert.rejects(lstat(targetRoot), /ENOENT/u);
});

test('a settings write failure rolls back the verified target without touching source', async (t) => {
	const { sourceRoot, targetRoot, store } = await fixture(t);

	await assert.rejects(
		relocateLocalModelStore({
			source: store, targetDirectory: targetRoot,
			persistTarget: async () => { throw new Error('settings unavailable'); },
		}),
		/settings unavailable/iu,
	);
	assert.equal((await lstat(sourceRoot)).isDirectory(), true);
	await assert.rejects(lstat(targetRoot), /ENOENT/u);
});

test('a source cleanup failure leaves a harmless authenticated duplicate', async (t) => {
	const { sourceRoot, targetRoot, store } = await fixture(t);
	let persisted = false;
	const result = await relocateLocalModelStore({
		source: store, targetDirectory: targetRoot,
		persistTarget: async () => { persisted = true; },
		removeSourceImpl: async () => { throw new Error('source busy'); },
	});

	assert.equal(persisted, true);
	assert.equal(result.sourceRemoved, false);
	assert.equal((await lstat(sourceRoot)).isDirectory(), true);
	assert.equal((await new FileLocalModelStore(targetRoot).listInstalled()).length, 1);
});

test('nested and relative relocation targets are rejected before filesystem work', async (t) => {
	const { sourceRoot, store } = await fixture(t);
	for (const targetDirectory of ['relative/models', join(sourceRoot, 'nested')]) {
		await assert.rejects(
			relocateLocalModelStore({
				source: store, targetDirectory,
				persistTarget: async () => { throw new Error('must not persist'); },
			}),
			/absolute|overlap|nested/iu,
		);
	}
});
