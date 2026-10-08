/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createSetVideoKeyframesCommand } from '../src/common/editor/commands/factories.ts';
import { exportProjectEdl, exportProjectFcpxml, exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';

for (const [profile, action] of [['edl', exportProjectEdl], ['otio', exportProjectOtio], ['fcpxml', exportProjectFcpxml]] as const) {
	test(`${profile} reports the authored picture composition it cannot carry`, async () => {
		const project = fixture(0.5);
		const original = structuredClone(project);
		const state: { deliveryReport?: unknown } = {};
		const result = await action({ getProject: () => project, state });
		assert.ok(result);
		const omission = result.report.items.find(item => item.code === `${profile}.picture-processing-omitted`);
		assert.ok(omission, 'cut-only picture delivery must disclose its lost opacity');
		assert.equal(omission.severity, 'warning');
		assert.equal(omission.disposition, 'omitted');
		assert.deepEqual(omission.scope, { kind: 'clip', id: 'take' });
		assert.deepEqual(omission.data, { videoComposition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity: 0.5 } });
		assert.equal(state.deliveryReport, result.report);
		assert.deepEqual(project, original);
	});

	test(`${profile} keeps neutral composition free of processing warnings`, async () => {
		const result = await action({ getProject: () => fixture(1), state: {} });
		assert.ok(result);
		assert.equal(result.report.items.filter(item => item.code.endsWith('picture-processing-omitted')).length, 0);
	});

	test(`${profile} inventories active picture effects and authored animation`, async () => {
		const project = fixture(1, { processing: true });
		const result = await action({ getProject: () => project, state: {} });
		assert.ok(result);
		const omission = result.report.items.find(item => item.code === `${profile}.picture-processing-omitted`);
		assert.ok(omission, 'picture processing must be named even when its base composition is neutral');
		assert.deepEqual(omission.data, { videoEffects: ['vignette'], videoKeyframes: ['opacity'] });
	});
}

for (const action of [exportProjectOtio, exportProjectFcpxml]) {
	test(`${action.name} does not warn about processing on an already hidden picture track`, async () => {
		const result = await action({ getProject: () => fixture(0.5, { hidden: true }), state: {} });
		assert.ok(result);
		assert.equal(result.report.items.filter(item => item.code.endsWith('picture-processing-omitted')).length, 0);
	});
}

test('EDL does not report processing on an entire second video track it already omits', async () => {
	const result = await exportProjectEdl({ getProject: () => fixture(1, { secondTrack: true }), state: {} });
	assert.ok(result);
	assert.ok(result.report.items.some(item => item.code === 'edl.video-track-omitted'));
	assert.equal(result.report.items.filter(item => item.code.endsWith('picture-processing-omitted')).length, 0);
});

function fixture(opacity: number, options: { processing?: boolean; hidden?: boolean; secondTrack?: boolean } = {}) {
	const clip = { kind: 'video', id: 'take', title: 'Take', sourceId: 'camera', sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25,
		videoComposition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity },
		...(options.processing ? {
			videoEffects: [createVideoEffect('vignette', { id: 'shade' }), createVideoEffect('pixelate', { id: 'disabled', enabled: false })],
		} : {}),
	};
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'programme', title: 'Programme', now: '2026-10-09T12:00:00.000Z',
		sources: [createVideoSource({ id: 'camera', name: 'Camera', storageKey: 'camera.webm', mimeType: 'video/webm',
			contentSha256: '12'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 25,
			frameRate: { num: 25, den: 1 }, width: 320, height: 180 })],
		clips: [clip, ...(options.secondTrack ? [{ ...clip, id: 'second', videoComposition: { ...clip.videoComposition, opacity: 0.5 } }] : [])],
		tracks: [{ type: 'video', id: 'picture', name: 'Picture', clipIds: ['take'], hidden: options.hidden ?? false },
			...(options.secondTrack ? [{ type: 'video', id: 'other', name: 'Other', clipIds: ['second'] }] : [])],
		sequences: [{ id: 'main', name: 'Main', rate: { num: 25, den: 1 }, trackIds: ['picture', ...(options.secondTrack ? ['other'] : [])] }],
		primarySequenceId: 'main',
	});
	if (!options.processing) return project;
	const empty = createDefaultVideoKeyframeCurves({ num: 25, den: 1 });
	return applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project,
		createSetVideoKeyframesCommand('take', empty, { ...empty, curves: [{
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: { anchors: [{ position: { num: 0, den: 1 }, value: 1 }, { position: { num: 25, den: 1 }, value: 0.5 }],
				segments: [{ kind: 'linear' }] },
		}] }));
}
