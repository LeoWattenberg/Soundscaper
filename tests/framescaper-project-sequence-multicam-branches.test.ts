/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_SEQUENCE_MAXIMUM_MULTICAMERA_GROUPS as MAXIMUM_GROUPS,
	FRAMESCAPER_SEQUENCE_MAXIMUM_MULTICAMERA_MEMBERS as MAXIMUM_MEMBERS,
	isFramescaperMulticameraCommandSequence as isCommand,
	planFramescaperMulticameraCommandSequence as plan,
	selectFramescaperMulticameraRuntimeSequence as select,
	validateFramescaperMulticameraGroupsSequence as validate,
} from '../src/framescaper/editor-project-sequence-multicam.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const PROJECT_ID = 'framescaper-v20';

/**
 * One 10 fps sequence carrying two five-frame output clips, a matching second
 * camera and a 4 fps third camera whose frame grid disagrees with the group
 * range. Every refusal below is driven from this one document.
 */
function fixtureOptions(): Data {
	const options = framescaperV20Options();
	const sources = options.sources as Data[];
	const video = sources[0]!;
	options.sources = [...sources, {
		...video, id: 'video-source-b', name: 'Video B',
		storageKey: 'video-source-b', contentSha256: '34'.repeat(32),
	}, {
		...video, id: 'video-source-c', name: 'Video C',
		storageKey: 'video-source-c', contentSha256: '56'.repeat(32),
		frameRate: { num: 4, den: 1 }, sourceFrameCount: 4,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 4, den: 1 } },
	}];
	const clips = options.clips as Data[];
	options.clips = [{ ...clips[0], sequenceFrameCount: 5, sourceFrameCount: 5 }, {
		...clips[0], id: 'video-clip-b', sourceId: 'video-source-b', title: 'Video B',
		sequenceStartFrame: 5, sequenceFrameCount: 5, sourceInFrame: 0, sourceFrameCount: 5,
	}, ...clips.slice(1)];
	const tracks = options.tracks as Data[];
	options.tracks = [{ ...tracks[0], clipIds: ['video-clip', 'video-clip-b'] }, ...tracks.slice(1)];
	return options;
}

const PROJECT = createFramescaperProjectSequence(PROFILE, fixtureOptions() as never) as unknown as Data;
const REVISION = PROJECT.revision as number;

function withProject(mutate: (project: Data) => void): Data {
	const copy = structuredClone(PROJECT);
	mutate(copy);
	return copy;
}

function clipOf(project: Data, id: string): Data {
	return (project.clips as Data[]).find((clip) => clip.id === id)!;
}

function member(id: string, sourceId: string, syncOffsetSamples = 0, groupId = 'group-a'): Data {
	return { id, groupId, sourceId, syncOffsetSamples };
}

function groupA(patch: Data = {}): Data {
	return {
		id: 'group-a', projectId: PROJECT_ID, sequenceId: 'main-sequence',
		outputClipId: 'video-clip', activeMemberId: 'camera-a',
		members: [member('camera-b', 'video-source-b'), member('camera-a', 'video-source')],
		...patch,
	};
}

function groupB(patch: Data = {}): Data {
	return {
		id: 'group-b', projectId: PROJECT_ID, sequenceId: 'main-sequence',
		outputClipId: 'video-clip-b', activeMemberId: 'camera-c',
		members: [
			member('camera-c', 'video-source-b', 0, 'group-b'),
			member('camera-d', 'video-source', 0, 'group-b'),
		],
		...patch,
	};
}

function pair(first: Data, second: Data): Data {
	return { members: [first, second] };
}

function command(patch: Data): Data {
	return { projectId: PROJECT_ID, expectedProjectRevision: REVISION, ...patch };
}

function request(patch: Data = {}): Data {
	return {
		projectId: PROJECT_ID, projectRevision: REVISION, groupId: 'group-a',
		sequenceId: 'main-sequence', outputClipId: 'video-clip', activeMemberId: 'camera-a',
		...patch,
	};
}

