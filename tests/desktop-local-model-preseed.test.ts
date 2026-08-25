/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LocalModelCapacity } from '../desktop/local-model-capacity.ts';
import {
	installPreseededLocalModel,
	reconcilePreseededLocalModels,
	type PreseededLocalModelEntry,
} from '../desktop/local-model-preseed.ts';
import { FileLocalModelStore, localModelBlobName } from '../desktop/local-model-store.ts';

const ENCODER = 'offline encoder weights';
const TOKENS = 'offline token vocabulary';

function artifact(fileName: string, contents: string) {
	return Object.freeze({
		fileName,
		byteLength: Buffer.byteLength(contents),
		sha256: createHash('sha256').update(contents).digest('hex'),
	});
}

const ENTRY: PreseededLocalModelEntry = Object.freeze({
	modelId: 'offline-model-v1',
	version: '1.0.0',
	artifacts: Object.freeze([
		artifact('encoder.onnx', ENCODER),
		artifact('tokens.txt', TOKENS),
	]),
});

async function fixture(t: { after: (fn: () => unknown) => void }) {
	const parent = await mkdtemp(join(tmpdir(), 'scape-model-preseed-'));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const root = join(parent, 'store');
	const source = join(parent, 'seed');
	await mkdir(source);
	const store = new FileLocalModelStore(root);
	return { parent, root, source, store };
}

test('an explicit offline install authenticates and publishes seed files without a network port', async (t) => {
	const { source, store } = await fixture(t);
	await writeFile(join(source, 'encoder.onnx'), ENCODER);
	await writeFile(join(source, 'tokens.txt'), TOKENS);

	const installed = await installPreseededLocalModel({ store, entry: ENTRY, sourceDirectory: source });
	assert.equal(installed.modelId, ENTRY.modelId);
	assert.equal(installed.totalBytes, ENCODER.length + TOKENS.length);
	assert.equal(String(await readFile(store.blobPath(ENTRY.artifacts[0]!.sha256))), ENCODER);
	assert.deepEqual((await store.listInstalled()).map(({ modelId }) => modelId), [ENTRY.modelId]);
});

test('every seed artifact is authenticated before any destination body is copied', async (t) => {
	const { source, store } = await fixture(t);
	await writeFile(join(source, 'encoder.onnx'), ENCODER);
	await writeFile(join(source, 'tokens.txt'), `${TOKENS}!`);

	await assert.rejects(
		installPreseededLocalModel({ store, entry: ENTRY, sourceDirectory: source }),
		/seed artifact.*byte length|seed artifact.*digest/iu,
	);
	assert.equal(await store.usedBytes(), 0);
	assert.equal(await store.readManifest(ENTRY.modelId), null);
});

test('offline copies receive capacity admission before the first destination byte', async (t) => {
	const { source, store } = await fixture(t);
	await writeFile(join(source, 'encoder.onnx'), ENCODER);
	await writeFile(join(source, 'tokens.txt'), TOKENS);
	let statfsCalls = 0;
	const capacity = new LocalModelCapacity({
		statfsImpl: async () => {
			statfsCalls += 1;
			return { bavail: 1n, bsize: 1n };
		},
	});

	await assert.rejects(
		installPreseededLocalModel({ store, entry: ENTRY, sourceDirectory: source, capacity }),
		/available disk space/iu,
	);
	assert.equal(statfsCalls, 1);
	assert.equal(await store.usedBytes(), 0);
});

test('reconciliation installs complete content-addressed pre-seeds with zero copying', async (t) => {
	const { root, store } = await fixture(t);
	await mkdir(join(root, 'blobs'), { recursive: true });
	for (const [index, contents] of [ENCODER, TOKENS].entries()) {
		const expected = ENTRY.artifacts[index]!;
		await writeFile(join(root, 'blobs', localModelBlobName(expected.sha256)), contents);
	}

	const report = await reconcilePreseededLocalModels(store, [ENTRY]);
	assert.deepEqual(report.installedModelIds, [ENTRY.modelId]);
	assert.deepEqual(report.incompleteModelIds, []);
	assert.deepEqual(report.rejected, []);
	assert.equal((await store.readManifest(ENTRY.modelId))?.version, ENTRY.version);
});

test('reconciliation reports incomplete and corrupt seeds without repair or fetching', async (t) => {
	const { root, store } = await fixture(t);
	const incomplete = Object.freeze({ ...ENTRY, modelId: 'incomplete-model' });
	const corrupt = Object.freeze({ ...ENTRY, modelId: 'corrupt-model' });
	await mkdir(join(root, 'blobs'), { recursive: true });
	await writeFile(
		join(root, 'blobs', localModelBlobName(ENTRY.artifacts[0]!.sha256)),
		ENCODER.replace('encoder', 'encodeR'),
	);

	const report = await reconcilePreseededLocalModels(store, [incomplete, corrupt]);
	assert.deepEqual(report.installedModelIds, []);
	assert.deepEqual(report.incompleteModelIds, []);
	assert.deepEqual(report.rejected.map(({ modelId }) => modelId), ['corrupt-model', 'incomplete-model']);
	assert.equal(await store.readManifest(incomplete.modelId), null);
	assert.equal(await store.readManifest(corrupt.modelId), null);
});
