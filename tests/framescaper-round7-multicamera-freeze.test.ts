/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { cloneFramescaperProject, createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperMulticameraMenuItems } from '../src/common/editor/ui/framescaper-multicamera-menu.ts';
import { framescaperSelectedVisualAuthoringRuntimeFor } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { bindFramescaperSelectedFreezeCaptureFinishing } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import type { FramescaperSelectedFreezeCaptureRequestFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('Freeze captures the switched multicamera picture after the ordinary camera control', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const options = framescaperBaselineOptions();
	const sources = records(options.sources);
	const camera = sources.find(source => source.id === 'video-source');
	assert.ok(camera);
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { ...options,
		sources: [...sources, { ...camera, id: 'alternate-camera', name: 'Alternate camera',
			storageKey: 'alternate-camera', contentSha256: '34'.repeat(32) }],
		projectBin: { clips: [...records((options.projectBin as Readonly<Record<string, unknown>>).clips),
			{ ...records(options.clips).find(clip => clip.id === 'video-clip'), id: 'alternate-bin',
				sourceId: 'alternate-camera', title: 'Alternate camera', binItemId: 'alternate-bin' }] },
	});
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	await controller.actions.project.openById(project.id);
	const library = framescaperSelectedVisualAuthoringRuntimeFor(controller);
	assert.ok(library);
	const captures: FramescaperSelectedFreezeCaptureRequestFinishing[] = [];
	const unbind = bindFramescaperSelectedFreezeCaptureFinishing(controller, { capture: async request => {
		captures.push(request);
		return { blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), width: 64, height: 36 };
	} });
	context.after(unbind);
	controller.actions.timeline.selectClip('video-clip');
	controller.actions.transport.seek(7_200);
	const freeze = async () => {
		const model = createFramescaperSelectedVisualAuthoringModelFinishing({ surface: 'video-freeze',
			project: controller.project, selectedClipId: 'video-clip', playheadSample: 7_200 });
		await library.run('video-freeze', { fence: model.fence, clipId: 'video-clip', operation: 'create',
			playheadSample: 7_200, durationFrames: 5 });
	};
	await freeze();
	assert.equal(captures[0]?.sourceId, 'video-source');
	assert.equal(captures[0]?.sourceOrdinal, 1);
	controller.actions.edit.undo();
	const menu = () => createFramescaperMulticameraMenuItems({ productId: 'framescaper',
		project: controller.project, editingBlocked: false, copy: {
			multicamera: 'Multicamera', createMulticamera: 'Create from video sources', switchMulticamera: 'Switch camera',
			nudgeMulticameraEarlier: 'Earlier', nudgeMulticameraLater: 'Later', removeMulticamera: 'Remove',
		} }, { execute: command => controller.actions.edit.commit(command) });
	await menu()?.items.find(item => item.id === 'multicamera-create')?.onClick();
	await menu()?.items.find(item => item.id === 'multicamera-switch')?.onClick();
	const before = snapshot(controller.project);
	const history = controller.getSnapshot().history.undoEntries.length;
	await freeze();
	assert.equal(captures[1]?.sourceId, 'alternate-camera', 'the exact capture follows the camera displayed after Switch');
	assert.equal(captures[1]?.sourceOrdinal, 1);
	const after = snapshot(controller.project);
	assert.equal(after.sources.find(source => source.kind === 'still')?.name, 'Alternate camera Freeze');
	assert.deepEqual(after.clips.filter(clip => clip.kind !== 'still'), before.clips);
	assert.deepEqual(after.sources.filter(source => source.kind !== 'still'), before.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.sources, before.sources);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.sources, after.sources);
});

function snapshot(project: unknown) {
	const value = cloneFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project);
	return { ...value, clips: records(value.clips), sources: records(value.sources) };
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	assert.ok(Array.isArray(value));
	return value.map((row: unknown) => {
		assert.ok(row !== null && typeof row === 'object' && !Array.isArray(row));
		return row as Readonly<Record<string, unknown>>;
	});
}
