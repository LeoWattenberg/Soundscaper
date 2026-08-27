/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import {
	createFramescaperDormantCandidateController,
} from '../src/framescaper/editor-dormant-candidate-controller.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import { createFramescaperProjectV25 } from '../src/framescaper/editor-project-v25.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('a dormant menu authoring result commits through candidate history and CAS storage', async () => {
	const project = createFramescaperProjectV25(FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, {
		...framescaperV20Options(), id: 'dormant-authoring-commit',
		videoTransitionsByTrackId: { 'video-track': [] },
	});
	const controller = await createFramescaperDormantCandidateController({
		generation: 25,
		project,
		storeOptions: { indexedDB: null },
		authoring: {
			open: (surface) => surface === 'video-adjustment-layer' ? {
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
			} : null,
		},
		native: nativeOptions(),
	});
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(runtime);
	await runtime.run('video-adjustment-layer');
	const saved = await controller.project();
	assert.equal(Number(saved.revision), Number(project.revision) + 1);
	assert.deepEqual(
		(saved.videoAdjustmentLayers as readonly Readonly<{ id: string }>[]).map(({ id }) => id),
		['adjustment-1'],
	);
	await controller.close();
});

function nativeOptions() {
	return {
		imageSequenceSelection: {
			bridge: {
				selectImageSequence: async () => null,
				readImageSequenceFile: async () => new Uint8Array(),
				releaseImageSequence: async () => true,
			},
			describe: () => null,
		},
		intents: {
			renderQueueEnqueue: () => null,
			proxyGenerate: () => null,
			proxyAttach: () => null,
			proxyDetach: () => null,
			proxyRelink: () => null,
		},
		imageSequence: {
			capabilities: () => createNativeMediaCapabilitySnapshotV1({
				masterEnabled: false,
				entries: [],
			}),
			createSourcePackWriter: () => ({
				write: () => undefined,
				commit: () => undefined,
				discard: () => undefined,
			}),
			publishInventory: () => undefined,
			cleanupInventory: () => undefined,
			admit: () => { throw new Error('No selection should reach admission.'); },
		},
		nativeServices: { enqueue: async () => ({}) },
		proxy: {
			enqueueProxy: () => 'proxy-job',
			reattestAttachment: () => true,
			cleanupBody: () => undefined,
		},
	};
}
