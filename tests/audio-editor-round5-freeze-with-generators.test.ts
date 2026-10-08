/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { cloneFramescaperProject, createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { framescaperSelectedVisualAuthoringRuntimeFor } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { bindFramescaperSelectedFreezeCaptureFinishing } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import type { FramescaperSelectedFreezeCaptureRequestFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const bystander of [null, 'video-title', 'video-solid'] as const) {
	test(`Freeze resolves the camera's exact ordinal with ${bystander ?? 'no generator'} and survives a second still`, async context => {
		const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
			storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
				persisted: async () => true, persist: async () => true } as unknown as StorageManager,
		} });
		const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, framescaperBaselineOptions());
		assert.ok(await environment.createProjectIfAbsent(project));
		const controller = createFramescaperAudioEditorController(environment);
		context.after(async () => { await controller.dispose(); await environment.close(); });
		await controller.ready;
		await controller.actions.project.openById(project.id);
		const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
		const library = framescaperSelectedVisualAuthoringRuntimeFor(controller);
		assert.ok(authoring && library);
		if (bystander) await authoring.run(bystander);
		const captures: FramescaperSelectedFreezeCaptureRequestFinishing[] = [];
		const unbind = bindFramescaperSelectedFreezeCaptureFinishing(controller, { capture: async request => {
			captures.push(request);
			return { blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), width: 64, height: 36 };
		} });
		context.after(unbind);
		for (let index = 0; index < 2; index += 1) {
			controller.actions.timeline.selectClip('video-clip');
			controller.actions.transport.seek(7_200);
			assert.equal(controller.getTelemetrySnapshot().positionFrame, 7_200);
			const before = snapshot(controller.project);
			const history = controller.getSnapshot().history.undoEntries.length;
			const model = createFramescaperSelectedVisualAuthoringModelFinishing({ surface: 'video-freeze',
				project: controller.project, selectedClipId: 'video-clip', playheadSample: 7_200 });
			await library.run('video-freeze', { fence: model.fence, clipId: 'video-clip', operation: 'create',
				playheadSample: 7_200, durationFrames: 5 });
			const after = snapshot(controller.project);
			assert.deepEqual(captures[index], { projectId: before.id, projectRevision: before.revision,
				timelineSample: 7_200, clipId: 'video-clip', sourceId: 'video-source', sourceOrdinal: 1 });
			assert.deepEqual(after.clips.filter(clip => clip.kind !== 'still'), before.clips.filter(clip => clip.kind !== 'still'));
			assert.deepEqual(after.sources.filter(source => source.kind !== 'still'), before.sources.filter(source => source.kind !== 'still'));
			const stills = after.clips.filter(clip => clip.kind === 'still');
			assert.equal(stills.length, index + 1);
			assert.equal(stills.at(-1)?.sequenceStartFrame, 1, 'the containing frame anchors the still');
			assert.equal(stills.at(-1)?.sequenceFrameCount, 5);
			assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
			controller.actions.edit.undo();
			assert.deepEqual(controller.project?.clips, before.clips);
			assert.deepEqual(controller.project?.sources, before.sources);
			controller.actions.edit.redo();
			assert.deepEqual(controller.project?.clips, after.clips);
			assert.deepEqual(controller.project?.sources, after.sources);
		}
	});
}

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
