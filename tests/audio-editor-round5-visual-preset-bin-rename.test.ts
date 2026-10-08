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

test('renaming a saved generator model preserves its exact preset binding in one Undo and Redo', async context => {
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
	await authoring.run('video-title');
	const clip = normalizeVideoGeneratorClipV1(controller.project?.clips.at(-1));
	controller.actions.timeline.selectClip(clip.id);
	const updateTitle = (text: string, fontSize: number, color: string): void => {
		const model = createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: clip.id });
		assert.ok(model.generator?.kind === 'title');
		controller.actions.edit.commit(createFramescaperVisualInspectorCommand(controller.project, clip.id, {
			generator: { ...model.generator, text, fontSize, color }, opacity: model.opacity,
			blendMode: model.blendMode, maskId: model.maskId, maskWidth: model.maskWidth, presetId: null,
		}) as AudioEditorCommand);
	};
	const runPreset = async (operation: 'save-visual' | 'apply-visual', values: Readonly<Record<string, unknown>>): Promise<void> => {
		const model = createFramescaperSelectedVisualAuthoringModelFinishing({ surface: 'video-visual-preset',
			project: controller.project, selectedClipId: clip.id, playheadSample: 0 });
		await library.run('video-visual-preset', { fence: model.fence, clipId: clip.id, operation, ...values });
	};
	updateTitle('Saved title', 40, '#ff0000ff');
	await runPreset('save-visual', { name: 'Saved title' });
	const selectedPreset = presets(controller.project?.videoVisualPresets)[0]!;
	const donorClip = normalizeVideoGeneratorClipV1(controller.project?.projectBin.clips.at(-1));
	const originalDonor = normalizeVideoGeneratorSourceV1(controller.project?.sources.find(source => source.id === donorClip.sourceId));
	await runPreset('save-visual', { name: 'Unrelated preset' });
	updateTitle('Changed title', 72, '#00ff00ff');
	const before = environment.runtime.cloneProject(controller.project);
	const history = controller.getSnapshot().history.undoEntries.length;
	assert.equal(controller.actions.projectBin.rename(donorClip.id, 'Renamed preset model'), 'Renamed preset model');
	const after = environment.runtime.cloneProject(controller.project);
	const renamed = normalizeVideoGeneratorSourceV1(after.sources.find(source => source.id === donorClip.sourceId));
	assert.deepEqual(renamed, { ...originalDonor, name: 'Renamed preset model' });
	const bound = presets(after.videoVisualPresets).find(preset => preset.id === selectedPreset.id);
	assert.ok(bound);
	assert.equal(bound.authoredStateSha256, fingerprintNativeMediaPlan(renamed).sha256, 'preset stays bound to the exact renamed source');
	assert.deepEqual(presets(after.videoVisualPresets).filter(preset => preset.id !== selectedPreset.id),
		presets(before.videoVisualPresets).filter(preset => preset.id !== selectedPreset.id));
	assert.deepEqual(after.projectBin, before.projectBin);
	assert.deepEqual(after.clips, before.clips);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.sources, before.sources);
	assert.deepEqual(controller.project?.videoVisualPresets, before.videoVisualPresets);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.sources, after.sources);
	assert.deepEqual(controller.project?.videoVisualPresets, after.videoVisualPresets);
	const changedGenerator = createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: clip.id }).generator;
	const beforeApplyHistory = controller.getSnapshot().history.undoEntries.length;
	await runPreset('apply-visual', { presetId: selectedPreset.id });
	const restored = createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: clip.id });
	assert.deepEqual(restored.generator, originalDonor.generator, 'saved text, font, color and alignment survive the Bin rename');
	assert.equal(controller.getSnapshot().history.undoEntries.length, beforeApplyHistory + 1);
	controller.actions.edit.undo();
	assert.deepEqual(createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: clip.id }).generator, changedGenerator);
	controller.actions.edit.redo();
	assert.deepEqual(createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: clip.id }).generator, originalDonor.generator);
});

function presets(value: unknown) {
	assert.ok(Array.isArray(value));
	return value.map(normalizeVideoVisualPresetV1);
}
