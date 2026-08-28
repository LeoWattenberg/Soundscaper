/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodeVideoTimingAsset,
	encodeVideoTimingAsset,
	normalizeVideoTimingAssetReference,
	validateVideoTimingAssetBytes,
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
	serializeScapeExportManifest,
} from '../src/common/editor/scape-export-plan.ts';
import { indexScapeProjectTimingAssets } from '../src/common/editor/scape-project-assets.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import {
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
} from '../src/common/editor/project-schema-identity.ts';
import { createBaselineAudioEditorProject } from './helpers/baseline-scape-runtime.ts';

const SOURCE_SHA256 = '1'.repeat(64);
const OTHER_SOURCE_SHA256 = '3'.repeat(64);
const SCAPE_IDENTITY_OPTIONS = Object.freeze({
	currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
});

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
		timescale: 0x1_0000_0000,
		presentationTicks: [0n],
		finalFrameDurationTicks: 1n,
	}), /timescale.*32-bit|timescale.*maximum/iu);
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
	const reference = {
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: `video-timing-sha256:${'a'.repeat(64)}`,
		sha256: 'a'.repeat(64),
		sourceSha256: SOURCE_SHA256,
		byteLength: 40,
		frameCount: 1,
		timescale: 0x1_0000_0000,
		finalFrameDurationTicks: '1',
	};
	assert.throws(() => normalizeVideoTimingAssetReference(reference), /timescale.*32-bit|timescale.*maximum/iu);
});

test('bound timing validation rejects a self-consistent digest over malformed codec bytes', async () => {
	const bytes = new Uint8Array(40);
	const { sha256 } = await import('@noble/hashes/sha2.js');
	const { bytesToHex } = await import('@noble/hashes/utils.js');
	const digest = bytesToHex(sha256(bytes));
	const reference = {
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: `video-timing-sha256:${digest}`,
		sha256: digest,
		sourceSha256: SOURCE_SHA256,
		byteLength: bytes.byteLength,
		frameCount: 1,
		timescale: 1_000,
		finalFrameDurationTicks: '40',
	};
	assert.throws(() => validateVideoTimingAssetBytes(reference, bytes), /magic|timing asset/iu);
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
	const project = createBaselineAudioEditorProject({
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
	}, { output: 'blob', ...SCAPE_IDENTITY_OPTIONS });
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

test('.scape export deduplicates shared timing content and binds completed body digests', async () => {
	const store = new VideoTimingAssetStore();
	const reference = await store.publish(SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n],
		finalFrameDurationTicks: 40n,
	});
	const videoSource = (id: string, storageKey: string, sourceSha256: string) => ({
		id, kind: 'video', storageKey, mimeType: 'video/mp4', frameCount: 4_800,
		sampleRate: 48_000, width: 16, height: 16, frameRate: { num: 30, den: 1 },
		sourceFrameCount: reference.frameCount, contentSha256: sourceSha256,
		timingAsset: { ...reference, sourceSha256 },
	});
	const project = createBaselineAudioEditorProject({
		sources: [
			videoSource('video-a', 'video-original-a', SOURCE_SHA256),
			videoSource('video-b', 'video-original-b', OTHER_SOURCE_SHA256),
		],
	});
	const plan = await prepareScapeExport(project, {
		async getMediaAssetMetadata(storageKey: string) {
			return storageKey === reference.storageKey
				? { size: reference.byteLength, sha256: reference.sha256 }
				: { size: 12, sha256: storageKey.endsWith('-a') ? SOURCE_SHA256 : OTHER_SOURCE_SHA256 };
		},
	}, { output: 'blob', ...SCAPE_IDENTITY_OPTIONS });
	assert.equal(plan.assets.filter(({ kind }) => kind === 'video-timing').length, 1);
	const completed = plan.assets.map((asset) => completeScapeExportAsset(
		asset,
		asset.kind === 'video-timing'
			? reference.sha256
			: asset.storageKey.endsWith('-a') ? SOURCE_SHA256 : OTHER_SOURCE_SHA256,
	));
	assert.doesNotThrow(() => serializeScapeExportManifest(plan, completed));
	assert.throws(() => serializeScapeExportManifest(plan, completed.map((asset, index) => (
		index === 0 ? { ...asset, sha256: '2'.repeat(64) } : asset
	))), /digest|SHA-256|project reference/iu);
});

