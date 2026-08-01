/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES,
} from '../src/common/editor/engine/offline-render-admission.ts';
import {
	planExportOfflineRenderStrategyAdmission,
} from '../src/common/editor/export-render-admission.ts';

const MIB = 1024 * 1024;

test('export strategy admission exposes exact central offline output geometry', () => {
	const result = planExportOfflineRenderStrategyAdmission({
		project: projectFixture(),
		rangeStartFrame: 0,
		requestedRenderFrames: 120,
	});

	assert.equal(result.admitted, true);
	assert.equal(result.strategy, 'offline');
	assert.equal(result.reason, null);
	assert.equal(result.preRollFrames, 0);
	assert.equal(result.graphLatencyFrames, 0);
	assert.deepEqual(result.geometry, {
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 120,
		captureOffsetFrames: 0,
		requestedFrames: 120,
	});
	assert.equal(result.peakUsefulBinaryBytes, 960);
	assert.equal(
		result.maximumUsefulBinaryBytes,
		MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES,
	);
	assert.equal(result.outputAdmission?.peakUsefulBinaryWorkingSet.bytes, 960);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.geometry), true);
});

test('export strategy admission charges pre-roll and graph-latency crop coexistence', () => {
	const result = planExportOfflineRenderStrategyAdmission({
		project: projectFixture({
			master: {
				effects: [{ type: 'limiter', params: { lookahead: 0.001 } }],
			},
		}),
		rangeStartFrame: 1_000,
		requestedRenderFrames: 120,
	});

	assert.equal(result.admitted, true);
	assert.equal(result.preRollFrames, 1_000);
	assert.equal(result.graphLatencyFrames, 48);
	assert.deepEqual(result.geometry, {
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 1_168,
		captureOffsetFrames: 1_048,
		requestedFrames: 120,
	});
	assert.equal(result.outputAdmission?.contextOutput.bytes, 9_344);
	assert.equal(result.outputAdmission?.cropOutput.bytes, 960);
	assert.equal(result.peakUsefulBinaryBytes, 10_304);
});

test('export strategy admission clamps pre-roll to the engine audio duration', () => {
	const result = planExportOfflineRenderStrategyAdmission({
		project: projectFixture({
			clips: [{ timelineStartFrame: 0, durationFrames: 100 }],
		}),
		rangeStartFrame: 1_000,
		requestedRenderFrames: 120,
	});

	assert.equal(result.preRollFrames, 100);
	assert.equal(result.geometry.captureOffsetFrames, 100);
	assert.equal(result.geometry.contextFrames, 220);
});

test('export strategy admission models mix and per-track stem graph latency', () => {
	const project = projectFixture({
		tracks: [
			{
				id: 'short',
				type: 'audio',
				effects: [{ type: 'limiter', params: { lookahead: 0.001 } }],
			},
			{
				id: 'long',
				type: 'audio',
				effects: [{ type: 'limiter', params: { lookahead: 0.01 } }],
			},
		],
		mixer: {
			groups: [{ effects: [{ type: 'limiter', params: { lookahead: 0.002 } }] }],
			sends: [],
			routes: {},
		},
		master: {
			effects: [{ type: 'limiter', params: { lookahead: 0.02 } }],
		},
	});
	const base = {
		project,
		rangeStartFrame: 0,
		requestedRenderFrames: 120,
	};

	assert.equal(
		planExportOfflineRenderStrategyAdmission(base).graphLatencyFrames,
		1_536,
	);
	assert.equal(planExportOfflineRenderStrategyAdmission({
		...base,
		trackId: 'short',
		includeMaster: false,
	}).graphLatencyFrames, 144);
	assert.equal(planExportOfflineRenderStrategyAdmission({
		...base,
		trackId: 'long',
		includeMaster: false,
	}).graphLatencyFrames, 576);
	assert.throws(
		() => planExportOfflineRenderStrategyAdmission({
			...base,
			includeMaster: null,
		} as never),
		/export offline render include-master/iu,
	);
});

test('export strategy admission uses render-rate frames before encode-rate resampling', () => {
	const result = planExportOfflineRenderStrategyAdmission({
		project: projectFixture({ sampleRate: 96_000 }),
		rangeStartFrame: 960_000,
		// Export planning may later resample these 96 kHz render frames to a
		// different encode rate; this is the exact request sent to renderMix.
		requestedRenderFrames: 96_000,
	});

	assert.equal(result.geometry.sampleRate, 96_000);
	assert.equal(result.preRollFrames, 960_000);
	assert.equal(result.geometry.requestedFrames, 96_000);
	assert.equal(result.geometry.contextFrames, 1_056_000);
});

test('export strategy admission supports the transient authored output width', () => {
	const result = planExportOfflineRenderStrategyAdmission({
		project: projectFixture({ masterChannels: 2 }),
		rangeStartFrame: 0,
		requestedRenderFrames: 120,
		channelCount: 6,
	});

	assert.equal(result.admitted, true);
	assert.equal(result.geometry.channelCount, 6);
	assert.equal(result.peakUsefulBinaryBytes, 2_880);
});

