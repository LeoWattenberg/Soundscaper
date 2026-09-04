import test from 'node:test';
import assert from 'node:assert/strict';
import {
	analyzeAudioChannels,
	createStreamingAudioAnalyzer,
} from '../src/common/editor/analysis.js';
import { createEffect } from '../src/common/editor/effects.js';
import { chooseRenderStrategy, createExportPlan, sanitizeExportName } from '../src/common/editor/export.js';
import {
	AUDIO_EDITOR_SAMPLE_RATE,
	aggregateStereoMinutes,
	projectDurationFrames,
	projectEnvelope,
} from '../src/common/editor/project.js';
import {
	NOW,
	apply,
	createFixture,
} from './helpers/audio-editor-model-harness.js';

test('duration, aggregate stereo minutes, and supported envelopes do not count clip reuse twice', () => {
	const sourceFrames = AUDIO_EDITOR_SAMPLE_RATE * 60 * 31;
	let project = createFixture({ frameCount: sourceFrames });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'long', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 0, durationFrames: 1_000,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-2', clip: {
		id: 'reuse', sourceId: 'source-1', timelineStartFrame: 3_000, sourceStartFrame: 2_000, durationFrames: 1_000,
	} });
	assert.equal(projectDurationFrames(project), 4_000);
	assert.equal(aggregateStereoMinutes(project), 31);
	assert.deepEqual(projectEnvelope(project).exceeded, { tracks: false, stereoMinutes: true });
	assert.equal(projectEnvelope(project, { mobile: true }).limits.trackCount, 4);
});

test('capacity envelopes accept the documented desktop and mobile boundaries and reject one step beyond them', () => {
	const atLimit = ({ stereoMinutes, trackCount, mobile }) => {
		const frameCount = AUDIO_EDITOR_SAMPLE_RATE * 60 * stereoMinutes;
		let project = createFixture({ frameCount });
		project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
			id: `capacity-${stereoMinutes}`, sourceId: 'source-1', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: frameCount,
		} });
		for (let index = 3; index <= trackCount; index += 1) {
			project = apply(project, { type: 'track/add', track: { id: `track-${index}`, name: `Track ${index}` } });
		}
		const envelope = projectEnvelope(project, { mobile });
		assert.equal(envelope.actual.trackCount, trackCount);
		assert.equal(envelope.actual.stereoMinutes, stereoMinutes);
		assert.equal(envelope.supported, true);
		project = apply(project, { type: 'track/add', track: { id: 'over-limit', name: 'Over limit' } });
		assert.equal(projectEnvelope(project, { mobile }).exceeded.tracks, true);
	};

	atLimit({ stereoMinutes: 30, trackCount: 8, mobile: false });
	atLimit({ stereoMinutes: 10, trackCount: 4, mobile: true });
});

test('export plans define mix/stem policy, encoding defaults, tails, names, and memory strategy', () => {
	let project = createFixture({ frameCount: 96_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000,
	} });
	project = apply(project, { type: 'effect/add', scope: 'track', trackId: 'track-1', effect: createEffect('reverb', {
		id: 'reverb-1', params: { decay: 2, preDelay: 0.25 },
	}) });
	project = apply(project, { type: 'effect/add', scope: 'master', effect: createEffect('delay', {
		id: 'delay-1', params: { time: 0.5, feedback: 0.5 },
	}) });
	const mix = createExportPlan(project, { format: 'wav', date: NOW });
	assert.equal(mix.encoding.bitDepth, 24);
	assert.equal(mix.dither, true);
	assert.equal(mix.outputs[0].respectMuteSolo, true);
	assert.equal(mix.outputs[0].includeMaster, true);
	assert.equal(mix.outputs[0].fileName, 'Studio-Test-mix-2026-07-12.wav');
	assert.ok(mix.tailFrames > 2 * AUDIO_EDITOR_SAMPLE_RATE);
	assert.equal(mix.render.strategy, 'offline');

	const stems = createExportPlan(project, { mode: 'stems', format: 'opus', bitRate: 160, date: NOW });
	assert.equal(stems.outputs.length, 2);
	assert.deepEqual(stems.outputs.map((output) => output.fileName), ['01-Voice.opus', '02-Music.opus']);
	assert.equal(stems.outputs.every((output) => !output.includeMaster && !output.respectMuteSolo), true);
	assert.equal(stems.archive.fileName, 'Studio-Test-stems-2026-07-12.zip');
	assert.equal(sanitizeExportName('  A/B: “Mix”  '), 'A-B-Mix');
	assert.deepEqual(chooseRenderStrategy({ mobile: true, outputBytes: 97 * 1024 ** 2, livePcmBytes: 0 }).strategy, 'realtime-stream');
	assert.throws(() => createExportPlan(project, { format: 'mp3', bitRate: 129 }), /bitrate/);
});