test('.scape export rejects digest-consistent malformed timing before archive publication', async () => {
	const malformed = new Uint8Array(48);
	const sha256 = digestScapeBytes(malformed);
	const reference = {
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: `video-timing-sha256:${sha256}`,
		sha256,
		sourceSha256: SOURCE_SHA256,
		byteLength: malformed.byteLength,
		frameCount: 2,
		timescale: 1_000,
		finalFrameDurationTicks: '40',
	} as const;
	const project = createBaselineAudioEditorProject({
		sources: [{
			id: 'video-source', kind: 'video', storageKey: 'video-original', mimeType: 'video/mp4',
			frameCount: 4_800, sampleRate: 48_000, width: 16, height: 16,
			frameRate: { num: 30, den: 1 }, sourceFrameCount: 2,
			contentSha256: SOURCE_SHA256, timingAsset: reference,
		}],
	});
	await assert.rejects(exportScapeProject(project, {
		async *readSourceChunks() { /* Video-only archive. */ },
		async getMediaAssetMetadata(storageKey: string) {
			return storageKey === reference.storageKey
				? { size: reference.byteLength, sha256: reference.sha256 }
				: { size: 4, sha256: SOURCE_SHA256 };
		},
		async loadMediaAsset(storageKey: string) {
			return storageKey === reference.storageKey
				? new Blob([malformed])
				: new Blob([Uint8Array.of(1, 2, 3, 4)]);
		},
	}, SCAPE_IDENTITY_OPTIONS), /timing|magic|codec/iu);
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
	const persist = async (
		storageKey: string,
		blob: Blob,
		metadata: Readonly<Record<string, unknown>> = {},
	) => {
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const persisted = Object.freeze({
			...metadata,
			sha256: digestScapeBytes(bytes),
			size: blob.size,
		});
		const record = Object.freeze({ blob, metadata: persisted });
		records.set(storageKey, record);
		return record;
	};
	const store = {
		async getMediaAssetMetadata(storageKey: string) {
			return records.get(storageKey)?.metadata ?? null;
		},
		async writeMediaAsset(storageKey: string, blob: Blob, metadata: Readonly<Record<string, unknown>> = {}) {
			return (await persist(storageKey, blob, metadata)).metadata;
		},
		async beginMediaAssetWrite(
			storageKey: string,
			metadata: Readonly<Record<string, unknown>>,
		) {
			const chunks: Uint8Array[] = [];
			let bytesWritten = 0;
			return {
				maximumChunkBytes: 8,
				get bytesWritten() { return bytesWritten; },
				async write(bytes: Uint8Array) {
					chunks.push(bytes.slice());
					bytesWritten += bytes.byteLength;
				},
				async commit() { throw new Error('The unowned timing commit must not be used.'); },
				async commitOwned() {
					const record = await persist(
						storageKey,
						new Blob(chunks.map((chunk) => Uint8Array.from(chunk).buffer)),
						metadata,
					);
					return {
						metadata: record.metadata,
						async discardIfCurrent() {
							if (records.get(storageKey) !== record) return false;
							records.delete(storageKey);
							return true;
						},
					};
				},
				async abort() { chunks.length = 0; },
			};
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
	await assert.rejects(
		publishVideoTimingAsset(store, SOURCE_SHA256, {
			timescale: 1_000,
			presentationTicks: [0n, 40n, 81n],
			finalFrameDurationTicks: 39n,
		}),
		/corrupt|immutable|stored content/iu,
	);
});

test('durable timing publication discards its exact committed generation on metadata drift', async () => {
	let commits = 0;
	let discards = 0;
	let legacyWrites = 0;
	await assert.rejects(publishVideoTimingAsset({
		async getMediaAssetMetadata() { return null; },
		async writeMediaAsset() {
			legacyWrites += 1;
			throw new Error('The legacy whole-Blob writer must not publish timing media.');
		},
		async beginMediaAssetWrite(_storageKey, _metadata, options) {
			let bytesWritten = 0;
			return {
				maximumChunkBytes: 8,
				get bytesWritten() { return bytesWritten; },
				async write(bytes: Uint8Array) { bytesWritten += bytes.byteLength; },
				async commit() { throw new Error('The unowned commit must not be used.'); },
				async commitOwned() {
					commits += 1;
					return {
						metadata: { size: bytesWritten + 1, sha256: options.expectedSha256 },
						async discardIfCurrent() { discards += 1; return true; },
					};
				},
				async abort() { /* No staged state remains after commit. */ },
			};
		},
		async loadMediaAsset() { return null; },
	}, SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n],
		finalFrameDurationTicks: 40n,
	}), /metadata|canonical reference/iu);
	assert.equal(commits, 1);
	assert.equal(discards, 1);
	assert.equal(legacyWrites, 0);
});

test('durable timing load rejects oversized bodies before materializing them', async () => {
	const store = new VideoTimingAssetStore();
	const reference = await store.publish(SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks: [0n],
		finalFrameDurationTicks: 40n,
	});
	let materializations = 0;
	const oversized = {
		size: reference.byteLength + 1,
		async arrayBuffer() { materializations += 1; throw new Error('must not materialize'); },
	} as unknown as Blob;
	assert.equal((await loadVideoTimingAsset({
		async loadMediaAsset() { return oversized; },
	}, reference)).status, 'corrupt');
	assert.equal(materializations, 0);
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
