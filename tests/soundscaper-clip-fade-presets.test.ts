/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateClipFadeAt } from '../src/common/editor/audio-clip-transition-gain.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-history.ts';

const NOW = '2026-10-06T12:00:00.000Z';

for (const clearingValue of [undefined, null]) {
	for (const edge of ['in', 'out'] as const) {
		test(`Soundscaper clears the ${edge} fade shape with ${String(clearingValue)} and preserves undo, redo and saved linear gain`, () => {
			const project = createSoundscaperProject({
				id: 'fade-presets', now: NOW, sampleRate: 48_000,
				sources: [createAudioSource({
					id: 'source', storageKey: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000,
				})],
				tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
				clips: [createAudioClip({
					id: 'clip', sourceId: 'source', durationFrames: 100,
					fadeInFrames: 20, fadeOutFrames: 25, fadeInShape: 1, fadeOutShape: 3,
				})],
			});
			const shapeField = edge === 'in' ? 'fadeInShape' : 'fadeOutShape';
			const otherField = edge === 'in' ? 'fadeOutShape' : 'fadeInShape';
			const initial = project.clips[0]!;
			const history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(project), {
				type: 'clip/update', clipId: 'clip', changes: { [shapeField]: clearingValue },
			}, { now: NOW });
			const cleared = history.present.clips[0]!;
			assert.equal(validateSoundscaperProject(history.present), true);
			assert.equal(Object.hasOwn(cleared, shapeField), false);
			assert.equal(cleared[otherField], initial[otherField]);
			assert.equal(cleared.fadeInFrames, initial.fadeInFrames);
			assert.equal(cleared.fadeOutFrames, initial.fadeOutFrames);
			assert.equal(cleared.durationFrames, initial.durationFrames);
			assert.equal(cleared.timelineStartFrame, initial.timelineStartFrame);
			assert.equal(cleared.sourceStartFrame, initial.sourceStartFrame);
			assert.equal(history.undoStack.length, 1);
			const undone = undoSoundscaperProjectCommand(history, { now: NOW });
			assert.deepEqual(undone.present.clips, project.clips);
			const redone = redoSoundscaperProjectCommand(undone, { now: NOW });
			assert.deepEqual(redone.present.clips, history.present.clips);
			const restored = parseScapeProjectDocument(serializeScapeProjectDocument(redone.present)) as typeof project;
			assert.equal(validateSoundscaperProject(restored), true);
			assert.deepEqual(restored.clips, history.present.clips);
			const restoredClip = restored.clips[0]!;
			const fadeFrames = edge === 'in' ? restoredClip.fadeInFrames : restoredClip.fadeOutFrames;
			const quarterFrame = edge === 'in' ? fadeFrames / 4 : restoredClip.durationFrames - fadeFrames / 4;
			assert.equal(evaluateClipFadeAt(quarterFrame, restoredClip.durationFrames, fadeFrames, edge, restoredClip[shapeField]), 0.25);
		});
	}
}
