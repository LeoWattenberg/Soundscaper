/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyFramescaperProjectCommandV25,
	framescaperProfessionalSourceStateV25,
	snapshotFramescaperProjectCommandV25,
	type FramescaperProfessionalSourceStateV25,
} from '../src/framescaper/editor-project-v25-commands.ts';
import {
	createFramescaperProjectHistoryV25,
	executeFramescaperProjectCommandV25,
	redoFramescaperProjectCommandV25,
	undoFramescaperProjectCommandV25,
	validateFramescaperProjectHistoryV25,
} from '../src/framescaper/editor-project-v25-history.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import {
	createFramescaperProjectV25,
	validateFramescaperProjectV25,
	type FramescaperProjectV25,
} from '../src/framescaper/editor-project-v25.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE;
const DIGEST_A = 'aa'.repeat(32);

test('V25 professional source commands are closed, stale-safe, and preserve inherited visual state', () => {
	const project = professionalProject();
	const expectedState = framescaperProfessionalSourceStateV25(PROFILE, project, 'video-source');
	const state = reportedState(expectedState, 10);
	const command = {
		type: 'video-source/professional-state-set' as const,
		sourceId: 'video-source',
		expectedState,
		state,
	};
	const beforePreset = structuredClone(project.videoVisualPresets);
	const beforeTransitions = transitionState(project);
	const changed = applyFramescaperProjectCommandV25(PROFILE, project, command, {
		now: '2026-08-22T14:00:00.000Z',
	});
	assert.equal(videoBitDepth(changed), 10);
	assert.equal(revision(changed), revision(project) + 1);
	assert.deepEqual(changed.videoVisualPresets, beforePreset);
	assert.deepEqual(transitionState(changed), beforeTransitions);
	assert.equal(validateFramescaperProjectV25(PROFILE, changed), true);
	assert.throws(() => applyFramescaperProjectCommandV25(PROFILE, changed, command), /stale/iu);
	assert.throws(() => snapshotFramescaperProjectCommandV25({ ...command, surprise: true }), /unsupported/iu);
});

test('V25 history executes, undoes, and redoes professional media state', () => {
	const project = professionalProject();
	const expectedState = framescaperProfessionalSourceStateV25(PROFILE, project, 'video-source');
	const command = {
		type: 'video-source/professional-state-set' as const,
		sourceId: 'video-source',
		expectedState,
		state: reportedState(expectedState, 12),
	};
	const executed = executeFramescaperProjectCommandV25(
		PROFILE,
		createFramescaperProjectHistoryV25(PROFILE, project, { limit: 2 }),
		command,
		{ now: '2026-08-22T14:00:00.000Z' },
	);
	assert.equal(videoBitDepth(executed.present), 12);
	const undone = undoFramescaperProjectCommandV25(PROFILE, executed, {
		now: '2026-08-22T14:01:00.000Z',
	});
	assert.equal(videoBitDepth(undone.present), null);
	assert.equal(revision(undone.present), revision(executed.present) + 1);
	const redone = redoFramescaperProjectCommandV25(PROFILE, undone, {
		now: '2026-08-22T14:02:00.000Z',
	});
	assert.equal(videoBitDepth(redone.present), 12);
	assert.equal(revision(redone.present), revision(undone.present) + 1);
	assert.equal(validateFramescaperProjectHistoryV25(PROFILE, redone), true);
});

test('V25 professional commands reject missing source identities and invalid exact characteristics', () => {
	const project = professionalProject();
	const expectedState = framescaperProfessionalSourceStateV25(PROFILE, project, 'video-source');
	assert.throws(() => applyFramescaperProjectCommandV25(PROFILE, project, {
		type: 'video-source/professional-state-set', sourceId: 'missing-source',
		expectedState, state: expectedState,
	}), /does not exist/iu);
	assert.throws(() => applyFramescaperProjectCommandV25(PROFILE, project, {
		type: 'video-source/professional-state-set', sourceId: 'video-source',
		expectedState, state: reportedState(expectedState, 14),
	}), /bitDepth|unsupported/iu);
	assert.throws(() => snapshotFramescaperProjectCommandV25({
		type: 'video-source/professional-state-set', sourceId: 'video-source',
		expectedState: { ...expectedState, extra: true }, state: expectedState,
	}), /unsupported/iu);
});

function professionalProject(): FramescaperProjectV25 {
	return createFramescaperProjectV25(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { presets: [{
			schemaVersion: 1, kind: 'video-preset', id: 'visual-preset', name: 'Preset',
			modelKind: 'generator', authoredStateSha256: DIGEST_A,
		}] },
	});
}

function reportedState(
	state: FramescaperProfessionalSourceStateV25,
	bitDepth: number,
): FramescaperProfessionalSourceStateV25 {
	return {
		...state,
		characteristics: {
			...state.characteristics,
			backend: 'framescaper-media-host',
			bitDepth,
			pixelFormat: 'yuv420p10le',
			chromaFormat: '4:2:0',
		},
	};
}

function videoBitDepth(project: FramescaperProjectV25): number | null {
	const source = project.sources.find(({ id }) => id === 'video-source');
	if (!source || source.kind !== 'video') throw new Error('Video source is missing.');
	return (source as unknown as {
		readonly characteristics: Readonly<{ readonly bitDepth: number | null }>;
	}).characteristics.bitDepth;
}

function revision(project: FramescaperProjectV25): number {
	return Number(project.revision);
}

function transitionState(project: FramescaperProjectV25): unknown {
	const tracks = project.tracks as readonly Readonly<Record<string, unknown>>[];
	return structuredClone(tracks.map(({ videoTransitions }) => videoTransitions));
}
