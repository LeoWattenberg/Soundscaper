/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FAST_RENDER_THRESHOLDS,
	chooseRenderStrategy,
	createExportPlan,
} from '../src/common/editor/export.js';

const MIB = 1024 * 1024;

test('render strategy callers which omit admission retain the legacy result', () => {
	assert.deepEqual(chooseRenderStrategy({
		outputBytes: 8 * MIB,
		livePcmBytes: 16 * MIB,
	}), {
		strategy: 'offline',
		fast: true,
		outputBytes: 8 * MIB,
		livePcmBytes: 16 * MIB,
		totalBytes: 24 * MIB,
		thresholds: FAST_RENDER_THRESHOLDS.desktop,
		reason: null,
	});
});

test('render strategy owns the central offline refusal reason', () => {
	const render = chooseRenderStrategy({
		outputBytes: 8 * MIB,
		livePcmBytes: 16 * MIB,
		offlineRenderAdmission: {
			admitted: false,
			reason: 'caller-controlled-reason',
		},
	});

	assert.equal(render.strategy, 'realtime-stream');
	assert.equal(render.reason, 'offline-render-output-memory');
});

test('export planning keeps the exact central offline output boundary offline', () => {
	const plan = createExportPlan(projectFixture({
		durationFrames: 33_554_432,
	}), {
		format: 'wav',
		includeTail: false,
		livePcmBytes: 0,
	});
	const admission = requireOfflineAdmission(plan);

	assert.equal(plan.render.strategy, 'offline');
	assert.equal(plan.render.reason, null);
	assert.equal(admission.admitted, true);
	assert.equal(admission.peakUsefulBinaryBytes, 256 * MIB);
	assert.deepEqual(admission.geometry, {
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 33_554_432,
		captureOffsetFrames: 0,
		requestedFrames: 33_554_432,
	});
});

test('export planning sends a 257 MiB desktop offline output to realtime', () => {
	const plan = createExportPlan(projectFixture({
		durationFrames: 33_685_504,
	}), {
		format: 'wav',
		includeTail: false,
		livePcmBytes: 0,
	});
	const admission = requireOfflineAdmission(plan);

	assert.equal(plan.outputBytesPerRender, 257 * MIB);
	assert.equal(plan.render.strategy, 'realtime-stream');
	assert.equal(plan.render.fast, false);
	assert.equal(plan.render.reason, 'offline-render-output-memory');
	assert.equal(admission.admitted, false);
	assert.equal(admission.peakUsefulBinaryBytes, 257 * MIB);
});

test('export planning accounts graph latency before selecting offline rendering', () => {
	const plan = createExportPlan(projectFixture({
		durationFrames: 16_777_216,
		masterEffects: [{
			type: 'limiter',
			enabled: true,
			params: { lookahead: 1 / 48_000 },
		}],
	}), {
		format: 'wav',
		includeTail: false,
		livePcmBytes: 0,
	});
	const admission = requireOfflineAdmission(plan);

	assert.equal(plan.outputBytesPerRender, 128 * MIB);
	assert.equal(plan.render.strategy, 'realtime-stream');
	assert.equal(plan.render.reason, 'offline-render-output-memory');
	assert.equal(admission.graphLatencyFrames, 1);
	assert.equal(admission.geometry.captureOffsetFrames, 1);
	assert.equal(admission.peakUsefulBinaryBytes, 256 * MIB + 8);
});

test('export planning preserves the earlier mobile threshold and reason', () => {
	const plan = createExportPlan(projectFixture({
		durationFrames: 12_713_984,
	}), {
		format: 'wav',
		includeTail: false,
		livePcmBytes: 0,
		mobile: true,
	});

	assert.equal(plan.outputBytesPerRender, 97 * MIB);
	assert.equal(plan.render.strategy, 'realtime-stream');
	assert.equal(plan.render.reason, 'output-memory');
	assert.equal('offlineRenderAdmission' in plan.render, false);
});

