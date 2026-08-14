/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DesktopSettingsStore, validateModelsDirectory } from '../desktop/settings.js';
import {
	DEFAULT_LOCAL_MODEL_DIRECTORY_NAME,
	FileLocalModelStore,
	LOCAL_MODEL_MANIFEST_SCHEMA_VERSION,
	localModelBlobName,
	resolveLocalModelRoot,
	type LocalModelArtifact,
} from '../desktop/local-model-store.ts';

async function createStore(): Promise<{ store: FileLocalModelStore; root: string }> {
	const root = await mkdtemp(join(tmpdir(), 'scape-local-models-'));
	const store = new FileLocalModelStore(root);
	await store.initialize();
	return { store, root };
}

function digestOf(contents: string): string {
	return createHash('sha256').update(contents).digest('hex');
}

async function publish(
	store: FileLocalModelStore,
	fileName: string,
	contents: string,
): Promise<LocalModelArtifact> {
	const artifact = {
		fileName,
		byteLength: Buffer.byteLength(contents),
		sha256: digestOf(contents),
	};
	const staged = await store.stagingPath();
	await writeFile(staged, contents);
	await store.publishBlob(staged, artifact);
	return artifact;
}

test('a published artifact is stored once under its digest', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	const artifact = await publish(store, 'model.onnx', 'weights');
	assert.equal(await store.hasBlob(artifact.sha256), true);
	assert.equal(store.blobPath(artifact.sha256), join(root, 'blobs', localModelBlobName(artifact.sha256)));
	assert.equal(String(await readFile(store.blobPath(artifact.sha256))), 'weights');
});

test('a staged artifact that does not match its digest is refused and discarded', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	const staged = await store.stagingPath();
	await writeFile(staged, 'tampered');
	const artifact = {
		fileName: 'model.onnx',
		byteLength: Buffer.byteLength('tampered'),
		sha256: digestOf('expected'),
	};

	await assert.rejects(store.publishBlob(staged, artifact), /does not match its recorded digest/iu);
	assert.equal(await store.hasBlob(artifact.sha256), false);
	await assert.rejects(stat(staged), /ENOENT/u);
});

test('a staged artifact of the wrong length is refused before it is hashed', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	const staged = await store.stagingPath();
	await writeFile(staged, 'weights');
	await assert.rejects(
		store.publishBlob(staged, { fileName: 'model.onnx', byteLength: 9_999, sha256: digestOf('weights') }),
		/recorded byte length/iu,
	);
});

test('a manifest cannot name bytes the store does not hold', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	await assert.rejects(
		store.commitInstall({
			modelId: 'silero-vad-v6',
			version: '6.2.1',
			artifacts: [{ fileName: 'model.onnx', byteLength: 7, sha256: digestOf('missing') }],
		}),
		/missing a published artifact/iu,
	);
	assert.equal(await store.readManifest('silero-vad-v6'), null);
});

test('an installation round-trips through the manifest', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	const artifact = await publish(store, 'model.onnx', 'weights');
	const committed = await store.commitInstall({
		modelId: 'silero-vad-v6',
		version: '6.2.1',
		artifacts: [artifact],
	});
	assert.equal(committed.totalBytes, artifact.byteLength);

	const read = await store.readManifest('silero-vad-v6');
	assert.deepEqual(read?.artifacts, [artifact]);
	assert.equal(read?.version, '6.2.1');

	const stored = JSON.parse(String(await readFile(store.manifestPath('silero-vad-v6'))));
	assert.equal(stored.schemaVersion, LOCAL_MODEL_MANIFEST_SCHEMA_VERSION);
});

test('removing a model reclaims only the blobs nothing else references', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	const shared = await publish(store, 'tokenizer.json', 'shared');
	const encoder = await publish(store, 'encoder.onnx', 'encoder-only');

	await store.commitInstall({ modelId: 'model-a', version: '1', artifacts: [shared, encoder] });
	await store.commitInstall({ modelId: 'model-b', version: '1', artifacts: [shared] });

	const reclaimed = await store.removeModel('model-a');
	assert.equal(reclaimed, encoder.byteLength, 'only the unshared blob is reclaimed');
	assert.equal(await store.hasBlob(shared.sha256), true, 'model-b still references the shared blob');
	assert.equal(await store.hasBlob(encoder.sha256), false);
	assert.equal(await store.readManifest('model-a'), null);
	assert.deepEqual((await store.listInstalled()).map(({ modelId }) => modelId), ['model-b']);
});

test('removing the last model leaves an empty store', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	const artifact = await publish(store, 'model.onnx', 'weights');
	await store.commitInstall({ modelId: 'model-a', version: '1', artifacts: [artifact] });

	assert.equal(await store.removeModel('model-a'), artifact.byteLength);
	assert.deepEqual(await store.listInstalled(), []);
	assert.equal(await store.usedBytes(), 0);
});

