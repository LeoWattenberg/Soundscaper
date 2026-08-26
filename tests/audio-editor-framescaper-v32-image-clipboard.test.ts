/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { applyFramescaperProjectCommandV32 } from '../src/framescaper/editor-project-v32-commands.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import {
	collectFramescaperSessionClipboardImageStorageKeysV13,
	createFramescaperSessionClipboardV13,
	framescaperSessionClipboardV12FoundationV13,
	normalizeFramescaperSessionClipboardV13,
} from '../src/framescaper/editor-session-clipboard-v13.ts';
import {
	prepareFramescaperSessionClipboardPasteV13,
	stageFramescaperSessionClipboardImageBodiesV13,
} from '../src/framescaper/editor-session-clipboard-v13-paste.ts';
import {
	createFramescaperV32ImageFixture,
	imagePasteCommand,
} from './helpers/framescaper-v32-image-fixture.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { createFramescaperProjectV32 } from '../src/framescaper/editor-project-v32.ts';

const PROFILE = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;

test('clipboard V13 owns exact selected image metadata, bindings, and retention roots', () => {
	const fixture = createFramescaperV32ImageFixture();
	const clipboard = createFramescaperSessionClipboardV13(PROFILE, fixture.project, fixture.descriptor);
	assert.equal(clipboard.schemaVersion, 13);
	assert.deepEqual(clipboard.images.sourceIds, [fixture.source.id]);
	assert.deepEqual(clipboard.images.clips, [fixture.clip]);
	assert.deepEqual(clipboard.clipBindings, [{
		clipId: fixture.clip.id,
		descriptorKey: fixture.descriptor.tracks[0]!.clips[0]!.key,
	}]);
	assert.deepEqual(collectFramescaperSessionClipboardImageStorageKeysV13(clipboard), [fixture.source.id]);
	assert.deepEqual(normalizeFramescaperSessionClipboardV13(structuredClone(clipboard)), clipboard);
	const foundation = framescaperSessionClipboardV12FoundationV13(clipboard);
	assert.deepEqual(foundation.sources, []);
	assert.deepEqual(foundation.clipBindings, []);
	assert.deepEqual(foundation.descriptor.tracks[0]?.clips, []);
	assert.throws(() => normalizeFramescaperSessionClipboardV13({
		...clipboard,
		images: { ...clipboard.images, sourceIds: [] },
	}), /source|closure|image/iu);
});

test('V13 same-body paste reuses immutable authority and places one fresh grouped image clip', () => {
	const fixture = createFramescaperV32ImageFixture();
	const clipboard = createFramescaperSessionClipboardV13(PROFILE, fixture.project, fixture.descriptor);
	const base = imagePasteCommand(fixture.descriptor, { clipId: 'same-body-copy', atFrame: 48_000 });
	const prepared = prepareFramescaperSessionClipboardPasteV13(
		PROFILE,
		fixture.project,
		clipboard,
		base,
		(prefix = 'id') => `${prefix}-unused`,
	);
	assert.deepEqual(prepared.imageSourceIdMap, new Map([[fixture.source.id, fixture.source.id]]));
	assert.equal(prepared.bodyTransfers.length, 1);
	assert.equal(prepared.bodyTransfers[0]?.mode, 'reuse');
	const pasted = applyFramescaperProjectCommandV32(PROFILE, fixture.project, prepared.command);
	const copy = pasted.clips.find(({ id }) => id === 'same-body-copy');
	assert.ok(copy && copy.kind === 'image');
	assert.equal(copy.sourceId, fixture.source.id);
	assert.equal(copy.sequenceStartFrame, 10);
	assert.equal(copy.sequenceFrameCount, 50);
	assert.equal(copy.sourceStartTicks, fixture.clip.sourceStartTicks);
	assert.equal(pasted.sources.filter(({ id }) => id === fixture.source.id).length, 1);
});

test('V13 collision paste copies exact bytes to a fresh source identity with owned rollback', async (context) => {
	const fixture = createFramescaperV32ImageFixture();
	const clipboard = createFramescaperSessionClipboardV13(PROFILE, fixture.project, fixture.descriptor);
	const destinationBase = createFramescaperProjectV32(PROFILE, framescaperV20Options());
	const conflicting = createFramescaperV32ImageFixture({ originalText: 'different bytes' }).source;
	const destination = applyFramescaperProjectCommandV32(PROFILE, destinationBase, {
		type: 'image-source/set', sourceId: conflicting.id, expectedSource: null, source: conflicting,
	});
	let ids = 0;
	const prepared = prepareFramescaperSessionClipboardPasteV13(
		PROFILE,
		destination,
		clipboard,
		imagePasteCommand(fixture.descriptor, { clipId: 'collision-copy' }),
		(prefix = 'id') => `${prefix}-${String(++ids)}`,
	);
	const copiedSourceId = prepared.imageSourceIdMap.get(fixture.source.id);
	assert.equal(copiedSourceId, 'image-source-2');
	assert.deepEqual(prepared.bodyTransfers.map(({ mode, fromStorageKey, toStorageKey }) => ({
		mode, fromStorageKey, toStorageKey,
	})), [{ mode: 'copy', fromStorageKey: fixture.source.id, toStorageKey: copiedSourceId }]);

	const store = memoryStore(context, 'clipboard-collision');
	await seedImage(store, fixture.source.id, fixture.bytes);
	const stage = await stageFramescaperSessionClipboardImageBodiesV13(prepared.bodyTransfers, store);
	assert.equal(stage.publicationCount, 1);
	assert.deepEqual(await bodyBytes(store, copiedSourceId!), fixture.bytes);
	await stage.rollback();
	assert.equal(await store.getMediaAssetMetadata(copiedSourceId!), null);
	assert.deepEqual(await bodyBytes(store, fixture.source.id), fixture.bytes);

	const retained = await stageFramescaperSessionClipboardImageBodiesV13(prepared.bodyTransfers, store);
	retained.complete();
	const pasted = applyFramescaperProjectCommandV32(PROFILE, destination, prepared.command);
	const copiedSource = pasted.sources.find(({ id }) => id === copiedSourceId);
	assert.ok(copiedSource && copiedSource.kind === 'image');
	assert.equal(copiedSource.storageKey, copiedSourceId);
	assert.equal(copiedSource.contentSha256, fixture.source.contentSha256);
	assert.equal(pasted.clips.find(({ id }) => id === 'collision-copy')?.sourceId, copiedSourceId);
	assert.deepEqual(await bodyBytes(store, copiedSourceId!), fixture.bytes);
});

type Store = ReturnType<typeof createProjectStore>;

function memoryStore(context: TestContext, label: string): Store {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `v32-clipboard-${label}` });
	context.after(async () => { await store.close(); });
	return store;
}

async function seedImage(store: Store, storageKey: string, bytes: Uint8Array): Promise<void> {
	await store.writeMediaAsset(storageKey, new Blob([Uint8Array.from(bytes).buffer], {
		type: 'application/vnd.framescaper.image-asset',
	}), {
		name: 'image.fsci', kind: 'timeline-image', encoding: 'framescaper-image-asset-v1',
		mimeType: 'application/vnd.framescaper.image-asset',
	});
}

async function bodyBytes(store: Store, storageKey: string): Promise<Uint8Array> {
	const body = await store.loadMediaAsset(storageKey);
	if (!body) throw new Error(`Missing body ${storageKey}.`);
	return new Uint8Array(await body.arrayBuffer());
}
