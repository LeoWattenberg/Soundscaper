/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type { BlobLike } from '../src/common/editor/storage/media-records.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../src/common/editor/timeline-image-model-v30.ts';
import type { ProductVideoVisualPreviewSession } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { applyFramescaperProjectCommandV30 } from '../src/framescaper/editor-project-v30-commands.ts';
import {
	openFramescaperStoredImageFramePackV30,
	type FramescaperStoredImageAssetStoreV30,
} from '../src/framescaper/editor-selected-v30-image-frame-source.ts';
import {
	createFramescaperSelectedProjectBinThumbnailV30,
	createFramescaperSelectedVisualPreviewSessionV30,
} from '../src/framescaper/editor-selected-v30-image-preview.ts';
import {
	createFramescaperSelectedTimelineFilmstripV30,
} from '../src/framescaper/editor-selected-v30-image-filmstrip.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { createFramescaperProjectV30, type FramescaperProjectV30 } from '../src/framescaper/editor-project-v30.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;
const RED = [255, 0, 0, 255] as const;
const GREEN = [0, 255, 0, 128] as const;

test('V30 image preview authenticates once and maps sample boundaries to exact packed frames', async () => {
	const fixture = imageProject('timeline');
	const loaded: string[] = [];
	const presented: Readonly<{ clipId: string; rgba: readonly number[] }>[] = [];
	let disposed = false;
	const session = await createFramescaperSelectedVisualPreviewSessionV30({
		profile: PROFILE,
		project: fixture.project,
		store: storeFor(fixture.bytes, loaded),
		width: 4,
		height: 2,
		createImageDrawable({ clipId, width, height }) {
			return {
				video: { drawable: {}, videoWidth: width, videoHeight: height, readyState: 4, currentTime: 0, pause() {} },
				present(rgba) { presented.push({ clipId, rgba: [...rgba.subarray(0, 4)] }); },
				dispose() { disposed = true; },
			};
		},
	});
	assert.ok(session);
	assert.deepEqual(loaded, ['image-source']);

	const beforeBoundary = session.resolve(47_999);
	assert.equal(beforeBoundary.layers.length, 1);
	assert.equal(beforeBoundary.layers[0]?.trackId, 'video-track');
	assert.equal(beforeBoundary.layers[0]?.entries[0]?.imageFrameIndex, 0);
	assert.equal(beforeBoundary.layers[0]?.entries[0]?.imageSourceTicks, '900000');
	assert.deepEqual(beforeBoundary.ledger, {
		requestedNodeIds: ['render:image:image-clip'],
		consumedNodeIds: ['render:image:image-clip'],
		omittedNodeIds: [],
	});

	const atBoundary = session.resolve(48_000);
	assert.equal(atBoundary.layers[0]?.entries[0]?.imageFrameIndex, 1);
	assert.equal(atBoundary.layers[0]?.entries[0]?.imageSourceTicks, '1000000');
	assert.deepEqual(presented.map(({ rgba }) => rgba), [RED, GREEN]);
	assert.deepEqual(session.resolve(240_000).layers, [], 'the clip is inactive at its exclusive end');
	session.dispose();
	assert.equal(disposed, true);
	assert.throws(() => session.resolve(0), /disposed/iu);
});

test('V30 image preview coalesces inherited entries and exact ledgers on one track', async () => {
	const fixture = imageProject('timeline');
	let inheritedDisposed = false;
	const inherited = inheritedSession(() => { inheritedDisposed = true; });
	const session = await createFramescaperSelectedVisualPreviewSessionV30({
		profile: PROFILE,
		project: fixture.project,
		store: storeFor(fixture.bytes),
		width: 2,
		height: 2,
		createInheritedSession: async () => inherited,
		createImageDrawable({ width, height }) {
			return {
				video: { drawable: {}, videoWidth: width, videoHeight: height, readyState: 4, currentTime: 0, pause() {} },
				present() {},
				dispose() {},
			};
		},
	});
	assert.ok(session);
	const frame = session.resolve(0);
	assert.equal(frame.layers.length, 1);
	assert.deepEqual(frame.layers[0]?.entries.map(({ clipId }) => clipId), ['legacy-clip', 'image-clip']);
	assert.deepEqual(frame.ledger.requestedNodeIds, ['render:image:image-clip', 'render:visual:legacy-clip']);
	assert.deepEqual(frame.ledger.consumedNodeIds, frame.ledger.requestedNodeIds);
	assert.equal(session.renderExact, undefined,
		'the inherited flattened exact graph cannot silently omit or misorder a V30 image layer');
	session.dispose();
	assert.equal(inheritedDisposed, true);
});

