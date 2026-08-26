/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type {
	ProductVideoVisualPreviewFrame,
	ProductVideoVisualPreviewSession,
} from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import type { FramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model-v32.ts';
import {
	FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_CONTEXTS_V32,
	admitFramescaperImageProjectBinThumbnailResourcesV32,
	admitFramescaperImageTimelineFilmstripResourcesV32,
	admitFramescaperImageTimelinePreviewResourcesV32,
} from '../src/framescaper/editor-selected-v32-image-preview-resources.ts';
import {
	createFramescaperSelectedProjectBinThumbnailV32,
	createFramescaperSelectedVisualPreviewSessionV32,
} from '../src/framescaper/editor-selected-v32-image-preview.ts';
import {
	createFramescaperSelectedTimelineFilmstripV32,
} from '../src/framescaper/editor-selected-v32-image-filmstrip.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import type { FramescaperProjectV32 } from '../src/framescaper/editor-project-v32.ts';
import { createFramescaperV32ImageFixture } from './helpers/framescaper-v32-image-fixture.ts';

const PROFILE = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;
const OVERSIZED_ASSET_BYTES = 300 * 1024 * 1024;

test('V32 preview resource plans count retained, drawable, output, cache, and transient bytes', () => {
	const { source } = createFramescaperV32ImageFixture({ imageOnly: true });
	const context = { source, width: 2, height: 1 };
	const preview = admitFramescaperImageTimelinePreviewResourcesV32([context, context]);
	assert.equal(preview.sourceCount, 1);
	assert.equal(preview.contextCount, 2);
	assert.equal(preview.snapshotBytes, BigInt(source.assetByteLength));
	assert.equal(preview.retainedFrameBytes, 16n, 'two fitted canonical frames remain resident');
	assert.equal(preview.drawableBackingBytes, 16n, 'each clip owns an eight-byte drawable');
	assert.equal(preview.transientRawFrameBytes, 9n, 'decode reserves RGBA plus the decoder sentinel');
	assert.equal(preview.transientScaledFrameBytes, 8n, 'canvas presentation makes one transient copy');
	assert.ok(preview.readerMetadataBytes > 0n);
	assert.equal(preview.totalBytes, sumBudget(preview));

	const filmstrip = admitFramescaperImageTimelineFilmstripResourcesV32([context, context, context]);
	assert.equal(filmstrip.requestOutputBytes, 24n);
	assert.equal(filmstrip.uniqueFrameCacheBytes, 24n,
		'preflight conservatively treats timing-dependent requests as unique');
	assert.equal(filmstrip.totalBytes, sumBudget(filmstrip));

	const thumbnail = admitFramescaperImageProjectBinThumbnailResourcesV32(source, 2, 1);
	assert.equal(thumbnail.requestOutputBytes, 8n);
	assert.equal(thumbnail.uniqueFrameCacheBytes, 0n);
	assert.equal(thumbnail.totalBytes, sumBudget(thumbnail));
});

test('V32 preview resource plans cap contexts and distinct sources', () => {
	const { source } = createFramescaperV32ImageFixture({ imageOnly: true });
	const context = { source, width: 2, height: 1 };
	assert.throws(() => admitFramescaperImageTimelinePreviewResourcesV32(
		Array.from({ length: FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_CONTEXTS_V32 + 1 }, () => context),
	), /context count bound/iu);
	assert.throws(() => admitFramescaperImageTimelineFilmstripResourcesV32(
		Array.from({ length: 513 }, (_, index) => ({
			source: reidentifiedSource(source, `image-source-${String(index)}`), width: 2, height: 1,
		})),
	), /source count bound/iu);
});

test('V32 preview consumers refuse aggregate packs before reads, inherited work, or drawables', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const timelineProject = withClaimedAssetBytes(fixture.project, OVERSIZED_ASSET_BYTES);
	const binProject = moveImageClipToProjectBin(timelineProject);
	let reads = 0;
	let inheritedStarts = 0;
	let drawableStarts = 0;
	const store = countingStore(fixture.bytes, () => { reads += 1; });

	await assert.rejects(createFramescaperSelectedVisualPreviewSessionV32({
		profile: PROFILE,
		project: timelineProject,
		store,
		width: 160,
		height: 90,
		createInheritedSession: async () => { inheritedStarts += 1; return null; },
		createImageDrawable() { drawableStarts += 1; throw new Error('must not create'); },
	}), /512 MiB working byte bound/iu);
	await assert.rejects(createFramescaperSelectedTimelineFilmstripV32({
		profile: PROFILE,
		project: timelineProject,
		store,
		width: 160,
		height: 90,
		createInheritedFilmstrip: async () => { inheritedStarts += 1; return Object.freeze([]); },
		frames: [{
			key: 'oversized', clipId: fixture.clip.id, sourceId: fixture.source.id,
			timelineSample: 0, sourceUrl: 'ignored:oversized',
		}],
	}), /512 MiB working byte bound/iu);
	await assert.rejects(createFramescaperSelectedProjectBinThumbnailV32({
		profile: PROFILE,
		project: binProject,
		store,
		clipId: fixture.clip.id,
		width: 320,
		height: 180,
	}), /512 MiB working byte bound/iu);
	assert.equal(reads, 0);
	assert.equal(inheritedStarts, 0);
	assert.equal(drawableStarts, 0);
});

