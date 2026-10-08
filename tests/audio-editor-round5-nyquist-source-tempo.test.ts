/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNyquistHostService, type NyquistHostProject } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-host-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { EffectTarget } from '../src/common/editor/controller/effects/effect-selection-service.ts';

for (const scenario of [
	{ name: 'moved recording', timelineStartFrame: 240_000, sourceStartFrame: 4800, expected: 90 },
	{ name: 'late source window at project zero', timelineStartFrame: 0, sourceStartFrame: 120_000, expected: 120 },
] as const) {
	test(`Nyquist source tempo uses the placed ${scenario.name}`, () => {
		const sampleRate = 48_000;
		const sourceRate = 24_000;
		const persisted = createSoundscaperProject({ id: 'project', now: '2026-10-08T04:00:00.000Z', sampleRate,
			tempoMap: { mode: 'musical', events: [
				{ id: 'initial', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ id: 'later', beat: { num: 8, den: 1 }, bpm: { num: 90, den: 1 } },
			] },
			sources: [createAudioSource({ id: 'source', sampleRate: sourceRate, frameCount: 240_000, channelCount: 1 })],
			clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: scenario.timelineStartFrame,
				sourceStartFrame: scenario.sourceStartFrame, sourceDurationFrames: 19_200, durationFrames: 38_400 })],
			tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
		const project = persisted as unknown as NyquistHostProject;
		const generation = new EditorProjectGeneration(); generation.activate(project.id);
		const target: EffectTarget = { track: { ...project.tracks[0]!, id: 'source-editor:source' },
			sourceId: 'source', sourceTrackId: 'track', sourceClipId: 'clip', sourceSampleRate: sourceRate,
			startFrame: scenario.sourceStartFrame, endFrame: scenario.sourceStartFrame + 19_200,
			durationFrames: 19_200, channelCount: 1, hasAudio: true };
		const service = createNyquistHostService({
			state: { selectedTrackId: 'track', nyquistAbort: null, audacityEffectProcessing: false, audacityPreviewSource: null },
			copy: { labels: 'Labels', playing: 'Playing', ready: 'Ready' }, locale: 'en', getProject: () => project,
			captureProject: () => generation.capture(project.id), assertProject: token => { generation.assertCurrent(token); },
			activeSelection: () => null, projectSampleRate: () => sampleRate, getPositionFrames: () => 0,
			getAudioContext: () => { throw new Error('Property inspection must not start audio.'); },
			getPlaybackDestination: () => null, pauseTransport() {}, assertAudioOutput() {},
			bufferFromChannels: () => { throw new Error('Property inspection must not render.'); },
			cancelAudacityEffectPreview: () => false, createId: prefix => prefix,
			commit() { assert.fail('Property inspection must not author the project.'); },
			setStatus() {}, publishDocumentSnapshot() {},
		});
		const properties = service.nyquistHostProperties(target, [target], 0, [new Float32Array(19_200)], {});
		assert.equal(properties.PROJECT.TEMPO, scenario.expected);
		assert.equal(properties.PROJECT.RATE, sampleRate);
		assert.equal(properties.SELECTION.START, scenario.sourceStartFrame / sourceRate);
		assert.equal(properties.SELECTION.END, (scenario.sourceStartFrame + 19_200) / sourceRate);
	});
}
