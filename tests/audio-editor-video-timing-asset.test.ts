/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodeVideoTimingAsset,
	encodeVideoTimingAsset,
	VideoTimingAssetStore,
	videoTimingAssetArchiveDescriptor,
	VIDEO_TIMING_ASSET_ENCODING,
} from '../src/common/editor/video-timing-asset.ts';
import {
	loadVideoTimingAsset,
	publishVideoTimingAsset,
} from '../src/common/editor/video-timing-storage.ts';
import {
	completeScapeExportAsset,
	prepareScapeExport,
} from '../src/common/editor/scape-export-plan.ts';
import { indexScapeProjectTimingAssets } from '../src/common/editor/scape-project-assets.ts';
import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

const SOURCE_SHA256 = '1'.repeat(64);

test('timing codec is canonical and derives the final frame from an explicit duration', () => {
	const first = encodeVideoTimingAsset({
		timescale: 90_000,
		presentationTicks: [0n, 3_003n, 6_007n],
		finalFrameDurationTicks: 3_002n,
	});
	const second = encodeVideoTimingAsset({
		timescale: 90_000,
		presentationTicks: [0n, 3_003n, 6_007n],
		finalFrameDurationTicks: 3_002n,
	});
	assert.deepEqual(first, second);
	assert.deepEqual(decodeVideoTimingAsset(first), {
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		timescale: 90_000,
		frameCount: 3,
		presentationTicks: [0n, 3_003n, 6_007n],
		finalFrameDurationTicks: 3_002n,
		endTicks: 9_009n,
	});
});

test('timing codec rejects non-canonical, corrupt, and over-bound tables', () => {
	assert.throws(() => encodeVideoTimingAsset({
		timescale: 1_000,
		presentationTicks: [0n, 0n],
		finalFrameDurationTicks: 1n,
	}), /strictly increasing/iu);
	assert.throws(() => encodeVideoTimingAsset({
		timescale: 1_000,
		presentationTicks: [1n],
		finalFrameDurationTicks: 1n,
	}), /begin at zero/iu);
	assert.throws(() => decodeVideoTimingAsset(new Uint8Array(31)), /header|length/iu);
	const corrupt = encodeVideoTimingAsset({
		timescale: 1_000,
		presentationTicks: [0n, 40n],
		finalFrameDurationTicks: 40n,
	});
	corrupt[4] = 99;
	assert.throws(() => decodeVideoTimingAsset(corrupt), /version/iu);
});

test('publication is immutable, digest-bound to source content, and archive-addressable', async () => {
	const store = new VideoTimingAssetStore();
	const reference = await store.publish(SOURCE_SHA256, {
		timescale: 1_000_000,
		presentationTicks: [0n, 33_366n, 66_733n],
		finalFrameDurationTicks: 33_367n,
	});
	assert.equal(reference.encoding, VIDEO_TIMING_ASSET_ENCODING);
	assert.equal(reference.sourceSha256, SOURCE_SHA256);
	assert.match(reference.sha256, /^[a-f0-9]{64}$/u);
	assert.equal(reference.storageKey, `video-timing-sha256:${reference.sha256}`);
	assert.deepEqual(await store.publish(SOURCE_SHA256, {
		timescale: 1_000_000,
		presentationTicks: [0n, 33_366n, 66_733n],
		finalFrameDurationTicks: 33_367n,
	}), reference);
	assert.equal((await store.load(reference)).status, 'available');
	assert.deepEqual(videoTimingAssetArchiveDescriptor(reference), {
		kind: 'video-timing',
		entry: `timing/${reference.sha256}.scti`,
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: reference.storageKey,
		size: reference.byteLength,
		sha256: reference.sha256,
	});
	const bytes = await store.exportAsset(reference);
	const handedOff = new VideoTimingAssetStore();
	await handedOff.importAsset(reference, bytes);
	assert.equal((await handedOff.load(reference)).status, 'available');
	await assert.rejects(() => handedOff.importAsset(reference, Uint8Array.of(1, 2, 3)), /digest binding/iu);
});