function refuses(groups: unknown, message: RegExp, project: unknown = PROJECT): void {
	assert.throws(() => validate(PROFILE, project, groups), message);
}

function refusesCommand(groups: unknown, patch: Data, message: RegExp): void {
	assert.throws(() => plan(PROFILE, PROJECT, groups, command(patch)), message);
}

test('the authenticated sequence runtime profile is required before any group is read', () => {
	assert.throws(() => validate({}, PROJECT, []), TypeError);
	assert.throws(() => plan({}, PROJECT, [], {}), /authenticated Framescaper 1\.0/u);
	assert.throws(() => select(null, PROJECT, [], {}), /authenticated Framescaper 1\.0/u);
});

test('the group document must be an exact Framescaper 1.0 envelope with the indexed fields', () => {
	refuses([], /must be an object/u, null);
	refuses([], /require an exact Framescaper 1\.0 project/u,
		withProject((project) => { project.schemaFamily = 'soundscaper'; }));
	refuses([], /require an exact Framescaper 1\.0 project/u,
		withProject((project) => { project.schemaVersion = 2; }));
	refuses([], /project\.sequences must be an own enumerable data property/u,
		withProject((project) => { delete project.sequences; }));
});

test('a groups collection must be a dense array of exactly the known group fields', () => {
	const withoutId: Data = groupA();
	delete withoutId.id;
	const accessorId = Object.defineProperties({}, {
		...Object.getOwnPropertyDescriptors(groupA()),
		id: { enumerable: true, get: () => 'group-a' },
	});

	refuses({}, /groups must be an array/u);
	refuses(Object.assign([], { length: 1 }), /groups\.0 must be an own enumerable data property/u);
	refuses(Object.assign([groupA()], { extra: 1 }), /must be a dense data array/u);
	refuses([groupA({ label: 'Cameras' })], /groups\[0\] has an unsupported field/u);
	refuses([withoutId], /groups\[0\]\.id must be an own/u);
	refuses([accessorId], /groups\[0\]\.id must be an own/u);
	refuses([groupA({ id: '' })], /groups\[0\]\.id must be a non-empty string/u);
});

test('a groups collection beyond the maintained maximum is refused before any group is read', () => {
	assert.equal(MAXIMUM_GROUPS, 1_024);
	refuses(Array.from({ length: MAXIMUM_GROUPS + 1 }, () => null), /exceed the maintained limit/u);
	refuses([null], /groups\[0\] must be an object/u);
});

test('group identity, project ownership and output-clip exclusivity are each enforced', () => {
	refuses([groupA(), groupA({ outputClipId: 'video-clip-b' })], /Duplicate multicamera group ID: group-a\./u);
	refuses([groupA({ projectId: 'other-project' })], /group group-a belongs to another project/u);
	refuses([groupA(), groupB({ outputClipId: 'video-clip' })],
		/Output clip video-clip can belong to only one multicamera group/u);
});

test('a validated snapshot sorts groups and members by ID and freezes every level', () => {
	const groups = validate(PROFILE, PROJECT, [groupB(), groupA()]);

	assert.deepEqual(groups.map((group) => group.id), ['group-a', 'group-b']);
	assert.deepEqual(groups[0]?.members.map((value) => value.id), ['camera-a', 'camera-b']);
	assert.equal(Object.isFrozen(groups), true);
	assert.equal(Object.isFrozen(groups[0]), true);
	assert.equal(Object.isFrozen(groups[0]?.members), true);
	assert.equal(Object.isFrozen(groups[0]?.members[0]), true);
});

test('a member collection is bounded to between two and sixty-four entries', () => {
	assert.equal(MAXIMUM_MEMBERS, 64);
	refuses([groupA({ members: 'camera-a' })], /members must be an array/u);
	refuses([groupA({ members: [member('camera-a', 'video-source')] })], /between 2 and 64 members/u);
	refuses(
		[groupA({ members: Array.from({ length: MAXIMUM_MEMBERS + 1 }, () => null) })],
		/between 2 and 64 members/u,
	);
});

