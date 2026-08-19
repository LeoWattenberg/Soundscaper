/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSourceV10 } from '../src/common/editor/project-v10.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import {
	assertFramescaperVideoKeyframeExportCanvasAuthorityV20,
	createFramescaperVideoKeyframeExportPlanV20,
} from '../src/framescaper/video-export-plan-v20.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('authenticates keyed V20 and creates an exact range-scoped keyed export plan', () => {
	const project = keyedProject();
	const plan = createFramescaperVideoKeyframeExportPlanV20(PROFILE, project, {
		format: 'webm',
		range: { startFrame: 48_000, endFrame: 96_000 },
		includeAudio: false,
		canvas: { maximumWidth: 640, maximumHeight: 360 },
	});

	assert.equal(plan.version, 7);
	assert.equal(plan.format, 'webm');
	assert.deepEqual(plan.range, { startFrame: 48_000, endFrame: 96_000, durationFrames: 48_000 });
	assert.deepEqual(plan.duration, { num: 1, den: 1 });
	assert.deepEqual(plan.canvas.frameRate, { num: 30_000, den: 1_001 });
	assert.equal(plan.canvas.width, 640);
	assert.equal(plan.canvas.height, 360);
	assert.equal(plan.canvas.referenceClipId, 'late-keyed-clip');
	assert.equal(plan.canvas.referenceSourceId, 'late-source');
	assert.deepEqual(plan.activeClipIds, ['late-keyed-clip']);
	assert.deepEqual(plan.activeSourceIds, ['late-source']);
	assert.equal(plan.outputFrameCount, 30);
	const videoInputs = plan.inputs.filter((input) => input.kind === 'video-source');
	assert.deepEqual(videoInputs.map(({ sourceId }) => sourceId), ['late-source']);
	assert.equal(videoInputs[0]?.contentSha256, '34'.repeat(32));
	assert.equal(Object.isFrozen(plan), true);
});

test('uses explicit audio request semantics and refuses static V20 dispatch', () => {
	const project = keyedProject();
	const plan = createFramescaperVideoKeyframeExportPlanV20(PROFILE, project, {
		range: { startFrame: 48_000, endFrame: 96_000 },
		audioFileName: 'framescaper-mix.wav',
	});
	assert.deepEqual(plan.inputs.at(-1), {
		kind: 'staged-audio-mix', inputIndex: 1, fileName: 'framescaper-mix.wav',
		sampleRate: 48_000, startFrame: 48_000, durationFrames: 48_000,
		channelLayout: 'preserve',
	});

	assert.throws(
		() => createFramescaperVideoKeyframeExportPlanV20(PROFILE, project, {
			range: { startFrame: 48_000, endFrame: 96_000 },
			includeAudio: false,
			audioFileName: 'ambiguous.wav',
		}),
		/audioFileName.*includeAudio/iu,
	);
	const staticProject = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	assert.throws(
		() => createFramescaperVideoKeyframeExportPlanV20(PROFILE, staticProject),
		/legacy-v6|authored keyframe|keyed/iu,
	);
});

test('authenticates the project before reading a closed hostile request', () => {
	const invalid = structuredClone(createFramescaperProjectV20(PROFILE, framescaperV20Options()));
	(invalid as Record<string, unknown>).schemaVersion = 19;
	let reads = 0;
	const request = new Proxy({}, {
		getOwnPropertyDescriptor() { reads += 1; throw new Error('request descriptor'); },
		ownKeys() { reads += 1; throw new Error('request keys'); },
	});
	assert.throws(
		() => createFramescaperVideoKeyframeExportPlanV20(PROFILE, invalid, request),
		/unsupported Framescaper project schema version/iu,
	);
	assert.equal(reads, 0);

	const project = keyedProject();
	assert.throws(
		() => createFramescaperVideoKeyframeExportPlanV20(PROFILE, project, { surprise: true }),
		/unsupported field/iu,
	);
	// A hex background is a delivery decision the compositor can clear to, so it
	// rides the keyed plan exactly as it rides the composed graph. A colour name
	// is FFmpeg's own palette, which this path has no way to resolve.
	assert.equal(
		createFramescaperVideoKeyframeExportPlanV20(PROFILE, project, {
			canvas: { backgroundColor: '#ffffff' },
		}).canvas.backgroundColor,
		'#ffffff',
	);
	assert.throws(
		() => createFramescaperVideoKeyframeExportPlanV20(PROFILE, project, {
			canvas: { backgroundColor: 'papayawhip' },
		}),
		/hex colour the compositor can clear to/iu,
	);
});

