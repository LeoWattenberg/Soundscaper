/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	directAudioRenderStrategy,
	isDirectOfflineAudioMixPlan,
} from '../src/common/editor/controller/direct-audio-render-plan.ts';
import { createExportPlan } from '../src/common/editor/export.js';

test('direct audio render admission accepts planner-owned offline single mixes', () => {
	for (const format of ['wav', 'aiff', 'bwf'] as const) {
		const plan = offlinePlan(format);
		assert.equal(plan.render.strategy, 'offline', format);
		assert.equal(directAudioRenderStrategy(plan), 'offline', format);
		assert.equal(isDirectOfflineAudioMixPlan(plan), true, format);
	}
	assert.equal(directAudioRenderStrategy({ render: { strategy: 'realtime-stream' } }), 'realtime-stream');
	assert.equal(isDirectOfflineAudioMixPlan({ render: { strategy: 'realtime-stream' } }), false);
	const converted = offlinePlan('wav', { sampleRate: 44_100, channelMapping: 'mono' }, 96_000);
	assert.equal(converted.channelCount, 1);
	assert.equal(converted.render.offlineRenderAdmission?.geometry.sampleRate, 96_000);
	assert.equal(directAudioRenderStrategy(converted), 'offline');
});

test('direct audio render admission rejects bare and non-single-mix offline plans', () => {
	const valid = offlinePlan('wav');
	const range = (valid as unknown as Readonly<{
		readonly range: Readonly<{ readonly durationFrames: number }>;
	}>).range;
	const candidates: readonly [string, unknown][] = [
		['bare strategy', { ...valid, render: { strategy: 'offline' } }],
		['stems mode', { ...valid, mode: 'stems' }],
		['archive', { ...valid, archive: { format: 'zip' } }],
		['multiple outputs', { ...valid, outputs: [...valid.outputs, valid.outputs[0]] }],
		['non-mix output', { ...valid, outputs: [{ ...valid.outputs[0], kind: 'stem', trackId: 'track' }] }],
		['unsafe output name', { ...valid, outputs: [{ ...valid.outputs[0], fileName: '../mix.wav' }] }],
		['stale PCM geometry', { ...valid, outputBytesPerRender: valid.outputBytesPerRender + 4 }],
		['stale range', { ...valid, range: { ...range, durationFrames: range.durationFrames + 1 } }],
	];
	for (const [label, candidate] of candidates) {
		assert.equal(directAudioRenderStrategy(candidate), null, label);
		assert.equal(isDirectOfflineAudioMixPlan(candidate), false, label);
	}
});

test('direct audio render admission rejects forged strategy and central-output evidence', () => {
	const valid = offlinePlan('wav');
	const render = structuredClone(valid.render) as Record<string, unknown>;
	const admission = render.offlineRenderAdmission as Record<string, unknown>;
	const geometry = admission.geometry as Record<string, unknown>;
	const outputAdmission = admission.outputAdmission as Record<string, unknown>;
	const peak = outputAdmission.peakUsefulBinaryWorkingSet as Record<string, unknown>;
	const candidates: readonly [string, Record<string, unknown>][] = [
		['fast flag', changed(render, (value) => { value.fast = false; })],
		['render reason', changed(render, (value) => { value.reason = 'output-memory'; })],
		['render output bytes', changed(render, (value) => { value.outputBytes = Number(value.outputBytes) + 1; })],
		['total bytes', changed(render, (value) => { value.totalBytes = Number(value.totalBytes) + 1; })],
		['threshold pair', changed(render, (value) => {
			value.thresholds = { outputBytes: 384 * 1024 ** 2, totalBytes: 320 * 1024 ** 2 };
		})],
		['admission flag', changed(render, (value) => {
			(value.offlineRenderAdmission as Record<string, unknown>).admitted = false;
		})],
		['requested frames', changed(render, (value) => {
			const owned = value.offlineRenderAdmission as Record<string, unknown>;
			(owned.geometry as Record<string, unknown>).requestedFrames = Number(geometry.requestedFrames) + 1;
		})],
		['capture arithmetic', changed(render, (value) => {
			const owned = value.offlineRenderAdmission as Record<string, unknown>;
			owned.preRollFrames = Number(owned.preRollFrames) + 1;
		})],
		['reported peak', changed(render, (value) => {
			const owned = value.offlineRenderAdmission as Record<string, unknown>;
			owned.peakUsefulBinaryBytes = Number(owned.peakUsefulBinaryBytes) + 1;
		})],
		['central output bytes', changed(render, (value) => {
			const owned = value.offlineRenderAdmission as Record<string, unknown>;
			const output = owned.outputAdmission as Record<string, unknown>;
			(output.peakUsefulBinaryWorkingSet as Record<string, unknown>).bytes = Number(peak.bytes) + 1;
		})],
		['unexpected render field', changed(render, (value) => { value.unexpected = true; })],
	];
	for (const [label, candidate] of candidates) {
		const plan = { ...valid, render: candidate };
		assert.equal(directAudioRenderStrategy(plan), null, label);
		assert.equal(isDirectOfflineAudioMixPlan(plan), false, label);
	}
});

