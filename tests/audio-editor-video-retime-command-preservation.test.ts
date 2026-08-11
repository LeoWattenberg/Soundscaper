/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createClipboardDescriptor,
	preparePasteCommand,
} from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	createAudioEditorProjectV16,
	type AudioEditorProjectV16,
} from '../src/common/editor/project-v16.ts';
import { projectForCommandConsumers } from '../src/common/editor/project-current-runtime.ts';
import {
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import type { VideoRetimeCurveV16 } from '../src/common/editor/video-retime-v16.ts';

const NOW = '2026-08-11T19:00:00.000Z';

function curve(): VideoRetimeCurveV16 {
	return {
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 2, den: 1 } },
			{ outerFrame: 4, sourceFrame: { num: 10, den: 1 } },
		],
		segments: [{
			mode: 'ramp-forward',
			startVelocity: { num: 1, den: 1 },
			endVelocity: { num: 3, den: 1 },
		}],
	};
}

function project(retimeMap: VideoRetimeCurveV16 | null = curve()): AudioEditorProjectV16 {
	const source = createVideoSourceV10({
		id: 'video-source', name: 'Video', frameCount: 40_000,
		sampleFrameCount: 40_000, sourceFrameCount: 20,
		frameRate: { num: 24, den: 1 }, width: 16, height: 16,
	});
	return createAudioEditorProjectV16({
		id: 'retime-command-preservation', now: NOW,
		sources: [source],
		clips: [{
			kind: 'video', id: 'retimed', sourceId: source.id, title: 'Retimed',
			sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 4,
			sourceInFrame: 2, sourceFrameCount: 8, retimeMap,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', locked: false, clipIds: ['retimed'],
		})],
		sequences: [{ id: 'main', rate: { num: 24, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main',
		projectBin: { clips: [] },
	});
}

test('V16 protected retime state refuses direct and indirect edits without mutating input', () => {
	const base = project();
	const before = structuredClone(base);
	for (const command of [
		{ type: 'clip/update' as const, clipId: 'retimed', changes: { title: 'Changed' } },
		{ type: 'source/update' as const, sourceId: 'video-source', changes: { name: 'Changed' } },
		{ type: 'sequence/update' as const, sequenceId: 'main', changes: { rate: { num: 25, den: 1 } } },
	]) {
		assert.throws(
			() => applyEditorCommand(base, command, { now: NOW }),
			/retime.*protected/iu,
		);
		assert.deepEqual(base, before);
	}
});

test('V16 nested batches reject change-restore after the first child and append no history', () => {
	const base = project();
	const history = createEditorHistory(base);
	assert.throws(() => executeEditorCommand(history, {
		type: 'batch',
		commands: [
			{ type: 'clip/move', clipId: 'retimed', timelineStartFrame: 2_000 },
			{ type: 'clip/move', clipId: 'retimed', timelineStartFrame: 0 },
		],
	}, { now: NOW }), /retime.*protected/iu);
	assert.equal(history.undoStack.length, 0);
	assert.deepEqual(history.present, base);
});

test('V16 unrelated history preserves exact curve bytes through undo and redo', () => {
	const base = project();
	const expected = structuredClone(base.clips[0]?.retimeMap);
	const executed = executeEditorCommand(createEditorHistory(base), {
		type: 'project/rename', title: 'Allowed metadata change',
	}, { now: NOW });
	assert.deepEqual(executed.present.clips[0]?.retimeMap, expected);
	const undone = undoEditorCommand(executed, { now: NOW });
	assert.deepEqual(undone.present.clips[0]?.retimeMap, expected);
	const redone = redoEditorCommand(undone, { now: NOW });
	assert.deepEqual(redone.present.clips[0]?.retimeMap, expected);
});

test('V16 all-null projects retain ordinary command behavior but V2 introduction refuses', () => {
	const base = project(null);
	const renamed = applyEditorCommand(base, { type: 'project/rename', title: 'Writable' }, { now: NOW });
	assert.equal(renamed.title, 'Writable');
	const selected = applyEditorCommand(renamed, {
		type: 'selection/set', startFrame: 0, endFrame: 1, clipIds: ['retimed'],
	}, { now: NOW });
	assert.deepEqual(selected.selection.clipIds, ['retimed']);

	assert.throws(() => applyEditorCommand(base, {
		type: 'clip/update', clipId: 'retimed', changes: { retimeMap: curve() },
	}, { now: NOW }), /retime.*protected/iu);
	for (const command of [{
		type: 'clip/add' as const,
		trackId: 'video-track',
		clip: { ...structuredClone(base.clips[0]), id: 'introduced-timeline', retimeMap: curve() },
	}, {
		type: 'project-bin/add' as const,
		clip: {
			...structuredClone(base.clips[0]), id: 'introduced-bin', binItemId: 'introduced-item', retimeMap: curve(),
		},
	}]) {
		assert.throws(() => applyEditorCommand(base, command, { now: NOW }), /retime.*protected/iu);
	}

	const source = project();
	const sourceProjection = projectForCommandConsumers(source);
	const clipboard = createClipboardDescriptor(sourceProjection, {
		startFrame: 0, endFrame: 8_000, trackIds: ['video-track'], clipIds: ['retimed'],
	});
	const paste = preparePasteCommand(clipboard, {
		atFrame: 10_000, project: projectForCommandConsumers(base),
	}, () => 'pasted-retime');
	assert.throws(
		() => applyEditorCommand(base, paste as AudioEditorCommand, { now: NOW }),
		/retime.*protected/iu,
	);
	assert.equal(base.clips[0]?.retimeMap, null);
});
