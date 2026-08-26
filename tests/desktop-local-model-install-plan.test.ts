/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { planLocalModelTransfers } from '../desktop/local-model-install-plan.ts';
import { FileLocalModelStore, type LocalModelArtifact } from '../desktop/local-model-store.ts';

const CONTENTS = 'authenticated model bytes';
const ARTIFACT: LocalModelArtifact = Object.freeze({
	fileName: 'model.onnx',
	byteLength: Buffer.byteLength(CONTENTS),
	sha256: createHash('sha256').update(CONTENTS).digest('hex'),
});

async function fixture(t: { after: (fn: () => unknown) => void }): Promise<FileLocalModelStore> {
	const root = await mkdtemp(join(tmpdir(), 'scape-model-plan-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new FileLocalModelStore(root);
	await store.initialize();
	return store;
}

test('transfer planning reserves only bytes absent from a resumable partial', async (t) => {
	const store = await fixture(t);
	await writeFile(await store.partialPath(ARTIFACT.sha256), CONTENTS.slice(0, 5));

	const plan = await planLocalModelTransfers(store, [ARTIFACT]);
	assert.equal(plan.totalBytes, ARTIFACT.byteLength - 5);
	assert.deepEqual(plan.artifacts.map((item) => ({
		sha256: item.artifact.sha256,
		resumedFromBytes: item.resumedFromBytes,
		transferBytes: item.transferBytes,
	})), [{ sha256: ARTIFACT.sha256, resumedFromBytes: 5, transferBytes: ARTIFACT.byteLength - 5 }]);
});

test('published bytes are authenticated while planning and need no reservation', async (t) => {
	const store = await fixture(t);
	const staged = await store.stagingPath();
	await writeFile(staged, CONTENTS);
	await store.publishBlob(staged, ARTIFACT);

	assert.equal((await planLocalModelTransfers(store, [ARTIFACT])).totalBytes, 0);
	await writeFile(store.blobPath(ARTIFACT.sha256), CONTENTS.replace('model', 'tampr'));
	await assert.rejects(
		planLocalModelTransfers(store, [ARTIFACT]),
		/published artifact failed its integrity check/iu,
	);
});

test('a digest shared by multiple roles is reserved only once', async (t) => {
	const store = await fixture(t);
	const duplicate = Object.freeze({ ...ARTIFACT, fileName: 'shared.onnx' });

	const plan = await planLocalModelTransfers(store, [ARTIFACT, duplicate]);
	assert.equal(plan.totalBytes, ARTIFACT.byteLength);
	assert.equal(plan.artifacts.length, 1);
});

test('oversized, complete, and non-file partials do not reduce admission', async (t) => {
	const store = await fixture(t);
	const path = await store.partialPath(ARTIFACT.sha256);
	await writeFile(path, CONTENTS);
	assert.equal((await planLocalModelTransfers(store, [ARTIFACT])).totalBytes, ARTIFACT.byteLength);

	await writeFile(path, `${CONTENTS}extra`);
	assert.equal((await planLocalModelTransfers(store, [ARTIFACT])).totalBytes, ARTIFACT.byteLength);

	await rm(path);
	assert.equal((await planLocalModelTransfers(store, [ARTIFACT])).totalBytes, ARTIFACT.byteLength);
});
