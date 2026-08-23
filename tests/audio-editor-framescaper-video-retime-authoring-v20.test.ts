/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperVideoRetimeActionsV20,
} from '../src/framescaper/editor-project-v20-retime-actions.ts';
import {
	createFramescaperVideoRetimeConstantCommandV20,
	createFramescaperVideoRetimeFreezeCommandV20,
	createFramescaperVideoRetimeRampCommandV20,
	createFramescaperVideoRetimeResetCommandV20,
	createFramescaperVideoRetimeReverseCommandV20,
	createFramescaperVideoRetimeSetCommandV20,
} from '../src/framescaper/editor-project-v20-retime-command.ts';
import {
	applyFramescaperProjectCommandV20,
	type FramescaperProjectCommandV20,
} from '../src/framescaper/editor-project-v20-commands.ts';
import {
	createFramescaperProjectHistoryV20,
	executeFramescaperProjectCommandV20,
	redoFramescaperProjectCommandV20,
	undoFramescaperProjectCommandV20,
} from '../src/framescaper/editor-project-v20-history.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
	type FramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;
const EDITED = '2026-08-23T12:01:00.000Z';
const UNDONE = '2026-08-23T12:02:00.000Z';
const REDONE = '2026-08-23T12:03:00.000Z';

test('V20 authors every exact retime operation without warping linked audio', () => {
	const initial = linkedProject();
	const audioBefore = structuredClone(clip(initial, 'audio-clip'));

	const constant = apply(initial, createFramescaperVideoRetimeConstantCommandV20({
		clipId: 'video-clip', expectedRetimeMap: null,
	}));
	assert.deepEqual(map(constant, 'video-clip'), curve(
		[{ outerFrame: 0, sourceFrame: rational(0) }, { outerFrame: 10, sourceFrame: rational(10) }],
		[{ mode: 'constant-forward' }],
	));

	const reverse = apply(constant, createFramescaperVideoRetimeReverseCommandV20({
		clipId: 'video-clip', expectedRetimeMap: map(constant, 'video-clip'),
	}));
	assert.deepEqual(map(reverse, 'video-clip'), curve(
		[{ outerFrame: 0, sourceFrame: rational(10) }, { outerFrame: 10, sourceFrame: rational(0) }],
		[{ mode: 'constant-reverse' }],
	));

	const frozen = apply(reverse, createFramescaperVideoRetimeFreezeCommandV20({
		clipId: 'video-clip', expectedRetimeMap: map(reverse, 'video-clip'), sourceFrame: rational(4),
	}));
	assert.deepEqual(map(frozen, 'video-clip'), curve(
		[{ outerFrame: 0, sourceFrame: rational(4) }, { outerFrame: 10, sourceFrame: rational(4) }],
		[{ mode: 'freeze' }],
	));

	const ramped = apply(frozen, createFramescaperVideoRetimeRampCommandV20({
		clipId: 'video-clip', expectedRetimeMap: map(frozen, 'video-clip'), direction: 'forward',
		startVelocity: rational(0), endVelocity: rational(2), sourceStartFrame: rational(0),
	}));
	assert.deepEqual(map(ramped, 'video-clip'), curve(
		[{ outerFrame: 0, sourceFrame: rational(0) }, { outerFrame: 10, sourceFrame: rational(10) }],
		[{ mode: 'ramp-forward', startVelocity: rational(0), endVelocity: rational(2) }],
	));

	const custom = curve([
		{ outerFrame: 0, sourceFrame: rational(0) },
		{ outerFrame: 5, sourceFrame: rational(5) },
		{ outerFrame: 10, sourceFrame: rational(5) },
	], [{ mode: 'constant-forward' }, { mode: 'freeze' }]);
	const set = apply(ramped, createFramescaperVideoRetimeSetCommandV20({
		clipId: 'video-clip', expectedRetimeMap: map(ramped, 'video-clip'), retimeMap: custom,
	}));
	assert.deepEqual(map(set, 'video-clip'), custom);
	assert.notStrictEqual(map(set, 'video-clip'), custom);

	const reset = apply(set, createFramescaperVideoRetimeResetCommandV20({
		clipId: 'video-clip', expectedRetimeMap: map(set, 'video-clip'),
	}), EDITED);
	assert.equal(map(reset, 'video-clip'), null);
	assert.equal(reset.revision, initial.revision + 6);
	assert.equal(reset.updatedAt, EDITED);
	assert.deepEqual(clip(reset, 'audio-clip'), audioBefore);
	assert.equal((clip(reset, 'audio-clip') as Readonly<Record<string, unknown>>).warpMap, null);
});

