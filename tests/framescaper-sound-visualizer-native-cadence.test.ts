/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperVideoExportExactExecutionFinishing } from '../src/framescaper/video-export-exact-execution-finishing.ts';
import { createFramescaperVideoVisualPlanFinishing } from '../src/framescaper/video-export-visual-plan-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

test('a 60 fps native carrier animates adjacent silent visualizer frames despite its 30 fps planning rate', async () => {
	const options = framescaperV20Options();
	options.videoTransitionsByTrackId = { 'video-track': [] };
	options.clips = [{
		schemaVersion: 1, kind: 'generator', id: 'visualizer-clip', sourceId: 'visualizer-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	}];
	options.tracks = (options.tracks as Data[]).map((track) => track.id === 'video-track'
		? { ...track, clipIds: ['visualizer-clip'] } : { ...track, clipIds: [] });
	options.visualModel = {
		stillSources: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [],
		generatorSources: [{
			schemaVersion: 1, kind: 'generator', id: 'visualizer-source', name: 'Visualizer',
			width: 32, height: 16, frameRate: { num: 10, den: 1 }, frameCount: 10,
			generator: {
				kind: 'sound-visualizer', mode: 'waveform', sourceIds: [], windowSeconds: 0.1,
				foregroundColor: '#ffffffff', backgroundColor: '#000000ff',
			},
		}],
	};
	const project = createFramescaperProjectFinishing(PROFILE, options as never);
	const plan = createFramescaperVideoVisualPlanFinishing(project, {
		format: 'mp4', range: 'project', includeAudio: false,
		canvas: { size: { width: 32, height: 16 }, frameRate: { num: 30, den: 1 } },
	} as never);
	const signal = new AbortController().signal;
	const exact = await createFramescaperVideoExportExactExecutionFinishing({
		profile: PROFILE, project,
		request: {
			canonicalProject: project, plan, timingViewsBySourceId: new Map([
				['video-source', { kind: 'cfr', rate: { num: 10, den: 1 }, frameCount: 10 }],
			]),
			videoBlobs: new Map(), signal, assertCurrent() {},
		} as never,
		outputFrameRate: { num: 60, den: 1 },
	});
	try {
		const frames = createVideoExactPictureExportFrameSource({
			sampleRate: Number(project.sampleRate), startFrame: 0, endFrame: plan.range.endFrame,
			canvas: {
				width: 32, height: 16, frameRate: { num: 60, den: 1 },
				fit: 'contain', backgroundColor: '#000000',
			},
		});
		const first = new Uint8Array(32 * 16 * 4);
		const second = new Uint8Array(first.length);
		await exact.compositor({ frame: frames.frame(1), layers: [], width: 32, height: 16,
			rgba: first, signal });
		await exact.compositor({ frame: frames.frame(2), layers: [], width: 32, height: 16,
			rgba: second, signal });
		assert.notDeepEqual(first, second);
	} finally {
		await exact.dispose();
	}
});
