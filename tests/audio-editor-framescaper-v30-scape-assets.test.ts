/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import type { ScapeArchiveEntry, ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';
import { ScapeExpandedByteBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import {
	ScapeImportTransaction,
	type ScapeImportStore,
} from '../src/common/editor/scape-import-transaction.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import {
	createFramescaperScapeProjectAssetExtensionV30,
} from '../src/framescaper/editor-scape-assets-v30.ts';
import {
	FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V30,
	collectFramescaperScapeImageAssetReferencesV30,
} from '../src/framescaper/editor-scape-asset-plan-v30.ts';
import { createFramescaperV30ImageFixture } from './helpers/framescaper-v30-image-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;

test('V30 Scape extension plans and validates one exact semantic image body', async (context) => {
	const fixture = createFramescaperV30ImageFixture();
	const store = memoryStore(context, 'plan');
	await seedImage(store, fixture.source.id, fixture.bytes);
	const extension = createFramescaperScapeProjectAssetExtensionV30(PROFILE);
	const assets = await extension.planExportAssets({ project: fixture.project, store });
	const image = assets.find(({ kind }) => kind === FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V30);
	assert.ok(image);
	assert.equal(image.sourceId, `framescaper-v30:image:${fixture.source.id}`);
	assert.equal(image.storageKey, fixture.source.storageKey);
	assert.equal(image.encoding, 'framescaper-image-asset-v1');
	assert.equal(image.mimeType, 'application/vnd.framescaper.image-asset');
	assert.equal(image.size, fixture.bytes.byteLength);
	await extension.validateExportAssetBody(image, new Blob([Uint8Array.from(fixture.bytes).buffer]));
	assert.deepEqual(collectFramescaperScapeImageAssetReferencesV30(fixture.project).map(
		({ sourceId, storageKey }) => ({ sourceId, storageKey }),
	), [{ sourceId: fixture.source.id, storageKey: fixture.source.id }]);
	assert.equal(extension.sourceStorageRole(fixture.source as unknown as Readonly<Record<string, unknown>>), 'media');
	assert.equal(extension.sourceKinds.includes('image'), true);
	assert.equal(extension.assetKinds.includes(FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V30), true);
});

test('V30 Scape import stages a rebound image body with exact owned identity', async (context) => {
	const fixture = createFramescaperV30ImageFixture();
	const sourceStore = memoryStore(context, 'source');
	await seedImage(sourceStore, fixture.source.id, fixture.bytes);
	const extension = createFramescaperScapeProjectAssetExtensionV30(PROFILE);
	const assets = await extension.planExportAssets({ project: fixture.project, store: sourceStore });
	const image = assets.find(({ kind }) => kind === FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V30)!;
	const manifest = manifestFor(image);
	const validation = extension.validateImportAssets(fixture.project, manifest);
	const rebound = structuredClone(fixture.project) as unknown as Record<string, unknown>;
	const reboundId = 'image-source-copy';
	for (const source of rebound.sources as Record<string, unknown>[]) {
		if (source.id === fixture.source.id) { source.id = reboundId; source.storageKey = reboundId; }
	}
	for (const clip of rebound.clips as Record<string, unknown>[]) {
		if (clip.sourceId === fixture.source.id) clip.sourceId = reboundId;
	}
	const recipient = memoryStore(context, 'recipient');
	const importStore = recipient as unknown as ScapeImportStore;
	const transaction = new ScapeImportTransaction(importStore);
	await extension.stageImportAssets({
		archiveProject: structuredClone(fixture.project) as unknown as Record<string, unknown>,
		project: rebound,
		manifest,
		entryByName: new Map([[image.entry, emittingEntry(image.entry, fixture.bytes)]]),
		expandedByteBudget: new ScapeExpandedByteBudget(fixture.bytes.byteLength),
		sourceIdMap: new Map([[fixture.source.id, reboundId]]),
		validation,
		store: importStore,
		transaction,
	});
	transaction.complete();
	assert.deepEqual(await bodyBytes(recipient, reboundId), fixture.bytes);
	assert.equal(await recipient.getMediaAssetMetadata(fixture.source.id), null);
});

test('V30 Scape semantic validation rejects internally tampered frames even with a rebound outer digest', async (context) => {
	const fixture = createFramescaperV30ImageFixture();
	const tampered = fixture.bytes.slice();
	const view = new DataView(tampered.buffer);
	const indexOffset = Number(view.getBigUint64(64, true));
	const frameOffset = Number(view.getBigUint64(indexOffset + 16, true));
	tampered[frameOffset] ^= 0xff;
	const digest = await crypto.subtle.digest('SHA-256', tampered);
	const changedSha = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	const project = structuredClone(fixture.project) as unknown as Record<string, unknown>;
	const source = (project.sources as Record<string, unknown>[]).find(({ kind }) => kind === 'image')!;
	source.contentSha256 = changedSha;
	const store = memoryStore(context, 'tamper');
	await seedImage(store, fixture.source.id, tampered);
	const extension = createFramescaperScapeProjectAssetExtensionV30(PROFILE);
	const image = (await extension.planExportAssets({ project, store }))
		.find(({ kind }) => kind === FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V30)!;
	await assert.rejects(async () => {
		await extension.validateExportAssetBody(image, new Blob([Uint8Array.from(tampered).buffer]));
	}, /compressed.*digest|zlib/iu);
});

type Store = ReturnType<typeof createProjectStore>;
type PlannedAsset = Awaited<ReturnType<ReturnType<typeof createFramescaperScapeProjectAssetExtensionV30>['planExportAssets']>>[number];

function memoryStore(context: TestContext, label: string): Store {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `v30-scape-${label}` });
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

function manifestFor(asset: PlannedAsset): ScapeManifest {
	if (!asset.expectedSha256) throw new Error('The planned image asset requires its digest.');
	return {
		format: 'scape-project',
		formatVersion: 1,
		project: { entry: 'project.json', size: 2, sha256: '00'.repeat(32) },
		assets: [{
			sourceId: asset.sourceId,
			kind: asset.kind,
			entry: asset.entry,
			encoding: asset.encoding,
			mimeType: asset.mimeType,
			size: asset.size,
			sha256: asset.expectedSha256,
		}],
	};
}

function emittingEntry(filename: string, bytes: Uint8Array): ScapeArchiveEntry {
	return {
		filename,
		directory: false,
		encrypted: false,
		compressionMethod: 0,
		compressedSize: bytes.byteLength,
		uncompressedSize: bytes.byteLength,
		async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			const output = writable.getWriter();
			for (let offset = 0; offset < bytes.byteLength; offset += 17) {
				await output.write(bytes.subarray(offset, Math.min(bytes.byteLength, offset + 17)));
			}
			await output.close();
		},
	};
}
