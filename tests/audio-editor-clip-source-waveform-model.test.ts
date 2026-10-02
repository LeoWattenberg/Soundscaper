/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipSourceWaveformModels } from '../src/common/editor/ui/inspector/clip-source-waveform-model.ts';
import { WAVEFORM_PEAKS_VERSION } from '../src/common/editor/waveform-peak-contract.ts';

const project = { sampleRate: 48_000, tempoMap: { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
const source = { id: 'source', sampleRate: 48_000, frameCount: 100_000, channelCount: 1 };
const clip = { id: 'clip', sourceId: 'source', kind: 'audio', anchor: 'sample', timelineStartFrame: 900_000,
	sourceStartFrame: 10_000, sourceDurationFrames: 60_000, durationFrames: 60_000 };
const peaks = { version: WAVEFORM_PEAKS_VERSION, channelCount: 1, levels: [{ blockSize: 256,
	channels: [{ minimums: new Float32Array(391).fill(-0.5), maximums: new Float32Array(391).fill(0.5), rms: new Float32Array(391).fill(0.2) }],
}] };
const options = { project, clip, source, visual: { peaks }, width: 800, startFrame: 21_000, endFrame: 22_000, displayMode: 'waveform' as const, clipLabel: 'Clip' };

test('zoom retains a coarse waveform until the private native PCM window is ready', () => {
	const pending = clipSourceWaveformModels(options);
	assert.equal(pending.models.length, 1);
	assert.ok(pending.models[0]?.audacityWaveform, 'zoom must not blank the available peak preview');
	assert.equal(pending.models[0]?.waveformPending, true);
	assert.deepEqual(pending.requests, [{ startFrame: 20_998, endFrame: 22_002 }]);
	const exact = clipSourceWaveformModels({ ...options, windows: [{ sourceId: source.id,
		startFrame: 20_998, endFrame: 22_002, channels: [new Float32Array(1004).fill(0.4)] }] });
	assert.ok(exact.models[0]?.audacityWaveform);
	assert.equal(exact.models[0]?.waveformPending, undefined);
	assert.deepEqual(exact.requests, []);
});

test('panning across unused source media requests those samples independently of timeline placement', () => {
	const prefix = clipSourceWaveformModels({ ...options, startFrame: 0, endFrame: 1000 });
	assert.deepEqual(prefix.requests, [{ startFrame: 0, endFrame: 1002 }]);
	const suffix = clipSourceWaveformModels({ ...options, startFrame: 99_000, endFrame: 100_000 });
	assert.deepEqual(suffix.requests, [{ startFrame: 98_998, endFrame: 100_000 }]);
	assert.equal(suffix.models[0]?.start, 0);
	assert.equal(suffix.models[0]?.duration, 1000 / project.sampleRate);
});

test('trimmed and retimed source segments occupy the visible viewport without offscreen clip offsets', () => {
	const view = clipSourceWaveformModels({ ...options, clip: { ...clip, sourceStartFrame: 20_000, sourceDurationFrames: 40_000, durationFrames: 80_000 },
		width: 1000, startFrame: 10_000, endFrame: 110_000 });
	assert.deepEqual(view.models.map(model => [Math.round(model.start * view.pixelsPerSecond), Math.round(model.duration * view.pixelsPerSecond)]), [[0, 100], [100, 800], [900, 100]]);
	assert.deepEqual(view.requests, [{ startFrame: 9998, endFrame: 20_002 }, { startFrame: 19_998, endFrame: 60_002 }, { startFrame: 59_998, endFrame: 70_002 }]);
});