test('export admission uses project render rate and width before encode conversion', () => {
	const plan = createExportPlan(projectFixture({
		durationFrames: 33_685_504,
		sampleRate: 96_000,
	}), {
		format: 'wav',
		includeTail: false,
		livePcmBytes: 0,
		sampleRate: 48_000,
		channelCount: 1,
	});
	const admission = requireOfflineAdmission(plan);

	assert.equal(plan.sampleRate, 48_000);
	assert.equal(plan.channelCount, 1);
	assert.equal(plan.outputBytesPerRender, 67_371_008);
	assert.equal(plan.render.strategy, 'realtime-stream');
	assert.equal(plan.render.reason, 'offline-render-output-memory');
	assert.deepEqual(admission.geometry, {
		channelCount: 2,
		sampleRate: 96_000,
		contextFrames: 33_685_504,
		captureOffsetFrames: 0,
		requestedFrames: 33_685_504,
	});
	assert.equal(admission.peakUsefulBinaryBytes, 257 * MIB);
});

test('stem export strategy selects the target with the largest offline peak', () => {
	const plan = createExportPlan(projectFixture({
		durationFrames: 16_777_216,
		tracks: [
			trackFixture('short', []),
			trackFixture('long', [{
				type: 'limiter',
				enabled: true,
				params: { lookahead: 1 / 48_000 },
			}]),
		],
		masterEffects: [{
			type: 'limiter',
			enabled: true,
			params: { lookahead: 1 },
		}],
	}), {
		mode: 'stems',
		format: 'wav',
		includeTail: false,
		livePcmBytes: 0,
	});
	const admission = requireOfflineAdmission(plan);

	assert.equal(plan.outputs.length, 2);
	assert.equal(plan.render.strategy, 'realtime-stream');
	assert.equal(admission.graphLatencyFrames, 1);
	assert.equal(admission.peakUsefulBinaryBytes, 256 * MIB + 8);
});

test('authored BW64 export admission uses the transient render width', () => {
	const bedChannels = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] as const;
	const project = projectFixture({
		durationFrames: 12_000_000,
		sourceChannelCount: 6,
		metadata: {
			adm: {
				mode: 'authored',
				programme: { name: 'Programme', language: '' },
				content: { name: 'Content', language: '' },
				bed: {
					name: 'Bed',
					layout: '5.1',
					assignments: bedChannels.map((bedChannel, sourceChannel) => ({
						stripKind: 'track',
						stripId: 'track',
						sourceChannel,
						bedChannel,
					})),
				},
			},
		},
	});
	const plan = createExportPlan(project, {
		format: 'bw64',
		adm: project.metadata.adm,
		dither: 'none',
		includeTail: false,
		livePcmBytes: 0,
	});
	const admission = requireOfflineAdmission(plan);

	assert.equal(project.masterChannels, 2);
	assert.equal(plan.channelCount, 6);
	assert.equal(admission.geometry.channelCount, 6);
	assert.equal(plan.render.strategy, 'realtime-stream');
	assert.equal(plan.render.reason, 'offline-render-output-memory');
});

interface ProjectFixtureOptions {
	readonly durationFrames: number;
	readonly sampleRate?: number;
	readonly sourceChannelCount?: number;
	readonly tracks?: ReturnType<typeof trackFixture>[];
	readonly masterEffects?: ReadonlyArray<Readonly<Record<string, unknown>>>;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

function requireOfflineAdmission(plan: ReturnType<typeof createExportPlan>) {
	const admission = plan.render.offlineRenderAdmission;
	assert.ok(admission);
	return admission;
}

function projectFixture({
	durationFrames,
	sampleRate = 48_000,
	sourceChannelCount = 2,
	tracks = [trackFixture('track', [])],
	masterEffects = [],
	metadata = {},
}: ProjectFixtureOptions) {
	return {
		schemaVersion: 9,
		id: 'export-strategy-project',
		title: 'Export strategy',
		revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z',
		updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate,
		masterChannels: 2,
		metadata,
		selection: { startFrame: 0, endFrame: durationFrames },
		loop: { enabled: false, startFrame: 0, endFrame: durationFrames },
		sources: [{
			id: 'source',
			name: 'Source',
			storageKey: 'pcm/source',
			mimeType: 'audio/wav',
			frameCount: durationFrames,
			channelCount: sourceChannelCount,
			sampleRate,
			sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip',
			kind: 'audio',
			sourceId: 'source',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames,
		}],
		tracks,
		mixer: { groups: [], sends: [], routes: {} },
		master: { effectsActive: true, effects: masterEffects },
	};
}

function trackFixture(
	id: string,
	effects: ReadonlyArray<Readonly<Record<string, unknown>>>,
) {
	return {
		id,
		type: 'audio',
		name: id,
		clipIds: id === 'track' || id === 'short' ? ['clip'] : [],
		effectsActive: true,
		effects,
	};
}
