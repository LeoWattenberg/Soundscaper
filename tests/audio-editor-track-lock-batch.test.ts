/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts';

const NOW = '2026-08-11T13:00:00.000Z';

test('transaction-start locks survive unlock-edit-relock through nested batches', () => {
	const project = lockProject(true);
	const before = structuredClone(project);
	assert.throws(
		() => applyEditorCommand(project, {
			type: 'batch',
			commands: [
				{ type: 'track/update', trackId: 'track', changes: { locked: false } },
				{ type: 'batch', commands: [
					{ type: 'clip/move', clipId: 'clip', timelineStartFrame: 200 },
				] },
				{ type: 'track/update', trackId: 'track', changes: { locked: true } },
			],
		}, { now: NOW }),
		/Track track is locked\./u,
	);
	assert.deepEqual(project, before);
});

test('a newly locked baseline is monotonic, so lock-edit and lock-unlock-edit refuse', () => {
	for (const commands of [
		[
			{ type: 'track/update' as const, trackId: 'track', changes: { locked: true } },
			{ type: 'clip/move' as const, clipId: 'clip', timelineStartFrame: 200 },
		],
		[
			{ type: 'track/update' as const, trackId: 'track', changes: { locked: true } },
			{ type: 'track/update' as const, trackId: 'track', changes: { locked: false } },
			{ type: 'clip/move' as const, clipId: 'clip', timelineStartFrame: 200 },
		],
	]) {
		const project = lockProject(false);
		assert.throws(
			() => applyEditorCommand(project, { type: 'batch', commands }, { now: NOW }),
			/Track track is locked\./u,
		);
		assert.equal(trackOf(project).locked, false);
		assert.equal(clipOf(project).timelineStartFrame, 100);
	}
});

test('edit-lock captures the edited state and permits the completed transaction', () => {
	const project = lockProject(false);
	const edited = applyEditorCommand(project, {
		type: 'batch',
		commands: [
			{ type: 'clip/move', clipId: 'clip', timelineStartFrame: 200 },
			{ type: 'track/update', trackId: 'track', changes: { locked: true } },
		],
	}, { now: NOW });
	assert.equal(trackOf(edited).locked, true);
	assert.equal(clipOf(edited).timelineStartFrame, 200);
});

test('raw checks reject change-then-restore collateral between batch children', () => {
	const project = lockProject(true);
	assert.throws(
		() => applyEditorCommand(project, {
			type: 'batch',
			commands: [
				{ type: 'clip/move', clipId: 'clip', timelineStartFrame: 200 },
				{ type: 'clip/move', clipId: 'clip', timelineStartFrame: 100 },
			],
		}, { now: NOW }),
		/Track track is locked\./u,
	);
	assert.equal(clipOf(project).timelineStartFrame, 100);
});

test('failed nested admission appends no history while standalone lock undo-redo stays compatible', () => {
	const base = lockProject(false);
	const history = createEditorHistory(base);
	assert.throws(
		() => executeEditorCommand(history, {
			type: 'batch', commands: [
				{ type: 'track/update', trackId: 'track', changes: { locked: true } },
				{ type: 'clip/update', clipId: 'clip', changes: { title: 'Forbidden' } },
			],
		}, { now: NOW }),
		/Track track is locked\./u,
	);
	assert.equal(history.undoStack.length, 0);
	assert.equal(trackOf(history.present).locked, false);
	assert.equal(clipOf(history.present).title, 'Clip');

	const locked = executeEditorCommand(history, {
		type: 'track/update', trackId: 'track', changes: { locked: true },
	}, { now: NOW });
	assert.equal(locked.undoStack.length, 1);
	assert.equal(trackOf(locked.present).locked, true);
	const undone = undoEditorCommand(locked, { now: NOW });
	assert.equal(trackOf(undone.present).locked, false);
	const redone = redoEditorCommand(undone, { now: NOW });
	assert.equal(trackOf(redone.present).locked, true);
});

function lockProject(locked: boolean): AudioEditorProjectCurrent {
	const source = createAudioSourceV10({ id: 'source', frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClipV10({
		id: 'clip', sourceId: source.id, title: 'Clip', timelineStartFrame: 100,
		durationFrames: 100, sourceStartFrame: 0, sourceDurationFrames: 100,
	});
	return createCurrentAudioEditorProject({
		id: 'batch-lock-project', now: NOW, sources: [source], clips: [clip],
		tracks: [createAudioTrackV10({ id: 'track', locked, clipIds: [clip.id] })],
	});
}

function trackOf(project: object): Readonly<Record<string, unknown>> {
	const track = (project as AudioEditorProjectCurrent).tracks[0];
	if (!track) throw new Error('Missing track.');
	return track;
}

function clipOf(project: object): Readonly<Record<string, unknown>> {
	const clip = (project as AudioEditorProjectCurrent).clips[0];
	if (!clip) throw new Error('Missing clip.');
	return clip;
}