test('export tails include the longest active routed group or send rack', () => {
	let project = createFixture({ frameCount: 96_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'tail-clip', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000,
	} });
	project = apply(project, {
		type: 'mixer/bus-add', busType: 'group', bus: { id: 'tail-group', name: 'Tail group' },
	});
	project = apply(project, {
		type: 'mixer/bus-add', busType: 'send', bus: { id: 'tail-send', name: 'Tail send' },
	});
	project = apply(project, {
		type: 'effect/add', scope: 'group', busId: 'tail-group',
		effect: createEffect('delay', {
			id: 'group-delay', params: { time: 0.5, feedback: 0, mix: 1 },
		}),
	});
	project = apply(project, {
		type: 'effect/add', scope: 'send', busId: 'tail-send',
		effect: createEffect('reverb', {
			id: 'send-reverb', params: { decay: 0.75, preDelay: 0.25, mix: 1 },
		}),
	});
	project = apply(project, {
		type: 'mixer/route-update', trackId: 'track-1',
		changes: { groupId: 'tail-group', sends: { 'tail-send': 0.5 } },
	});

	assert.equal(createExportPlan(project).tailFrames, 48_000);
	assert.equal(createExportPlan(project, { mode: 'stems' }).tailFrames, 48_000);

	project = apply(project, {
		type: 'mixer/bus-update', busType: 'send', busId: 'tail-send',
		changes: { effectsActive: false },
	});
	assert.equal(createExportPlan(project).tailFrames, 24_000);
});

test('streaming analysis is chunk-invariant and reports channel-aware production levels', () => {
	const sampleRate = 8_000;
	const frames = sampleRate * 4;
	const left = Float32Array.from({ length: frames }, (_, index) => 0.5 * Math.sin(2 * Math.PI * 440 * index / sampleRate));
	const right = left.slice();
	const oneShot = analyzeAudioChannels([left, right], sampleRate);
	const streaming = createStreamingAudioAnalyzer({ sampleRate, channelCount: 2 });
	for (let start = 0; start < frames; start += 777) {
		const end = Math.min(frames, start + 777);
		streaming.push([left.subarray(start, end), right.subarray(start, end)]);
	}
	const chunked = streaming.finish();
	assert.ok(Math.abs(oneShot.peakDbfs + 6.0206) < 0.01);
	assert.ok(Math.abs(oneShot.rmsDbfs + 9.0309) < 0.01);
	assert.ok(oneShot.truePeakDbtp >= oneShot.peakDbfs);
	assert.equal(oneShot.stereoCorrelation, 1);
	assert.equal(oneShot.clippedSamples, 0);
	assert.ok(Number.isFinite(oneShot.momentaryLufs));
	assert.ok(Number.isFinite(oneShot.shortTermLufs));
	assert.ok(Number.isFinite(oneShot.integratedLufs));
	assert.ok(Math.abs(chunked.integratedLufs - oneShot.integratedLufs) < 1e-9);
	assert.ok(Math.abs(chunked.truePeakDbtp - oneShot.truePeakDbtp) < 1e-9);
	assert.deepEqual(streaming.finish(), chunked);
	assert.throws(() => streaming.push([left, right]), /finished/);
});

test('streaming analysis handles silence, anti-phase stereo, clipping, and short programs explicitly', () => {
	const sampleRate = 8_000;
	const silence = new Float32Array(sampleRate * 3);
	const silent = analyzeAudioChannels([silence, silence], sampleRate);
	assert.equal(silent.integratedLufs, null);
	assert.equal(silent.momentaryLufs, null);
	assert.equal(silent.shortTermLufs, null);
	assert.equal(silent.loudnessRangeLufs, null);
	assert.equal(silent.peakDbfs, -120);

	const left = Float32Array.from({ length: sampleRate }, (_, index) => Math.sin(2 * Math.PI * 200 * index / sampleRate));
	const right = Float32Array.from(left, (sample) => -sample);
	left[5] = 1.2;
	right[5] = -1.2;
	const antiPhase = analyzeAudioChannels([left, right], sampleRate);
	assert.ok(Math.abs(antiPhase.stereoCorrelation + 1) < 1e-12);
	assert.equal(antiPhase.clippedSamples >= 2, true);
	assert.equal(antiPhase.clippedFrames >= 1, true);
	assert.equal(antiPhase.shortTermLufs, null);
});