test('V20 retime commands are stale-safe, track-lock aware, Project Bin capable, and one-step undoable', () => {
	const project = linkedProject();
	const command = createFramescaperVideoRetimeFreezeCommandV20({
		clipId: 'video-clip', expectedRetimeMap: null, sourceFrame: rational(3),
	});
	let history = executeFramescaperProjectCommandV20(
		PROFILE, createFramescaperProjectHistoryV20(PROFILE, project), command, { now: EDITED },
	);
	assert.equal(map(history.present, 'video-clip')?.segments[0]?.mode, 'freeze');
	history = undoFramescaperProjectCommandV20(PROFILE, history, { now: UNDONE });
	assert.equal(map(history.present, 'video-clip'), null);
	history = redoFramescaperProjectCommandV20(PROFILE, history, { now: REDONE });
	assert.equal(map(history.present, 'video-clip')?.segments[0]?.mode, 'freeze');
	assert.equal(history.present.revision, project.revision + 3);

	assert.throws(() => apply(history.present, command), /stale|expected.*retime/iu);
	const locked = structuredClone(project) as FramescaperProjectV20;
	(locked.tracks[0] as Record<string, unknown>).locked = true;
	assert.throws(() => apply(locked, command), /locked track/iu);

	const bin = apply(project, createFramescaperVideoRetimeConstantCommandV20({
		scope: 'project-bin', clipId: 'bin-video', expectedRetimeMap: null,
	}));
	assert.equal(map(bin, 'bin-video', 'project-bin')?.segments[0]?.mode, 'constant-forward');
});

test('the V20 controller action facade snapshots exact commands and exposes no generic escape hatch', () => {
	const observed: FramescaperProjectCommandV20[] = [];
	const actions = createFramescaperVideoRetimeActionsV20((command: FramescaperProjectCommandV20) => {
		observed.push(command);
		return command.type;
	});
	assert.equal(actions.freeze({
		clipId: 'video-clip', expectedRetimeMap: null, sourceFrame: rational(5),
	}), 'video-retime/freeze');
	assert.deepEqual(observed, [createFramescaperVideoRetimeFreezeCommandV20({
		clipId: 'video-clip', expectedRetimeMap: null, sourceFrame: rational(5),
	})]);
	assert.deepEqual(Object.keys(actions).sort(), ['constant', 'freeze', 'ramp', 'reset', 'reverse', 'set']);
});

test('V20 inherited editorial commands preserve authored retime while linked audio stays unwarped', () => {
	const authored = apply(linkedProject(), createFramescaperVideoRetimeReverseCommandV20({
		clipId: 'video-clip', expectedRetimeMap: null,
	}));
	const expectedMap = structuredClone(map(authored, 'video-clip'));
	const expectedAudio = structuredClone(clip(authored, 'audio-clip'));
	const moved = apply(authored, {
		type: 'clip/move', clipId: 'video-clip', timelineStartFrame: 48_000,
	});
	assert.deepEqual(map(moved, 'video-clip'), expectedMap);
	const movedAudio = clip(moved, 'audio-clip') as Readonly<Record<string, unknown>>;
	assert.equal(movedAudio.timelineStartFrame, 48_000);
	assert.equal(movedAudio.sourceStartFrame, expectedAudio.sourceStartFrame);
	assert.equal(movedAudio.sourceDurationFrames, expectedAudio.sourceDurationFrames);
	assert.equal(movedAudio.reversed, false);
	assert.equal(movedAudio.warpMap, null);
});

function linkedProject(): FramescaperProjectV20 {
	const options = framescaperV20Options();
	(options.clips as Record<string, unknown>[])[0]!.avLinkId = 'linked-av';
	(options.clips as Record<string, unknown>[])[1]!.avLinkId = 'linked-av';
	(options.tracks as Record<string, unknown>[])[0]!.laneGroupId = 'linked-lane';
	(options.tracks as Record<string, unknown>[])[1]!.laneGroupId = 'linked-lane';
	return createFramescaperProjectV20(PROFILE, options);
}

function apply(
	project: FramescaperProjectV20,
	command: FramescaperProjectCommandV20,
	now = '2026-08-23T12:00:30.000Z',
): FramescaperProjectV20 {
	return applyFramescaperProjectCommandV20(PROFILE, project, command, { now });
}

function clip(
	project: FramescaperProjectV20,
	clipId: string,
	scope: 'timeline' | 'project-bin' = 'timeline',
): Readonly<Record<string, unknown>> {
	const clips = scope === 'timeline' ? project.clips : project.projectBin.clips;
	const value = clips.find(({ id }) => id === clipId);
	if (!value) throw new ReferenceError(`Missing ${scope} clip ${clipId}.`);
	return value;
}

function map(
	project: FramescaperProjectV20,
	clipId: string,
	scope: 'timeline' | 'project-bin' = 'timeline',
) {
	return clip(project, clipId, scope).retimeMap as Readonly<{
		feature: 'video-retime'; version: 2;
		points: readonly Readonly<Record<string, unknown>>[];
		segments: readonly Readonly<{ mode: string }>[];
	}> | null;
}

function curve(
	points: readonly Readonly<Record<string, unknown>>[],
	segments: readonly Readonly<Record<string, unknown>>[],
) {
	return { feature: 'video-retime' as const, version: 2 as const, points, segments };
}

function rational(num: number, den = 1) {
	return { num, den };
}
