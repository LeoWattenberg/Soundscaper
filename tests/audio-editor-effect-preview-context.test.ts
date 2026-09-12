/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../src/common/editor/effects.js';

interface RenderCall {
	readonly trackId: string;
	readonly start: number;
	readonly end: number;
	readonly channels: number;
	readonly clipIds: readonly string[];
}

interface WorkerInput {
	readonly channels: Float32Array[];
	readonly context: Readonly<{
		beforeChannels: Float32Array[];
		afterChannels: Float32Array[];
	}>;
}

function fixture(start: number, end: number, projectEnd: number, cancelOnRender = 0) {
	const renders: RenderCall[] = [];
	const jobs: WorkerInput[] = [];
	const played: Float32Array[][] = [];
	const state = {
		audacityEffectType: 'audacity-repair',
		audacityEffectProcessing: false,
		audacityPreviewGeneration: 0,
		audacityPreviewSource: null as unknown,
		audacityEffectTouchedParams: new Map<string, Set<string>>(),
	};
	let started = 0;
	let published = 0;
	const source = {
		buffer: null as unknown,
		onended: null as (() => void) | null,
		connect: () => undefined,
		start: () => { started += 1; },
	};
	const preview = createSelectionEffectPreviewService({
		state,
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000,
		AUDIO_SELECTION_EFFECT_DEFINITIONS,
		abortError: () => new DOMException('Preview was cancelled', 'AbortError'),
		assertAudacityEffectOutput: (channels: Float32Array[]) => assert.equal(channels.length, 1),
		audacityEffectMemoryError: () => new Error('Preview exceeds memory limit'),
		audacityEffectTargets: () => [{ track: { id: 'selected-track' },
			startFrame: start, endFrame: end, durationFrames: end - start,
			channelCount: 1, clipIds: ['selected-clip'] }],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => {
			played.push(channels);
			return { channels };
		},
		cancelAudacityEffectPreview: () => { state.audacityPreviewGeneration += 1; },
		copy: { audacityPreviewProcessing: 'Preparing preview', audacityPreviewPlaying: 'Playing' },
		currentAudacityEffectParams: () => ({}),
		engine: {
			pause: () => undefined,
			getAudioContext: async () => ({ createBufferSource: () => source, destination: {} }),
		},
		estimateAudioSelectionEffectPeakBytes: () => 0,
		getProject: () => ({ id: 'selected-project' }),
		mixNyquistPreviewChannels,
		normalizeAudioSelectionEffectParams: () => ({}),
		projectDurationFrames: () => projectEnd,
		projectSampleRate: () => 100,
		publishDocumentSnapshot: () => { published += 1; },
		renderDryTrackRange: async (trackId: string, from: number, to: number,
			channels: number, clipIds: readonly string[]) => {
			renders.push({ trackId, start: from, end: to, channels, clipIds });
			if (renders.length === cancelOnRender) state.audacityPreviewGeneration += 1;
			return [Float32Array.from({ length: to - from }, (_, index) => (from + index) / 1_000)];
		},
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		runSelectionEffectWorker: async (request: WorkerInput) => {
			jobs.push(request);
			return { channels: request.channels.map((channel) => channel.map((value) => -value)) };
		},
		setStatus: () => undefined,
	});
	return { preview, state, renders, jobs, played, started: () => started, published: () => published };
}

test('Repair previews supply clip-scoped context clipped to the project and play only the selection', async () => {
	for (const [start, end, projectEnd] of [[20, 24, 50], [0, 4, 50], [46, 50, 50], [220, 224, 500]] as const) {
		const value = fixture(start, end, projectEnd);
		assert.equal(await value.preview(), true);
		const beforeStart = Math.max(0, start - 128);
		const afterEnd = Math.min(projectEnd, end + 128);
		assert.deepEqual(value.renders, [
			[start, end], ...(beforeStart < start ? [[beforeStart, start]] : []),
			...(end < afterEnd ? [[end, afterEnd]] : []),
		].map(([from, to]) => ({ trackId: 'selected-track', start: from, end: to,
			channels: 1, clipIds: ['selected-clip'] })));
		assert.equal(value.jobs.length, 1);
		const { channels, context } = value.jobs[0]!;
		assert.equal(context.beforeChannels[0]!.length, start - beforeStart);
		assert.equal(context.afterChannels[0]!.length, afterEnd - end);
		assert.equal(channels[0]!.length, end - start);
		assert.deepEqual(Array.from(value.played[0]![0]!), Array.from(channels[0]!, (sample) => sample === 0 ? 0 : -sample));
		assert.equal(value.started(), 1);
		assert.equal(value.state.audacityEffectProcessing, false);
	}
});

test('cancelling a Repair preview during context reads never launches the worker or playback', async () => {
	for (const cancelOnRender of [2, 3]) {
		const value = fixture(20, 24, 50, cancelOnRender);
		assert.equal(await value.preview(), false);
		assert.equal(value.renders.length, cancelOnRender);
		assert.deepEqual(value.jobs, []);
		assert.deepEqual(value.played, []);
		assert.equal(value.started(), 0);
		assert.equal(value.state.audacityPreviewSource, null);
		assert.equal(value.state.audacityEffectProcessing, false);
		assert.equal(value.published(), 2, 'cancelled processing clears its published busy state');
	}
});
