/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createStandardDelayProcessor } from '../src/common/editor/first-party-effects/standard/delay-dsp.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';

for (const rate of [8000, 48000]) test(`a selected ${rate} Hz render preserves twenty seconds of finite delay history`, async context => {
	const fixture = createFixture(rate);
	context.after(async () => { await fixture.engine.dispose(); });
	const complete = await fixture.engine.renderMix({ startFrame: 0, endFrame: rate * 20 });
	const selected = await fixture.engine.renderMix({ startFrame: rate * 18, endFrame: rate * 19,
		preRollFrames: rate * 10 });
	assert.ok('channels' in complete && 'channels' in selected);
	const fullChannel = complete.channels[0], selectedChannel = selected.channels[0];
	assert.ok(fullChannel instanceof Float32Array && selectedChannel instanceof Float32Array);
	assert.equal(selectedChannel.length, rate);
	const reference = rms(fullChannel.subarray(Math.round(rate * 18.1), Math.round(rate * 18.9)));
	assert.ok(reference > .12, 'The full render must retain ten in-phase programme copies.');
	const actual = rms(selectedChannel.subarray(Math.round(rate * .1), Math.round(rate * .9)));
	assert.ok(Math.abs(actual / reference - 1) < .00001,
		`Selected processing must match the same complete passage; received ratio ${actual / reference}.`);
	assert.equal(fixture.starts.at(-1), 0, 'A normal twenty-second delay requires all eighteen available preceding seconds.');
});

for (const mode of ['disabled', 'dry', 'short', 'explicit'] as const) test(`selected history preserves ${mode} render controls`, async context => {
	const rate = 8000;
	const fixture = createFixture(rate, mode);
	context.after(async () => { await fixture.engine.dispose(); });
	const requested = rate * (mode === 'explicit' ? 16 : 10);
	const selected = await fixture.engine.renderMix({ startFrame: rate * 18, endFrame: rate * 19, preRollFrames: requested });
	assert.ok('channels' in selected);
	const channel = selected.channels[0];
	assert.ok(channel instanceof Float32Array);
	assert.equal(channel.length, rate);
	assert.ok(rms(channel) > .013);
	assert.equal(fixture.starts.at(-1), rate * 18 - requested,
		'No inactive or shorter effect may enlarge the caller\'s accepted pre-roll; longer explicit pre-roll is retained.');
});

function createFixture(rate: number, mode?: 'disabled' | 'dry' | 'short' | 'explicit') {
	const params = { time: 2, echoes: mode === 'short' || mode === 'explicit' ? 3 : 10,
		echoGain: 0, mix: mode === 'dry' ? 0 : 1 };
	const effect = createEffect('multi-tap-delay', { id: 'delay', enabled: mode !== 'disabled', params });
	const document = createSoundscaperProject({ id: `finite-history-${rate}-${mode ?? 'wet'}`,
		sources: [createAudioSource({ id: 'source', name: 'Steady recording', storageKey: 'source',
			sampleRate: rate, channelCount: 1, frameCount: rate * 20 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Steady recording', clipIds: ['clip'], effects: [effect], spectrogram: { maximumFrequency: rate / 2 } })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 0,
			durationFrames: rate * 20, sourceDurationFrames: rate * 20 })], sampleRate: rate });
	assert.ok(validateSoundscaperProject(document));
	const starts: number[] = [];
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
		softwareRenderer: ({ startFrame, captureStartFrame, endFrame, sampleRate }) => {
			assert.ok(typeof startFrame === 'number' && typeof captureStartFrame === 'number'
				&& typeof endFrame === 'number' && typeof sampleRate === 'number');
			starts.push(startFrame);
			const input = Float32Array.from({ length: endFrame - startFrame }, (_, index) =>
				.02 * Math.sin(2 * Math.PI * 500 * (startFrame + index) / sampleRate));
			const output = new Float32Array(input.length);
			if (mode === 'disabled') output.set(input);
			else {
				const processor = createStandardDelayProcessor({ sampleRate, channelCount: 1, params });
				try { processor.processBlock([input], [output], input.length); } finally { processor.dispose(); }
			}
			return { channels: [output.slice(captureStartFrame - startFrame)], sampleRate };
		} });
	engine.loadProject(projectForRuntimeConsumers(document));
	return { engine, starts };
}

function rms(samples: Float32Array): number {
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	return Math.sqrt(sum / samples.length);
}
