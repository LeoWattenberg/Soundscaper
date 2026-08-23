/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { createFramescaperSelectedExactFrameExecutionV27 } from '../src/framescaper/selected-v27-exact-frame-execution.ts';
import { createFramescaperVideoExportVisualExecutionV27 } from '../src/framescaper/video-export-visual-execution-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

/**
 * Playback and export are the same render. The picture-only browser export
 * must produce byte-identical frames to the selected exact execution that
 * serves the program preview and the keyed export; a route that composites
 * in encoded space diverges visibly on every semi-transparent pixel.
 */
test('picture-only export composites in the same linear space as the exact preview', async () => {
	const project = pictureOnlyProject();
	const signal = new AbortController().signal;
	const plan = Object.freeze({
		format: 'mp4', quality: 'balanced', sampleRate: 48_000,
		range: Object.freeze({ startFrame: 0, endFrame: 48_000, durationFrames: 48_000 }),
		canvas: Object.freeze({
			width: 2, height: 2, frameRate: Object.freeze({ num: 10, den: 1 }),
			fit: 'contain', backgroundColor: '#000000',
		}),
	});
	const visual = await createFramescaperVideoExportVisualExecutionV27({
		profile: PROFILE, project, plan: plan as never,
		timingViewsBySourceId: new Map([['video-source', Object.freeze({
			kind: 'cfr' as const, rate: Object.freeze({ num: 10, den: 1 }), frameCount: 10,
		})]]),
		signal, assertCurrent() {},
	});
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: 48_000, startFrame: 0, endFrame: 48_000,
		canvas: {
			width: 2, height: 2, frameRate: { num: 10, den: 1 },
			fit: 'contain', backgroundColor: '#000000',
		},
	});
	const producer = visual.createProducer(frameSource);
	const exported = new Uint8Array(16);
	await producer.produce(frameSource.frame(0), exported, { signal });

	const exact = await createFramescaperSelectedExactFrameExecutionV27({
		project, plan: visual.exactPlan, timingSidecars: visual.timingSidecars,
		signal, assertCurrent() {},
	});
	const previewed = new Uint8Array(16);
	await exact.render({
		sequencePosition: { num: 0, den: 1 }, layers: [],
		width: 2, height: 2, target: previewed, signal,
	});
	await exact.dispose();
	visual.dispose();

	assert.deepEqual(
		[...exported], [...previewed],
		'a half-transparent solid over black exports exactly what the preview shows',
	);
	assert.ok(
		exported.subarray(0, 3).some((value) => value > 0),
		'the generator visibly rendered over the background',
	);
});

function pictureOnlyProject() {
	const options = framescaperV20Options();
	options.clips = (options.clips as Record<string, unknown>[])
		.filter((clip) => clip.id !== 'video-clip');
	(options.clips as Record<string, unknown>[]).push({
		schemaVersion: 1, kind: 'generator', id: 'generator-clip',
		sourceId: 'generator-source', sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	});
	const tracks = options.tracks as Record<string, unknown>[];
	tracks[0]!.clipIds = ['generator-clip'];
	return createFramescaperProjectV27(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			generatorSources: [{
				schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Wash',
				width: 1_920, height: 1_080, frameRate: { num: 10, den: 1 }, frameCount: 100,
				generator: { kind: 'solid', color: '#ffffff80' },
			}],
		},
		finishing: {
			colorContexts: [{
				schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
				outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working',
				toneMapping: 'none',
			}],
			sourceColorInterpretations: [{
				schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video',
				primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited',
				provenance: 'default-video-bt709-limited',
			}],
			visualPresentations: [],
			processorStacks: [], motionAnalyses: [],
		},
	});
}
