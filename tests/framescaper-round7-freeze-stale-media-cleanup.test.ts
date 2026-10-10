/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperSelectedVisualAuthoringRuntimeFor } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { bindFramescaperSelectedFreezeCaptureFinishing } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(complete => { resolve = complete; });
	return { promise, resolve };
}

test('a normally completed Freeze retains its media, but stale capture releases its unpublished media', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const project = createFramescaperProject(PROFILE, framescaperBaselineOptions());
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	await controller.actions.project.openById(project.id);
	const runtime = framescaperSelectedVisualAuthoringRuntimeFor(controller);
	assert.ok(runtime);
	const captureStarted = deferred();
	const captureRelease = deferred();
	let holdCapture = false;
	const unbind = bindFramescaperSelectedFreezeCaptureFinishing(controller, { capture: async () => {
		if (holdCapture) { captureStarted.resolve(); await captureRelease.promise; }
		return { blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), width: 64, height: 36 };
	} });
	context.after(unbind);
	const writes: string[] = [];
	const writeMedia = environment.store.writeMediaAsset.bind(environment.store);
	environment.store.writeMediaAsset = async (sourceId, input, metadata, options) => {
		const result = await writeMedia(sourceId, input, metadata, options);
		writes.push(sourceId);
		return result;
	};
	const freeze = () => {
		const model = createFramescaperSelectedVisualAuthoringModelFinishing({ surface: 'video-freeze',
			project: controller.project, selectedClipId: 'video-clip', playheadSample: 7_200 });
		return runtime.run('video-freeze', { fence: model.fence, clipId: 'video-clip', operation: 'create',
			playheadSample: 7_200, durationFrames: 5 });
	};
	controller.actions.timeline.selectClip('video-clip');
	controller.actions.transport.seek(7_200);
	await freeze();
	assert.equal(writes.length, 1);
	assert.ok(await environment.store.loadMediaAsset(writes[0]!), 'a successful Freeze owns its saved PNG');
	controller.actions.edit.undo();
	controller.actions.timeline.selectClip('video-clip');
	controller.actions.transport.seek(7_200);
	holdCapture = true;
	const refusal = assert.rejects(freeze(), /playhead is stale/u);
	await captureStarted.promise;
	// The menu-opened dialog allows Close during encoding, then the surviving
	// transport admits an ordinary playhead change before the capture completes.
	controller.actions.transport.seek(8_000);
	captureRelease.resolve();
	await refusal;
	assert.equal(writes.length, 2, 'the real media repository completed the stale PNG write');
	assert.equal(await environment.store.loadMediaAsset(writes[1]!), null,
		'the refused Freeze must release its unpublished stored PNG');
	assert.ok(await environment.store.loadMediaAsset(writes[0]!), 'the healthy undoable Freeze retains its media');
});
