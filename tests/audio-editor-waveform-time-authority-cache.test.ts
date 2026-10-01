/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { HoldTempoMap } from '../src/common/editor/timeline-time.ts';
import {
	createTimelineClipViewModel,
	type TimelineClipViewModel,
	type TimelineClipViewModelOptions,
	type TimelineWaveformCacheEntry,
} from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import type { SpectrogramSampleView } from '../src/common/editor/ui/timeline/spectrogram-sample-view.ts';

function tempoMap(events: readonly (readonly [number, number])[]): HoldTempoMap {
	return { mode: 'musical', events: events.map(([beat, bpm]) => ({
		beat: { num: beat, den: 1 }, bpm: { num: bpm, den: 1 },
	})) };
}

function options(): TimelineClipViewModelOptions {
	const source = { id: 'source', sampleRate: 4, frameCount: 8, channelCount: 1 };
	const samples = Float32Array.from({ length: 8 }, (_, index) => index);
	const buffer = { numberOfChannels: 1, getChannelData: () => samples };
	return {
		controller: { getClipVisualData: () => ({ source, buffer }) },
		sourceLookup: new Map([[source.id, source]]),
		clip: {
			id: 'clip', sourceId: source.id, kind: 'audio', anchor: 'musical',
			timelineStartFrame: 0, durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
			waveformStartFrame: 0, waveformEndFrame: 8,
			musicalStartBeat: { num: 0, den: 1 }, musicalExtent: 'beat',
			musicalDurationBeats: { num: 4, den: 1 },
			warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' },
				{ outer: 4, source: 8, mode: 'forward' },
			] },
		},
		project: { sampleRate: 4, tempoMap: tempoMap([[0, 120]]) },
		geometry: { overscanStartFrame: 0, pixelsPerSecond: 4, sampleRate: 4 },
		selection: { selectedClipIds: null }, copy: { clip: 'Clip' },
		rendering: { provideAudacitySpectrogram: true },
	};
}

function spectralSamples(model: TimelineClipViewModel): number[] {
	const views = model.spectrogramWaveform as readonly SpectrogramSampleView[];
	return Array.from({ length: 8 }, (_, index) => views[0]!.sampleAt(index));
}

test('same-duration tempo edits rebuild retained warped waveform and spectrogram samples', () => {
	const base = options();
	const cache = new Map<string, TimelineWaveformCacheEntry>();
	const initial = createTimelineClipViewModel({ ...base, cache });
	const equivalent = createTimelineClipViewModel({
		...base, project: { sampleRate: 4, tempoMap: tempoMap([[0, 120]]) }, cache,
	});
	assert.equal(equivalent.audacityWaveform, initial.audacityWaveform);
	assert.equal(equivalent.spectrogramWaveform, initial.spectrogramWaveform);
	const changed = { ...base, project: { sampleRate: 4, tempoMap: tempoMap([[0, 240], [2, 80]]) } };
	const retained = createTimelineClipViewModel({ ...changed, cache });
	const fresh = createTimelineClipViewModel(changed);
	assert.equal(retained.waveformError, undefined);
	assert.equal(retained.duration, initial.duration, 'the changed tempos preserve the clip endpoints');
	assert.notEqual(retained.audacityWaveform, initial.audacityWaveform);
	assert.notEqual(retained.spectrogramWaveform, initial.spectrogramWaveform);
	assert.notDeepEqual(retained.audacityWaveform, initial.audacityWaveform);
	assert.deepEqual(retained.audacityWaveform, fresh.audacityWaveform);
	assert.deepEqual(spectralSamples(initial), [0, 1, 2, 3, 4, 5, 6, 7]);
	assert.deepEqual(spectralSamples(retained), [0, 2, 4, 4, 5, 6, 6, 7]);
	assert.deepEqual(spectralSamples(retained), spectralSamples(fresh));
});

test('sample-rate edits refresh retained plans even when the minimum clip width stays fixed', () => {
	const base = options();
	const clip = { ...base.clip, anchor: 'sample', warpMap: { feature: 'audio-warp', points: [
		{ outer: 0, source: 0, mode: 'forward' }, { outer: 8, source: 8, mode: 'forward' },
	] } };
	const cache = new Map<string, TimelineWaveformCacheEntry>();
	const initial = createTimelineClipViewModel({ ...base, clip, cache });
	const changed = createTimelineClipViewModel({
		...base, clip, cache,
		project: { sampleRate: 8, tempoMap: tempoMap([[0, 120]]) },
		geometry: { ...base.geometry, sampleRate: 8 },
	});
	assert.equal(changed.waveformError, undefined);
	assert.equal(changed.duration, initial.duration);
	assert.notEqual(changed.waveformIdentity, initial.waveformIdentity);
	assert.notEqual(changed.audacityWaveform, initial.audacityWaveform);
	assert.notEqual(changed.spectrogramWaveform, initial.spectrogramWaveform);
	assert.equal((changed.audacityWaveform as { waveformIdentity: string }).waveformIdentity,
		changed.waveformIdentity);
	assert.deepEqual(spectralSamples(changed), spectralSamples(initial));
});

test('tempo-only edits retain ordinary PCM plans and their draw identity', () => {
	const base = options();
	const clip = { ...base.clip, anchor: 'sample', warpMap: null };
	const cache = new Map<string, TimelineWaveformCacheEntry>();
	const initial = createTimelineClipViewModel({ ...base, clip, cache });
	const changed = createTimelineClipViewModel({
		...base, clip, cache,
		project: { sampleRate: 4, tempoMap: tempoMap([[0, 240], [2, 80]]) },
	});
	assert.equal(changed.audacityWaveform, initial.audacityWaveform);
	assert.equal(changed.spectrogramWaveform, initial.spectrogramWaveform);
	assert.equal(changed.waveformIdentity, initial.waveformIdentity);
	assert.deepEqual(spectralSamples(changed), spectralSamples(initial));
});
