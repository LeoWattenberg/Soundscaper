/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportDelivery } from '../src/common/editor/controller/product-video-export-strategy.ts';
import type { VideoKeyframeVideoEncoderRequest } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { createFramescaperPlaybackProjectServiceV30 } from '../src/framescaper/editor-project-playback-v30.ts';
import { applyFramescaperProjectCommandV30 } from '../src/framescaper/editor-project-v30-commands.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { createFramescaperProjectV30 } from '../src/framescaper/editor-project-v30.ts';
import { createFramescaperVideoExportStrategyV30 } from '../src/framescaper/video-export-strategy-v30.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { createFramescaperV30ImageFixture } from './helpers/framescaper-v30-image-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;

test('selected V30 export paints a same-track image after inherited visual entries like preview', async () => {
	const image = createFramescaperV30ImageFixture({
		imageOnly: true,
		firstFrameRgba: [255, 0, 0, 128, 0, 0, 0, 0],
	});
	const base = blueGeneratorProject();
	const project = applyFramescaperProjectCommandV30(PROFILE, base, {
		type: 'batch',
		commands: [{
			type: 'image-source/set',
			sourceId: image.source.id,
			expectedSource: null,
			source: image.source,
		}, {
			type: 'image-clip/set',
			clipId: image.clip.id,
			expectedClip: null,
			expectedPlacement: null,
			clip: { ...image.clip, sequenceId: base.primarySequenceId, sequenceFrameCount: 10 },
			placement: { scope: 'timeline', trackId: 'video-track' },
		}],
	});
	let rendered: Uint8Array<ArrayBuffer> | null = null;
	const strategy = createFramescaperVideoExportStrategyV30(PROFILE, {
		async encodeOffline() { throw new Error('visual-only export must not use the V20 renderer'); },
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
		async encodePicture(_editorFfmpeg: unknown, request: VideoKeyframeVideoEncoderRequest) {
			const pixels = new Uint8Array(request.producer.byteLength);
			await request.producer.produce(request.frameSource.frame(0), pixels, { signal: request.signal! });
			rendered = pixels;
			return encodedResult();
		},
	}, {
		loadMediaAsset: () => Promise.resolve(new Blob([Uint8Array.from(image.bytes)])),
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: delivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: { size: { width: 2, height: 2 }, fit: 'stretch' },
	});
	assert.ok(plan);
	await strategy.encode({
		canonicalProject: project,
		exportProject,
		plan,
		timingBySourceId: new Map(),
		timingViewsBySourceId: new Map(),
		videoBlobs: new Map(),
		audioMix: null,
		editorFfmpeg: {},
		webCodecs: null,
		signal: new AbortController().signal,
		assertCurrent() {},
		maximumOutputBytes: 1_024,
	});
	assert.ok(rendered);
	assert.deepEqual([...rendered.subarray(0, 4)], [180, 0, 180, 255]);
});

function blueGeneratorProject() {
	const options = framescaperV20Options();
	options.sources = [];
	options.clips = [{
		schemaVersion: 1,
		kind: 'generator',
		id: 'solid-clip',
		sourceId: 'solid-source',
		sequenceId: 'main-sequence',
		sequenceStartFrame: 0,
		sequenceFrameCount: 10,
		sourceInFrame: 0,
		sourceFrameCount: 10,
	}];
	(options.projectBin as Record<string, unknown>).clips = [];
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	track.clipIds = ['solid-clip'];
	options.tracks = [track];
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = ['video-track'];
	return createFramescaperProjectV30(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			generatorSources: [{
				schemaVersion: 1,
				kind: 'generator',
				id: 'solid-source',
				name: 'Blue',
				width: 2,
				height: 2,
				frameRate: { num: 10, den: 1 },
				frameCount: 10,
				generator: { kind: 'solid', color: '#0000ffff' },
			}],
		},
	});
}

function delivery(project: ReturnType<typeof createFramescaperProjectV30>): ProductVideoExportDelivery {
	return createFramescaperPlaybackProjectServiceV30(PROFILE)
		.projectForVideoRenderedFallbackDelivery!(project) as ProductVideoExportDelivery;
}

function encodedResult() {
	return Object.freeze({
		bytes: Uint8Array.of(1, 2, 3),
		byteLength: 3,
		videoEncoder: 'ffmpeg' as const,
		format: 'mp4' as const,
		extension: '.mp4' as const,
		mimeType: 'video/mp4' as const,
		frameCount: 10,
		rgbaChunkCount: 1,
		outputChunkCount: 1,
	});
}
