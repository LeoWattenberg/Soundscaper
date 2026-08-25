/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { collectLocalModelGarbage } from '../desktop/local-model-garbage-collection.ts';
import { FileLocalModelStore, type LocalModelArtifact } from '../desktop/local-model-store.ts';

function artifact(fileName: string, contents: string): LocalModelArtifact {
	return Object.freeze({
		fileName,
		byteLength: Buffer.byteLength(contents),
		sha256: createHash('sha256').update(contents).digest('hex'),
	});
}

async function publish(store: FileLocalModelStore, expected: LocalModelArtifact, contents: string) {
	const staged = await store.stagingPath();
	await writeFile(staged, contents);
	await store.publishBlob(staged, expected);
}

async function fixture(t: { after: (fn: () => unknown) => void }) {
	const root = await mkdtemp(join(tmpdir(), 'scape-model-gc-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new FileLocalModelStore(root);
	await store.initialize();
	return { root, store };
}

test('explicit garbage collection removes only unreferenced blobs and non-resumable staging', async (t) => {
	const { root, store } = await fixture(t);
	const kept = artifact('kept.onnx', 'kept model');
	const orphan = artifact('orphan.onnx', 'orphan model');
	const resumable = artifact('resume.onnx', 'resumable download bytes');
	await publish(store, kept, 'kept model');
	await publish(store, orphan, 'orphan model');
	await store.commitInstall({ modelId: 'kept-model', version: '1', artifacts: [kept] });
	await writeFile(await store.partialPath(resumable.sha256), 'prefix');
	await writeFile(join(root, 'staging', `${'f'.repeat(64)}.part`), 'unknown');
	await writeFile(join(root, 'staging', `${'a'.repeat(32)}.part`), 'random staging');

	const report = await collectLocalModelGarbage({ store, offeredArtifacts: [kept, resumable] });
	assert.equal(report.reclaimedBlobBytes, orphan.byteLength);
	assert.equal(report.discardedManifestCount, 0);
	assert.equal(report.discardedPartialCount, 2);
	assert.equal(report.discardedPartialBytes, Buffer.byteLength('unknownrandom staging'));
	assert.equal(await store.hasBlob(kept.sha256), true);
	assert.equal(await store.hasBlob(orphan.sha256), false);
	assert.deepEqual(await readdir(join(root, 'staging')), [`sha256-${resumable.sha256}.part`]);
});

test('explicit reconciliation discards manifests whose authenticated bodies were deleted or changed', async (t) => {
	const { store } = await fixture(t);
	const missing = artifact('missing.onnx', 'missing model');
	const changed = artifact('changed.onnx', 'model-a');
	await publish(store, missing, 'missing model');
	await publish(store, changed, 'model-a');
	await store.commitInstall({ modelId: 'missing-model', version: '1', artifacts: [missing] });
	await store.commitInstall({ modelId: 'changed-model', version: '1', artifacts: [changed] });
	await rm(store.blobPath(missing.sha256));
	await writeFile(store.blobPath(changed.sha256), 'model-b');

	const report = await collectLocalModelGarbage({ store, offeredArtifacts: [missing, changed] });
	assert.equal(report.discardedManifestCount, 2);
	assert.deepEqual(await store.listInstalled(), []);
	assert.equal(await store.readManifest('missing-model'), null);
	assert.equal(await store.readManifest('changed-model'), null);
	assert.equal(await store.hasBlob(changed.sha256), false, 'the now-unreferenced corrupt blob is collected');
});

test('a valid catalog partial is discarded once its published blob exists', async (t) => {
	const { root, store } = await fixture(t);
	const expected = artifact('model.onnx', 'published model');
	await publish(store, expected, 'published model');
	await store.commitInstall({ modelId: 'published-model', version: '1', artifacts: [expected] });
	await writeFile(await store.partialPath(expected.sha256), 'prefix');

	const report = await collectLocalModelGarbage({ store, offeredArtifacts: [expected] });
	assert.equal(report.discardedPartialCount, 1);
	assert.deepEqual(await readdir(join(root, 'staging')), []);
});

test('unexpected manifest-directory content is garbage only on explicit collection', async (t) => {
	const { root, store } = await fixture(t);
	await mkdir(join(root, 'manifests'), { recursive: true });
	await writeFile(join(root, 'manifests', 'broken.json'), '{not json');
	await writeFile(join(root, 'manifests', 'abandoned.tmp'), 'temporary');

	assert.equal((await readdir(join(root, 'manifests'))).length, 2);
	const report = await collectLocalModelGarbage({ store, offeredArtifacts: [] });
	assert.equal(report.discardedManifestCount, 2);
	assert.deepEqual(await readdir(join(root, 'manifests')), []);
});