test('V30 Project Bin thumbnails and timeline filmstrips read the addressed authenticated frames', async () => {
	const bin = imageProject('project-bin', '1000000');
	const thumbnail = await createFramescaperSelectedProjectBinThumbnailV30({
		profile: PROFILE,
		project: bin.project,
		store: storeFor(bin.bytes),
		clipId: 'image-clip',
		width: 4,
		height: 2,
	});
	assert.ok(thumbnail);
	assert.equal(thumbnail.width, 4);
	assert.equal(thumbnail.height, 2);
	assert.deepEqual([...thumbnail.pixels.subarray(0, 4)], GREEN);
	assert.deepEqual(thumbnail.presentationIds, []);
	assert.deepEqual(thumbnail.maskIds, []);

	const timeline = imageProject('timeline');
	const filmstrip = await createFramescaperSelectedTimelineFilmstripV30({
		profile: PROFILE,
		project: timeline.project,
		store: storeFor(timeline.bytes),
		width: 4,
		height: 2,
		frames: [{
			key: 'before', clipId: 'image-clip', sourceId: 'image-source',
			timelineSample: 47_999, sourceUrl: 'ignored:image-frame-0',
		}, {
			key: 'at', clipId: 'image-clip', sourceId: 'image-source',
			timelineSample: 48_000, sourceUrl: 'ignored:image-frame-1',
		}],
	});
	assert.ok(filmstrip);
	assert.deepEqual(filmstrip.map(({ key }) => key), ['before', 'at']);
	assert.deepEqual([...filmstrip[0]!.pixels.subarray(0, 4)], RED);
	assert.deepEqual([...filmstrip[1]!.pixels.subarray(0, 4)], GREEN);
});

test('every V30 image preview consumer fails closed on changed frame-pack bytes', async () => {
	const fixture = imageProject('timeline');
	const changed = fixture.bytes.slice();
	changed[changed.length - 1] ^= 1;
	await assert.rejects(createFramescaperSelectedVisualPreviewSessionV30({
		profile: PROFILE,
		project: fixture.project,
		store: storeFor(changed),
		width: 2,
		height: 2,
		createImageDrawable() { throw new Error('changed bytes must fail before drawable publication'); },
	}), /complete body digest binding/iu);
	await assert.rejects(createFramescaperSelectedTimelineFilmstripV30({
		profile: PROFILE,
		project: fixture.project,
		store: storeFor(changed),
		width: 2,
		height: 2,
		frames: [{
			key: 'changed', clipId: 'image-clip', sourceId: 'image-source',
			timelineSample: 0, sourceUrl: 'ignored:changed',
		}],
	}), /complete body digest binding/iu);
});

test('V30 stored image readers snapshot structural bodies before authenticating ranges', async () => {
	const authentic = imageProject('timeline');
	const switched = imageProject('timeline', '0', [0, 0, 255, 255]);
	assert.equal(switched.bytes.byteLength, authentic.bytes.byteLength);
	let sliceReads = 0;
	let transferred: ArrayBuffer | null = null;
	const body: BlobLike = {
		size: authentic.bytes.byteLength,
		arrayBuffer() {
			transferred = ownedBuffer(authentic.bytes);
			return Promise.resolve(transferred);
		},
		slice(start = 0, end = authentic.bytes.byteLength): BlobLike {
			const selected = sliceReads++ === 0 ? authentic.bytes : switched.bytes;
			return fixedBody(selected.subarray(start, end));
		},
	};
	const store: FramescaperStoredImageAssetStoreV30 = {
		loadMediaAsset: () => Promise.resolve(body),
	};
	const source = authentic.project.sources.find(({ kind }) => kind === 'image');
	assert.ok(source);
	const reader = await openFramescaperStoredImageFramePackV30(store, source);
	assert.deepEqual([...await reader.readFrame(0)].slice(0, 4), RED);
	assert.equal(sliceReads, 0, 'authentication must use one owned body snapshot, not mutable range reads');
	assert.equal(transferred?.byteLength, 0, 'the structural body cannot retain mutable snapshot authority');
});

