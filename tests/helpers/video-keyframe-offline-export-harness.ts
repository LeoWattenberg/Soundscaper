/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The offline keyed video export harness.
 *
 * Shared because the orchestration test and the delivery-option tests need the
 * same authenticated project, digest-matched source Blob and stubbed resolver,
 * renderer and encoder, and building it twice would let the two drift.
 */

import { digestMediaContent } from '../../src/common/editor/storage/media-content-digest.ts';
import type {
	VideoKeyframeOfflineVideoExportDependencies,
} from '../../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import type { VideoKeyframeOfflineHtmlVideoSourceResolver } from '../../src/common/editor/ui/video-keyframe-offline-html-video-source-resolver.ts';
import type { VideoKeyframeOfflineRgbaRenderer } from '../../src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import type { VideoKeyframeVideoEditorFfmpeg } from '../../src/common/editor/video-keyframe-video-encoder.ts';
import {
	bindVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../../src/common/editor/video-source-timing-view.ts';
import { createFramescaperProjectV20 } from '../../src/framescaper/editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../../src/framescaper/editor-project-v20-profile.ts';
import { framescaperProjectForRuntimeConsumersV20 } from '../../src/framescaper/editor-project-v20-runtime.ts';
import { framescaperV20Options } from './framescaper-v20-model-fixture.ts';

export const RATE = Object.freeze({ num: 10, den: 1 });
export const SOURCE_ID = 'video-source';
export const CLIP_ID = 'video-clip';
const CAPTURED_ASSETS = new WeakMap<object, readonly Readonly<Record<string, unknown>>[]>();

export interface HarnessOptions {
	readonly encode?: VideoKeyframeOfflineVideoExportDependencies['encodeVideo'];
	readonly encoded?: Uint8Array<ArrayBuffer>;
	readonly rendererDispose?: () => Promise<void>;
	readonly resolverDispose?: () => void;
}

export function harnessDependencies(
	events: string[],
	options: HarnessOptions = {},
): VideoKeyframeOfflineVideoExportDependencies {
	let assets: readonly Readonly<Record<string, unknown>>[] = [];
	const resolver: VideoKeyframeOfflineHtmlVideoSourceResolver = Object.freeze({
		resolveSource: async () => { throw new Error('not rendered in the orchestration unit test'); },
		dispose() {
			events.push('resolver:dispose');
			options.resolverDispose?.();
		},
	});
	const renderer: VideoKeyframeOfflineRgbaRenderer = Object.freeze({
		width: 64,
		height: 32,
		byteLength: 64 * 32 * 4,
		async produce() { throw new Error('not rendered in the orchestration unit test'); },
		async dispose() {
			events.push('renderer:dispose');
			await options.rendererDispose?.();
		},
	});
	const encoded = options.encoded ?? Uint8Array.of(9, 8, 7);
	const dependencies = {
		createCanvas: () => Object.assign({ getContext: () => ({}) }, { width: 64, height: 32 }) as never,
		createResolver(request: Parameters<VideoKeyframeOfflineVideoExportDependencies['createResolver']>[0]) {
			events.push('resolver:create');
			assets = request.sources as unknown as readonly Readonly<Record<string, unknown>>[];
			CAPTURED_ASSETS.set(dependencies, assets);
			return resolver;
		},
		createRenderer() { events.push('renderer:create'); return renderer; },
		encodeVideo: options.encode ?? (async () => {
			events.push('encode');
			await renderer.dispose();
			return Object.freeze({
				bytes: encoded,
				byteLength: encoded.byteLength,
				videoEncoder: 'ffmpeg',
				format: 'mp4',
				extension: '.mp4',
				mimeType: 'video/mp4',
				frameCount: 1,
				rgbaChunkCount: 1,
				outputChunkCount: 1,
			});
		}),
	};
	const frozen = Object.freeze(dependencies);
	return frozen;
}

export function capturedAssets(
	dependencies: VideoKeyframeOfflineVideoExportDependencies,
): readonly Readonly<Record<string, unknown>>[] {
	return CAPTURED_ASSETS.get(dependencies) ?? [];
}

export function encodedResult() {
	const bytes = Uint8Array.of(9, 8, 7);
	return Object.freeze({
		bytes,
		byteLength: bytes.byteLength,
		videoEncoder: 'ffmpeg' as const,
		format: 'mp4' as const,
		extension: '.mp4' as const,
		mimeType: 'video/mp4' as const,
		frameCount: 1,
		rgbaChunkCount: 1,
		outputChunkCount: 1,
	});
}

export function floatWav(frameCount: number, sampleRate = 48_000): Blob {
	const bytes = Uint8Array.from(encodeWav([
		new Float32Array(frameCount),
		new Float32Array(frameCount),
	], { sampleRate, bitDepth: 32, float: true, dither: 'none' }));
	return new Blob([bytes.buffer], { type: 'audio/wav' });
}

export async function exportFixture(options_: Readonly<{
	readonly inactiveSources?: boolean;
	readonly rotationDegrees?: 0 | 90;
}> = {}) {
	const blob = new Blob([Uint8Array.of(1, 2, 3, 4)], { type: 'video/mp4' });
	const digest = await digestMediaContent(blob);
	const options = framescaperV20Options();
	const sourceInput = (options.sources as Array<Record<string, unknown>>)[0]!;
	sourceInput.contentSha256 = digest;
	const rotationDegrees = options_.rotationDegrees ?? 0;
	sourceInput.width = rotationDegrees === 90 ? 32 : 64;
	sourceInput.height = rotationDegrees === 90 ? 64 : 32;
	sourceInput.characteristics = {
		codedWidth: 64,
		codedHeight: 32,
		rotationDegrees,
		pixelAspectRatio: { num: 5, den: 4 },
	};
	if (options_.inactiveSources) addInactiveSources(options);
	const project = createFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		options,
	);
	const runtimeProject = framescaperProjectForRuntimeConsumersV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		project,
	);
	const source = project.sources.find((candidate) => candidate.id === SOURCE_ID)!;
	const view: VideoSourceTimingView = Object.freeze({ kind: 'cfr', rate: RATE, frameCount: 10 });
	return Object.freeze({
		blob,
		digest,
		project: runtimeProject,
		timing: new Map([[SOURCE_ID, bindVideoSourceTimingView(new Map([[SOURCE_ID, view]]), source)]]),
	});
}

