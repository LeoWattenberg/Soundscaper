/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { framescaperNativeProjectActionRuntimeFor } from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import { createFramescaperDormantCandidateController } from '../src/framescaper/editor-dormant-candidate-controller.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v22.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import { createFramescaperProjectV22 } from '../src/framescaper/editor-project-v22.ts';
import { createFramescaperProjectV24 } from '../src/framescaper/editor-project-v24.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('V22 and V24 prerequisite candidates bind only their cumulative authoring surfaces', async () => {
	const v22 = await createFramescaperDormantCandidateController({
		generation: 22,
		project: createFramescaperProjectV22(FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, {
			...framescaperV20Options(), id: 'dormant-v22-prerequisite',
			videoTransitionsByTrackId: { 'video-track': [] },
		}),
		storeOptions: { indexedDB: null },
		authoring: { open: () => undefined },
	});
	const transitionRuntime = framescaperCandidateAuthoringActionRuntimeFor(v22);
	assert.ok(transitionRuntime);
	assert.deepEqual(transitionRuntime.surfaces, [
		'video-transition', 'video-transition-dissolve',
	]);
	assert.equal(framescaperNativeProjectActionRuntimeFor(v22), null);
	await transitionRuntime.run('video-transition');
	assert.equal((await v22.project()).revision, 0);
	await v22.close();

	const v24 = await createFramescaperDormantCandidateController({
		generation: 24,
		project: createFramescaperProjectV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, {
			...framescaperV20Options(), id: 'dormant-v24-prerequisite',
			videoTransitionsByTrackId: { 'video-track': [] },
		}),
		storeOptions: { indexedDB: null },
		authoring: {
			open: (surface) => surface === 'video-adjustment-layer'
				? adjustmentCommand() : undefined,
		},
	});
	const visualRuntime = framescaperCandidateAuthoringActionRuntimeFor(v24);
	assert.ok(visualRuntime);
	assert.equal(visualRuntime.surfaces.includes('video-transition'), true);
	assert.equal(visualRuntime.surfaces.includes('video-freeze'), true);
	assert.equal(framescaperNativeProjectActionRuntimeFor(v24), null);
	await visualRuntime.run('video-adjustment-layer');
	assert.deepEqual(adjustmentLayerIds(await v24.project()), ['adjustment-1']);
	assert.equal(await v24.undoAuthoring(), true);
	assert.deepEqual(adjustmentLayerIds(await v24.project()), []);
	await v24.close();
});

function adjustmentLayerIds(project: Readonly<Record<string, unknown>>): readonly string[] {
	return Array.from(
		project.videoAdjustmentLayers as readonly Readonly<{ id: string }>[],
		({ id }) => id,
	);
}

function adjustmentCommand() {
	return {
		type: 'video-adjustment-layer/set',
		adjustmentLayerId: 'adjustment-1',
		expectedAdjustmentLayer: null,
		adjustmentLayer: {
			schemaVersion: 1,
			kind: 'adjustment-layer',
			id: 'adjustment-1',
			sequenceId: 'main-sequence',
			sequenceStartFrame: 0,
			sequenceFrameCount: 10,
			targetTrackIds: ['video-track'],
			effectIds: [],
		},
	};
}
