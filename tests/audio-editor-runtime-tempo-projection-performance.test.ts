/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
} from '../src/common/editor/runtime-clip-projection.ts';
import {
	beatToSampleFrame,
	type HoldTempoMap,
	type Rational,
	type SampleFrame,
} from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;

test('one runtime project projection preserves exact point timing across unordered map coordinates', () => {
	for (const tempoMap of exactTempoMaps()) {
		const beats = [
			{ num: 8, den: 1 },
			{ num: 1, den: 3 },
			{ num: 4, den: 1 },
			{ num: 13, den: 2 },
			{ num: 0, den: 1 },
		] as const;
		const clips = beats.slice(0, 3).map((beat, index) => musicalClip(`timeline-${String(index)}`, beat));
		const projectBinClips = beats.slice(3).map((beat, index) => musicalClip(`bin-${String(index)}`, beat));
		const project: RuntimeClipProject = {
			schemaVersion: 10,
			sampleRate: SAMPLE_RATE,
			tempoMap,
			clips,
			tracks: [{
				id: 'labels',
				type: 'label',
				labels: [{
					id: 'label',
					anchor: 'musical',
					startBeat: beats[4],
					endBeat: beats[1],
				}],
			}],
			projectBin: { clips: projectBinClips },
		};

		const projected = resolveRuntimeProjectProjection(project);
		assert.deepEqual(
			projected.clips.map(({ timelineStartFrame }) => timelineStartFrame),
			beats.slice(0, 3).map((beat) => beatToSampleFrame(beat, tempoMap, SAMPLE_RATE, 'point')),
		);
		assert.deepEqual(
			projected.projectBin.clips.map(({ timelineStartFrame }) => timelineStartFrame),
			beats.slice(3).map((beat) => beatToSampleFrame(beat, tempoMap, SAMPLE_RATE, 'point')),
		);
		const label = (projected.tracks[0] as Readonly<{ labels: readonly Readonly<Record<string, unknown>>[] }>).labels[0];
		assert.deepEqual(
			[label.startFrame, label.endFrame],
			[
				beatToSampleFrame(beats[4], tempoMap, SAMPLE_RATE, 'point'),
				beatToSampleFrame(beats[1], tempoMap, SAMPLE_RATE, 'point'),
			],
		);
	}
});

test('runtime projection preindexes one maximum-size tempo map for all project clips', () => {
	const eventCount = 4_096;
	const clipCount = 4_096;
	const tempoMap: HoldTempoMap = {
		mode: 'musical',
		events: Array.from({ length: eventCount }, (_, index) => ({
			beat: { num: index, den: 1 },
			bpm: { num: index % 2 ? 60 : 120, den: 1 },
		})),
	};
	const clips = Array.from({ length: clipCount }, (_, index) => (
		musicalClip(`clip-${String(index)}`, { num: clipCount - index - 1, den: 1 })
	));
	const project: RuntimeClipProject = {
		schemaVersion: 10,
		sampleRate: SAMPLE_RATE,
		tempoMap,
		clips: clips.slice(0, clipCount / 2),
		tracks: [],
		projectBin: { clips: clips.slice(clipCount / 2) },
	};

	const startedAt = performance.now();
	const projected = resolveRuntimeProjectProjection(project);
	const elapsed = performance.now() - startedAt;

	assert.equal(projected.clips.length + projected.projectBin.clips.length, clipCount);
	assert.ok(elapsed < 750, `runtime tempo projection took ${String(Math.round(elapsed))} ms`);
});

function exactTempoMaps(): readonly HoldTempoMap[] {
	return [{
		mode: 'musical',
		events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 100, den: 3 } },
			{ beat: { num: 4, den: 1 }, bpm: { num: 75, den: 1 } },
			{ beat: { num: 7, den: 1 }, bpm: { num: 120, den: 1 } },
		],
	}, {
		mode: 'sampleLocked',
		events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: 0 as SampleFrame },
			{ beat: { num: 4, den: 1 }, bpm: { num: 90, den: 1 }, samplePosition: 96_000 as SampleFrame },
			{ beat: { num: 7, den: 1 }, bpm: { num: 60, den: 1 }, samplePosition: 192_000 as SampleFrame },
		],
	}];
}

function musicalClip(id: string, beat: Rational): Readonly<Record<string, unknown>> {
	return {
		id,
		kind: 'audio',
		anchor: 'musical',
		musicalStartBeat: beat,
		musicalExtent: 'fixedSamples',
		durationFrames: 1,
		sourceStartFrame: 0,
		sourceDurationFrames: 1,
	};
}
