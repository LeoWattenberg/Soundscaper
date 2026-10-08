/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNyquistHostService, type NyquistHostProject } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-host-service.ts';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';

for (const [sampleRate, channelCount] of [[48_000, 1], [24_000, 2]] as const) {
	test(`Nyquist clip metadata follows the ${sampleRate} Hz native Source editor sound`, () => {
		const project = createSoundscaperProject({ id: 'project', now: '2026-10-08T04:00:00.000Z', sampleRate: 48_000,
			sources: [createAudioSource({ id: 'source', sampleRate, frameCount: sampleRate, channelCount })],
			clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 240_000,
				sourceStartFrame: Math.round(sampleRate * 0.2), sourceDurationFrames: Math.round(sampleRate * 0.6), durationFrames: 28_800 })],
			tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] }) as unknown as NyquistHostProject;
		const generation = new EditorProjectGeneration(); generation.activate(project.id);
		const source = createSourceEditorEffects({ getProject: () => project as unknown as EffectSelectionProject,
			loadSourceBuffer: () => { throw new Error('Reading host metadata does not render audio.'); }, publishDocumentSnapshot() {} });
		source.setSourceSelection({ clipId: 'clip', startFrame: 0, endFrame: sampleRate });
		const target = source.target(); assert.ok(target);
		const host = createNyquistHostService({
			state: { selectedTrackId: 'track', nyquistAbort: null, audacityEffectProcessing: false, audacityPreviewSource: null },
			copy: { labels: 'Labels', playing: 'Playing', ready: 'Ready' }, locale: 'en', getProject: () => project,
			captureProject: () => generation.capture(project.id), assertProject: token => { generation.assertCurrent(token); },
			activeSelection: () => null, projectSampleRate: () => 48_000, getPositionFrames: () => 0,
			getAudioContext: () => { throw new Error('Reading host metadata does not start playback.'); },
			getPlaybackDestination: () => null, pauseTransport() {}, assertAudioOutput() {},
			bufferFromChannels: () => { throw new Error('Reading host metadata does not render audio.'); },
			cancelAudacityEffectPreview: () => false, createId: prefix => prefix,
			commit() { assert.fail('Reading host metadata does not author the project.'); }, setStatus() {}, publishDocumentSnapshot() {},
		});
		const channels = Array.from({ length: channelCount }, () => new Float32Array(sampleRate));
		const properties = host.nyquistHostProperties(target, [target], 0, channels, {});
		assert.deepEqual(properties.TRACK.CLIPS, channelCount === 1 ? [[0, 1]] : [[[0, 1]], [[0, 1]]]);
		assert.deepEqual(properties.TRACK.INCLIPS, properties.TRACK.CLIPS);
		assert.equal(properties.SELECTION.START, 0); assert.equal(properties.SELECTION.END, 1);
		const timelineTarget = { ...target, track: project.tracks[0]!, sourceId: undefined,
			sourceClipId: undefined, sourceSampleRate: undefined, sourceFrameCount: undefined };
		const timeline = host.nyquistHostProperties(timelineTarget, [timelineTarget], 0, channels, {});
		assert.deepEqual(timeline.TRACK.CLIPS, channelCount === 1 ? [[5, 5.6]] : [[[5, 5.6]], [[5, 5.6]]]);
	});
}
