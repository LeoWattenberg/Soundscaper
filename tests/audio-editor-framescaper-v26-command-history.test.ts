/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { OfxEffectStateV26 } from '../src/common/editor/native-ofx-state-v26.ts';
import {
	applyFramescaperProjectCommandV26,
	snapshotFramescaperProjectCommandV26,
} from '../src/framescaper/editor-project-v26-commands.ts';
import {
	createFramescaperProjectHistoryV26,
	executeFramescaperProjectCommandV26,
	redoFramescaperProjectCommandV26,
	undoFramescaperProjectCommandV26,
	validateFramescaperProjectHistoryV26,
} from '../src/framescaper/editor-project-v26-history.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import {
	createFramescaperProjectV26,
	validateFramescaperProjectV26,
	type FramescaperProjectV26,
} from '../src/framescaper/editor-project-v26.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE;
const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);

test('V26 OpenFX commands are closed, stale-safe, and preserve cumulative V24/V25 state', () => {
	const project = ofxProject();
	const expectedEffect = project.ofxEffects[0]!;
	const effect = { ...expectedEffect, enabled: false };
	const command = {
		type: 'openfx-effect/set' as const,
		instanceId: expectedEffect.instanceId,
		expectedEffect,
		effect,
	};
	const beforeSources = structuredClone(project.sources);
	const beforePresets = structuredClone(project.videoVisualPresets);
	const changed = applyFramescaperProjectCommandV26(PROFILE, project, command, {
		now: '2026-08-22T15:00:00.000Z',
	});
	assert.equal(changed.ofxEffects[0]!.enabled, false);
	assert.equal(revision(changed), revision(project) + 1);
	assert.deepEqual(changed.sources, beforeSources);
	assert.deepEqual(changed.videoVisualPresets, beforePresets);
	assert.equal(validateFramescaperProjectV26(PROFILE, changed), true);
	assert.throws(() => applyFramescaperProjectCommandV26(PROFILE, changed, command), /stale/iu);
	assert.throws(() => snapshotFramescaperProjectCommandV26({ ...command, surprise: true }), /unsupported/iu);
});

test('V26 history executes, undoes, and redoes fingerprint-bound effect state', () => {
	const project = ofxProject();
	const expectedEffect = project.ofxEffects[0]!;
	const command = {
		type: 'openfx-effect/set' as const,
		instanceId: expectedEffect.instanceId,
		expectedEffect,
		effect: { ...expectedEffect, enabled: false },
	};
	const executed = executeFramescaperProjectCommandV26(
		PROFILE,
		createFramescaperProjectHistoryV26(PROFILE, project, { limit: 2 }),
		command,
		{ now: '2026-08-22T15:00:00.000Z' },
	);
	assert.equal(executed.present.ofxEffects[0]!.enabled, false);
	const undone = undoFramescaperProjectCommandV26(PROFILE, executed, {
		now: '2026-08-22T15:01:00.000Z',
	});
	assert.equal(undone.present.ofxEffects[0]!.enabled, true);
	assert.equal(revision(undone.present), revision(executed.present) + 1);
	const redone = redoFramescaperProjectCommandV26(PROFILE, undone, {
		now: '2026-08-22T15:02:00.000Z',
	});
	assert.equal(redone.present.ofxEffects[0]!.enabled, false);
	assert.equal(revision(redone.present), revision(undone.present) + 1);
	assert.equal(validateFramescaperProjectHistoryV26(PROFILE, redone), true);
});

test('V26 OpenFX commands enforce instance identity and project-wide collision rules', () => {
	const project = ofxProject();
	const expectedEffect = project.ofxEffects[0]!;
	assert.throws(() => snapshotFramescaperProjectCommandV26({
		type: 'openfx-effect/set', instanceId: expectedEffect.instanceId, expectedEffect,
		effect: { ...expectedEffect, instanceId: 'different-instance' },
	}), /identity/iu);
	const colliding = { ...expectedEffect, instanceId: 'video-source' };
	assert.throws(() => applyFramescaperProjectCommandV26(PROFILE, project, {
		type: 'openfx-effect/set', instanceId: 'video-source', expectedEffect: null,
		effect: colliding,
	}), /collid|identity|duplicate/iu);
	const removed = applyFramescaperProjectCommandV26(PROFILE, project, {
		type: 'openfx-effect/set', instanceId: expectedEffect.instanceId,
		expectedEffect, effect: null,
	});
	assert.deepEqual(removed.ofxEffects, []);
	const requirements = removed.featureRequirements as Readonly<{
		readonly requirements: readonly Readonly<{ readonly id: string }>[];
	}>;
	assert.equal(requirements.requirements.some(
		({ id }) => id === 'framescaper.openfx-effects',
	), false);
});

test('V26 history dispatches inherited commands without dropping fingerprint-bound effects', () => {
	const project = ofxProject();
	const executed = executeFramescaperProjectCommandV26(
		PROFILE,
		createFramescaperProjectHistoryV26(PROFILE, project),
		{ type: 'project/rename', title: 'Inherited rename' },
	);
	assert.equal(executed.present.title, 'Inherited rename');
	assert.deepEqual(executed.present.ofxEffects, project.ofxEffects);
	const undone = undoFramescaperProjectCommandV26(PROFILE, executed);
	assert.equal(undone.present.title, project.title);
	assert.deepEqual(undone.present.ofxEffects, project.ofxEffects);
});

function ofxProject(): FramescaperProjectV26 {
	return createFramescaperProjectV26(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { presets: [{
			schemaVersion: 1, kind: 'video-preset', id: 'visual-preset', name: 'Preset',
			modelKind: 'generator', authoredStateSha256: SHA_A,
		}] },
		ofxEffects: [effectFixture()],
	});
}

function effectFixture(): OfxEffectStateV26 {
	return {
		schemaVersion: 1,
		instanceId: 'ofx-instance-1',
		pluginId: 'net.example.Blur',
		binarySha256: SHA_A,
		context: 'filter',
		attachment: { kind: 'filter', targetId: 'video-clip' },
		inputs: [{ name: 'Source', sourceRef: 'video-source' }],
		parameters: [{ name: 'radius', type: 'double', value: [2], keyframes: [] }],
		customEncodings: {},
		enabled: true,
		freshness: {
			authoredStateSha256: SHA_A,
			inputIdentitiesSha256: SHA_B,
			renderPlanFingerprintSha256: SHA_C,
			nativeEffectFingerprintSha256: SHA_D,
		},
		frozenFallback: null,
	};
}

function revision(project: FramescaperProjectV26): number {
	return Number(project.revision);
}
