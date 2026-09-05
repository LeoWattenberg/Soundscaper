/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * Fixtures for the selected timelineImage image preview: a real published frame
 * pack, a store that serves it, the drawable and inherited-session seams the
 * preview accepts, and a synthetic project whose track topology a test can state
 * outright.
 */

import assert from 'node:assert/strict';

import type { AudioEditorProjectStore } from '../../src/common/editor/storage.js';
import { createFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../../src/common/editor/timeline-image-model.ts';
import type {
	ProductVideoVisualPreviewFrame,
	ProductVideoVisualPreviewSession,
	ProductVideoVisualProjectBinThumbnail,
} from '../../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../../src/framescaper/editor-project-runtime-profile.ts';
import {
	applyFramescaperProjectCommandTimelineImage,
} from '../../src/framescaper/editor-project-timeline-image-commands.ts';
import { createFramescaperProjectTimelineImage } from '../../src/framescaper/editor-project-timeline-image.ts';
import {
	createFramescaperSelectedProjectBinThumbnailTimelineImage as createThumbnail,
	createFramescaperSelectedVisualPreviewSessionTimelineImage as createSession,
	type FramescaperImagePreviewDrawableTimelineImage,
} from '../../src/framescaper/editor-selected-timeline-image-image-preview.ts';
import { framescaperV20Options } from './framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const ENCODER = new TextEncoder();
const NO_INHERITED = () => Promise.resolve(null);

/** The sequence runs at 10 fps over 48 kHz, so this sample is sequence frame 10 — pack frame 1. */
export const SECOND_PACK_FRAME_SAMPLE = 48_000;

export interface ImageFixtureTimelineImage {
	readonly source: FramescaperImageSourceV1;
	readonly bytes: Uint8Array;
}

/** Publish a real frame pack whose frames each occupy one second of source ticks. */
export function imageFixture(id: string, width = 2, height = 1, frameCount = 2): ImageFixtureTimelineImage {
	const published = createFramescaperImageFramePackV1({
		original: ENCODER.encode(`exact ${id} input`),
		receipt: { decoder: { id: 'browser-native', version: '1' }, schemaVersion: 1 },
		width, height, timingMode: 'embedded',
		frames: Array.from({ length: frameCount }, (_frame, index) => ({
			presentationTicks: BigInt(index) * 1_000_000n,
			durationTicks: 1_000_000n,
			rgba: Uint8Array.from({ length: width * height * 4 }, (_byte, offset) => (
				offset % 4 === 3 ? 255 : ((index + 1) * 37 + offset) % 251
			)),
		})),
	});
	return Object.freeze({
		bytes: published.bytes,
		source: {
			schemaVersion: 1 as const, kind: 'image' as const, id, name: `Image ${id}`,
			mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, storageKey: id,
			contentSha256: published.contentSha256, assetByteLength: published.assetByteLength,
			original: {
				fileName: 'animated.png', mimeType: 'image/png', recognizedFormat: 'apng',
				byteLength: published.originalByteLength, sha256: published.originalSha256,
			},
			canonical: {
				width: published.width, height: published.height, hasAlpha: published.hasAlpha,
				frameCount: published.frameCount, durationTicks: published.durationTicks,
				timingMode: published.timingMode,
			},
			conversionReceiptSha256: published.conversionReceiptSha256,
		},
	});
}

export const IMAGE_FIXTURE = imageFixture('image-source');

export function imageClip(
	id: string, sourceId = 'image-source', overrides: Partial<FramescaperImageClipV1> = {},
): FramescaperImageClipV1 {
	return {
		schemaVersion: 1, kind: 'image', id, sourceId, sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 150, sourceStartTicks: '0', ...overrides,
	};
}

export interface SyntheticTrackTimelineImage {
	readonly id: string;
	readonly type?: string;
	readonly clipIds: readonly string[];
	readonly hidden?: boolean;
	readonly solo?: boolean;
}

export interface SceneOptionsTimelineImage {
	readonly tracks?: readonly SyntheticTrackTimelineImage[];
	readonly clips?: readonly unknown[];
	readonly binClips?: readonly unknown[];
	readonly fixtures?: readonly ImageFixtureTimelineImage[];
	readonly stored?: readonly ImageFixtureTimelineImage[];
	readonly primarySequenceId?: string;
	readonly calls?: string[];
}

export function assetStore(
	fixtures: readonly ImageFixtureTimelineImage[], calls: string[] = [],
): AudioEditorProjectStore {
	const bodies = new Map(fixtures.map(({ source, bytes }) => [source.storageKey, bytes]));
	return {
		loadMediaAsset(storageKey: string) {
			calls.push(storageKey);
			const bytes = bodies.get(storageKey);
			return Promise.resolve(bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>]) : null);
		},
	} as unknown as AudioEditorProjectStore;
}

/**
 * A project, store and clone seam for one image scene. The clone is bypassed so a
 * test can state the exact track and clip topology the compositor must read.
 */
export function scene(options: SceneOptionsTimelineImage = {}): Data {
	const fixtures = options.fixtures ?? [IMAGE_FIXTURE];
	const tracks = options.tracks ?? [{ id: 'video-track', clipIds: ['clip-a'] }];
	return {
		project: {
			sampleRate: 48_000,
			primarySequenceId: options.primarySequenceId ?? 'main-sequence',
			sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: tracks.map(({ id }) => id) }],
			tracks: tracks.map((track) => ({ type: 'video', ...track })),
			clips: options.clips ?? [imageClip('clip-a')],
			sources: fixtures.map(({ source }) => source),
			projectBin: { clips: options.binClips ?? [] },
		},
		store: assetStore(options.stored ?? fixtures, options.calls),
		cloneProject: (_profile: unknown, project: unknown) => project as never,
	};
}

