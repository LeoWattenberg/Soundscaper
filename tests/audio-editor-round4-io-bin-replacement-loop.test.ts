/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';

function fixture(loop = true) {
	let project = createCurrentAudioEditorProject({ id: 'bin-replacement', sampleRate: 48_000 });
	const clip = { sourceId: 'old', title: 'Take', timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 48_000, durationFrames: 48_000 };
	project = applyEditorCommand(project, { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'old', storageKey: 'old', name: 'Old.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 } },
		{ type: 'project-bin/add', clip: { ...clip, id: 'bin', kind: 'audio' } },
		{ type: 'track/add', track: { id: 'track', name: 'Take' } },
		{ type: 'clip/add', trackId: 'track', clip: { ...clip, id: 'first' } },
		{ type: 'clip/add', trackId: 'track', clip: { ...clip, id: 'later', timelineStartFrame: 200_000 } },
	] });
	if (loop) project = applyEditorCommand(project, { type: 'clip/update', clipId: 'first', changes: {
		loop: { periodFrames: 48_000, durationFrames: 120_000, offsetFrames: 12_000 },
	} });
	return project;
}

function replace(project: ReturnType<typeof fixture>, mode: 'keep-spacing' | 'contract-gaps', sourceRate = 48_000) {
	const sourceFrames = sourceRate / 2;
	return executeEditorCommand(createEditorHistory(project), { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'new', storageKey: 'new', name: 'Short.wav', sampleRate: sourceRate, frameCount: sourceFrames, channelCount: 1 } },
		{ type: 'project-bin/replace-media', clipId: 'bin', replacements: [{ oldSourceId: 'old', newSourceId: 'new' }],
			templates: [{ id: 'template', kind: 'audio', title: 'Short', sourceId: 'new', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: sourceFrames, durationFrames: 24_000 }], shortfallMode: mode },
	] });
}

for (const mode of ['keep-spacing', 'contract-gaps'] as const) {
	test(`${mode} shorter replacement preserves fractional repeat count, phase and speed`, () => {
		const project = fixture();
		const history = replace(project, mode, 44_100);
		const first = history.present.clips.find((clip: Readonly<{ id: string }>) => clip.id === 'first')!;
		assert.equal(first.durationFrames, 60_000);
		assert.equal(first.sourceDurationFrames, 22_050);
		assert.equal(first.speedRatio, 1);
		assert.deepEqual(readClipLoop(first), { periodFrames: 24_000, offsetFrames: 6_000 });
		const later = history.present.clips.find((clip: Readonly<{ id: string }>) => clip.id === 'later')!;
		assert.equal(later.timelineStartFrame, mode === 'contract-gaps' ? 140_000 : 200_000);
		assert.equal(later.durationFrames, 24_000);
		assert.equal(readClipLoop(later), null);
		assert.equal(history.undoStack.length, 1);
		const restored = undoEditorCommand(history).present;
		assert.deepEqual(restored.clips, project.clips);
		assert.deepEqual(restored.projectBin, project.projectBin);
		assert.deepEqual(restored.sources, project.sources);
	});
}

test('one-pass replacement retains its existing duration and never creates a loop', () => {
	const history = replace(fixture(false), 'keep-spacing');
	const first = history.present.clips[0]!;
	assert.equal(first.durationFrames, 24_000);
	assert.equal(first.sourceDurationFrames, 24_000);
	assert.equal(readClipLoop(first), null);
});