test('member identity is unique across the document and bound to its own group and source', () => {
	refuses(
		[groupA(), groupB(pair(
			member('camera-a', 'video-source-b', 0, 'group-b'),
			member('camera-d', 'video-source', 0, 'group-b'),
		))],
		/Duplicate multicamera member ID: camera-a\./u,
	);
	refuses(
		[groupA(pair(member('camera-a', 'video-source'), member('camera-b', 'video-source-b', 0, 'group-b')))],
		/member camera-b belongs to another group/u,
	);
	refuses(
		[groupA(pair(member('camera-a', 'video-source'), member('camera-b', 'video-source')))],
		/Duplicate multicamera member source: video-source\./u,
	);
	refuses(
		[groupA(pair(member('camera-a', 'video-source', 0.5), member('camera-b', 'video-source-b')))],
		/syncOffsetSamples must be a signed safe integer/u,
	);
});

test('a group refuses a missing sequence, a missing output clip and a non-video output clip', () => {
	refuses([groupA({ sequenceId: 'absent-sequence' })], /group group-a references a missing sequence/u);
	refuses([groupA({ outputClipId: 'absent-clip' })], /group group-a references a missing video output clip/u);
	refuses([groupA({ outputClipId: 'audio-clip' })], /group group-a references a missing video output clip/u);
});

test('an output clip must be un-retimed, one-to-one and inside the group sequence', () => {
	refuses([groupA()], /group group-a output clip belongs to another sequence/u,
		withProject((project) => { clipOf(project, 'video-clip').sequenceId = 'other-sequence'; }));
	refuses([groupA()], /cannot carry a retime map/u,
		withProject((project) => { clipOf(project, 'video-clip').retimeMap = { kind: 'linear' }; }));
	refuses([groupA()], /must preserve exact one-to-one group time/u,
		withProject((project) => { clipOf(project, 'video-clip').sequenceFrameCount = 4; }));
});

test('an output clip requires exactly one video track owner held by exactly one sequence', () => {
	refuses([groupA()], /requires exactly one video track owner/u,
		withProject((project) => { (project.tracks as Data[])[0]!.clipIds = ['video-clip-b']; }));
	refuses([groupA()], /requires exactly one video track owner/u, withProject((project) => {
		const tracks = project.tracks as Data[];
		tracks.push({ ...tracks[0], id: 'video-track-b', clipIds: ['video-clip'] });
	}));
	refuses([groupA()], /has invalid sequence ownership/u,
		withProject((project) => { (project.sequences as Data[])[0]!.trackIds = ['audio-track']; }));
	refuses([groupA()], /requires exact sequence ownership/u, withProject((project) => {
		const sequences = project.sequences as Data[];
		sequences.push({ ...sequences[0], id: 'shadow-sequence' });
	}));
});

test('a group requires a present active member backed by canonical video sources', () => {
	refuses([groupA({ activeMemberId: 'camera-z' })], /group group-a has a missing active member/u);
	refuses(
		[groupA(pair(member('camera-a', 'video-source'), member('camera-b', 'audio-source')))],
		/member camera-b references a missing canonical video source/u,
	);
	refuses(
		[groupA(pair(member('camera-a', 'video-source'), member('camera-b', 'absent-source')))],
		/member camera-b references a missing canonical video source/u,
	);
	refuses(
		[groupA({
			...pair(member('camera-a', 'video-source-b'), member('camera-b', 'video-source-c')),
			activeMemberId: 'camera-b',
		})],
		/must reference one group member source/u,
	);
});