/** Two adjacent clips on one track, the second starting where the first ends. */
export function twoClipTopology(): SceneOptionsTimelineImage {
	return {
		tracks: [{ id: 'video-track', clipIds: ['clip-a', 'clip-b'] }],
		clips: [
			imageClip('clip-a', 'image-source', { sequenceFrameCount: 5 }),
			imageClip('clip-b', 'image-source', { sequenceStartFrame: 5, sequenceFrameCount: 5 }),
		],
	};
}

/** A project built through the authenticated timelineImage command path. */
export function committedProject(fixture: ImageFixtureTimelineImage): unknown {
	return applyFramescaperProjectCommandTimelineImage(
		PROFILE,
		createFramescaperProjectTimelineImage(PROFILE, framescaperV20Options() as never),
		{
			type: 'batch',
			commands: [
				{ type: 'image-source/set', sourceId: fixture.source.id, expectedSource: null, source: fixture.source },
				{
					type: 'image-clip/set', clipId: 'image-clip', expectedClip: null, expectedPlacement: null,
					clip: imageClip('image-clip', fixture.source.id),
					placement: { scope: 'timeline', trackId: 'video-track' },
				},
			],
		},
	);
}

export interface DrawableRequestTimelineImage {
	readonly clipId: string;
	readonly sourceId: string;
	readonly width: number;
	readonly height: number;
}

export interface RecordedDrawableTimelineImage {
	readonly request: DrawableRequestTimelineImage;
	readonly presented: number[];
	disposals: number;
}

export function drawableFactory(
	drawables: RecordedDrawableTimelineImage[],
	options: Readonly<{ videoWidth?: number; disposeError?: Error }> = {},
): (request: DrawableRequestTimelineImage) => FramescaperImagePreviewDrawableTimelineImage {
	return (request) => {
		const record: RecordedDrawableTimelineImage = { request, presented: [], disposals: 0 };
		drawables.push(record);
		return {
			video: {
				drawable: null, videoWidth: options.videoWidth ?? request.width, videoHeight: request.height,
				readyState: 4, currentTime: 0, pause() { /* A synthetic drawable never plays. */ },
			},
			present(rgba) { record.presented.push(rgba[0] ?? -1); },
			dispose() {
				record.disposals += 1;
				if (options.disposeError) throw options.disposeError;
			},
		};
	};
}

export function previewFrame(
	layers: ProductVideoVisualPreviewFrame['layers'] = [], nodeIds: readonly string[] = [],
): ProductVideoVisualPreviewFrame {
	return {
		layers, adjustments: [], activeFreezeNodeIds: [], availablePresetIds: [],
		ledger: { requestedNodeIds: nodeIds, consumedNodeIds: nodeIds, omittedNodeIds: [] },
	};
}

export interface InheritedLogTimelineImage {
	disposals: number;
	readonly samples: number[];
}

export function inheritedLog(): InheritedLogTimelineImage {
	return { disposals: 0, samples: [] };
}

export function inherited(
	log: InheritedLogTimelineImage, overrides: Partial<ProductVideoVisualPreviewSession> = {},
): () => Promise<ProductVideoVisualPreviewSession> {
	return () => Promise.resolve({
		resolve(timelineSample: number) {
			log.samples.push(timelineSample);
			return previewFrame();
		},
		resolveTransitionWeight: () => null,
		dispose() { log.disposals += 1; },
		...overrides,
	});
}

export async function openSession(overrides: Data): Promise<ProductVideoVisualPreviewSession> {
	const session = await createSession({
		profile: PROFILE, width: 320, height: 180,
		createImageDrawable: drawableFactory([]), createInheritedSession: NO_INHERITED, ...overrides,
	} as never);
	assert.ok(session, 'the composed preview session must exist');
	return session;
}

export async function binThumbnail(overrides: Data): Promise<ProductVideoVisualProjectBinThumbnail> {
	const thumbnail = await createThumbnail({
		profile: PROFILE, width: 4, height: 2, clipId: 'bin-image', ...overrides,
	} as never);
	assert.ok(thumbnail, 'the Project Bin thumbnail must exist');
	return thumbnail;
}

export function binScene(sourceStartTicks = '0'): Data {
	return scene({
		tracks: [], clips: [], binClips: [imageClip('bin-image', 'image-source', { sourceStartTicks })],
	});
}

export function entriesOf(frame: ProductVideoVisualPreviewFrame): readonly Data[] {
	return frame.layers.flatMap((layer) => [...layer.entries]);
}

export interface StubCanvasRecordTimelineImage {
	readonly puts: Readonly<{ width: number; height: number; length: number }>[];
	cleared: number;
}

/** Install the minimum canvas runtime the module's default drawable looks for. */
export function installCanvasRuntime(context: unknown): () => void {
	const globals = globalThis as unknown as Data;
	const priorDocument = globals.document;
	const priorImageData = globals.ImageData;
	globals.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
	globals.ImageData = class {
		constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
	};
	return () => {
		globals.document = priorDocument;
		globals.ImageData = priorImageData;
	};
}
