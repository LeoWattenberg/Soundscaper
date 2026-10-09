/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperProjectForRuntimeConsumers } from '../src/framescaper/editor-project-runtime.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { planFramescaperMulticameraCommandSequence } from '../src/framescaper/editor-project-sequence-multicam.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { exportProjectEdl, exportProjectOtio, exportProjectFcpxml, resolveDeliveredProject } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createExportActionGroup } from '../src/common/editor/controller/export/export-action-group.ts';

for (const mode of ['ordinary', 'initial', 'switched'] as const) {
	for (const [format, action] of [['edl', exportProjectEdl], ['otio', exportProjectOtio], ['fcpxml', exportProjectFcpxml]] as const) {
		test(`${format} exports the ${mode} ordinary camera output and discloses flattened editing`, async () => {
			const project = fixture(mode);
			const before = structuredClone(project);
			const saved: Blob[] = [];
			const runtime = { getProject: () => project, state: {},
				projectForRuntimeConsumers: (candidate: unknown) => framescaperProjectForRuntimeConsumers(PROFILE, candidate),
				reelNames: { 'camera-a': 'ANGLE_A', 'camera-b': 'ANGLE_B' },
				fileService: { saveFile: (request: Readonly<Record<string, unknown>>) => { saved.push(request.blob as Blob); } },
			};
			const result = await action(runtime);
			assert.ok(result);
			const expected = mode === 'switched' ? 'camera-b' : 'camera-a';
			if (format === 'edl') assert.match(result.text, new RegExp(mode === 'switched' ? 'ANGLE_B' : 'ANGLE_A', 'u'));
			else assert.ok(result.text.includes(`media/${expected}.mp4`), 'the saved file must reference the active camera');
			const disclosure = result.report.items.find(item => item.code === `${format}.multicamera-flattened`);
			assert.equal(Boolean(disclosure), mode !== 'ordinary');
			if (disclosure) assert.deepEqual(disclosure.data, { activeSourceId: expected, memberCount: 2, outputClipId: 'take' });
			assert.equal(saved.length, 1);
			assert.equal(await saved[0]!.text(), result.text);
			assert.deepEqual(project, before);
		});
	}
	test(`DAWproject delivery preparation preserves the ${mode} active source and exact native extent`, () => {
		const project = fixture(mode);
		const delivered = resolveDeliveredProject({ getProject: () => project, state: {},
			projectForRuntimeConsumers: (candidate: unknown) => framescaperProjectForRuntimeConsumers(PROFILE, candidate),
		});
		assert.ok(delivered);
		const clips = delivered.clips as readonly Readonly<Record<string, unknown>>[];
		assert.equal(clips[0]?.sourceId, mode === 'switched' ? 'camera-b' : 'camera-a');
		assert.equal(clips[0]?.durationFrames, 48_000);
		assert.equal(clips[0]?.sourceStartFrame, 0);
		const exported = createDawprojectExport({ project: delivered, embeddableVideoSourceIds: ['camera-a', 'camera-b'] });
		assert.deepEqual(exported.media.map(entry => entry.sourceId), [mode === 'switched' ? 'camera-b' : 'camera-a']);
	});
}

test('the menu action forwards the selected product projection without losing existing picture omissions', async () => {
	const project = fixture('switched', { opacity: 0.5, unsupported: true });
	const actions = createExportActionGroup({ getProject: () => project, state: {}, persistSetting: () => undefined,
		handleExportAction: () => undefined,
		projectForRuntimeConsumers: candidate => framescaperProjectForRuntimeConsumers(PROFILE, candidate),
	});
	const result = await actions.exportOtio();
	assert.ok(result);
	assert.ok(result.text.includes('media/camera-b.mp4'));
	assert.ok(result.report.items.some(item => item.code === 'otio.unsupported-visual-clip-omitted' && item.scope.id === 'bars'));
	const picture = result.report.items.find(item => item.code === 'otio.picture-processing-omitted');
	assert.deepEqual(picture?.data.videoComposition, { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity: 0.5 });
	assert.ok(result.report.items.some(item => item.code === 'otio.multicamera-flattened'));
});

test('a hidden camera output creates no converted-camera warning', async () => {
	const project = fixture('switched', { hidden: true });
	const result = await exportProjectOtio({ getProject: () => project, state: {},
		projectForRuntimeConsumers: candidate => framescaperProjectForRuntimeConsumers(PROFILE, candidate),
	});
	assert.ok(result);
	assert.equal(result.report.items.filter(item => item.code === 'otio.multicamera-flattened').length, 0);
});

function fixture(mode: 'ordinary' | 'initial' | 'switched', options: { opacity?: number; hidden?: boolean; unsupported?: boolean } = {}) {
	const original = createFramescaperProject(PROFILE, {
		id: 'programme', title: 'Programme', now: '2026-10-09T12:00:00.000Z',
		sources: ['camera-a', 'camera-b'].map((id, index) => createVideoSource({ id,
			name: `${id}.mp4`, storageKey: `media/${id}.mp4`, mimeType: 'video/mp4', contentSha256: (index ? '34' : '12').repeat(32),
			sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: { num: 25, den: 1 }, width: 320, height: 180,
		})),
		...(options.unsupported ? { visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'bars-source', name: 'Bars',
			width: 320, height: 180, frameRate: { num: 25, den: 1 }, frameCount: 25,
			generator: { kind: 'test-image', pattern: 'color-bars' } }] } } : {}),
		clips: [{ kind: 'video', id: 'take', title: 'Camera output', sourceId: 'camera-a', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25,
			videoComposition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity: options.opacity ?? 1 } },
			...(options.unsupported ? [{ schemaVersion: 1, kind: 'generator', id: 'bars', sourceId: 'bars-source', sequenceId: 'main',
				sequenceStartFrame: 25, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25 }] : [])],
		tracks: [{ type: 'video', id: 'picture', name: 'Picture', clipIds: ['take', ...(options.unsupported ? ['bars'] : [])], hidden: options.hidden ?? false }],
		sequences: [{ id: 'main', name: 'Main', rate: { num: 25, den: 1 }, trackIds: ['picture'] }], primarySequenceId: 'main',
		...(mode === 'ordinary' ? {} : { multicameraGroups: [{ id: 'group', projectId: 'programme', sequenceId: 'main', outputClipId: 'take', activeMemberId: 'a',
			members: [{ id: 'a', groupId: 'group', sourceId: 'camera-a', syncOffsetSamples: 0 },
				{ id: 'b', groupId: 'group', sourceId: 'camera-b', syncOffsetSamples: 0 }] }] }),
	});
	const plan = mode === 'switched' ? planFramescaperMulticameraCommandSequence(PROFILE, original,
		original.multicameraGroups, { type: 'multicamera/switch', projectId: original.id,
			expectedProjectRevision: original.revision, groupId: 'group', expectedActiveMemberId: 'a', memberId: 'b' }) : null;
	const project = plan ? { ...original, multicameraGroups: plan.after } : original;
	assert.equal(validateFramescaperProject(PROFILE, project), true);
	return project;
}