test('a member offset outside the canonical source bounds is refused at either end', () => {
	refuses(
		[groupA(pair(member('camera-a', 'video-source'), member('camera-b', 'video-source-b', -4_800)))],
		/member camera-b lies outside canonical source bounds/u,
	);
	refuses(
		[groupA(pair(member('camera-a', 'video-source'), member('camera-b', 'video-source-b', 28_800)))],
		/member camera-b lies outside canonical source bounds/u,
	);
});

test('a group whose frame range leaves the safe-integer sample space is refused by range', () => {
	refuses([groupA()], /multicamera output range exceeds the safe-integer range/u, withProject(
		(project) => { clipOf(project, 'video-clip').sequenceStartFrame = Number.MAX_SAFE_INTEGER; },
	));
	refuses([groupA()], /multicamera group-source range exceeds the safe-integer range/u, withProject(
		(project) => { clipOf(project, 'video-clip').sourceInFrame = Number.MAX_SAFE_INTEGER; },
	));
});

test('a sequence rate that cannot express a sample denominator is refused', () => {
	refuses([groupA()], /exact multicamera sample denominator cannot be zero/u,
		withProject((project) => { (project.sequences as Data[])[0]!.rate = { num: 0, den: 1 }; }));
});

test('a member offset that is not an exact canonical-source boundary is refused', () => {
	// video-source-c runs at 4 fps, so a three-frame 10 fps group range ends mid-frame for it.
	const shortClip = withProject((project) => {
		const clip = clipOf(project, 'video-clip');
		clip.sequenceFrameCount = 3;
		clip.sourceFrameCount = 3;
	});

	refuses(
		[groupA(pair(member('camera-a', 'video-source'), member('camera-b', 'video-source-b', 1)))],
		/member camera-b start is not an exact canonical-source boundary/u,
	);
	refuses(
		[groupA(pair(member('camera-a', 'video-source'), member('camera-e', 'video-source-c')))],
		/member camera-e end is not an exact canonical-source boundary/u,
		shortClip,
	);
});

test('a member whose exact timing is unverified is admitted at rest instead of at the projection', () => {
	const unverified = withProject((project) => {
		const source = (project.sources as Data[]).find((value) => value.id === 'video-source-b')!;
		source.timingDecision = { mode: 'exact', rate: { num: 10, den: 1 } };
	});
	const groups = [groupA(pair(member('camera-a', 'video-source'), member('camera-b', 'video-source-b', 1)))];

	refuses(groups, /not an exact canonical-source boundary/u);
	assert.deepEqual(
		validate(PROFILE, unverified, groups)[0]?.members.map((value) => value.syncOffsetSamples),
		[0, 1],
	);
});

test('only an own enumerable data type field marks a value as a multicamera command', () => {
	assert.equal(isCommand(null), false);
	assert.equal(isCommand('multicamera/create'), false);
	assert.equal(isCommand([{ type: 'multicamera/create' }]), false);
	assert.equal(isCommand({}), false);
	assert.equal(isCommand({ type: 'multicamera/rename' }), false);
	assert.equal(isCommand(Object.defineProperty({}, 'type', { value: 'multicamera/create' })), false);
	assert.equal(
		isCommand(Object.defineProperty({}, 'type', { enumerable: true, get: () => 'multicamera/create' })),
		false,
	);
	for (const type of ['multicamera/create', 'multicamera/update', 'multicamera/remove', 'multicamera/switch']) {
		assert.equal(isCommand({ type }), true, type);
	}
});

test('a command must be a record carrying exactly the fields its own type admits', () => {
	assert.throws(() => plan(PROFILE, PROJECT, [], []), /command must be an object/u);
	refusesCommand([], { type: 'multicamera/rename' }, /Unsupported Framescaper sequence multicamera command type/u);
	refusesCommand([], { type: 'multicamera/create', group: groupA(), note: 'x' },
		/command has an unsupported field/u);
	refusesCommand([], { type: 'multicamera/create', group: groupA(), groupId: 'group-a' },
		/command has an unsupported field/u);
	refusesCommand([groupA()], {
		type: 'multicamera/remove', groupId: 'group-a', expectedActiveMemberId: 'camera-a', group: groupA(),
	}, /command has an unsupported field/u);
	refusesCommand([groupA()], {
		type: 'multicamera/switch', groupId: 'group-a', expectedActiveMemberId: 'camera-a',
	}, /command\.memberId must be an own enumerable data property/u);
	refusesCommand([groupA()], {
		type: 'multicamera/remove', groupId: '', expectedActiveMemberId: 'camera-a',
	}, /command\.groupId must be a non-empty string/u);
});

