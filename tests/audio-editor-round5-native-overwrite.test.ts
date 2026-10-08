/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createFramescaperVisualInspectorCommand, createFramescaperVisualInspectorModel }
	from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { normalizeFramescaperImageClipV1 } from '../src/common/editor/timeline-image-model.ts';
import { FOUNDATION_TIME_CONVERSION_SITES } from '../src/common/editor/foundation-time-conversion-audit.ts';

for (const [offset, short] of [[-10, false], [-5, false], [0, false], [5, false], [45, false], [50, false], [0, true]] as const) {
	test(`public Bin Overwrite at Title offset ${String(offset)}${short ? ' (complete coverage)' : ''} retains only uncovered native picture and one Undo`, async context => {
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
		const titleId = String(controller.project?.clips.at(-1)?.id);
		if (short) controller.actions.clip.trim(titleId, { durationFrames: 24_000 });
		const title = normalizeVideoGeneratorClipV1(controller.project?.clips.find(clip => clip.id === titleId));
		assert.equal(title.sequenceStartFrame, 10);
		const model = createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: title.id });
		controller.actions.edit.commit(createFramescaperVisualInspectorCommand(controller.project, title.id, {
			generator: model.generator, opacity: 0.25, blendMode: 'screen', maskId: model.maskId,
			maskWidth: model.maskWidth, presetId: null,
		}) as AudioEditorCommand);
		controller.actions.timeline.selectClip(title.id);
		const before = environment.runtime.cloneProject(controller.project);
		const historyCount = controller.getSnapshot().history.undoEntries.length;
		const start = title.sequenceStartFrame + offset;
		controller.actions.video.overwrite({ binItemId: 'bin-video', sequenceInFrame: start * 4_800 });
		const after = environment.runtime.cloneProject(controller.project);
		const titles = (after.clips as readonly Readonly<Record<string, unknown>>[])
			.filter(clip => clip.kind === 'generator').map(normalizeVideoGeneratorClipV1)
			.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
		const end = start + 10;
		const titleEnd = title.sequenceStartFrame + title.sequenceFrameCount;
		const spans = [[title.sequenceStartFrame, Math.min(start, titleEnd)], [Math.max(end, title.sequenceStartFrame), titleEnd]]
			.filter(([left, right]) => left !== undefined && right !== undefined && right > left);
		assert.deepEqual(titles.map(clip => [clip.sequenceStartFrame, clip.sequenceStartFrame + clip.sequenceFrameCount]), spans);
		for (const surviving of titles) {
			assert.equal(surviving.sourceInFrame, title.sourceInFrame + surviving.sequenceStartFrame - title.sequenceStartFrame);
			assert.equal(surviving.sourceFrameCount, surviving.sequenceFrameCount);
		}
		assert.deepEqual(after.sources, titles.length ? before.sources : before.sources.filter(source => source.id !== title.sourceId));
		const camera = after.clips.find(clip => clip.id === 'video-clip');
		if (start >= 10) assert.deepEqual(camera, before.clips.find(clip => clip.id === 'video-clip'));
		else if (start === 0) assert.equal(camera, undefined);
		else {
			assert.equal(camera?.sequenceStartFrame, 0);
			assert.equal(camera?.sequenceFrameCount, start);
			assert.equal(camera?.sourceInFrame, 0);
			assert.equal(camera?.sourceFrameCount, start);
		}
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
		assert.deepEqual(controller.project?.sources, before.sources);
		controller.actions.edit.redo();
		assert.deepEqual(controller.project?.clips, after.clips);
		assert.deepEqual(controller.project?.tracks, after.tracks);
		assert.deepEqual(controller.project?.videoVisualPresentations, after.videoVisualPresentations);
		assert.deepEqual(controller.project?.sources, after.sources);
	});
}

for (const start of [0, 5]) test(`public Bin Overwrite at ${String(start)} retains animated image phase`, async context => {
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
	controller.actions.timeline.selectClip(fixture.clip.id);
	const before = environment.runtime.cloneProject(controller.project);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.video.overwrite({ binItemId: 'bin-video', sequenceInFrame: start * 4_800 });
	const after = environment.runtime.cloneProject(controller.project);
	const images = after.clips.filter(clip => clip.kind === 'image').map(normalizeFramescaperImageClipV1)
		.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
	assert.deepEqual(images.map(clip => [clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceStartTicks]),
		start === 0 ? [[10, fixture.clip.sequenceFrameCount - 10, '1000000']]
			: [[0, 5, '0'], [15, fixture.clip.sequenceFrameCount - 15, '1500000']]);
	assert.deepEqual(after.sources, before.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.tracks, after.tracks);
});

test('native Overwrite owns the exact nearest-frame and source-trim conversion policies', () => {
	const site = FOUNDATION_TIME_CONVERSION_SITES.find(value => value.id === 'framescaper-native-bin-overwrite-span');
	assert.equal(site?.file, 'src/framescaper/editor-timeline-native-overwrite-command.ts');
	assert.deepEqual(site?.conversions, [{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
		{ helper: 'videoFrameToSampleFrame', policies: ['point'] }]);
});