test('export strategy admission chooses realtime at one past the central ceiling', () => {
	assert.equal(MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES, 256 * MIB);
	const exact = planExportOfflineRenderStrategyAdmission({
		project: projectFixture(),
		rangeStartFrame: 0,
		requestedRenderFrames: 33_554_432,
	});
	assert.equal(exact.admitted, true);
	assert.equal(exact.strategy, 'offline');
	assert.equal(exact.peakUsefulBinaryBytes, 256 * MIB);

	const onePast = planExportOfflineRenderStrategyAdmission({
		project: projectFixture(),
		rangeStartFrame: 0,
		requestedRenderFrames: 33_554_433,
	});
	assert.equal(onePast.admitted, false);
	assert.equal(onePast.strategy, 'realtime-stream');
	assert.equal(onePast.reason, 'offline-render-output-memory');
	assert.equal(onePast.outputAdmission, null);
	assert.equal(onePast.peakUsefulBinaryBytes, 256 * MIB + 8);
	assert.equal(onePast.maximumUsefulBinaryBytes, 256 * MIB);
	assert.deepEqual(onePast.geometry, {
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 33_554_433,
		captureOffsetFrames: 0,
		requestedFrames: 33_554_433,
	});
	assert.equal(Object.isFrozen(onePast), true);
});

test('export strategy admission pins the cropped exact and one-past boundaries', () => {
	const exact = planExportOfflineRenderStrategyAdmission({
		project: projectFixture(),
		rangeStartFrame: 2,
		requestedRenderFrames: 16_777_215,
	});
	assert.equal(exact.admitted, true);
	assert.equal(exact.geometry.captureOffsetFrames, 2);
	assert.equal(exact.peakUsefulBinaryBytes, 256 * MIB);

	const onePast = planExportOfflineRenderStrategyAdmission({
		project: projectFixture(),
		rangeStartFrame: 2,
		requestedRenderFrames: 16_777_216,
	});
	assert.equal(onePast.admitted, false);
	assert.equal(onePast.geometry.contextFrames, 16_777_218);
	assert.equal(onePast.peakUsefulBinaryBytes, 256 * MIB + 16);
});

test('export strategy admission has a lower-only central ceiling seam', () => {
	const request = {
		project: projectFixture({ masterChannels: 1 }),
		rangeStartFrame: 0,
		requestedRenderFrames: 10,
	};
	assert.equal(planExportOfflineRenderStrategyAdmission({
		...request,
		maximumUsefulBinaryBytes: 40,
	}).admitted, true);
	const refused = planExportOfflineRenderStrategyAdmission({
		...request,
		maximumUsefulBinaryBytes: 39,
	});
	assert.equal(refused.admitted, false);
	assert.equal(refused.maximumUsefulBinaryBytes, 39);

	for (const maximumUsefulBinaryBytes of [
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES + 1,
		null,
		'40',
	]) {
		assert.throws(
			() => planExportOfflineRenderStrategyAdmission({
				...request,
				maximumUsefulBinaryBytes,
			} as never),
			/offline render output maximum/iu,
		);
	}
});

test('export strategy admission rejects malformed and overflowing geometry', () => {
	const valid = {
		project: projectFixture(),
		rangeStartFrame: 0,
		requestedRenderFrames: 120,
	};
	for (const request of [
		{ ...valid, project: projectFixture({ sampleRate: 0 }) },
		{ ...valid, project: projectFixture({ sampleRate: 48_000.5 }) },
		{ ...valid, project: projectFixture({ masterChannels: 0 }) },
		{ ...valid, project: projectFixture({ masterChannels: 33 }) },
		{ ...valid, rangeStartFrame: -1 },
		{ ...valid, rangeStartFrame: 1.5 },
		{ ...valid, requestedRenderFrames: 0 },
		{ ...valid, requestedRenderFrames: 1.5 },
		{ ...valid, channelCount: 0 },
		{ ...valid, channelCount: 33 },
	]) {
		assert.throws(
			() => planExportOfflineRenderStrategyAdmission(request),
			/export offline render/iu,
		);
	}
	assert.throws(
		() => planExportOfflineRenderStrategyAdmission({
			...valid,
			rangeStartFrame: Number.MAX_SAFE_INTEGER,
			requestedRenderFrames: Number.MAX_SAFE_INTEGER,
		}),
		/safe integer range/iu,
	);
});

function projectFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		sampleRate: 48_000,
		masterChannels: 2,
		clips: [{ timelineStartFrame: 0, durationFrames: 2_000_000 }],
		tracks: [],
		mixer: { groups: [], sends: [], routes: {} },
		master: { effects: [] },
		...overrides,
	};
}