test('a command is fenced to the exact project identity and revision', () => {
	const create = { type: 'multicamera/create', group: groupA() };

	assert.throws(
		() => plan(PROFILE, PROJECT, [], { ...create, projectId: 'other', expectedProjectRevision: REVISION }),
		/command belongs to another project/u,
	);
	assert.throws(
		() => plan(PROFILE, PROJECT, [], { ...create, projectId: PROJECT_ID, expectedProjectRevision: -1 }),
		/expectedProjectRevision must be a non-negative safe integer/u,
	);
	assert.throws(
		() => plan(PROFILE, PROJECT, [], { ...create, projectId: PROJECT_ID, expectedProjectRevision: REVISION + 1 }),
		/command has a stale project revision/u,
	);
});

test('creating a group appends it and revalidates the whole resulting collection', () => {
	const created = plan(PROFILE, PROJECT, [groupB()], command({ type: 'multicamera/create', group: groupA() }));

	assert.deepEqual(created.before.map((group) => group.id), ['group-b']);
	assert.deepEqual(created.after.map((group) => group.id), ['group-a', 'group-b']);
	assert.equal(Object.isFrozen(created), true);
	refusesCommand([groupA()], {
		type: 'multicamera/create', group: groupB({ outputClipId: 'video-clip' }),
	}, /can belong to only one multicamera group/u);
});

test('a fenced group command refuses a missing group and a stale active member', () => {
	assert.throws(
		() => plan(PROFILE, PROJECT, [groupA()], command({
			type: 'multicamera/remove', groupId: 'group-z', expectedActiveMemberId: 'camera-a',
		})),
		{ name: 'ReferenceError', message: /Multicamera group group-z is missing\./u },
	);
	refusesCommand([groupA()], {
		type: 'multicamera/remove', groupId: 'group-a', expectedActiveMemberId: 'camera-b',
	}, /group group-a has a stale active member/u);
});

test('removing a group drops only that group and leaves the rest validated', () => {
	const removed = plan(PROFILE, PROJECT, [groupA(), groupB()], command({
		type: 'multicamera/remove', groupId: 'group-a', expectedActiveMemberId: 'camera-a',
	}));

	assert.deepEqual(removed.before.map((group) => group.id), ['group-a', 'group-b']);
	assert.deepEqual(removed.after.map((group) => group.id), ['group-b']);
});

test('an update replaces the group body but can change neither its ID nor its active member', () => {
	refusesCommand([groupA()], {
		type: 'multicamera/update', groupId: 'group-a', expectedActiveMemberId: 'camera-a', group: 'group-a',
	}, /Multicamera replacement group must be an object/u);
	refusesCommand([groupA()], {
		type: 'multicamera/update', groupId: 'group-a', expectedActiveMemberId: 'camera-a',
		group: groupA({ id: 'group-renamed' }),
	}, /cannot change the stable group ID/u);
	refusesCommand([groupA()], {
		type: 'multicamera/update', groupId: 'group-a', expectedActiveMemberId: 'camera-a',
		group: groupA({ activeMemberId: 'camera-b' }),
	}, /cannot bypass the dedicated member-switch command/u);

	const updated = plan(PROFILE, PROJECT, [groupA()], command({
		type: 'multicamera/update', groupId: 'group-a', expectedActiveMemberId: 'camera-a',
		group: groupA(pair(member('camera-a', 'video-source'), member('camera-b', 'video-source-b', 4_800))),
	}));

	assert.deepEqual(updated.after[0]?.members.map((value) => value.syncOffsetSamples), [0, 4_800]);
	assert.deepEqual(updated.before[0]?.members.map((value) => value.syncOffsetSamples), [0, 0]);
});