test('a manifest the user damaged is skipped rather than hiding the rest', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	const artifact = await publish(store, 'model.onnx', 'weights');
	await store.commitInstall({ modelId: 'model-a', version: '1', artifacts: [artifact] });
	await writeFile(join(root, 'manifests', 'model-b.json'), '{ not json');
	await writeFile(join(root, 'manifests', 'notes.txt'), 'ignored');

	assert.deepEqual((await store.listInstalled()).map(({ modelId }) => modelId), ['model-a']);
});

test('externally deleted bytes are reported as uninstalled rather than trusted', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	const artifact = await publish(store, 'model.onnx', 'weights');
	await store.commitInstall({ modelId: 'model-a', version: '1', artifacts: [artifact] });
	await rm(store.blobPath(artifact.sha256));

	assert.equal(await store.hasBlob(artifact.sha256), false);
	await assert.rejects(
		store.commitInstall({ modelId: 'model-a', version: '2', artifacts: [artifact] }),
		/missing a published artifact/iu,
	);
});

test('the store refuses ids, versions, and digests it cannot place safely', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	assert.throws(() => store.manifestPath('../escape'), /lowercase, dot or dash separated/iu);
	assert.throws(() => store.manifestPath('Model-A'), /lowercase, dot or dash separated/iu);
	assert.throws(() => store.blobPath('not-a-digest'), /lowercase SHA-256/iu);
	assert.throws(() => new FileLocalModelStore('relative/path'), /must be an absolute path/iu);

	const artifact = await publish(store, 'model.onnx', 'weights');
	await assert.rejects(
		store.commitInstall({ modelId: 'model-a', version: '', artifacts: [artifact] }),
		/version must be a short non-empty string/iu,
	);
	await assert.rejects(
		store.commitInstall({
			modelId: 'model-a',
			version: '1',
			artifacts: [{ ...artifact, fileName: '../escape.onnx' }],
		}),
		/plain relative file name/iu,
	);
	await assert.rejects(
		store.commitInstall({ modelId: 'model-a', version: '1', artifacts: [artifact, artifact] }),
		/repeats an artifact file name/iu,
	);
	await assert.rejects(
		store.commitInstall({ modelId: 'model-a', version: '1', artifacts: [] }),
		/between one and 64 artifacts/iu,
	);
});

test('an unset models directory follows the product data directory', () => {
	assert.equal(
		resolveLocalModelRoot({ userDataPath: join('/data', 'Soundscaper') }),
		join('/data', 'Soundscaper', DEFAULT_LOCAL_MODEL_DIRECTORY_NAME),
	);
	assert.equal(
		resolveLocalModelRoot({ userDataPath: '/data/Soundscaper', settingsDirectory: '/models/scape' }),
		'/models/scape',
	);
	assert.throws(() => resolveLocalModelRoot({ userDataPath: 'relative' }), /must be absolute/iu);
	assert.throws(
		() => resolveLocalModelRoot({ userDataPath: '/data', settingsDirectory: 'relative/models' }),
		/must be an absolute path/iu,
	);
});

test('the models directory setting persists and rejects unusable paths', { timeout: 20_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-settings-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const settings = new DesktopSettingsStore(join(root, 'desktop-settings.json'));
	await settings.load(['en']);

	assert.equal(settings.snapshot().modelsDirectory, null, 'the default stays derived, not persisted');
	assert.equal(await settings.setModelsDirectory(join(root, 'chosen')), join(root, 'chosen'));

	const stored = JSON.parse(String(await readFile(join(root, 'desktop-settings.json'))));
	assert.equal(stored.modelsDirectory, join(root, 'chosen'));

	const reopened = new DesktopSettingsStore(join(root, 'desktop-settings.json'));
	assert.equal((await reopened.load(['en'])).modelsDirectory, join(root, 'chosen'));

	assert.equal(await settings.setModelsDirectory(null), null, 'clearing returns to the default');
	await assert.rejects(settings.setModelsDirectory('relative/models'), /absolute path/iu);
	await assert.rejects(settings.setModelsDirectory('/models\0/scape'), /out of range/iu);
	assert.throws(() => validateModelsDirectory(42), /absolute path/iu);
});

test('an unreadable models directory value falls back instead of failing startup', { timeout: 20_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-settings-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'desktop-settings.json');
	await writeFile(path, JSON.stringify({ schemaVersion: 1, locale: 'en', modelsDirectory: 'relative/models' }));

	const settings = new DesktopSettingsStore(path);
	assert.equal((await settings.load(['en'])).modelsDirectory, null);
});

test('a manifest written by a future schema is refused rather than guessed at', { timeout: 20_000 }, async (t) => {
	const { store, root } = await createStore();
	t.after(() => rm(root, { recursive: true, force: true }));

	await writeFile(
		join(root, 'manifests', 'model-a.json'),
		JSON.stringify({ schemaVersion: LOCAL_MODEL_MANIFEST_SCHEMA_VERSION + 1, modelId: 'model-a', version: '1', artifacts: [] }),
	);
	await assert.rejects(store.readManifest('model-a'), /schema version is unsupported/iu);
});