test('a keyed export delivers a stated vertical canvas and the fit it asked for', () => {
	const plan = createFramescaperVideoKeyframeExportPlanV20(PROFILE, keyedProject(), {
		range: { startFrame: 48_000, endFrame: 96_000 },
		includeAudio: false,
		canvas: { size: { width: 1_080, height: 1_920 }, fit: 'cover' },
	});

	assert.equal(plan.canvas.width, 1_080);
	assert.equal(plan.canvas.height, 1_920);
	assert.equal(plan.canvas.fit, 'cover');
});

test('an unstated keyed canvas still states the fit every keyed frame already had', () => {
	const plan = createFramescaperVideoKeyframeExportPlanV20(PROFILE, keyedProject(), {
		range: { startFrame: 48_000, endFrame: 96_000 },
		includeAudio: false,
	});

	assert.equal(plan.canvas.fit, 'contain');
});

test('a keyed canvas the encoder cannot stream is refused at plan build', () => {
	// 1080x1944 RGBA is 8,398,080 bytes, past the encoder's 8 MiB frame limit.
	assert.throws(
		() => createFramescaperVideoKeyframeExportPlanV20(PROFILE, keyedProject(), {
			range: { startFrame: 48_000, endFrame: 96_000 },
			includeAudio: false,
			canvas: { size: { width: 1_080, height: 1_944 } },
		}),
		/8 MiB RGBA frame limit/u,
	);
	assert.throws(
		() => createFramescaperVideoKeyframeExportPlanV20(PROFILE, keyedProject(), {
			range: { startFrame: 48_000, endFrame: 96_000 },
			includeAudio: false,
			canvas: { size: { width: 1_080, height: 1_920 }, fit: 'fill' },
		}),
		/canvas\.fit is unsupported/u,
	);
});

test('refuses independently active but mismatched canvas reference clip/source IDs', () => {
	assert.throws(() => assertFramescaperVideoKeyframeExportCanvasAuthorityV20({
		width: 640,
		height: 360,
		frameRate: { num: 30, den: 1 },
		fit: 'contain',
		pixelFormat: 'yuv420p',
		backgroundColor: '#000000',
		referenceClipId: 'clip-a',
		referenceSourceId: 'source-b',
	}, [
		{ id: 'clip-a', sourceId: 'source-a' },
		{ id: 'clip-b', sourceId: 'source-b' },
	]), /reference clip.*reference source/iu);
});

function keyedProject() {
	const options = framescaperV20Options();
	const sources = options.sources as Record<string, unknown>[];
	sources.push(createVideoSourceV10({
		id: 'late-source', name: 'Late', storageKey: 'late-source', mimeType: 'video/mp4',
		contentSha256: '34'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30_000, den: 1_001 }, width: 1_920, height: 1_080,
	}));
	const clips = options.clips as Record<string, unknown>[];
	clips.push({
		kind: 'video', id: 'late-keyed-clip', sourceId: 'late-source', title: 'Late',
		sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null,
	});
	const tracks = options.tracks as Record<string, unknown>[];
	(tracks[0]!.clipIds as string[]).push('late-keyed-clip');
	const project = createFramescaperProjectV20(PROFILE, options);
	const clip = project.clips.find(({ id }) => id === 'late-keyed-clip');
	assert.ok(clip);
	(clip as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(10);
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	return project;
}
