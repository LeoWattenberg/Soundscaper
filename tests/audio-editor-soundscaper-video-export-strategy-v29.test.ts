/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportStrategyEncodeRequest } from '../src/common/editor/controller/product-video-export-strategy.ts';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import type { VideoKeyframeOfflineVideoExportRequest } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	createSoundscaperDesktopVideoExportStrategy,
	createSoundscaperVideoExportStrategy,
} from '../src/soundscaper/video-export-strategy.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

test('Soundscaper V29 keyed strategy reaches buffered and sink encoders with one exact active pair', async () => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const project = createSoundscaperProject(framescaperV20Options() as never);
	const canonicalJson = JSON.stringify(project);
	const canonicalSource = project.sources[0]!;
	const canonicalTempoMap = project.tempoMap;
	assert.equal(Object.isFrozen(canonicalSource), false);
	assert.equal(Object.isFrozen(canonicalTempoMap), false);
	const calls: Array<Readonly<Record<string, unknown>>> = [];
	const strategy = createSoundscaperVideoExportStrategy(runtime, {
		async encodeOffline(request: VideoKeyframeOfflineVideoExportRequest) {
			calls.push(request as unknown as Readonly<Record<string, unknown>>);
			return encoderResult('mp4');
		},
		async encodeOfflineToSink(
			request: VideoKeyframeOfflineVideoExportRequest,
			sink: FfmpegOutputSink<unknown>,
		) {
			calls.push(request as unknown as Readonly<Record<string, unknown>>);
			return { ...encoderResult('mp4'), output: sink, outputChunkCount: 1 };
		},
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: fallbackFreeDelivery(project),
	});
	assert.equal(JSON.stringify(project), canonicalJson);
	assert.equal(Object.isFrozen(canonicalSource), false);
	assert.equal(Object.isFrozen(canonicalTempoMap), false);
	const plan = strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: true, canvas: undefined,
	});
	assert.ok(plan);
	assert.deepEqual(plan.activeClipIds, ['video-clip']);
	assert.deepEqual(plan.activeSourceIds, ['video-source']);
	assert.equal((plan.canvas as { referenceClipId: string }).referenceClipId, 'video-clip');
	assert.equal((plan.canvas as { referenceSourceId: string }).referenceSourceId, 'video-source');
	const request = encodeRequest(project, exportProject, plan);
	const buffered = await strategy.encode(request);
	assert.equal(buffered.videoEncoder, 'ffmpeg');
	const sink = Object.freeze({ kind: 'sink' });
	const direct = await strategy.encodeToSink(request, sink as never);
	assert.strictEqual(direct.output, sink);
	assert.equal(calls.length, 2);
	assert.equal(calls.every((call) => call.project === exportProject), true);
});

test('Soundscaper V29 keyed strategy refuses fallback, caption, and detached plan authority', () => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const project = createSoundscaperProject(framescaperV20Options() as never);
	const strategy = createSoundscaperVideoExportStrategy(runtime, dependencies());
	assert.throws(() => strategy.createExportProject({
		canonicalProject: project,
		delivery: { ...fallbackFreeDelivery(project), videoRenderedFallback: {} },
	}), /rendered-fallback/iu);
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: fallbackFreeDelivery(project),
	});
	assert.throws(() => strategy.createPlan({
		canonicalProject: project, exportProject, format: 'webm', range: 'project',
		includeAudio: false, canvas: undefined, captions: { mode: 'sidecar' },
	}), /caption/iu);
	assert.throws(() => strategy.createPlan({
		canonicalProject: project, exportProject: structuredClone(exportProject),
		format: 'webm', range: 'project', includeAudio: false, canvas: undefined,
	}), /owned|authority/iu);
});

test('Soundscaper V29 keyed strategy refuses a stale export projection after canonical mutation', () => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const project = createSoundscaperProject(framescaperV20Options() as never);
	const strategy = createSoundscaperVideoExportStrategy(runtime, dependencies());
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: fallbackFreeDelivery(project),
	});
	(project as unknown as { title: string }).title = 'Advanced after projection';

	assert.throws(() => strategy.createPlan({
		canonicalProject: project, exportProject, format: 'webm', range: 'project',
		includeAudio: false, canvas: undefined,
	}), /diverge|stale|snapshot/iu);
});

