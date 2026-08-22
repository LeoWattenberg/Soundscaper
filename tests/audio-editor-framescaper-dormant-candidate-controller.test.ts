/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { framescaperNativeProjectActionRuntimeFor } from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	createFramescaperDormantCandidateController,
} from '../src/framescaper/editor-dormant-candidate-controller.ts';
import { createFramescaperProjectV25 } from '../src/framescaper/editor-project-v25.ts';
import { createFramescaperProjectV26 } from '../src/framescaper/editor-project-v26.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('the dormant V26 composition binds candidate menus and pathless native actions to one controller', async () => {
	const project = createFramescaperProjectV26(FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE, {
		...framescaperV20Options(), id: 'dormant-v26-controller',
		videoTransitionsByTrackId: { 'video-track': [] }, ofxEffects: [],
	});
	const opened: unknown[][] = [];
	let selected = 0;
	const controller = await createFramescaperDormantCandidateController({
		generation: 26, project, storeOptions: { indexedDB: null },
		authoring: { open: (surface, current) => { opened.push([surface, current.schemaVersion]); } },
		native: {
			imageSequenceSelection: {
				bridge: {
					selectImageSequence: async () => { selected += 1; return null; },
					readImageSequenceFile: async () => new Uint8Array(),
					releaseImageSequence: async () => true,
				},
				describe: () => ({ sourceId: 'sequence-source', projectBinClipId: 'sequence-bin',
					name: 'Sequence', frameRate: { num: 24, den: 1 } }),
			},
			intents: {
				renderQueueEnqueue: () => null, proxyGenerate: () => null, proxyAttach: () => null,
				proxyDetach: () => null, proxyRelink: () => null, ofFxAdd: () => null,
			},
			imageSequence: imageSequencePorts(),
			nativeServices: { enqueue: async () => ({}) },
			proxy: { enqueueProxy: () => 'proxy-job', reattestAttachment: () => true,
				cleanupBody: () => undefined },
		},
	});
	assert.equal(controller.status, 'dormant-candidate');
	assert.equal((await controller.project()).schemaVersion, 26);
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(authoring);
	assert.equal(authoring.surfaces.includes('video-freeze'), true);
	await authoring.run('video-title');
	assert.deepEqual(opened, [['video-title', 26]]);
	const native = framescaperNativeProjectActionRuntimeFor(controller);
	assert.ok(native);
	assert.equal(native.surfaces.includes('ofx-add'), true);
	await native.run('image-sequence-import');
	assert.equal(selected, 1);
});

test('the V25 composition omits OpenFX and refuses a mismatched project generation', async () => {
	const project = createFramescaperProjectV25(FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, {
		...framescaperV20Options(), id: 'dormant-v25-controller',
		videoTransitionsByTrackId: { 'video-track': [] },
	});
	const controller = await createFramescaperDormantCandidateController({
		generation: 25, project, storeOptions: { indexedDB: null },
		authoring: { open: () => undefined },
		native: nativeOptionsWithoutOfx(),
	});
	assert.equal(framescaperNativeProjectActionRuntimeFor(controller)?.surfaces.includes('ofx-add'), false);
	await assert.rejects(() => createFramescaperDormantCandidateController({
		generation: 26, project: project as never, storeOptions: { indexedDB: null },
		authoring: { open: () => undefined },
		native: { ...nativeOptionsWithoutOfx(), intents: {
			...nativeOptionsWithoutOfx().intents, ofFxAdd: () => null,
		} },
	}), /V26.*project|schema 26|generation/iu);
});

function nativeOptionsWithoutOfx() {
	return {
		imageSequenceSelection: {
			bridge: { selectImageSequence: async () => null,
				readImageSequenceFile: async () => new Uint8Array(), releaseImageSequence: async () => true },
			describe: () => null,
		},
		intents: {
			renderQueueEnqueue: () => null, proxyGenerate: () => null, proxyAttach: () => null,
			proxyDetach: () => null, proxyRelink: () => null,
		},
		imageSequence: imageSequencePorts(),
		nativeServices: { enqueue: async () => ({}) },
		proxy: { enqueueProxy: () => 'proxy-job', reattestAttachment: () => true,
			cleanupBody: () => undefined },
	};
}

function imageSequencePorts() {
	return {
		capabilities: () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true,
			entries: [
				{ domain: 'operation' as const, id: 'image-sequence-import' },
				{ domain: 'queue' as const, id: 'persistent-render-queue' },
				{ domain: 'codec' as const, id: 'encode-mov-prores-proxy' },
				{ domain: 'ofx' as const, id: 'isolated-host' },
			].map((entry) => ({ ...entry, policyCleared: true, buildSupported: true,
				probeSucceeded: true, selfTestPassed: true, userEnabled: true })),
		}),
		clearedPolicyRowIds: () => ['codec-image-sequence-still-formats'],
		createSourcePackWriter: () => ({ write: () => undefined, commit: () => undefined,
			discard: () => undefined }),
		publishInventory: () => undefined, cleanupInventory: () => undefined,
		admit: () => { throw new Error('null selection must not admit'); },
	};
}