test('.scape export plans and admission preserve the exact timing-asset binding', async () => {
	const store = new VideoTimingAssetStore();
	const reference = await store.publish(SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n, 81n],
		finalFrameDurationTicks: 39n,
	});
	const project = createAudioEditorProjectV10({
		sources: [{
			id: 'video-source',
			kind: 'video',
			storageKey: 'video-original',
			mimeType: 'video/mp4',
			frameCount: 4_800,
			sampleRate: 48_000,
			width: 16,
			height: 16,
			frameRate: { num: 30, den: 1 },
			sourceFrameCount: 3,
			contentSha256: SOURCE_SHA256,
			timingAsset: reference,
		}],
	});
	const plan = await prepareScapeExport(project, {
		async getMediaAssetMetadata(storageKey: string) {
			if (storageKey === 'video-original') return { size: 12, sha256: SOURCE_SHA256 };
			if (storageKey === reference.storageKey) return { size: reference.byteLength, sha256: reference.sha256 };
			return null;
		},
	}, { output: 'blob' });
	assert.deepEqual(plan.assets.map(({ kind, sourceId, entry, encoding }) => ({ kind, sourceId, entry, encoding })), [
		{ kind: 'video', sourceId: 'video-source', entry: 'media/video-source/original', encoding: 'original' },
		{
			kind: 'video-timing',
			sourceId: reference.storageKey,
			entry: `timing/${reference.sha256}.scti`,
			encoding: VIDEO_TIMING_ASSET_ENCODING,
		},
	]);
	const assets = plan.assets.map((asset) => completeScapeExportAsset(
		asset,
		asset.kind === 'video-timing' ? reference.sha256 : SOURCE_SHA256,
	));
	assert.equal(indexScapeProjectTimingAssets(project, { assets }).get(reference.storageKey)?.entry,
		`timing/${reference.sha256}.scti`);
	assert.throws(() => indexScapeProjectTimingAssets(project, {
		assets: assets.map((asset) => asset.kind === 'video-timing'
			? { ...asset, sha256: '2'.repeat(64) }
			: asset),
	}), /missing the bound timing asset/iu);
});

test('missing and corrupt timing assets degrade explicitly without fabricating CFR timing', async () => {
	const store = new VideoTimingAssetStore();
	const reference = await store.publish(SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n],
		finalFrameDurationTicks: 40n,
	});
	const missingSha256 = '2'.repeat(64);
	assert.equal((await store.load({
		...reference,
		sha256: missingSha256,
		storageKey: `video-timing-sha256:${missingSha256}`,
	})).status, 'missing');
	store.testingCorrupt(reference.storageKey, 8);
	const result = await store.load(reference);
	assert.equal(result.status, 'corrupt');
	assert.equal(result.index, null);
	assert.equal((await store.load(reference, { sourceSha256: '3'.repeat(64) })).status, 'source-mismatch');
});

test('durable timing storage verifies immutable metadata, bytes, source binding, and digest on load', async () => {
	const records = new Map<string, Readonly<{ blob: Blob; metadata: Readonly<Record<string, unknown>> }>>();
	const store = {
		async getMediaAssetMetadata(storageKey: string) {
			return records.get(storageKey)?.metadata ?? null;
		},
		async writeMediaAsset(storageKey: string, blob: Blob, metadata: Readonly<Record<string, unknown>> = {}) {
			const bytes = new Uint8Array(await blob.arrayBuffer());
			const publication = await import('@noble/hashes/sha2.js');
			const utilities = await import('@noble/hashes/utils.js');
			const persisted = Object.freeze({
				...metadata,
				sha256: utilities.bytesToHex(publication.sha256(bytes)),
				size: blob.size,
			});
			records.set(storageKey, Object.freeze({ blob, metadata: persisted }));
			return persisted;
		},
		async loadMediaAsset(storageKey: string) {
			return records.get(storageKey)?.blob ?? null;
		},
	};
	const published = await publishVideoTimingAsset(store, SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n, 81n],
		finalFrameDurationTicks: 39n,
	});
	assert.equal((await loadVideoTimingAsset(store, published.reference, {
		sourceSha256: SOURCE_SHA256,
	})).status, 'available');
	assert.equal((await loadVideoTimingAsset(store, published.reference, {
		sourceSha256: '4'.repeat(64),
	})).status, 'source-mismatch');
	const record = records.get(published.reference.storageKey);
	assert.ok(record);
	const corrupt = new Uint8Array(await record.blob.arrayBuffer());
	corrupt[31] ^= 1;
	records.set(published.reference.storageKey, Object.freeze({
		blob: new Blob([corrupt]),
		metadata: record.metadata,
	}));
	assert.equal((await loadVideoTimingAsset(store, published.reference)).status, 'corrupt');
});

test('reclamation rechecks references and publication generation at the delete fence', async () => {
	const store = new VideoTimingAssetStore();
	const reference = await store.publish(SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks: [0n],
		finalFrameDurationTicks: 40n,
	});
	let checks = 0;
	const retained = await store.reclaim(reference.storageKey, {
		isReferenced: async () => ++checks === 2,
	});
	assert.equal(retained, false);
	assert.equal((await store.load(reference)).status, 'available');
	checks = 0;
	const deleted = await store.reclaim(reference.storageKey, {
		isReferenced: async () => { checks += 1; return false; },
	});
	assert.equal(deleted, true);
	assert.equal(checks, 2);
	assert.equal((await store.load(reference)).status, 'missing');
});
