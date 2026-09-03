/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAup4ExportPlan, normalizeAup4ExportSource } from '../src/common/editor/aup4-export.js';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

/*
 * A clip carries polarity as a flag rather than as rewritten samples, so the
 * inversion has to appear wherever the clip's amplitude is realized: the clip
 * gain node during playback and offline render, and the baked PCM of an export
 * to a format with no field for it.
 */

test('an inverted clip plays through a negated clip gain while its envelope keeps its shape', async () => {
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	engine.loadProject(
		polarityProject({ inverted: true }),
		new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]),
	);
	await engine.play();

	const fadeIn = context.bufferSources[0].connections[0];
	const fadeOut = fadeIn.connections[0];
	const clipGain = fadeOut.connections[0];
	assert.deepEqual(clipGain.gain.events, [
		['set', -0.8, 0],
		['ramp', -0.4, 0.25],
		['ramp', -0.2, 0.75],
		['ramp', -0.2, 1],
	]);
	engine.stop();
	await engine.dispose();
});

test('an upright clip keeps the same envelope shape with a positive clip gain', async () => {
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	engine.loadProject(
		polarityProject({ inverted: false }),
		new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]),
	);
	await engine.play();

	const fadeIn = context.bufferSources[0].connections[0];
	const fadeOut = fadeIn.connections[0];
	const clipGain = fadeOut.connections[0];
	assert.deepEqual(clipGain.gain.events, [
		['set', 0.8, 0],
		['ramp', 0.4, 0.25],
		['ramp', 0.2, 0.75],
		['ramp', 0.2, 1],
	]);
	engine.stop();
	await engine.dispose();
});

test('AUP4 export bakes clip polarity into the PCM Audacity has no field for', () => {
	const project = {
		id: 'polarity-project',
		sampleRate: 48_000,
		sources: [{
			kind: 'audio',
			id: 'polarity-source',
			name: 'polarity-source',
			storageKey: 'polarity-source',
			mimeType: 'audio/wav',
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			channelCount: 1,
			frameCount: 4,
			sampleFormat: 'float32',
			chunkFrames: 4,
		}],
		clips: [{
			id: 'polarity-clip',
			sourceId: 'polarity-source',
			title: 'polarity-clip',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 4,
			durationFrames: 4,
			trimStartFrames: 0,
			trimEndFrames: 0,
			envelope: [],
			inverted: true,
		}],
		tracks: [{ id: 'polarity-track', type: 'audio', name: 'polarity-track', clipIds: ['polarity-clip'], effects: [] }],
	};
	const plan = createAup4ExportPlan(project);
	const normalized = normalizeAup4ExportSource(plan, {
		sourceId: 'polarity-source',
		sampleRate: 48_000,
		channels: [Float32Array.of(1, 2, 3, 4)],
	})[0];

	assert.deepEqual(normalized.channels[0], Float32Array.of(-1, -2, -3, -4));
	assert.equal(plan.project.clips[0].inverted, false);
	assert.ok(plan.compatibilityReport.items.some((item) => item.code === 'INVERTED_CLIP_RENDERED'));
});

function polarityProject({ inverted }) {
	return {
		id: 'polarity-playback-project',
		sampleRate: 48_000,
		clips: [{
			id: 'clip-1',
			sourceId: 'source-1',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: 48_000,
			gain: 0.8,
			fadeInFrames: 0,
			fadeOutFrames: 0,
			reversed: false,
			inverted,
			envelope: [{ frame: 12_000, value: 0.5 }, { frame: 36_000, value: 0.25 }],
		}],
		tracks: [{ id: 'track-1', clipIds: ['clip-1'], gain: 1, pan: 0, mute: false, solo: false, effects: [] }],
		master: { gain: 1, effects: [] },
	};
}
