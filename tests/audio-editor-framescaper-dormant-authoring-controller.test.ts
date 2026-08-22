/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperDormantCandidateAuthoringController,
} from '../src/framescaper/editor-dormant-candidate-authoring-controller.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import { createFramescaperProjectStoreV25 } from '../src/framescaper/editor-project-store-v25.ts';
import { createFramescaperProjectV25, type FramescaperProjectV25 } from '../src/framescaper/editor-project-v25.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('candidate authoring applies, undoes, and redoes a menu-owned command through CAS storage', async () => {
	const profile = FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE;
	const store = createFramescaperProjectStoreV25(profile, { indexedDB: null });
	await store.ready();
	const project = createFramescaperProjectV25(profile, {
		...framescaperV20Options(), id: 'candidate-authoring-history',
		videoTransitionsByTrackId: { 'video-track': [] },
	});
	await store.projectRepository.createIfAbsent!(project);
	let command: unknown = adjustmentCommand();
	const controller = createFramescaperDormantCandidateAuthoringController({
		generation: 25,
		profile,
		repository: store.projectRepository,
		project,
		port: { open: () => command },
		now: () => '2026-08-22T20:00:00.000Z',
	});

	await controller.runtime.run('video-adjustment-layer');
	assert.deepEqual((await saved()).videoAdjustmentLayers.map(({ id }) => id), ['adjustment-1']);
	assert.equal(await controller.undo(), true);
	assert.deepEqual((await saved()).videoAdjustmentLayers, []);
	assert.equal(await controller.redo(), true);
	assert.deepEqual((await saved()).videoAdjustmentLayers.map(({ id }) => id), ['adjustment-1']);

	command = adjustmentCommand('adjustment-2');
	await assert.rejects(
		() => controller.runtime.run('video-mask-matte'),
		/another authoring surface/u,
	);
	assert.deepEqual((await saved()).videoAdjustmentLayers.map(({ id }) => id), ['adjustment-1']);
	await store.close();

	async function saved(): Promise<FramescaperProjectV25> {
		return await store.projectRepository.load(String(project.id)) as FramescaperProjectV25;
	}
});

function adjustmentCommand(id = 'adjustment-1') {
	return {
		type: 'video-adjustment-layer/set',
		adjustmentLayerId: id,
		expectedAdjustmentLayer: null,
		adjustmentLayer: {
			schemaVersion: 1,
			kind: 'adjustment-layer',
			id,
			sequenceId: 'main-sequence',
			sequenceStartFrame: 0,
			sequenceFrameCount: 10,
			targetTrackIds: ['video-track'],
			effectIds: [],
		},
	};
}
