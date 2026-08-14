/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	planFramescaperMulticameraCommandV18,
	selectFramescaperMulticameraRuntimeV18,
	validateFramescaperMulticameraGroupsV18,
	type FramescaperMulticameraCommandV18,
	type FramescaperMulticameraGroupV18,
} from '../src/framescaper/editor-project-v18-multicam.ts';
import {
	createFramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

const NOW = '2026-08-13T12:00:00.000Z';
const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('V18 multicamera groups are closed, bounded, detached, and sample-canonical', () => {
	const project = multicameraProject();
	const input = [multicameraGroup()];
	const groups = validateFramescaperMulticameraGroupsV18(PROFILE, project, input);
	assert.deepEqual(groups, input);
	assert.notStrictEqual(groups, input);
	assert.notStrictEqual(groups[0], input[0]);
	assert.notStrictEqual(groups[0]?.members, input[0]?.members);
	assert.equal(Object.isFrozen(groups), true);
	assert.equal(Object.isFrozen(groups[0]), true);
	assert.equal(Object.isFrozen(groups[0]?.members), true);
	assert.equal(Object.isFrozen(groups[0]?.members[0]), true);

	input[0]!.members[0]!.syncOffsetSamples = 99;
	assert.equal(groups[0]?.members[0]?.syncOffsetSamples, 8_008);
	for (const [mutate, pattern] of [
		[(value: Record<string, unknown>) => {
			((value.members as Record<string, unknown>[])[0]!).syncOffsetSamples = 0.5;
		}, /syncOffsetSamples.*safe integer/iu],
		[(value: Record<string, unknown>) => { value.autoSync = true; }, /unsupported field/iu],
		[(value: Record<string, unknown>) => { value.activeMemberId = 'missing'; }, /active member/iu],
		[(value: Record<string, unknown>) => {
			(value.members as Record<string, unknown>[])[1]!.id = 'camera-a';
		}, /duplicate.*member/iu],
	] as const) {
		const candidate = structuredClone(multicameraGroup()) as unknown as Record<string, unknown>;
		mutate(candidate);
		assert.throws(() => validateFramescaperMulticameraGroupsV18(PROFILE, project, [candidate]), pattern);
	}
	const sparse = [multicameraGroup()];
	sparse.length = 2;
	assert.throws(
		() => validateFramescaperMulticameraGroupsV18(PROFILE, project, sparse),
		/dense data array|own enumerable data property/iu,
	);
	const tooManyMembers = multicameraGroup();
	tooManyMembers.members = Array.from({ length: 65 }, (_, index) => ({
		id: `camera-${String(index)}`, groupId: 'group-a', sourceId: `source-${String(index)}`,
		syncOffsetSamples: 0,
	}));
	assert.throws(
		() => validateFramescaperMulticameraGroupsV18(PROFILE, project, [tooManyMembers]),
		/between 2 and 64/iu,
	);
});

test('V18 multicamera validation proves exact project, sequence, clip, track, and source ownership', () => {
	const project = multicameraProject();
	for (const [mutate, pattern] of [
		[(value: MutableGroup) => { value.projectId = 'other'; }, /project/iu],
		[(value: MutableGroup) => { value.sequenceId = 'missing'; }, /sequence/iu],
		[(value: MutableGroup) => { value.outputClipId = 'missing'; }, /output clip/iu],
		[(value: MutableGroup) => { value.members[0]!.sourceId = 'missing'; }, /video source/iu],
	] as const) {
		const candidate = structuredClone(multicameraGroup());
		mutate(candidate);
		assert.throws(() => validateFramescaperMulticameraGroupsV18(PROFILE, project, [candidate]), pattern);
	}
	assert.throws(
		() => validateFramescaperMulticameraGroupsV18(PROFILE, project, [
			multicameraGroup(), { ...multicameraGroup(), id: 'group-b' },
		]),
		/one multicamera group|duplicate output clip/iu,
	);

	const unowned = structuredClone(project) as unknown as MutableProject;
	unowned.tracks[0]!.clipIds = [];
	assert.throws(
		() => validateFramescaperMulticameraGroupsV18(PROFILE, unowned, [multicameraGroup()]),
		/output clip.*exactly one|clip ownership|exactly one media track/iu,
	);
	const retimed = structuredClone(project) as unknown as MutableProject;
	retimed.clips[0]!.retimeMap = { feature: 'not-admitted' };
	assert.throws(
		() => validateFramescaperMulticameraGroupsV18(PROFILE, retimed, [multicameraGroup()]),
		/retime|validation/iu,
	);
});

test('V18 multicamera planners create, update, switch, and remove without mutating input', () => {
	const project = multicameraProject();
	const empty = Object.freeze([]) as readonly FramescaperMulticameraGroupV18[];
	let planned = plan(project, empty, {
		type: 'multicamera/create', projectId: project.id,
		expectedProjectRevision: project.revision, group: multicameraGroup(),
	});
	assert.deepEqual(planned.before, []);
	assert.deepEqual(planned.after, [multicameraGroup()]);
	assert.equal(Object.isFrozen(planned), true);

	planned = plan(project, planned.after, {
		type: 'multicamera/update', projectId: project.id,
		expectedProjectRevision: project.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-a',
		group: {
			...multicameraGroup(),
			members: [
				{ ...multicameraGroup().members[0]!, syncOffsetSamples: 16_016 },
				multicameraGroup().members[1]!,
			],
		},
	});
	assert.equal(planned.after[0]?.members[0]?.syncOffsetSamples, 16_016);
	assert.throws(() => plan(project, planned.after, {
		type: 'multicamera/update', projectId: project.id,
		expectedProjectRevision: project.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-a', group: { ...multicameraGroup(), activeMemberId: 'camera-b' },
	}), /cannot bypass.*member-switch/iu);

	planned = plan(project, planned.after, {
		type: 'multicamera/switch', projectId: project.id,
		expectedProjectRevision: project.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-a', memberId: 'camera-b',
	});
	assert.equal(planned.before[0]?.activeMemberId, 'camera-a');
	assert.equal(planned.after[0]?.activeMemberId, 'camera-b');
	assert.equal(planned.after[0]?.members[0]?.syncOffsetSamples, 16_016);

	assert.throws(() => plan(project, planned.after, {
		type: 'multicamera/switch', projectId: project.id,
		expectedProjectRevision: project.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-a', memberId: 'camera-a',
	}), /stale.*active member/iu);
	assert.throws(() => plan(project, planned.after, {
		type: 'multicamera/remove', projectId: project.id,
		expectedProjectRevision: project.revision + 1, groupId: 'group-a',
		expectedActiveMemberId: 'camera-b',
	}), /stale.*revision/iu);

	planned = plan(project, planned.after, {
		type: 'multicamera/remove', projectId: project.id,
		expectedProjectRevision: project.revision, groupId: 'group-a',
		expectedActiveMemberId: 'camera-b',
	});
	assert.deepEqual(planned.after, []);
});

test('V18 runtime selection maps the output clip to the active canonical source exactly', () => {
	const project = multicameraProject();
	const groups = [multicameraGroup()];
	const request = {
		projectId: project.id,
		projectRevision: project.revision,
		groupId: 'group-a',
		sequenceId: 'main-sequence',
		outputClipId: 'output-clip',
		activeMemberId: 'camera-a',
	};
	const selection = selectFramescaperMulticameraRuntimeV18(PROFILE, project, groups, request);
	assert.deepEqual(selection, {
		projectId: project.id,
		projectRevision: project.revision,
		groupId: 'group-a',
		sequenceId: 'main-sequence',
		outputClipId: 'output-clip',
		memberId: 'camera-a',
		sourceId: 'source-a',
		syncOffsetSamples: 8_008,
		timelineStartSample: { numerator: 8_008n, denominator: 5n },
		timelineEndSample: { numerator: 88_088n, denominator: 5n },
		sourceStartSample: { numerator: 48_048n, denominator: 5n },
		sourceEndSample: { numerator: 128_128n, denominator: 5n },
	});
	assert.equal(Object.isFrozen(selection), true);
	assert.equal(Object.isFrozen(selection.sourceStartSample), true);
	assert.deepEqual(
		selectFramescaperMulticameraRuntimeV18(PROFILE, project, [{
			...multicameraGroup(), members: [...multicameraGroup().members].reverse(),
		}], request),
		selection,
	);
	assert.equal(Object.hasOwn(selection, 'proxyAttachment'), false);
	const moved = structuredClone(project) as unknown as MutableProject;
	moved.clips[0]!.sequenceStartFrame = 2;
	const movedSelection = selectFramescaperMulticameraRuntimeV18(PROFILE, moved, groups, request);
	assert.deepEqual(movedSelection.timelineStartSample, { numerator: 16_016n, denominator: 5n });
	assert.deepEqual(movedSelection.sourceStartSample, selection.sourceStartSample);
});

test('V18 runtime selection refuses stale fences and source-bound violations', () => {
	const project = multicameraProject();
	const request = {
		projectId: project.id, projectRevision: project.revision,
		groupId: 'group-a', sequenceId: 'main-sequence',
		outputClipId: 'output-clip', activeMemberId: 'camera-a',
	};
	for (const [changes, pattern] of [
		[{ projectRevision: project.revision + 1 }, /stale.*revision/iu],
		[{ activeMemberId: 'camera-b' }, /stale.*active member/iu],
		[{ outputClipId: 'other' }, /stale.*output clip/iu],
		[{ sequenceId: 'other' }, /stale.*sequence/iu],
	] as const) assert.throws(
		() => selectFramescaperMulticameraRuntimeV18(PROFILE, project, [multicameraGroup()], {
			...request, ...changes,
		}),
		pattern,
	);
	const outside = multicameraGroup();
	outside.members[0]!.syncOffsetSamples = -2_000;
	assert.throws(
		() => selectFramescaperMulticameraRuntimeV18(PROFILE, project, [outside], request),
		/source bounds/iu,
	);
});

test('V18 multicamera writes refuse offsets between the member source frame boundaries', () => {
	const project = multicameraProject();
	const offGrid = multicameraGroup();
	offGrid.members[0]!.syncOffsetSamples = 8_007;
	assert.throws(
		() => validateFramescaperMulticameraGroupsV18(PROFILE, project, [offGrid]),
		/camera-a start is not an exact canonical-source boundary/iu,
	);
	for (const command of [
		{
			type: 'multicamera/create', projectId: project.id,
			expectedProjectRevision: project.revision, group: offGrid,
		},
		{
			type: 'multicamera/update', projectId: project.id,
			expectedProjectRevision: project.revision, groupId: 'group-a',
			expectedActiveMemberId: 'camera-a', group: offGrid,
		},
	] as const) assert.throws(
		() => plan(project, command.type === 'multicamera/create' ? [] : [multicameraGroup()], command),
		/exact canonical-source boundary/iu,
	);
	const inactive = multicameraGroup();
	inactive.members[1]!.syncOffsetSamples = 1;
	assert.throws(
		() => plan(project, [], {
			type: 'multicamera/create', projectId: project.id,
			expectedProjectRevision: project.revision, group: inactive,
		}),
		/camera-b start is not an exact canonical-source boundary/iu,
	);
});

test('V18 multicamera refuses a member source grid that cannot host the group time', () => {
	const mixed = structuredClone(multicameraProject()) as unknown as MutableProject;
	const rate = { num: 24, den: 1 };
	mixed.sources[1]!.frameRate = rate;
	mixed.sources[1]!.timingDecision = { mode: 'conform-cfr-at-ingest', rate };
	const aligned = multicameraGroup();
	aligned.members[0]!.syncOffsetSamples = 0;
	aligned.members[1]!.syncOffsetSamples = 0;
	assert.throws(
		() => validateFramescaperMulticameraGroupsV18(PROFILE, mixed, [aligned]),
		/camera-b start is not an exact canonical-source boundary/iu,
	);
});

test('V18 multicamera authenticates the runtime profile before traversing project input', () => {
	let traps = 0;
	const project = new Proxy({}, { get() { traps += 1; throw new Error('project trap'); } });
	assert.throws(
		() => validateFramescaperMulticameraGroupsV18({}, project, []),
		/exact Framescaper V18 runtime profile/iu,
	);
	assert.equal(traps, 0);
});

function plan(
	project: ReturnType<typeof multicameraProject>,
	groups: readonly FramescaperMulticameraGroupV18[],
	command: FramescaperMulticameraCommandV18,
) {
	return planFramescaperMulticameraCommandV18(PROFILE, project, groups, command);
}

function multicameraGroup(): MutableGroup {
	return {
		id: 'group-a', projectId: 'multicamera-v18', sequenceId: 'main-sequence',
		outputClipId: 'output-clip', activeMemberId: 'camera-a',
		members: [
			{ id: 'camera-a', groupId: 'group-a', sourceId: 'source-a', syncOffsetSamples: 8_008 },
			{ id: 'camera-b', groupId: 'group-a', sourceId: 'source-b', syncOffsetSamples: 0 },
		],
	};
}

function multicameraProject() {
	const rate = { num: 30_000, den: 1_001 };
	return createFramescaperProjectV18(PROFILE, {
		id: 'multicamera-v18', title: 'Multicamera V18', now: NOW, sampleRate: 48_000,
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
	});
}

interface MutableGroup extends FramescaperMulticameraGroupV18 {
	id: string;
	projectId: string;
	sequenceId: string;
	outputClipId: string;
	activeMemberId: string;
	members: MutableMember[];
}

interface MutableMember {
	id: string;
	groupId: string;
	sourceId: string;
	syncOffsetSamples: number;
}

interface MutableProject extends Record<string, unknown> {
	clips: Record<string, unknown>[];
	sources: Record<string, unknown>[];
	tracks: (Record<string, unknown> & { clipIds: string[] })[];
}
