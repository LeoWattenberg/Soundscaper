/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyFramescaperProjectCommandV24,
	snapshotFramescaperProjectCommandV24,
} from '../src/framescaper/editor-project-v24-commands.ts';
import {
	createFramescaperProjectHistoryV24,
	executeFramescaperProjectCommandV24,
	redoFramescaperProjectCommandV24,
	undoFramescaperProjectCommandV24,
	validateFramescaperProjectHistoryV24,
} from '../src/framescaper/editor-project-v24-history.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import {
	createFramescaperProjectV24,
	validateFramescaperProjectV24,
	type FramescaperProjectV24,
} from '../src/framescaper/editor-project-v24.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE;
const DIGEST_A = 'aa'.repeat(32);
const DIGEST_B = 'bb'.repeat(32);

test('V24 visual preset commands are closed, stale-safe, and preserve the cumulative project', () => {
	const project = visualProject();
	const beforeClips = structuredClone(project.clips);
	const beforeTransitions = transitionState(project);
	const replacement = preset('Preset updated', DIGEST_B);
	const command = {
		type: 'video-visual-preset/set' as const,
		presetId: 'visual-preset',
		expectedPreset: preset('Preset', DIGEST_A),
		preset: replacement,
	};
	const changed = applyFramescaperProjectCommandV24(PROFILE, project, command, {
		now: '2026-08-22T13:00:00.000Z',
	});
	assert.equal(revision(changed), revision(project) + 1);
	assert.deepEqual(changed.videoVisualPresets, [replacement]);
	assert.deepEqual(changed.clips, beforeClips);
	assert.deepEqual(transitionState(changed), beforeTransitions);
	assert.equal(validateFramescaperProjectV24(PROFILE, changed), true);
	assert.throws(() => applyFramescaperProjectCommandV24(PROFILE, changed, command), /stale/iu);
	assert.throws(() => snapshotFramescaperProjectCommandV24({ ...command, surprise: true }), /unsupported/iu);
});

test('V24 history executes, undoes, and redoes an owned visual mutation with monotonic revisions', () => {
	const project = visualProject();
	const command = {
		type: 'video-visual-preset/set' as const,
		presetId: 'visual-preset',
		expectedPreset: preset('Preset', DIGEST_A),
		preset: preset('Preset updated', DIGEST_B),
	};
	const executed = executeFramescaperProjectCommandV24(
		PROFILE,
		createFramescaperProjectHistoryV24(PROFILE, project, { limit: 2 }),
		command,
		{ now: '2026-08-22T13:00:00.000Z' },
	);
	assert.equal(executed.present.videoVisualPresets[0]!.name, 'Preset updated');
	const undone = undoFramescaperProjectCommandV24(PROFILE, executed, {
		now: '2026-08-22T13:01:00.000Z',
	});
	assert.equal(undone.present.videoVisualPresets[0]!.name, 'Preset');
	assert.equal(revision(undone.present), revision(executed.present) + 1);
	const redone = redoFramescaperProjectCommandV24(PROFILE, undone, {
		now: '2026-08-22T13:02:00.000Z',
	});
	assert.equal(redone.present.videoVisualPresets[0]!.name, 'Preset updated');
	assert.equal(revision(redone.present), revision(undone.present) + 1);
	assert.equal(validateFramescaperProjectHistoryV24(PROFILE, redone), true);
});

test('V24 visual preset commands cannot change identity or collide with inherited identities', () => {
	const project = visualProject();
	assert.throws(() => snapshotFramescaperProjectCommandV24({
		type: 'video-visual-preset/set', presetId: 'visual-preset',
		expectedPreset: preset('Preset', DIGEST_A),
		preset: { ...preset('Preset', DIGEST_B), id: 'other-preset' },
	}), /identity/iu);
	assert.throws(() => applyFramescaperProjectCommandV24(PROFILE, project, {
		type: 'video-visual-preset/set', presetId: 'video-source', expectedPreset: null,
		preset: { ...preset('Collision', DIGEST_B), id: 'video-source' },
	}), /identity|collid|duplicate/iu);
});

function visualProject(): FramescaperProjectV24 {
	return createFramescaperProjectV24(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { presets: [preset('Preset', DIGEST_A)] },
	});
}

function preset(name: string, authoredStateSha256: string) {
	return {
		schemaVersion: 1 as const,
		kind: 'video-preset' as const,
		id: 'visual-preset',
		name,
		modelKind: 'generator' as const,
		authoredStateSha256,
	};
}

function revision(project: FramescaperProjectV24): number {
	return Number(project.revision);
}

function transitionState(project: FramescaperProjectV24): unknown {
	const tracks = project.tracks as readonly Readonly<Record<string, unknown>>[];
	return structuredClone(tracks.map(({ videoTransitions }) => videoTransitions));
}
