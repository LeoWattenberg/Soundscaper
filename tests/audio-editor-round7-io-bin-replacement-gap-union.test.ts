/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applySoundscaperProjectCommand as applyEditorCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProjectHistory as createEditorHistory, executeSoundscaperProjectCommand as executeEditorCommand,
	undoSoundscaperProjectCommand as undoEditorCommand } from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

for (const [secondStart, contractedFrames] of [[0, 24_000], [12_000, 36_000], [72_000, 48_000]] as const) {
	test(`Contract gaps removes overlapping replaced tails once at second start ${String(secondStart)}`, () => {
		const template = { kind: 'audio', sourceId: 'old', title: 'Programme', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 };
		let project = createSoundscaperProject({ id: 'bin-gaps', sampleRate: 48_000 });
		project = applyEditorCommand(project, { type: 'batch', commands: [
			{ type: 'source/add', source: { id: 'old', storageKey: 'old', name: 'Programme.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 } },
			{ type: 'project-bin/add', clip: { ...template, id: 'bin' } },
			{ type: 'track/add', track: { id: 'track', name: 'Programme' } },
			...[0, secondStart, 144_000].map((start, index) => ({ type: 'project-bin/place', binClipId: 'bin',
				timelineStartFrame: start, placements: [{ binClipId: 'bin', trackId: 'track', clipId: `clip-${String(index)}` }] })),
		] });
		const history = executeEditorCommand(createEditorHistory(project), { type: 'batch', commands: [
			{ type: 'source/add', source: { id: 'new', storageKey: 'new', name: 'Short.wav', sampleRate: 48_000, frameCount: 24_000, channelCount: 1 } },
			{ type: 'project-bin/replace-media', clipId: 'bin', replacements: [{ oldSourceId: 'old', newSourceId: 'new' }],
				templates: [{ ...template, id: 'imported', sourceId: 'new', sourceDurationFrames: 24_000, durationFrames: 24_000 }],
				shortfallMode: 'contract-gaps' },
		] });
		const following = history.present.clips.find((clip: Readonly<{ id: string }>) => clip.id === 'clip-2')!;
		assert.equal(following.timelineStartFrame, 144_000 - contractedFrames);
		assert.equal(following.durationFrames, 24_000);
		assert.deepEqual(undoEditorCommand(history).present.clips, project.clips);
	});
}
