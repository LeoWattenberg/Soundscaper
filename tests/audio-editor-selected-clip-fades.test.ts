/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	clipFadeEditsCommand, clipFadeEditsPreviews, planSelectedClipFadeCommand,
	planSelectedClipFadeEdits, selectedClipFadeTargets,
} from '../src/common/editor/ui/timeline/selected-clip-fades.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

const clips = [
	{ id: 'long', kind: 'audio', timelineStartFrame: 0, durationFrames: 96_000, fadeInFrames: 0, fadeOutFrames: 48_000 },
	{ id: 'other', kind: 'audio', timelineStartFrame: 96_000, durationFrames: 96_000, fadeInFrames: 0, fadeOutFrames: 0 },
	{ id: 'short', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000, fadeInFrames: 12_000, fadeOutFrames: 12_000 },
	{ id: 'picture', kind: 'video', timelineStartFrame: 0, durationFrames: 96_000 },
];
const selectedIds = new Set(['long', 'short', 'picture']);
const request = { clips, editedClipId: 'long', selectedIds, sampleRate: 48_000 };

test('selected fades target all selected audio clips while an unselected edit stays on its clip', () => {
	const targets = selectedClipFadeTargets(clips, 'long', selectedIds);
	assert.deepEqual(targets.map(clip => clip.id), ['long', 'short']);
	assert.equal(targets[0], clips[0], 'pointer baselines retain their exact captured objects');
	assert.deepEqual(selectedClipFadeTargets(clips, 'other', selectedIds).map(clip => clip.id), ['other']);
	assert.deepEqual(selectedClipFadeTargets(clips, 'missing', selectedIds), []);
	assert.deepEqual(selectedClipFadeTargets(clips, 'picture', selectedIds), []);
});

test('a selected fade length clamps each duration and pushes only that clip\'s opposite fade', () => {
	const edits = planSelectedClipFadeEdits({ ...request, edit: { kind: 'length', edge: 'in', frames: 60_000 } });
	assert.deepEqual(edits, [
		{ clipId: 'long', changes: { fadeInFrames: 60_000, fadeOutFrames: 36_000, fadeInShape: 2 } },
		{ clipId: 'short', changes: { fadeInFrames: 48_000, fadeOutFrames: 0 } },
	]);
	assert.deepEqual(clipFadeEditsPreviews(edits, new Map([['long', 'one'], ['short', 'two']])), [
		{ clipId: 'long', trackId: 'one', fadeInFrames: 60_000, fadeOutFrames: 36_000, fadeInShape: 2 },
		{ clipId: 'short', trackId: 'two', fadeInFrames: 48_000, fadeOutFrames: 0 },
	]);
});

test('shape presets, linear resets and removal share selected target ownership', () => {
	assert.deepEqual(planSelectedClipFadeEdits({ ...request, edit: { kind: 'shape', edge: 'out', shape: 0.5 } }), [
		{ clipId: 'long', changes: { fadeOutShape: 0.5 } }, { clipId: 'short', changes: { fadeOutShape: 0.5 } },
	]);
	const shaped = clips.map(clip => ({ ...clip, fadeOutShape: 2 }));
	const linear = planSelectedClipFadeEdits({ ...request, clips: shaped, edit: { kind: 'shape', edge: 'out', shape: undefined } });
	assert.deepEqual(linear, [{ clipId: 'long', changes: { fadeOutShape: undefined } }, { clipId: 'short', changes: { fadeOutShape: undefined } }]);
	assert.equal(Object.hasOwn(linear[0]!.changes, 'fadeOutShape'), true);
	assert.deepEqual(planSelectedClipFadeEdits({ ...request, edit: { kind: 'length', edge: 'out', frames: 0 } }), [
		{ clipId: 'long', changes: { fadeOutFrames: 0 } }, { clipId: 'short', changes: { fadeOutFrames: 0 } },
	]);
});