test('Soundscaper V29 keyed strategy renders the delivery effect-bypass projection', () => {
	const options = framescaperV20Options();
	const audioTrack = (options.tracks as Record<string, unknown>[])[1]!;
	audioTrack.effects = [{
		id: 'audio-limiter', type: 'limiter', enabled: true, bypassed: false,
		params: { ceiling: -1, lookahead: 0.005, release: 0.1 },
	}];
	const project = createSoundscaperProject(options as never);
	const deliveryProject = structuredClone(project);
	const deliveredTrack = deliveryProject.tracks.find(({ id }) => id === 'audio-track')!;
	if (deliveredTrack.type !== 'audio') throw new Error('Expected the audio fixture track.');
	deliveredTrack.effects[0] = { ...deliveredTrack.effects[0]!, bypassed: true, params: {} };
	const strategy = createSoundscaperVideoExportStrategy(
		createSoundscaperProjectRuntimeSelection(), dependencies(),
	);

	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: fallbackFreeDelivery(deliveryProject),
	});
	const exportedTrack = (exportProject.tracks as readonly Readonly<Record<string, unknown>>[])
		.find(({ id }) => id === 'audio-track')!;
	const exportedEffect = (exportedTrack.effects as readonly Readonly<Record<string, unknown>>[])[0]!;
	assert.equal(exportedEffect.bypassed, true);
	assert.doesNotThrow(() => strategy.createPlan({
		canonicalProject: project, exportProject, format: 'webm', range: 'project',
		includeAudio: true, canvas: undefined,
	}));
});

test('Soundscaper V29 controller strategy is desktop-only', () => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	assert.equal(createSoundscaperDesktopVideoExportStrategy(runtime, { isDesktop: false }), undefined);
	assert.equal(createSoundscaperDesktopVideoExportStrategy(runtime, {}), undefined);
	assert.ok(createSoundscaperDesktopVideoExportStrategy(runtime, { isDesktop: true }));
	const accessor = Object.defineProperty({}, 'isDesktop', { enumerable: true, get: () => true });
	assert.equal(createSoundscaperDesktopVideoExportStrategy(runtime, accessor), undefined);
});

function fallbackFreeDelivery(project: Readonly<Record<string, unknown>>) {
	return Object.freeze({
		project, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: Object.freeze([]), requiredVideoSourceIds: Object.freeze([]),
	});
}

function dependencies() {
	return {
		encodeOffline: async () => encoderResult('mp4'),
		encodeOfflineToSink: async (_request: unknown, sink: unknown) => ({
			...encoderResult('mp4'), output: sink, outputChunkCount: 1,
		}),
	};
}

function encoderResult(format: 'mp4' | 'webm') {
	return {
		bytes: Uint8Array.of(1, 2, 3, 4), byteLength: 4, format,
		extension: `.${format}` as const,
		mimeType: format === 'mp4' ? 'video/mp4' as const : 'video/webm' as const,
		videoEncoder: 'ffmpeg' as const,
	};
}

function encodeRequest(
	canonicalProject: Readonly<Record<string, unknown>>,
	exportProject: Readonly<Record<string, unknown>>,
	plan: NonNullable<ReturnType<ReturnType<typeof createSoundscaperVideoExportStrategy>['createPlan']>>,
): ProductVideoExportStrategyEncodeRequest {
	return {
		canonicalProject, exportProject, plan, timingBySourceId: new Map(),
		videoBlobs: new Map([['video-source', new Blob([Uint8Array.of(1)])]]),
		audioMix: new Blob([Uint8Array.of(2)], { type: 'audio/wav' }), editorFfmpeg: {},
		webCodecs: null, signal: new AbortController().signal, assertCurrent() {},
		maximumOutputBytes: 1024 * 1024,
	};
}
