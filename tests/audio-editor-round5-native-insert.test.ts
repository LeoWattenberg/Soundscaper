/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { normalizeFramescaperImageClipV1 } from '../src/common/editor/timeline-image-model.ts';
import { createFramescaperVisualInspectorCommand, createFramescaperVisualInspectorModel } from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const mode of ['insert', 'overwrite'] as const) for (const point of [0, 15]) {
	test(`public Bin ${mode} at sequence frame ${String(point)} preserves the Title lane and one Undo`, async context => {
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
		assert.ok(authoring);
		await authoring.run('video-title');
		const title = normalizeVideoGeneratorClipV1(controller.project?.clips.at(-1));
		assert.equal(title.sequenceStartFrame, 10);
		controller.actions.timeline.selectClip(title.id);
		const model = createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: title.id });
		controller.actions.edit.commit(createFramescaperVisualInspectorCommand(controller.project, title.id, {
			generator: model.generator, opacity: 0.25, blendMode: 'screen', maskId: model.maskId,
			maskWidth: model.maskWidth, presetId: null,
		}) as AudioEditorCommand);
		controller.actions.timeline.selectClip('video-clip');
		const before = environment.runtime.cloneProject(controller.project);
		const historyCount = controller.getSnapshot().history.undoEntries.length;
		controller.actions.video[mode]({ binItemId: 'bin-video', sequenceInFrame: point * 4_800 });
		const after = environment.runtime.cloneProject(controller.project);
		const titles = (after.clips as readonly Readonly<Record<string, unknown>>[])
			.filter(clip => clip.kind === 'generator').map(normalizeVideoGeneratorClipV1);
		assert.equal(titles.length, mode === 'insert' && point > 0 ? 2 : 1);
		if (mode === 'overwrite') assert.deepEqual(titles, [title]);
		else if (point === 0) assert.deepEqual(titles, [{ ...title, sequenceStartFrame: title.sequenceStartFrame + 10 }]);
		else {
			const left = titles.find(clip => clip.id === title.id)!;
			const right = titles.find(clip => clip.id !== title.id)!;
			assert.deepEqual(left, { ...title, sequenceFrameCount: 5, sourceFrameCount: 5 });
			assert.deepEqual(right, { ...title, id: right.id, sequenceStartFrame: 25,
				sequenceFrameCount: title.sequenceFrameCount - 5, sourceInFrame: 5, sourceFrameCount: title.sourceFrameCount - 5 });
		}
		assert.deepEqual(after.sources, before.sources);
		const presentations = after.videoVisualPresentations as readonly Readonly<{
			owner: Readonly<{ kind: string; id: string }>; opacity: number; blendMode: string;
		}>[];
		assert.equal(presentations.length, titles.length);
		for (const clip of titles) {
			const presentation = presentations.find(row => row.owner.kind === 'clip' && row.owner.id === clip.id);
			assert.ok(presentation);
			assert.equal(presentation.opacity, 0.25);
			assert.equal(presentation.blendMode, 'screen');
		}
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.project?.clips, before.clips);
		assert.deepEqual(controller.project?.tracks, before.tracks);
		assert.deepEqual(controller.project?.videoVisualPresentations, before.videoVisualPresentations);
		controller.actions.edit.redo();
		assert.deepEqual(controller.project?.clips, after.clips);
		assert.deepEqual(controller.project?.tracks, after.tracks);
		assert.deepEqual(controller.project?.videoVisualPresentations, after.videoVisualPresentations);
	});
}

for (const point of [0, 5]) test(`public Bin Insert at ${String(point)} preserves animated image source phase`, async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const fixture = createFramescaperBaselineImageFixture();
	const owner = fixture.project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(fixture.clip.id));
	assert.ok(owner);
	const placement = { scope: 'timeline' as const, trackId: owner.id };
	const base = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, fixture.project, {
		type: 'batch', commands: [{ type: 'image-clip/set', clipId: fixture.clip.id,
			expectedClip: fixture.clip, expectedPlacement: placement, clip: null, placement: null }, {
			type: 'image-source/set', sourceId: fixture.source.id, expectedSource: fixture.source, source: null,
		}],
	});
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, base, {
		type: 'batch', commands: [{ type: 'image-source/set', sourceId: fixture.source.id,
			expectedSource: null, source: fixture.source }, { type: 'image-clip/set', clipId: fixture.clip.id,
			expectedClip: null, expectedPlacement: null, clip: fixture.clip, placement }],
	});
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes: fixture.bytes }));
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	await controller.actions.project.openById(fixture.project.id);
	controller.actions.timeline.selectClip('video-clip');
	const before = environment.runtime.cloneProject(controller.project);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.video.insert({ binItemId: 'bin-video', sequenceInFrame: point * 4_800 });
	const after = environment.runtime.cloneProject(controller.project);
	const images = (after.clips as readonly Readonly<Record<string, unknown>>[])
		.filter(clip => clip.kind === 'image').map(normalizeFramescaperImageClipV1);
	assert.equal(images.length, point > 0 ? 2 : 1);
	if (point === 0) assert.deepEqual(images, [{ ...fixture.clip, sequenceStartFrame: 10 }]);
	else {
		const left = images.find(clip => clip.id === fixture.clip.id)!;
		const right = images.find(clip => clip.id !== fixture.clip.id)!;
		assert.deepEqual(left, { ...fixture.clip, sequenceFrameCount: 5 });
		assert.deepEqual(right, { ...fixture.clip, id: right.id, sequenceStartFrame: 15,
			sequenceFrameCount: fixture.clip.sequenceFrameCount - 5, sourceStartTicks: '500000' });
	}
	assert.deepEqual(after.sources, before.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.tracks, after.tracks);
});
