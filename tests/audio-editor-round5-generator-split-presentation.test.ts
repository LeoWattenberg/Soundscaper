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
import { createSplitVisualPresentationPlanner } from '../src/framescaper/editor-split-visual-presentations.ts';

for (const kind of ['video-title', 'video-noise'] as const) for (const styled of [true, false]) test(`public ${kind} Split ${styled ? 'retains authored' : 'preserves absent'} clip presentation in one Undo`, async context => {
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
	const owner = before.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(original.id));
	assert.ok(owner);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.edit.splitAt(96_000, [owner.id]);
	const after = environment.runtime.cloneProject(controller.project);
	const clips = (after.clips as readonly Readonly<Record<string, unknown>>[]).map(normalizeVideoGeneratorClipV1);
	assert.equal(clips.length, 2);
	const presentations = (after.videoVisualPresentations as readonly unknown[]).map(normalizeVideoVisualPresentationV1);
	assert.equal(presentations.length, styled ? 2 : 0);
	if (styled) {
		const originalPresentation = normalizeVideoVisualPresentationV1((before.videoVisualPresentations as readonly unknown[])[0]);
		for (const clip of clips) {
			const presentation = presentations.find(row => row.owner.kind === 'clip' && row.owner.id === clip.id);
			assert.ok(presentation);
			assert.deepEqual(presentation, { ...originalPresentation, id: presentation.id, owner: { kind: 'clip', id: clip.id } });
			if (clip.id === original.id) assert.equal(presentation.id, originalPresentation.id);
			else assert.notEqual(presentation.id, originalPresentation.id);
		}
		assert.equal(new Set(presentations.map(row => row.id)).size, 2);
	}
	assert.deepEqual(after.sources, before.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.videoVisualPresentations, before.videoVisualPresentations);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.videoVisualPresentations, after.videoVisualPresentations);
});

test('split presentation preparation follows ordered edits and consecutive right-hand splits', () => {
	const original = normalizeVideoVisualPresentationV1({ schemaVersion: 1, id: 'original-style',
		owner: { kind: 'clip', id: 'title' }, enabled: true, opacity: 0.25, blendMode: 'screen',
		grade: null, processorStackId: null, maskMatteIds: [] });
	const sourceStyle = normalizeVideoVisualPresentationV1({ ...original, id: 'source-style',
		owner: { kind: 'generator', id: 'title-source' } });
	const planner = createSplitVisualPresentationPlanner([original, sourceStyle]);
	planner.observe({ type: 'video-visual-presentation/set', presentationId: original.id,
		expectedPresentation: original, presentation: { ...original, opacity: 0.5 } });
	const first = planner.copy('title', 'right');
	assert.equal(first.length, 1);
	assert.equal(first[0]?.presentation?.opacity, 0.5);
	assert.deepEqual(first[0]?.presentation?.owner, { kind: 'clip', id: 'right' });
	const second = planner.copy('right', 'last');
	assert.equal(second.length, 1);
	assert.equal(second[0]?.presentation?.opacity, 0.5);
	assert.notEqual(second[0]?.presentationId, first[0]?.presentationId);
	assert.deepEqual(second[0]?.presentation?.owner, { kind: 'clip', id: 'last' });
	planner.observe({ type: 'video-visual-presentation/set', presentationId: original.id,
		expectedPresentation: original, presentation: null });
	assert.deepEqual(planner.copy('title', 'unstyled'), []);
	assert.deepEqual(original.owner, { kind: 'clip', id: 'title' });
	assert.equal(original.opacity, 0.25);
});
