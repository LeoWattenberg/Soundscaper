/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand, CommandObject } from '../src/common/editor/commands/protocol.ts';
import {
	createTakeCompService,
} from '../src/common/editor/controller/take-comp-service.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	cloneCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV16 } from '../src/common/editor/project-v16.ts';
import {
	createAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from '../src/common/editor/project-v17.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-12T12:00:00.000Z';

function group(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'group-a', sequenceId: 'main-sequence', trackId: 'track-a',
		startSample: 100, endSample: 500,
		laneOrder: ['lane-a', 'lane-b'],
		lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
		takes: [
			{
				id: 'take-a', laneId: 'lane-a', sourceId: 'source-a',
				startSample: 100, endSample: 500, sourceStartSample: 0,
			},
			{
				id: 'take-b', laneId: 'lane-b', sourceId: 'source-b',
				startSample: 100, endSample: 500, sourceStartSample: 25,
			},
		],
		compRegions: [{
			id: 'original', takeId: 'take-a', startSample: 100, endSample: 500,
		}],
		...overrides,
	};
}

function project(takeGroups: readonly unknown[] = [group()], locked = false): AudioEditorProjectV17 {
	return createAudioEditorProjectV17({
		id: 'take-command-project', title: 'Take command project', now: NOW,
		sources: [
			createAudioSourceV10({
				id: 'source-a', storageKey: 'source-a', name: 'Take A',
				frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSourceV10({
				id: 'source-b', storageKey: 'source-b', name: 'Take B',
				frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
		],
		tracks: [createAudioTrackV10({ id: 'track-a', name: 'Vocal', clipIds: [], locked })],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
		takeGroups,
	});
}

test('serializable V17 commands create, replace, and remove canonical take groups fail-closed', () => {
	const empty = project([]);
	const added = applyEditorCommand(empty, {
		type: 'take-comp/group-add', group: commandObject(group()),
	}, { now: NOW });
	assert.deepEqual(added.takeGroups.map(({ id }) => id), ['group-a']);
	assert.equal(added.revision, empty.revision + 1);

	const replacement = {
		...added.takeGroups[0],
		compRegions: [{ id: 'replacement', takeId: 'take-b', startSample: 100, endSample: 500 }],
	};
	const updated = applyEditorCommand(added, {
		type: 'take-comp/group-update', groupId: 'group-a', group: commandObject(replacement),
	}, { now: NOW });
	assert.deepEqual(updated.takeGroups[0]?.compRegions, [
		{ id: 'replacement', takeId: 'take-b', startSample: 100, endSample: 500 },
	]);
	assert.equal(updated.takeGroups[0]?.takes[0]?.sourceId, 'source-a');

	const removed = applyEditorCommand(updated, {
		type: 'take-comp/group-remove', groupId: 'group-a',
	}, { now: NOW });
	assert.deepEqual(removed.takeGroups, []);
	assert.deepEqual(empty.takeGroups, [], 'commands never mutate the input document');

	assert.throws(() => applyEditorCommand(empty, {
		type: 'take-comp/group-add',
		group: commandObject(group({
			takes: [{
				id: 'take-a', laneId: 'lane-a', sourceId: 'missing',
				startSample: 100, endSample: 500, sourceStartSample: 0,
			}],
		})),
	}, { now: NOW }), /missing source/iu);
	assert.deepEqual(empty.takeGroups, []);

	assert.throws(() => applyEditorCommand(added, {
		type: 'take-comp/group-update', groupId: 'group-a',
		group: commandObject({ ...added.takeGroups[0], id: 'renamed-group' }),
	}, { now: NOW }), /identity is immutable/iu);
	assert.throws(() => applyEditorCommand(createAudioEditorProjectV16({ id: 'v16', now: NOW }), {
		type: 'take-comp/group-add', group: commandObject(group()),
	}, { now: NOW }), /Unsupported audio editor schema version: 16/iu);
});

test('the controller plans audition and commits promotion and boundary edits as atomic group updates', () => {
	const fixture = serviceFixture(project());
	assert.deepEqual(fixture.service.auditionTake('group-a', 'take-b'), {
		kind: 'audition-take', groupId: 'group-a', takeId: 'take-b', laneId: 'lane-b',
		startSample: 100, endSample: 500,
	});
	assert.deepEqual(fixture.service.auditionLane('group-a', 'lane-b'), {
		kind: 'audition-lane', groupId: 'group-a', laneId: 'lane-b',
		takes: [{
			kind: 'audition-take', groupId: 'group-a', takeId: 'take-b', laneId: 'lane-b',
			startSample: 100, endSample: 500,
		}],
	});

	fixture.service.promoteTake('group-a', {
		takeId: 'take-b', regionId: 'promoted', startSample: 200, endSample: 300,
		rightRemainderRegionId: 'original-right',
	});
	assert.deepEqual(fixture.present().takeGroups[0]?.compRegions, [
		{ id: 'original', takeId: 'take-a', startSample: 100, endSample: 200 },
		{ id: 'promoted', takeId: 'take-b', startSample: 200, endSample: 300 },
		{ id: 'original-right', takeId: 'take-a', startSample: 300, endSample: 500 },
	]);
	assert.equal(fixture.present().takeGroups[0]?.takes[1]?.sourceId, 'source-b');
	fixture.service.editSharedCompBoundary('group-a', {
		leftRegionId: 'original', rightRegionId: 'promoted', boundarySample: 225,
	});
	fixture.service.editCompBoundary('group-a', {
		regionId: 'original-right', edge: 'start', boundarySample: 325,
	});
	assert.deepEqual(fixture.present().takeGroups[0]?.compRegions, [
		{ id: 'original', takeId: 'take-a', startSample: 100, endSample: 225 },
		{ id: 'promoted', takeId: 'take-b', startSample: 225, endSample: 300 },
		{ id: 'original-right', takeId: 'take-a', startSample: 325, endSample: 500 },
	]);
	assert.equal(fixture.commands.length, 3);
	assert.equal(fixture.present().revision, project().revision + 3);

	fixture.setEditingBlocked(true);
	assert.throws(() => fixture.service.removeGroup('group-a'), /Editing is blocked/u);
	assert.equal(fixture.commands.length, 3);
});

test('the controller reads take plans from exact Soundscaper V21 authority', () => {
	const v17 = project();
	const v21 = createSoundscaperProjectV21({
		...v17,
		mixer: undefined,
	}) as unknown as AudioEditorProjectV17;
	const service = createTakeCompService({
		lifetime: { assertActive: () => undefined },
		getProject: () => v21,
		editingBlocked: () => false,
		commit: () => undefined,
	});
	assert.deepEqual(service.auditionTake('group-a', 'take-b'), {
		kind: 'audition-take', groupId: 'group-a', takeId: 'take-b', laneId: 'lane-b',
		startSample: 100, endSample: 500,
	});
});

test('the controller creates, replaces, and removes groups only after full document validation', () => {
	const fixture = serviceFixture(project([]));
	fixture.service.createGroup(group());
	const replacement = {
		...fixture.present().takeGroups[0],
		compRegions: [{ id: 'replacement', takeId: 'take-b', startSample: 100, endSample: 500 }],
	};
	fixture.service.updateGroup('group-a', replacement);
	assert.deepEqual(fixture.present().takeGroups[0]?.compRegions, [
		{ id: 'replacement', takeId: 'take-b', startSample: 100, endSample: 500 },
	]);
	fixture.service.removeGroup('group-a');
	assert.deepEqual(fixture.present().takeGroups, []);
	assert.deepEqual(fixture.commands.map(({ type }) => type), [
		'take-comp/group-add', 'take-comp/group-update', 'take-comp/group-remove',
	]);

	const invalid = serviceFixture(project([]));
	assert.throws(() => invalid.service.createGroup(group({
		trackId: 'missing-track',
	})), /missing track/iu);
	assert.equal(invalid.commands.length, 0, 'invalid state never crosses the commit boundary');
});

test('take mutations refuse locked ownership in both the service and low-level command boundary', () => {
	const locked = project([group()], true);
	const fixture = serviceFixture(locked);
	assert.throws(() => fixture.service.promoteTake('group-a', {
		takeId: 'take-b', regionId: 'promoted', startSample: 200, endSample: 300,
		rightRemainderRegionId: 'original-right',
	}), /Track track-a is locked/u);
	assert.equal(fixture.commands.length, 0);
	assert.throws(() => applyEditorCommand(locked, {
		type: 'take-comp/group-remove', groupId: 'group-a',
	}, { now: NOW }), /Track track-a is locked/u);
	assert.throws(() => applyEditorCommand(project([], true), {
		type: 'take-comp/group-add', group: commandObject(group()),
	}, { now: NOW }), /Track track-a is locked/u);
});

test('flatten publication is exact, stale-safe, one-step undoable, and survives clone and reopen', () => {
	let history = createEditorHistory(project());
	const commands: AudioEditorCommand[] = [];
	const service = createTakeCompService({
		lifetime: { assertActive: () => undefined },
		getProject: () => history.present as AudioEditorProjectV17,
		editingBlocked: () => false,
		commit(command) {
			commands.push(command);
			history = executeEditorCommand(history, command, { now: NOW });
			return history.present;
		},
	});
	const preparation = service.prepareFlatten('group-a', 'flatten-op', 'flat-clip');
	assert.deepEqual(preparation.renderPlan.segments.map(({ kind }) => kind), ['take']);
	assert.equal(preparation.documentSnapshot.takes[1]?.sourceId, 'source-b');
	service.publishFlatten(preparation, flattenPublication());

	let present = history.present as AudioEditorProjectV17;
	assert.deepEqual(present.takeGroups, []);
	assert.equal(present.sources.some(({ id }) => id === 'flat-source'), true);
	assert.equal(present.clips.some(({ id }) => id === 'flat-clip'), true);
	assert.deepEqual(present.tracks[0]?.clipIds, ['flat-clip']);
	assert.equal(commands.length, 1);
	assert.equal(commands[0]?.type, 'take-comp/flatten');

	history = undoEditorCommand(history, { now: NOW });
	present = history.present as AudioEditorProjectV17;
	assert.deepEqual(present.takeGroups.map(({ id }) => id), ['group-a']);
	assert.equal(present.sources.some(({ id }) => id === 'flat-source'), false);
	assert.deepEqual(present.tracks[0]?.clipIds, []);
	history = redoEditorCommand(history, { now: NOW });
	present = history.present as AudioEditorProjectV17;
	assert.deepEqual(present.takeGroups, []);
	assert.deepEqual(present.tracks[0]?.clipIds, ['flat-clip']);

	const clone = cloneCurrentAudioEditorProject(history.present as AudioEditorProjectV17);
	const reopened = loadCurrentAudioEditorProject(JSON.parse(JSON.stringify(clone)) as unknown);
	assert.deepEqual(reopened, { project: clone, readOnly: false, reason: null });
	assert.notStrictEqual(reopened.project, clone);
});

test('flatten rejects inexact publications and a rendered snapshot invalidated by an intervening edit', () => {
	const inexact = serviceFixture(project());
	const preparation = inexact.service.prepareFlatten('group-a', 'flatten-op', 'flat-clip');
	const bad = flattenPublication();
	assert.throws(() => inexact.service.publishFlatten(preparation, {
		...bad,
		source: commandObject({ ...bad.source, frameCount: 399 }),
	}), /exact project-rate audio/iu);
	assert.equal(inexact.commands.length, 1, 'the rejected command reached the atomic command validator');
	assert.deepEqual(inexact.present().takeGroups.map(({ id }) => id), ['group-a']);
	assert.equal(inexact.present().sources.some(({ id }) => id === 'flat-source'), false);

	const stale = serviceFixture(project());
	const stalePreparation = stale.service.prepareFlatten('group-a', 'flatten-op', 'flat-clip');
	stale.service.promoteTake('group-a', { takeId: 'take-b', regionId: 'replacement' });
	const before = structuredClone(stale.present());
	assert.throws(
		() => stale.service.publishFlatten(stalePreparation, flattenPublication()),
		/changed after flatten rendering began/iu,
	);
	assert.deepEqual(stale.present(), before);
	assert.throws(
		() => stale.service.prepareFlatten('group-a', 'same-id', 'same-id'),
		/operationId and outputId must be distinct/iu,
	);
});

function flattenPublication(): { source: CommandObject; clip: CommandObject } {
	const source = createAudioSourceV10({
		id: 'flat-source', storageKey: 'flat-source', name: 'Flattened comp',
		frameCount: 400, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClipV10({
		id: 'flat-clip', sourceId: 'flat-source', kind: 'audio', anchor: 'sample',
		timelineStartFrame: 100, durationFrames: 400,
		sourceStartFrame: 0, sourceDurationFrames: 400,
	});
	return { source: commandObject(source), clip: commandObject(clip) };
}

function serviceFixture(initial: AudioEditorProjectV17): {
	readonly service: ReturnType<typeof createTakeCompService>;
	readonly commands: AudioEditorCommand[];
	present(): AudioEditorProjectV17;
	setEditingBlocked(value: boolean): void;
} {
	let present = initial;
	let blocked = false;
	const commands: AudioEditorCommand[] = [];
	const service = createTakeCompService({
		lifetime: { assertActive: () => undefined },
		getProject: () => present,
		editingBlocked: () => blocked,
		commit(command) {
			commands.push(command);
			present = applyEditorCommand(present, command, { now: NOW });
			return present;
		},
	});
	return {
		service,
		commands,
		present: () => present,
		setEditingBlocked: (value) => { blocked = value; },
	};
}

function commandObject(value: object): CommandObject {
	return value as unknown as CommandObject;
}
