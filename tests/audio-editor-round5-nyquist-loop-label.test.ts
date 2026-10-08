/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nyquistLabelTimelineRange } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-label-projection.ts';
import type { NyquistHostProject } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-host-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';

for (const sourceRate of [32_000, 48_000]) {
	for (const scenario of [
		{ name: 'ordinary', repeated: false, reversed: false, offsetFrames: 0, expected: [57_600, 67_200] },
		{ name: 'repeated', repeated: true, reversed: false, offsetFrames: 0, expected: [57_600, 67_200] },
		{ name: 'reversed repeat', repeated: true, reversed: true, offsetFrames: 0, expected: [67_200, 76_800] },
		{ name: 'split repeat phase', repeated: true, reversed: false, offsetFrames: 19_200, expected: [76_800, 86_400] },
	]) {
		test(`source labels preserve their ${sourceRate} Hz sound position in a ${scenario.name} clip`, () => {
			const geometry = { id: 'clip', sourceId: 'source', timelineStartFrame: 48_000,
				reversed: scenario.reversed, sourceStartFrame: 0, sourceDurationFrames: Math.round(sourceRate * 0.8), durationFrames: 38_400 };
			const original = { ...createAudioClip(geometry), ...geometry };
			const clip = { ...original, ...(scenario.repeated ? clipLoopUpdateFields(original, {
				periodFrames: 38_400, durationFrames: 76_800, offsetFrames: scenario.offsetFrames,
			}) : {}) };
			const project = createSoundscaperProject({ id: 'project', now: '2026-10-08T04:00:00.000Z', sampleRate: 48_000,
				sources: [createAudioSource({ id: 'source', sampleRate: sourceRate, channelCount: 1,
					frameCount: Math.round(sourceRate * 0.8) })], clips: [clip],
				tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] }) as unknown as NyquistHostProject;
			assert.deepEqual(nyquistLabelTimelineRange(project, {
				start: 0.2, end: 0.4, text: 'Source cue', baseFrame: 0,
				sourceTarget: { sourceClipId: 'clip', sourceSampleRate: sourceRate, startFrame: 0 },
			}), scenario.expected);
		});
	}
}