test('V32 preview startup waits for both routes and disposes a successful inherited peer', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const changed = fixture.bytes.slice();
	changed[changed.length - 1] ^= 1;
	let inheritedDisposed = false;
	const inherited = emptySession(() => { inheritedDisposed = true; });
	await assert.rejects(createFramescaperSelectedVisualPreviewSessionV32({
		profile: PROFILE,
		project: fixture.project,
		store: countingStore(changed),
		width: 2,
		height: 2,
		createInheritedSession: async () => inherited,
		createImageDrawable() { throw new Error('failed image startup must not publish a drawable'); },
	}), /complete body digest binding/iu);
	assert.equal(inheritedDisposed, true);
});

test('V32 filmstrip failure zeroes a fulfilled inherited sibling output', async () => {
	const fixture = createFramescaperV32ImageFixture();
	const inheritedClip = fixture.project.clips.find(({ kind }) => kind !== 'image');
	if (!inheritedClip) throw new Error('The resource fixture requires an inherited clip.');
	const changed = fixture.bytes.slice();
	changed[changed.length - 1] ^= 1;
	const inheritedPixels = Uint8Array.of(1, 2, 3, 255);
	await assert.rejects(createFramescaperSelectedTimelineFilmstripV32({
		profile: PROFILE,
		project: fixture.project,
		store: countingStore(changed),
		width: 2,
		height: 2,
		createInheritedFilmstrip: async () => [Object.freeze({
			key: 'inherited', timelineSample: 0, width: 1, height: 1, pixels: inheritedPixels,
		})],
		frames: [{
			key: 'image', clipId: fixture.clip.id, sourceId: fixture.source.id,
			timelineSample: 0, sourceUrl: 'ignored:image',
		}, {
			key: 'inherited', clipId: String(inheritedClip.id), sourceId: String(inheritedClip.sourceId),
			timelineSample: 0, sourceUrl: 'ignored:inherited',
		}],
	}), /complete body digest binding/iu);
	assert.deepEqual([...inheritedPixels], [0, 0, 0, 0]);
});

test('V32 preview disposal zeroes eager frames and releases every drawable', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const presented: Uint8Array<ArrayBuffer>[] = [];
	let drawableDisposals = 0;
	const session = await createFramescaperSelectedVisualPreviewSessionV32({
		profile: PROFILE,
		project: fixture.project,
		store: countingStore(fixture.bytes),
		width: 2,
		height: 2,
		createInheritedSession: async () => null,
		createImageDrawable({ width, height }) {
			return {
				video: {
					drawable: {}, videoWidth: width, videoHeight: height,
					readyState: 4, currentTime: 0, pause() {},
				},
				present(rgba) { presented.push(rgba); },
				dispose() { drawableDisposals += 1; },
			};
		},
	});
	assert.ok(session);
	session.resolve(0);
	assert.equal(presented.length, 1);
	assert.ok(presented[0]!.some((value) => value !== 0));
	session.dispose();
	assert.equal(drawableDisposals, 1);
	assert.ok(presented[0]!.every((value) => value === 0));
});

type Budget = ReturnType<typeof admitFramescaperImageTimelinePreviewResourcesV32>;

function sumBudget(value: Budget): bigint {
	return value.snapshotBytes + value.readerMetadataBytes + value.retainedFrameBytes
		+ value.drawableBackingBytes + value.requestOutputBytes + value.uniqueFrameCacheBytes
		+ value.transientRangeBytes + value.transientRawFrameBytes + value.transientScaledFrameBytes;
}

function reidentifiedSource(source: FramescaperImageSourceV1, id: string): FramescaperImageSourceV1 {
	return { ...source, id, storageKey: id };
}

function withClaimedAssetBytes(projectValue: FramescaperProjectV32, byteLength: number): FramescaperProjectV32 {
	const project = structuredClone(projectValue) as unknown as Record<string, unknown>;
	const sources = project.sources as Record<string, unknown>[];
	const source = sources.find(({ kind }) => kind === 'image');
	if (!source) throw new Error('The resource fixture requires an image source.');
	source.assetByteLength = byteLength;
	return project as unknown as FramescaperProjectV32;
}

function moveImageClipToProjectBin(projectValue: FramescaperProjectV32): FramescaperProjectV32 {
	const project = structuredClone(projectValue) as unknown as Record<string, unknown>;
	const clips = project.clips as Record<string, unknown>[];
	const imageIndex = clips.findIndex(({ kind }) => kind === 'image');
	if (imageIndex < 0) throw new Error('The resource fixture requires an image clip.');
	const [clip] = clips.splice(imageIndex, 1);
	const tracks = project.tracks as Record<string, unknown>[];
	for (const track of tracks) {
		if (Array.isArray(track.clipIds)) track.clipIds = track.clipIds.filter((id) => id !== clip!.id);
	}
	const projectBin = project.projectBin as Record<string, unknown>;
	(projectBin.clips as Record<string, unknown>[]).push(clip!);
	return project as unknown as FramescaperProjectV32;
}

function countingStore(bytes: Uint8Array, onRead: () => void = () => {}): AudioEditorProjectStore {
	const owned = Uint8Array.from(bytes);
	return {
		loadMediaAsset(): Promise<Blob> {
			onRead();
			return Promise.resolve(new Blob([owned]));
		},
	} as unknown as AudioEditorProjectStore;
}

function emptySession(dispose: () => void): ProductVideoVisualPreviewSession {
	const frame: ProductVideoVisualPreviewFrame = Object.freeze({
		layers: Object.freeze([]), adjustments: Object.freeze([]),
		activeFreezeNodeIds: Object.freeze([]), availablePresetIds: Object.freeze([]),
		ledger: Object.freeze({
			requestedNodeIds: Object.freeze([]), consumedNodeIds: Object.freeze([]),
			omittedNodeIds: Object.freeze([]),
		}),
	});
	return Object.freeze({
		resolve: () => frame,
		resolveTransitionWeight: () => null,
		dispose,
	});
}
