/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { normalizeAudioWarpMap, type AudioWarpPoint } from '../src/common/editor/audio-warp-domain.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';

function fixture(warped = true, sourceStart = 0, sourceDuration = 48_000) {
	let project = createCurrentAudioEditorProject({ id: 'replacement-warp', sampleRate: 48_000 });
	const clip = { sourceId: 'old', title: 'Production pause', timelineStartFrame: 0,
		sourceStartFrame: sourceStart, sourceDurationFrames: sourceDuration, durationFrames: 48_000 };
	project = applyEditorCommand(project, { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'old', storageKey: 'old', name: 'Original.wav', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 } },
		{ type: 'project-bin/add', clip: { ...clip, id: 'bin', kind: 'audio' } },
		{ type: 'track/add', track: { id: 'track', name: 'Production' } },
		{ type: 'clip/add', trackId: 'track', clip: { ...clip, id: 'timeline', kind: 'audio',
			...(warped ? { warpMap: normalizeAudioWarpMap({ feature: 'audio-warp', points: [
				{ outer: 0, source: sourceStart, mode: 'forward' },
				{ outer: 24_000, source: { num: 4 * sourceStart + 3 * sourceDuration, den: 4 }, mode: 'forward' },
				{ outer: 48_000, source: sourceStart + sourceDuration, mode: 'forward' },
			] }) } : {}) } },
	] });
	return project;
}

function replace(project: ReturnType<typeof fixture>, target = 'bin', sampleRate = 24_000) {
	return executeEditorCommand(createEditorHistory(project), { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'new', storageKey: 'new', name: 'Replacement.wav', sampleRate, frameCount: sampleRate * 2, channelCount: 1 } },
		{ type: 'project-bin/replace-media', clipId: target, replacements: [{ oldSourceId: 'old', newSourceId: 'new' }],
			templates: [{ id: 'replacement', kind: 'audio', title: 'Replacement', sourceId: 'new', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: sampleRate * 2, durationFrames: 96_000 }], shortfallMode: 'keep-spacing' },
	] });
}

test('native-rate replacement preserves timeline warp positions and exact Undo/Redo', () => {
	const original = fixture();
	const history = replace(original);
	const clip = history.present.clips[0]!;
	assert.equal(clip.sourceId, 'new');
	assert.equal(clip.durationFrames, 48_000);
	assert.equal(clip.sourceDurationFrames, 24_000);
	assert.deepEqual(clip.warpMap?.points.map((point: AudioWarpPoint) => point.source), [
		{ num: 0, den: 1 }, { num: 18_000, den: 1 }, { num: 24_000, den: 1 },
	]);
	assert.equal(history.undoStack.length, 1);
	const undone = undoEditorCommand(history);
	assert.deepEqual({ ...undone.present, revision: original.revision, updatedAt: original.updatedAt }, original);
	const redone = redoEditorCommand(undone).present;
	assert.deepEqual({ ...redone, revision: history.present.revision, updatedAt: history.present.updatedAt }, history.present);
});

test('replacement retains fractional warp progress within independently rounded source windows', () => {
	const history = replace(fixture(true, 11, 31));
	const clip = history.present.clips[0]!;
	assert.equal(clip.sourceStartFrame, 6);
	assert.equal(clip.sourceDurationFrames, 16);
	assert.deepEqual(clip.warpMap?.points.map((point: AudioWarpPoint) => point.source), [
		{ num: 6, den: 1 }, { num: 18, den: 1 }, { num: 22, den: 1 },
	]);
	assert.equal(clip.durationFrames, 48_000);
});

test('a warped clip moved into the target bin retains a valid map on replacement', () => {
	let project = fixture();
	project = applyEditorCommand(project, { type: 'project-bin/remove', clipId: 'bin' });
	project = applyEditorCommand(project, { type: 'project-bin/move-from-timeline', clipIds: ['timeline'] });
	const history = replace(project, 'timeline');
	const clip = history.present.projectBin.clips[0]!;
	assert.equal(clip.sourceId, 'new');
	assert.equal(clip.sourceDurationFrames, 48_000);
	assert.equal(clip.durationFrames, 96_000);
	assert.deepEqual(clip.warpMap?.points.map((point: AudioWarpPoint) => ({ source: point.source, outer: point.outer })), [
		{ source: { num: 0, den: 1 }, outer: { num: 0, den: 1 } },
		{ source: { num: 36_000, den: 1 }, outer: { num: 48_000, den: 1 } },
		{ source: { num: 48_000, den: 1 }, outer: { num: 96_000, den: 1 } },
	]);
});

test('same-rate replacement retains the map and ordinary replacement creates no warp', () => {
	const original = fixture();
	assert.deepEqual(replace(original, 'bin', 48_000).present.clips[0]!.warpMap, original.clips[0]!.warpMap);
	const ordinary = replace(fixture(false)).present.clips[0]!;
	assert.equal(ordinary.warpMap, null);
	assert.equal(ordinary.sourceDurationFrames, 24_000);
});
