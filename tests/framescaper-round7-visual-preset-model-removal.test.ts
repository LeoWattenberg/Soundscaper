/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { normalizeVideoVisualPresetV1 } from '../src/common/editor/video-visual-preset-v24.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { createFramescaperVisualInspectorCommand, createFramescaperVisualInspectorModel } from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { framescaperSelectedVisualAuthoringRuntimeFor } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('removing a saved generator model from the Bin preserves the independently saved preset and history', async context => {
	const { controller, environment, authoring, library } = await setup(context);
	await authoring.run('video-title');
	const clip = normalizeVideoGeneratorClipV1(controller.project?.clips.at(-1));
	controller.actions.timeline.selectClip(clip.id);
	const updateTitle = (text: string, fontSize: number): void => {
		const model = createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: clip.id });
		assert.ok(model.generator?.kind === 'title');
		controller.actions.edit.commit(createFramescaperVisualInspectorCommand(controller.project, clip.id, {
			generator: { ...model.generator, text, fontSize }, opacity: model.opacity,
			blendMode: model.blendMode, maskId: model.maskId, maskWidth: model.maskWidth, presetId: null,
		}) as AudioEditorCommand);
	};
	const runPreset = async (operation: 'save-visual' | 'apply-visual', values: Readonly<Record<string, unknown>>): Promise<void> => {
		const model = createFramescaperSelectedVisualAuthoringModelFinishing({ surface: 'video-visual-preset',
			project: controller.project, selectedClipId: clip.id, playheadSample: 0 });
		await library.run('video-visual-preset', { fence: model.fence, clipId: clip.id, operation, ...values });
	};
	updateTitle('Saved title', 40);
	await runPreset('save-visual', { name: 'Saved title' });
	assert.ok(Array.isArray(controller.project?.videoVisualPresets));
	const preset = normalizeVideoVisualPresetV1(controller.project.videoVisualPresets[0]);
	const donorClip = normalizeVideoGeneratorClipV1(controller.project.projectBin.clips.at(-1));
	const donor = normalizeVideoGeneratorSourceV1(controller.project.sources.find(source => source.id === donorClip.sourceId));
	assert.equal(preset.authoredStateSha256, fingerprintNativeMediaPlan(donor).sha256);
	const donorInstanceId = controller.actions.projectBin.place(donorClip.id);
	assert.equal(controller.actions.projectBin.instanceCount(donorClip.id), 1);
	updateTitle('Changed title', 72);
	await runPreset('apply-visual', { presetId: preset.id });
	assert.deepEqual(createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: clip.id }).generator, donor.generator,
		'the same normally saved preset applies successfully before removal');
	controller.actions.edit.undo();
	const before = environment.runtime.cloneProject(controller.project);
	assert.equal(preset.authoredStateSha256, fingerprintNativeMediaPlan(controller.project?.sources.find(source => source.id === donor.id)).sha256);
	const history = controller.getSnapshot().history.undoEntries.length;
	assert.deepEqual(new Set(controller.actions.projectBin.removeFromProject(donorClip.id)), new Set([donorClip.id, donorInstanceId]));
	assert.equal(controller.project?.projectBin.clips.some(item => item.id === donorClip.id), false);
	assert.equal(controller.project?.clips.some(item => item.id === donorInstanceId), false);
	assert.deepEqual(controller.project?.videoVisualPresets, before.videoVisualPresets);
	assert.deepEqual(controller.project?.sources.find(source => source.id === donor.id), donor,
		'the saved preset retains its exact model after its Bin card is removed');
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.sources, before.sources);
	assert.deepEqual(controller.project?.projectBin, before.projectBin);
	controller.actions.edit.redo();
	assert.equal(controller.project?.projectBin.clips.some(item => item.id === donorClip.id), false);
	controller.actions.timeline.selectClip(clip.id);
	await runPreset('apply-visual', { presetId: preset.id });
	assert.deepEqual(createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: clip.id }).generator, donor.generator);
});

test('removing an ordinary generator with no saved preset still removes its source', async context => {
	const { controller, authoring } = await setup(context);
	await authoring.run('video-solid');
	const clip = normalizeVideoGeneratorClipV1(controller.project?.clips.at(-1));
	assert.deepEqual(controller.actions.projectBin.moveFromTimeline(clip.id), [clip.id]);
	assert.deepEqual(controller.actions.projectBin.removeFromProject(clip.id), [clip.id]);
	assert.equal(controller.project?.sources.some(source => source.id === clip.sourceId), false);
	assert.equal(controller.project?.projectBin.clips.some(item => item.id === clip.id), false);
	controller.actions.edit.undo();
	assert.equal(controller.project?.sources.some(source => source.id === clip.sourceId), true);
	assert.equal(controller.project?.projectBin.clips.some(item => item.id === clip.id), true);
});

async function setup(context: test.TestContext) {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
	const library = framescaperSelectedVisualAuthoringRuntimeFor(controller);
	assert.ok(authoring && library);
	return { controller, environment, authoring, library };
}