test('a switch activates another existing member and refuses the one already active', () => {
	assert.throws(
		() => plan(PROFILE, PROJECT, [groupA()], command({
			type: 'multicamera/switch', groupId: 'group-a', expectedActiveMemberId: 'camera-a', memberId: 'camera-z',
		})),
		{ name: 'ReferenceError', message: /Multicamera member camera-z is missing\./u },
	);
	refusesCommand([groupA()], {
		type: 'multicamera/switch', groupId: 'group-a', expectedActiveMemberId: 'camera-a', memberId: 'camera-a',
	}, /member camera-a is already active/u);

	const switched = plan(PROFILE, PROJECT, [groupA()], command({
		type: 'multicamera/switch', groupId: 'group-a', expectedActiveMemberId: 'camera-a', memberId: 'camera-b',
	}));

	assert.equal(switched.before[0]?.activeMemberId, 'camera-a');
	assert.equal(switched.after[0]?.activeMemberId, 'camera-b');
	assert.deepEqual(switched.after[0]?.members.map((value) => value.id), ['camera-a', 'camera-b']);
});

test('a runtime request must carry exactly the fenced projection fields', () => {
	assert.throws(
		() => select(PROFILE, PROJECT, [groupA()], { groupId: 'group-a' }),
		/runtime request\.projectId must be an own enumerable data property/u,
	);
	assert.throws(
		() => select(PROFILE, PROJECT, [groupA()], request({ memberId: 'camera-a' })),
		/runtime request has an unsupported field/u,
	);
	assert.throws(
		() => select(PROFILE, PROJECT, [groupA()], request({ projectRevision: 1.5 })),
		/projectRevision must be a non-negative safe integer/u,
	);
});

test('a runtime request is refused for any stale fence in the projection', () => {
	const fences: readonly (readonly [Data, RegExp])[] = [
		[{ projectId: 'other' }, /stale project ID/u],
		[{ projectRevision: REVISION + 1 }, /stale project revision/u],
		[{ groupId: 'group-z' }, /Multicamera group group-z is missing/u],
		[{ sequenceId: 'other-sequence' }, /stale sequence/u],
		[{ outputClipId: 'video-clip-b' }, /stale output clip/u],
		[{ activeMemberId: 'camera-b' }, /stale active member/u],
	];

	for (const [patch, message] of fences) {
		assert.throws(() => select(PROFILE, PROJECT, [groupA()], request(patch)), message);
	}
});

test('a runtime projection resolves the active member to exact canonical sample ranges', () => {
	const groups = [groupA({
		...pair(member('camera-a', 'video-source'), member('camera-b', 'video-source-b', 4_800)),
		activeMemberId: 'camera-b',
	})];

	const selection = select(PROFILE, PROJECT, groups, request({ activeMemberId: 'camera-b' }));

	assert.deepEqual({ ...selection }, {
		projectId: PROJECT_ID,
		projectRevision: REVISION,
		groupId: 'group-a',
		sequenceId: 'main-sequence',
		outputClipId: 'video-clip',
		memberId: 'camera-b',
		sourceId: 'video-source-b',
		syncOffsetSamples: 4_800,
		timelineStartSample: { numerator: 0n, denominator: 1n },
		timelineEndSample: { numerator: 24_000n, denominator: 1n },
		sourceStartSample: { numerator: 4_800n, denominator: 1n },
		sourceEndSample: { numerator: 28_800n, denominator: 1n },
	});
	assert.equal(Object.isFrozen(selection), true);
	assert.equal(Object.isFrozen(selection.sourceStartSample), true);
});