function addInactiveSources(options: Record<string, unknown>): void {
	const sources = options.sources as Array<Record<string, unknown>>;
	const clips = options.clips as Array<Record<string, unknown>>;
	const tracks = options.tracks as Array<Record<string, unknown>>;
	const sequence = (options.sequences as Array<Record<string, unknown>>)[0]!;
	const projectBin = options.projectBin as { clips: Array<Record<string, unknown>> };
	const source = sources[0]!;
	const clip = clips[0]!;
	const track = tracks[0]!;
	const duplicateSource = (id: string, digestByte: string): Record<string, unknown> => ({
		...structuredClone(source), id, name: id, storageKey: id, contentSha256: digestByte.repeat(32),
	});
	sources.push(
		duplicateSource('hidden-source', '34'),
		duplicateSource('late-source', '56'),
		duplicateSource('bin-only-source', '78'),
	);
	clips.push(
		{ ...structuredClone(clip), id: 'hidden-clip', sourceId: 'hidden-source' },
		{ ...structuredClone(clip), id: 'late-clip', sourceId: 'late-source', sequenceStartFrame: 20 },
	);
	tracks.push(
		{ ...structuredClone(track), id: 'hidden-track', clipIds: ['hidden-clip'], hidden: true },
		{ ...structuredClone(track), id: 'late-track', clipIds: ['late-clip'] },
	);
	(sequence.trackIds as string[]).push('hidden-track', 'late-track');
	projectBin.clips.push({
		...structuredClone(projectBin.clips[0]!),
		id: 'bin-only-clip', sourceId: 'bin-only-source', binItemId: 'bin-only-clip',
	});
}

export function editorPort(): VideoKeyframeVideoEditorFfmpeg {
	return Object.freeze({
		runVideoKeyframeEncoderOperation: async () => { throw new Error('injected encoder only'); },
	});
}
