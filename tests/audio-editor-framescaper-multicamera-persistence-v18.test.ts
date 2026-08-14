/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	applyFramescaperProjectCommandV18,
} from '../src/framescaper/editor-project-v18-commands.ts';
import {
	createFramescaperProjectHistoryV18,
	executeFramescaperProjectCommandV18,
	redoFramescaperProjectCommandV18,
	undoFramescaperProjectCommandV18,
} from '../src/framescaper/editor-project-v18-history.ts';
import type { FramescaperMulticameraGroupV18 } from '../src/framescaper/editor-project-v18-multicam.ts';
import {
	cloneFramescaperProjectV18,
	createFramescaperProjectV18,
	loadFramescaperProjectV18,
	validateFramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const CREATED = '2026-08-13T12:00:00.000Z';
const UPDATED = '2026-08-13T12:01:00.000Z';
const SWITCHED = '2026-08-13T12:02:00.000Z';

test('exact V18 persistence owns one required detached multicamera collection', () => {
	const empty = createFramescaperProjectV18(PROFILE, projectOptions());
	assert.equal(Object.hasOwn(empty, 'multicameraGroups'), true);
	assert.deepEqual(empty.multicameraGroups, []);

	const input = [multicameraGroup()];
	const project = createFramescaperProjectV18(PROFILE, {
		...projectOptions(), multicameraGroups: input,
	});
	input[0]!.members[0]!.syncOffsetSamples = 99;
	assert.equal(project.multicameraGroups[0]?.members[0]?.syncOffsetSamples, 8_008);
	assert.equal(validateFramescaperProjectV18(PROFILE, project), true);

	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete missing.multicameraGroups;
	assert.throws(() => validateFramescaperProjectV18(PROFILE, missing), /multicameraGroups.*own enumerable data/iu);
	const sparse = structuredClone(project) as unknown as MutableProject;
	const groups = [...sparse.multicameraGroups];
	groups.length = 2;
	sparse.multicameraGroups = groups;
	assert.throws(() => validateFramescaperProjectV18(PROFILE, sparse), /dense data array|own enumerable data/iu);
});

test('V18 clone, load, and Scape document paths preserve detached multicamera identity', () => {
	const project = createFramescaperProjectV18(PROFILE, {
		...projectOptions(), multicameraGroups: [multicameraGroup()],
	});
	const clone = cloneFramescaperProjectV18(PROFILE, project);
	assert.deepEqual(clone.multicameraGroups, project.multicameraGroups);
	assert.notStrictEqual(clone.multicameraGroups, project.multicameraGroups);
	assert.notStrictEqual(clone.multicameraGroups[0], project.multicameraGroups[0]);
	assert.notStrictEqual(clone.multicameraGroups[0]?.members, project.multicameraGroups[0]?.members);
	const loaded = loadFramescaperProjectV18(PROFILE, parseScapeProjectDocument(serializeScapeProjectDocument(project)));
	assert.deepEqual(loaded.project, project);
	assert.notStrictEqual((loaded.project as typeof project).multicameraGroups, project.multicameraGroups);
});

test('V18 command ownership delegates create, update, switch, and remove with exact fences', () => {
	const initial = createFramescaperProjectV18(PROFILE, projectOptions());
	const input = multicameraGroup();
	const created = applyFramescaperProjectCommandV18(PROFILE, initial, {
		type: 'multicamera/create', projectId: initial.id,
		expectedProjectRevision: initial.revision, group: input,
	}, { now: UPDATED });
	input.members[0]!.syncOffsetSamples = 99;
	assert.equal(created.multicameraGroups[0]?.members[0]?.syncOffsetSamples, 8_008);
	assert.equal(created.revision, initial.revision + 1);
	assert.equal(created.updatedAt, UPDATED);

	const replacement = {
		...multicameraGroup(),
		members: [
			{ ...multicameraGroup().members[0]!, syncOffsetSamples: 16_016 },
			multicameraGroup().members[1]!,
		],
	};
	const updated = applyFramescaperProjectCommandV18(PROFILE, created, {
		type: 'multicamera/update', projectId: created.id,
		expectedProjectRevision: created.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-a', group: replacement,
	}, { now: SWITCHED });
	assert.equal(updated.multicameraGroups[0]?.members[0]?.syncOffsetSamples, 16_016);

	const switched = applyFramescaperProjectCommandV18(PROFILE, updated, {
		type: 'multicamera/switch', projectId: updated.id,
		expectedProjectRevision: updated.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-a', memberId: 'camera-b',
	});
	assert.equal(switched.multicameraGroups[0]?.activeMemberId, 'camera-b');
	assert.throws(() => applyFramescaperProjectCommandV18(PROFILE, switched, {
		type: 'multicamera/remove', projectId: switched.id,
		expectedProjectRevision: updated.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-b',
	}), /stale.*revision/iu);
	assert.throws(() => applyFramescaperProjectCommandV18(PROFILE, switched, {
		type: 'multicamera/switch', projectId: switched.id,
		expectedProjectRevision: switched.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-a', memberId: 'camera-a',
	}), /stale.*active member/iu);

	const removed = applyFramescaperProjectCommandV18(PROFILE, switched, {
		type: 'multicamera/remove', projectId: switched.id,
		expectedProjectRevision: switched.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-b',
	});
	assert.deepEqual(removed.multicameraGroups, []);
	const renamed = applyFramescaperProjectCommandV18(PROFILE, switched, {
		type: 'project/rename', title: 'Renamed',
	});
	assert.deepEqual(renamed.multicameraGroups, switched.multicameraGroups);
	assert.notStrictEqual(renamed.multicameraGroups, switched.multicameraGroups);
});

test('V18 history snapshots multicamera commands and restores groups with monotonic revisions', () => {
	const project = createFramescaperProjectV18(PROFILE, {
		...projectOptions(), multicameraGroups: [multicameraGroup()],
	});
	let history = createFramescaperProjectHistoryV18(PROFILE, project);
	const command = {
		type: 'multicamera/switch' as const, projectId: project.id,
		expectedProjectRevision: project.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-a', memberId: 'camera-b',
	};
	history = executeFramescaperProjectCommandV18(PROFILE, history, command, { now: SWITCHED });
	assert.equal(history.present.multicameraGroups[0]?.activeMemberId, 'camera-b');
	assert.equal(history.undoStack[0]?.command.type, 'multicamera/switch');
	assert.notStrictEqual(history.undoStack[0]?.command, command);
	const switchedRevision = history.present.revision;

	history = undoFramescaperProjectCommandV18(PROFILE, history, { now: '2026-08-13T12:03:00.000Z' });
	assert.equal(history.present.multicameraGroups[0]?.activeMemberId, 'camera-a');
	assert.equal(history.present.revision, switchedRevision + 1);
	history = redoFramescaperProjectCommandV18(PROFILE, history, { now: '2026-08-13T12:04:00.000Z' });
	assert.equal(history.present.multicameraGroups[0]?.activeMemberId, 'camera-b');
	assert.equal(history.present.revision, switchedRevision + 2);

	const before = history;
	assert.throws(() => executeFramescaperProjectCommandV18(PROFILE, history, {
		type: 'multicamera/switch', projectId: project.id,
		expectedProjectRevision: project.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-b', memberId: 'camera-a',
	}), /stale.*revision/iu);
	assert.strictEqual(history, before);
});

function multicameraGroup(): MutableGroup {
	return {
		id: 'group-a', projectId: 'multicamera-persistence-v18', sequenceId: 'main-sequence',
		outputClipId: 'output-clip', activeMemberId: 'camera-a',
		members: [
			{ id: 'camera-a', groupId: 'group-a', sourceId: 'source-a', syncOffsetSamples: 8_008 },
			{ id: 'camera-b', groupId: 'group-a', sourceId: 'source-b', syncOffsetSamples: 0 },
		],
	};
}

function projectOptions(): Record<string, unknown> {
	const rate = { num: 30_000, den: 1_001 };
	return {
		id: 'multicamera-persistence-v18', title: 'Multicamera persistence V18', now: CREATED,
		sampleRate: 48_000,
		sources: [
			createVideoSourceV10({
				id: 'source-a', name: 'Camera A', storageKey: 'source-a', mimeType: 'video/mp4',
				contentSha256: '12'.repeat(32), sampleFrameCount: 480_000,
				sourceFrameCount: 300, frameRate: rate, width: 1920, height: 1080,
			}),
			createVideoSourceV10({
				id: 'source-b', name: 'Camera B', storageKey: 'source-b', mimeType: 'video/mp4',
				contentSha256: '34'.repeat(32), sampleFrameCount: 480_000,
				sourceFrameCount: 300, frameRate: rate, width: 1920, height: 1080,
			}),
		],
		clips: [{
			kind: 'video', id: 'output-clip', sourceId: 'source-a', title: 'Multicamera output',
			sequenceId: 'main-sequence', sequenceStartFrame: 1, sequenceFrameCount: 10,
			sourceInFrame: 1, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['output-clip'], locked: false,
		})],
		sequences: [{ id: 'main-sequence', rate, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	};
}

interface MutableGroup extends FramescaperMulticameraGroupV18 {
	members: MutableMember[];
}

interface MutableMember {
	id: string;
	groupId: string;
	sourceId: string;
	syncOffsetSamples: number;
}

interface MutableProject extends Record<string, unknown> {
	multicameraGroups: FramescaperMulticameraGroupV18[];
}
