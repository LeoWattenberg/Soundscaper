/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportStrategyEncodeRequest } from '../src/common/editor/controller/product-video-export-strategy.ts';
import { createSoundscaperProjectRuntimeV29Selection } from '../src/soundscaper/editor-project-runtime-v29-selection.ts';
import { createSoundscaperProjectV29 } from '../src/soundscaper/editor-project-v29.ts';
import {
	createSoundscaperDesktopVideoExportStrategyV29,
	createSoundscaperVideoExportStrategyV29,
} from '../src/soundscaper/video-export-strategy-v29.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('Soundscaper V29 keyed strategy reaches buffered and sink encoders with one exact active pair', async () => {
	const runtime = createSoundscaperProjectRuntimeV29Selection();
	const project = createSoundscaperProjectV29(framescaperV20Options() as never);
	const calls: Array<Readonly<Record<string, unknown>>> = [];
	const strategy = createSoundscaperVideoExportStrategyV29(runtime, {
		async encodeOffline(request) {
			calls.push(request as unknown as Readonly<Record<string, unknown>>);
			return encoderResult('mp4');
		},
		async encodeOfflineToSink(request, sink) {
			calls.push(request as unknown as Readonly<Record<string, unknown>>);
			return { ...encoderResult('mp4'), output: sink, outputChunkCount: 1 };
		},
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: fallbackFreeDelivery(project),
	});
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
	const runtime = createSoundscaperProjectRuntimeV29Selection();
	const project = createSoundscaperProjectV29(framescaperV20Options() as never);
	const strategy = createSoundscaperVideoExportStrategyV29(runtime, dependencies());
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

test('Soundscaper V29 controller strategy is desktop-only', () => {
	const runtime = createSoundscaperProjectRuntimeV29Selection();
	assert.equal(createSoundscaperDesktopVideoExportStrategyV29(runtime, { isDesktop: false }), undefined);
	assert.equal(createSoundscaperDesktopVideoExportStrategyV29(runtime, {}), undefined);
	assert.ok(createSoundscaperDesktopVideoExportStrategyV29(runtime, { isDesktop: true }));
	const accessor = Object.defineProperty({}, 'isDesktop', { enumerable: true, get: () => true });
	assert.equal(createSoundscaperDesktopVideoExportStrategyV29(runtime, accessor), undefined);
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
	plan: NonNullable<ReturnType<ReturnType<typeof createSoundscaperVideoExportStrategyV29>['createPlan']>>,
): ProductVideoExportStrategyEncodeRequest {
	return {
		canonicalProject, exportProject, plan, timingBySourceId: new Map(),
		videoBlobs: new Map([['video-source', new Blob([Uint8Array.of(1)])]]),
		audioMix: new Blob([Uint8Array.of(2)], { type: 'audio/wav' }), editorFfmpeg: {},
		webCodecs: null, signal: new AbortController().signal, assertCurrent() {},
		maximumOutputBytes: 1024 * 1024,
	};
}
