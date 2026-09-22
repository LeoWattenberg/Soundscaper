/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand, createAddClipCommand, createAddSourceCommand, createAddTrackCommand, prepareSplitCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createEditorHistory, executeEditorCommand } from '../src/common/editor/history.js';

const NOW = '2026-09-22T00:00:00.000Z';

function project(sampleRate = 48_000) {
	let current = createCurrentAudioEditorProject({ id: 'microfades', sampleRate, now: NOW });
	current = applyEditorCommand(current, createAddSourceCommand({
		id: 'source', storageKey: 'source', name: 'Source', frameCount: sampleRate,
		channelCount: 1, sampleRate,
	}), { now: NOW });
	return applyEditorCommand(current, createAddTrackCommand({ id: 'track', name: 'Audio' }), { now: NOW });
}

function addClip(current: ReturnType<typeof project>, options: Record<string, unknown> = {}) {
	return applyEditorCommand(current, createAddClipCommand('track', {
		id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
		durationFrames: 24_000, sourceDurationFrames: 24_000, ...options,
	}), { now: NOW, microfadeNewClips: true });
}

test('new audio clips receive editable 2 ms fades at the project sample rate', () => {
	const created = addClip(project());
	assert.equal(created.clips[0].fadeInFrames, 96);
	assert.equal(created.clips[0].fadeOutFrames, 96);
	const changed = applyEditorCommand(created, {
		type: 'clip/update', clipId: 'clip', changes: { fadeInFrames: 0, fadeOutFrames: 240 },
	}, { now: NOW, microfadeNewClips: true });
	assert.equal(changed.clips[0].fadeInFrames, 0);
	assert.equal(changed.clips[0].fadeOutFrames, 240);
	assert.equal(addClip(project(44_100)).clips[0].fadeInFrames, 88);
});

test('the preference can disable microfades and existing fade lengths stay intact', () => {
	const plain = applyEditorCommand(project(), createAddClipCommand('track', {
		id: 'clip', sourceId: 'source', durationFrames: 24_000, sourceDurationFrames: 24_000,
	}), { now: NOW, microfadeNewClips: false });
	assert.equal(plain.clips[0].fadeInFrames, 0);
	assert.equal(plain.clips[0].fadeOutFrames, 0);
	const custom = addClip(project(), { fadeInFrames: 480, fadeOutFrames: 0 });
	assert.equal(custom.clips[0].fadeInFrames, 480);
	assert.equal(custom.clips[0].fadeOutFrames, 96);
});

test('splitting smooths the new edges without replacing the original outer fades', () => {
	const original = addClip(project(), { fadeInFrames: 480, fadeOutFrames: 240 });
	const split = applyEditorCommand(original, prepareSplitCommand('clip', 12_000, () => 'right') as AudioEditorCommand, {
		now: NOW, microfadeNewClips: true,
	});
	assert.deepEqual(split.clips.map(({ fadeInFrames, fadeOutFrames }) => [fadeInFrames, fadeOutFrames]), [
		[480, 96], [96, 240],
	]);
});

test('fades are bounded by a very short clip', () => {
	const created = addClip(project(), { durationFrames: 20, sourceDurationFrames: 20 });
	assert.equal(created.clips[0].fadeInFrames, 10);
	assert.equal(created.clips[0].fadeOutFrames, 10);
	const singleFrame = addClip(project(), { durationFrames: 1, sourceDurationFrames: 1 });
	assert.equal(singleFrame.clips[0].fadeInFrames, 0);
	assert.equal(singleFrame.clips[0].fadeOutFrames, 0);
});

test('history applies the creation preference in the same undoable command', () => {
	const initial = project();
	const history = createEditorHistory(initial);
	const edited = executeEditorCommand(history, createAddClipCommand('track', {
		id: 'clip', sourceId: 'source', durationFrames: 24_000, sourceDurationFrames: 24_000,
	}), { now: NOW, microfadeNewClips: true });
	assert.equal(edited.present.clips[0].fadeInFrames, 96);
	assert.equal(edited.undoStack.length, 1);
	assert.equal(edited.undoStack[0].project.clips.length, 0);
});