test('direct audio render admission binds encode geometry and exact pre-roll to central geometry', () => {
	const converted = offlinePlan('wav', { sampleRate: 44_100, channelMapping: 'mono' }, 96_000);
	const render = structuredClone(converted.render) as Record<string, unknown>;
	const expandedFrames = converted.outputFrames + 1;
	const expandedBytes = expandedFrames * converted.channelCount * Float32Array.BYTES_PER_ELEMENT;
	const expandedRender = structuredClone(render) as Record<string, unknown>;
	expandedRender.outputBytes = expandedBytes;
	expandedRender.totalBytes = expandedBytes + Number(expandedRender.livePcmBytes);
	const candidates: readonly [string, unknown][] = [
		['encode sample rate', { ...converted, sampleRate: converted.sampleRate + 1 }],
		['encode output frames', {
			...converted,
			outputFrames: expandedFrames,
			outputBytesPerRender: expandedBytes,
			render: expandedRender,
		}],
		['input render width', {
			...converted,
			encoding: { ...converted.encoding, inputChannelCount: 1 },
		}],
		['noncanonical channel mapping', {
			...converted,
			channelMapping: {
				inputChannelCount: 2, outputChannelCount: 1, mode: 'made-up', channels: [],
			},
			encoding: {
				...converted.encoding,
				channelMapping: {
					inputChannelCount: 2, outputChannelCount: 1, mode: 'made-up', channels: [],
				},
			},
		}],
	];
	for (const [label, candidate] of candidates) {
		assert.equal(directAudioRenderStrategy(candidate), null, label);
	}

	const ranged = offlinePlan('wav', { range: { startFrame: 20, endFrame: 52 } });
	const changedRender = structuredClone(ranged.render) as Record<string, unknown>;
	const admission = changedRender.offlineRenderAdmission as Record<string, unknown>;
	admission.preRollFrames = Number(admission.preRollFrames) - 1;
	admission.graphLatencyFrames = Number(admission.graphLatencyFrames) + 1;
	assert.equal(
		directAudioRenderStrategy({ ...ranged, render: changedRender }),
		null,
		'pre-roll split must remain planner-owned',
	);

	const outsideProject = offlinePlan('wav', { range: { startFrame: 100, endFrame: 120 } });
	assert.equal(outsideProject.render.strategy, 'offline');
	assert.equal(
		directAudioRenderStrategy(outsideProject),
		null,
		'direct rendering refuses central pre-roll evidence that differs from the render request',
	);
});

function changed(
	value: Record<string, unknown>,
	change: (clone: Record<string, unknown>) => void,
): Record<string, unknown> {
	const clone = structuredClone(value) as Record<string, unknown>;
	change(clone);
	return clone;
}

function offlinePlan(
	format: 'aiff' | 'bwf' | 'wav',
	overrides: Readonly<Record<string, unknown>> = {},
	projectSampleRate = 48_000,
) {
	return createExportPlan(projectFixture(projectSampleRate), {
		format,
		includeTail: false,
		livePcmBytes: 0,
		date: '2026-08-02',
		productName: 'Soundscaper',
		...overrides,
	});
}

function projectFixture(sampleRate = 48_000) {
	const frameCount = 64;
	return {
		schemaVersion: 9,
		id: 'direct-offline-render-plan',
		title: 'Offline mix',
		revision: 1,
		createdAt: '2026-08-02T00:00:00.000Z',
		updatedAt: '2026-08-02T00:00:00.000Z',
		sampleRate,
		masterChannels: 2,
		metadata: {},
		selection: { startFrame: 0, endFrame: frameCount },
		loop: { enabled: false, startFrame: 0, endFrame: frameCount },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount, channelCount: 2, sampleRate, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: frameCount,
		}],
		tracks: [{
			id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'],
			effectsActive: true, effects: [],
		}],
		mixer: { groups: [], sends: [], routes: {} },
		master: { effectsActive: true, effects: [] },
	};
}
