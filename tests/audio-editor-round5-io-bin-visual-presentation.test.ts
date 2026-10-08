/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { normalizeVideoVisualPresentationV1 } from '../src/common/editor/video-visual-presentation-v27.ts';
import { createFramescaperVisualInspectorCommand, createFramescaperVisualInspectorModel } from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const kind of ['video-title', 'video-noise'] as const) for (const styled of [true, false]) {
	test(`public ${kind} Bin placement ${styled ? 'copies authored' : 'preserves absent'} presentation atomically`, async context => {
		const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
			storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
				persisted: async () => true, persist: async () => true } as unknown as StorageManager,
		} });
		const controller = createFramescaperAudioEditorController(environment);
		context.after(async () => { await controller.dispose(); await environment.close(); });
		await controller.ready;
		const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
		assert.ok(authoring);
		await authoring.run(kind);
		const original = normalizeVideoGeneratorClipV1(controller.project?.clips.at(-1));
		controller.actions.timeline.selectClip(original.id);
		if (styled) {
			const model = createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: original.id });
			controller.actions.edit.commit(createFramescaperVisualInspectorCommand(controller.project, original.id, {
				generator: model.generator, opacity: 0.25, blendMode: 'screen', maskId: model.maskId,
				maskWidth: model.maskWidth, presetId: null,
			}) as AudioEditorCommand);
		}
		const before = environment.runtime.cloneProject(controller.project);
		assert.deepEqual(controller.actions.projectBin.moveFromTimeline(original.id), [original.id]);
		const binned = environment.runtime.cloneProject(controller.project);
		assert.equal(binned.clips.length, 0);
		assert.deepEqual(binned.videoVisualPresentations, before.videoVisualPresentations);
		const historyCount = controller.getSnapshot().history.undoEntries.length;
		const placedId = controller.actions.projectBin.place(original.id);
		assert.equal(typeof placedId, 'string');
		const after = environment.runtime.cloneProject(controller.project);
		const placed = after.clips.find(clip => clip.id === placedId);
		assert.ok(placed);
		assert.equal(placed.sourceId, original.sourceId);
		assert.equal(placed.sequenceFrameCount, original.sequenceFrameCount);
		const presentations = (after.videoVisualPresentations as readonly unknown[]).map(normalizeVideoVisualPresentationV1);
		assert.equal(presentations.length, styled ? 2 : 0);
		if (styled) {
			const sourceStyle = normalizeVideoVisualPresentationV1((before.videoVisualPresentations as readonly unknown[])[0]);
			const copied = presentations.find(row => row.owner.kind === 'clip' && row.owner.id === placedId);
			assert.ok(copied);
			assert.notEqual(copied.id, sourceStyle.id);
			assert.deepEqual(copied, { ...sourceStyle, id: copied.id, owner: { kind: 'clip', id: placedId } });
			assert.deepEqual(presentations.find(row => row.id === sourceStyle.id), sourceStyle);
		}
		assert.deepEqual(after.sources, before.sources);
		assert.deepEqual(after.projectBin, binned.projectBin);
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.project?.clips, binned.clips);
		assert.deepEqual(controller.project?.videoVisualPresentations, binned.videoVisualPresentations);
		controller.actions.edit.redo();
		assert.deepEqual(controller.project?.clips, after.clips);
		assert.deepEqual(controller.project?.videoVisualPresentations, after.videoVisualPresentations);
		const secondId = controller.actions.projectBin.place(original.id);
		assert.notEqual(secondId, placedId);
		const finalPresentations = (controller.project?.videoVisualPresentations as readonly unknown[]).map(normalizeVideoVisualPresentationV1);
		assert.equal(finalPresentations.length, styled ? 3 : 0);
		if (styled) {
			assert.equal(new Set(finalPresentations.map(row => row.id)).size, 3);
			assert.equal(finalPresentations.find(row => row.owner.kind === 'clip' && row.owner.id === secondId)?.opacity, 0.25);
		}
	});
}