function imageProject(
	placement: 'timeline' | 'project-bin',
	sourceStartTicks = '0',
	firstFrame: readonly [number, number, number, number] = RED,
): Readonly<{ project: FramescaperProjectV30; bytes: Uint8Array }> {
	const publication = createFramescaperImageFramePackV1({
		original: new TextEncoder().encode('authenticated APNG original'),
		receipt: { decoder: 'test', schemaVersion: 1 },
		width: 2,
		height: 1,
		timingMode: 'embedded',
		frames: [{
			presentationTicks: 0n,
			durationTicks: 1_000_000n,
			rgba: Uint8Array.of(...firstFrame, 0, 0, 0, 0),
		}, {
			presentationTicks: 1_000_000n,
			durationTicks: 4_000_000n,
			rgba: Uint8Array.of(...GREEN, 0, 0, 255, 255),
		}],
	});
	const source: FramescaperImageSourceV1 = {
		schemaVersion: 1,
		kind: 'image',
		id: 'image-source',
		name: 'Animated image',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'image-source',
		contentSha256: publication.contentSha256,
		assetByteLength: publication.assetByteLength,
		original: {
			fileName: 'animated.png',
			mimeType: 'image/png',
			recognizedFormat: 'apng',
			byteLength: publication.originalByteLength,
			sha256: publication.originalSha256,
		},
		canonical: {
			width: publication.width,
			height: publication.height,
			hasAlpha: publication.hasAlpha,
			frameCount: publication.frameCount,
			durationTicks: publication.durationTicks,
			timingMode: publication.timingMode,
		},
		conversionReceiptSha256: publication.conversionReceiptSha256,
	};
	const baseOptions = framescaperV20Options();
	baseOptions.sources = (baseOptions.sources as Readonly<Record<string, unknown>>[])
		.filter(({ kind }) => kind !== 'video');
	baseOptions.clips = (baseOptions.clips as Readonly<Record<string, unknown>>[])
		.filter(({ kind }) => kind !== 'video');
	(baseOptions.projectBin as Record<string, unknown>).clips = [];
	const videoTrack = (baseOptions.tracks as Record<string, unknown>[])
		.find(({ type }) => type === 'video');
	assert.ok(videoTrack);
	videoTrack.clipIds = [];
	const base = createFramescaperProjectV30(PROFILE, baseOptions);
	const clip: FramescaperImageClipV1 = {
		schemaVersion: 1,
		kind: 'image',
		id: 'image-clip',
		sourceId: source.id,
		sequenceId: base.primarySequenceId,
		sequenceStartFrame: 0,
		sequenceFrameCount: 50,
		sourceStartTicks,
	};
	const project = applyFramescaperProjectCommandV30(PROFILE, base, {
		type: 'batch',
		commands: [{
			type: 'image-source/set', sourceId: source.id, expectedSource: null, source,
		}, {
			type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null,
			clip,
			placement: placement === 'timeline'
				? { scope: 'timeline', trackId: String(videoTrack.id) }
				: { scope: 'project-bin' },
		}],
	});
	return Object.freeze({ project, bytes: publication.bytes });
}

function storeFor(bytes: Uint8Array, loaded: string[] = []): AudioEditorProjectStore {
	const owned: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
	owned.set(bytes);
	return {
		async loadMediaAsset(sourceId: string): Promise<Blob> {
			loaded.push(sourceId);
			return new Blob([owned]);
		},
	} as unknown as AudioEditorProjectStore;
}

function fixedBody(bytes: Uint8Array): BlobLike {
	const owned = Uint8Array.from(bytes);
	return {
		size: owned.byteLength,
		arrayBuffer: () => Promise.resolve(ownedBuffer(owned)),
		slice(start = 0, end = owned.byteLength): BlobLike {
			return fixedBody(owned.subarray(start, end));
		},
	};
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
	return Uint8Array.from(bytes).buffer;
}

function inheritedSession(dispose: () => void): ProductVideoVisualPreviewSession {
	const frame = Object.freeze({
		layers: Object.freeze([Object.freeze({
			trackId: 'video-track', trackIndex: 0,
			entries: Object.freeze([Object.freeze({ clipId: 'legacy-clip' })]),
		})]),
		adjustments: Object.freeze([]),
		activeFreezeNodeIds: Object.freeze([]),
		availablePresetIds: Object.freeze([]),
		ledger: Object.freeze({
			requestedNodeIds: Object.freeze(['render:visual:legacy-clip']),
			consumedNodeIds: Object.freeze(['render:visual:legacy-clip']),
			omittedNodeIds: Object.freeze([]),
		}),
	});
	return Object.freeze({
		resolve: () => frame,
		resolveTransitionWeight: () => null,
		async renderExact() {
			return Object.freeze({ frame, layers: Object.freeze([]), renderedEffectIds: Object.freeze([]) });
		},
		dispose,
	});
}