test('dialog patches preserve unspecified fields and apply both lengths without overlapping them', () => {
	const edits = planSelectedClipFadeEdits({ ...request, edit: { kind: 'properties', changes: {
		fadeInFrames: 60_000, fadeOutFrames: 24_000, fadeOutShape: 1,
	} } });
	assert.deepEqual(edits[0], { clipId: 'long', changes: { fadeInFrames: 60_000, fadeOutFrames: 24_000, fadeInShape: 2, fadeOutShape: 1 } });
	assert.deepEqual(edits[1], { clipId: 'short', changes: { fadeInFrames: 24_000, fadeOutFrames: 24_000, fadeOutShape: 1 } });
	assert.deepEqual(planSelectedClipFadeEdits({ ...request, edit: { kind: 'properties', changes: {} } }), []);
	assert.equal(clipFadeEditsCommand([]), null);
});

test('numeric fade properties retain authored sub-20ms fades on every target', () => {
	const initial = project();
	const command = planSelectedClipFadeCommand({ ...request, clips: initial.clips,
		edit: { kind: 'properties', changes: { fadeInFrames: 48 } } });
	assert.ok(command);
	const history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(initial), command);
	assert.deepEqual(history.present.clips.map(clip => clip.fadeInFrames), [48, 48]);
	assert.deepEqual(history.present.clips.map(clip => clip.fadeOutFrames), [48_000, 12_000]);
	assert.equal(history.undoStack.length, 1);
});

test('native batch commits the selected fade once and Undo restores every track', () => {
	const initial = project();
	const command = planSelectedClipFadeCommand({ clips: initial.clips, editedClipId: 'long', selectedIds,
		sampleRate: initial.sampleRate, edit: { kind: 'length', edge: 'in', frames: 60_000 } });
	assert.equal(command?.type, 'batch');
	assert.ok(command);
	let history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(initial), command);
	assert.equal(history.undoStack.length, 1);
	assert.deepEqual(history.present.clips.map(clip => [clip.fadeInFrames, clip.fadeOutFrames]), [[60_000, 36_000], [48_000, 0]]);
	history = undoSoundscaperProjectCommand(history);
	assert.deepEqual(history.present.clips, initial.clips);
	assert.deepEqual(history.present.tracks, initial.tracks);
	assert.deepEqual(history.present.selection, initial.selection);
	assert.equal(history.undoStack.length, 0);
});

test('native batch clears explicit linear shapes on every selected clip', () => {
	const initial = project();
	const shaped = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(initial), {
		type: 'batch', commands: initial.clips.map(clip => ({ type: 'clip/update', clipId: clip.id, changes: { fadeOutShape: 2 } })),
	});
	const command = planSelectedClipFadeCommand({ ...request, clips: shaped.present.clips,
		edit: { kind: 'shape', edge: 'out', shape: undefined } });
	assert.ok(command);
	const linear = executeSoundscaperProjectCommand(shaped, command);
	assert.deepEqual(linear.present.clips.map(clip => clip.fadeOutShape), [undefined, undefined]);
});

test('a locked participant stays in the plan so native admission rejects the entire batch', () => {
	const initial = project(true);
	const baseline = structuredClone(initial);
	const command = planSelectedClipFadeCommand({ clips: initial.clips, editedClipId: 'long', selectedIds,
		sampleRate: initial.sampleRate, edit: { kind: 'length', edge: 'in', frames: 60_000 } });
	assert.equal(command?.commands.length, 2);
	assert.ok(command);
	const history = createSoundscaperProjectHistory(initial);
	assert.throws(() => executeSoundscaperProjectCommand(history, command), /locked/iu);
	assert.deepEqual(history.present, baseline);
	assert.equal(history.undoStack.length, 0);
});

function project(locked = false) {
	const source = createAudioSource({ id: 'source', storageKey: 'source', frameCount: 192_000, channelCount: 1, sampleRate: 48_000 });
	const long = createAudioClip({ ...clips[0], sourceId: 'source', sourceDurationFrames: 96_000 });
	const short = createAudioClip({ ...clips[2], sourceId: 'source', sourceDurationFrames: 48_000 });
	return createSoundscaperProject({ id: 'selected-fades', sampleRate: 48_000, sources: [source], clips: [long, short], tracks: [
		createAudioTrack({ id: 'one', clipIds: ['long'] }), createAudioTrack({ id: 'two', clipIds: ['short'], locked }),
	] });
}
