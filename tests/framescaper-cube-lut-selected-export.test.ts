/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import type { ProductVideoExportStrategyEncodeRequest } from '../src/common/editor/controller/export/product-video-export-strategy.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import {
	createFramescaperVideoExportStrategyFinishing,
	framescaperVideoExportDispositionFinishingFor,
	type FramescaperVideoExportStrategyFinishingDependencies,
} from '../src/framescaper/video-export-strategy-finishing.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const PARSED = parseCubeLutV1(TEXT);
const BODY = new TextEncoder().encode(TEXT);
const REF = Object.freeze({
	storageKey: `lut-sha256:${PARSED.sha256}`, sha256: PARSED.sha256,
	byteLength: PARSED.byteLength, size: PARSED.size,
	domainMin: PARSED.domainMin, domainMax: PARSED.domainMax,
});
const CUBE = Object.freeze({ id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: REF } });
const RATE = Object.freeze({ num: 10, den: 1 });
const SOURCE = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
// The authored table exchanges red and blue. This literal does not invoke the
// production LUT kernel or derive its expected pixels from a render result.
const CUBE_EXPECTED = [0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255];

function projectFixture(effects: readonly unknown[]) {
	return createFramescaperProjectFinishing(PROFILE, {
		id: 'cube-selected-export', title: 'Selected cube export', now: '2026-10-09T00:00:00.000Z',
		sources: [createVideoSource({
			id: 'source', name: 'Pixels', storageKey: 'original', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 4800, sampleFrameCount: 4800,
			sourceFrameCount: 1, frameRate: RATE, width: 2, height: 2,
		})],
		clips: [{
			kind: 'video', id: 'clip', sourceId: 'source', title: 'Pixels', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1,
			retimeMap: null, videoEffects: effects,
		}],
		tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: ['clip'], locked: false })],
		sequences: [{ id: 'main', rate: RATE, trackIds: ['track'] }], primarySequenceId: 'main',
		finishing: { colorContexts: [{
			schemaVersion: 1, sequenceId: 'main', workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none',
		}] },
	});
}

test('a visible generator exports through current16 while an inactive bin cube retains its exact reference without body demand', async () => {
	const moved = applyFramescaperProjectCommandFinishing(PROFILE, projectFixture([CUBE]),
		{ type: 'project-bin/move-from-timeline', clipIds: ['clip'] });
	const generator = createFramescaperProjectFinishing(PROFILE, { ...moved, projectBin: { clips: [] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'solid', sourceId: 'solid-source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1 }],
		tracks: (moved.tracks as readonly Readonly<Record<string, unknown>>[]).map(track => track.id === 'track' ? { ...track, clipIds: ['solid'] } : track),
		visualModel: { ...(moved.visualModel as Readonly<Record<string, unknown>>), generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'solid-source', name: 'Solid',
			width: 2, height: 2, frameRate: RATE, frameCount: 1, generator: { kind: 'solid', color: '#ff0000ff' } }] },
	});
	const project = cloneFramescaperProjectFinishing(PROFILE, { ...generator, projectBin: moved.projectBin });
	const canonicalProject = project as unknown as Readonly<Record<string, unknown>>, encoder = await createPinnedExportEncoderV1();
	const literal = [255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255]; let demands = 0;
	const strategy = createFramescaperVideoExportStrategyFinishing(PROFILE, {
		async encodeOffline() { throw Error('An inactive bin video never opens the video decoder.'); },
		async encodeOfflineToSink() { throw Error('This bounded picture case never opens a sink.'); },
		async encodePicture(_editor, request) { return encodeVideoKeyframeVideo(encoder.editor, request); },
	}, { async loadMediaAsset() { demands++; throw Error('An inactive LUT has no rendering body demand.'); } });
	try {
		const exportProject = strategy.createExportProject({ canonicalProject, delivery: { project: { projection: true },
			audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
		const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'mp4', range: 'project', includeAudio: false,
			canvas: { width: 2, height: 2, frameRate: RATE, fit: 'contain', backgroundColor: '#00000000' } }); assert.ok(plan);
		await strategy.encode({ canonicalProject, exportProject, plan, timingBySourceId: new Map(),
			timingViewsBySourceId: new Map([['source', { kind: 'cfr', rate: RATE, frameCount: 1 }]]), videoBlobs: new Map(),
			audioMix: null, editorFfmpeg: {}, webCodecs: null, signal: new AbortController().signal, maximumOutputBytes: 1024 * 1024, assertCurrent() {} });
		assert.equal(framescaperVideoExportDispositionFinishingFor(plan).exactPlanVersion, 16);
		assert.deepEqual(encoder.inputCopies, [literal]); assert.equal(demands, 0);
		assert.deepEqual((project.projectBin as Readonly<{ clips: readonly Readonly<{ videoEffects: readonly unknown[] }>[] }>).clips[0]!.videoEffects, [CUBE]);
	} finally { encoder.close(); }
});

function capturedLayers(effects: readonly unknown[]) {
	return [{ trackId: 'track', entries: [{
		clipId: 'clip', sourceId: 'source',
		presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
		displayWidth: 2, displayHeight: 2, effects, intervalProgress: 0,
		renderDescription: {
			crop: {
				normalized: { left: 0, top: 0, right: 0, bottom: 0 },
				sourcePixels: { x: 0, y: 0, width: 2, height: 2 },
			},
			sourceDisplayToCanvas: [1, 0, 0, 1, 0, 0], opacityStart: 1, opacityEnd: 1,
			blendMode: 'normal', compositingOrder: 0,
		},
	}] }];
}

const WHITE = { id: 'white', type: 'white-balance-v1', enabled: true, params: { temperature: 100, tint: 0 } };
const scenarios = [
	{ name: 'plain control', effects: [], carrier: [], expected: SOURCE, version: 13, load: false },
	{ name: 'cube resource', effects: [CUBE], carrier: [], expected: CUBE_EXPECTED, version: 16, load: true },
	{ name: 'disabled resource custody', effects: [{ ...CUBE, enabled: false }], carrier: [], expected: SOURCE, version: 16, load: false },
	{ name: 'explicit null bypass', effects: [{ ...CUBE, params: { lut: null } }], carrier: [], expected: SOURCE, version: 16, load: false },
	// At temperature100 blue linear light is halved: encoded255 becomes188.
	// These distinct literals establish the authored position of the cube stage.
	{ name: 'white balance then cube', effects: [WHITE, CUBE], carrier: [WHITE], version: 16, load: true,
		expected: [0,0,255,255,0,255,0,255,188,0,0,255,188,255,255,255] },
	{ name: 'cube then white balance', effects: [CUBE, WHITE], carrier: [WHITE], version: 16, load: true,
		expected: [0,0,188,255,0,255,0,255,255,0,0,255,255,255,188,255] },
];
for (const scenario of scenarios) {
	test(`the maintained selected export strategy delivers ${scenario.name} pixels to the pinned encoder`, { timeout: 15_000 }, async () => {
		const expected = scenario.expected;
		const authoredProject = projectFixture(scenario.effects);
		const sampleRate = authoredProject.sampleRate; assert.ok(typeof sampleRate === 'number');
		const canonicalProject = authoredProject as unknown as Readonly<Record<string, unknown>>;
		const sourcePixels = new Uint8Array(SOURCE);
		const captures: string[] = [];
		const loads: string[] = [];
		let offlineCalls = 0;
		const encoderOwner: { value?: Awaited<ReturnType<typeof createPinnedExportEncoderV1>> } = {};
		const dependencies: FramescaperVideoExportStrategyFinishingDependencies = {
			captureExactFrame(entry) {
				captures.push(String(entry.clipId));
				return { width: 2, height: 2, pixels: sourcePixels };
			},
			async encodeOffline(request) {
				offlineCalls += 1;
				assert.equal(request.sources.length, 1);
				assert.equal(request.sources[0]!.sourceId, 'source');
				assert.ok(request.rgbaCompositor, 'The maintained strategy must supply its own exact compositor.');
				assert.equal(request.startFrame, 0);
				assert.equal(request.endFrame, 4800);
				const compositor = request.rgbaCompositor;
				const clips = request.project.clips as readonly Readonly<{ id: string; videoEffects: readonly unknown[] }>[];
				const carrierEffects = clips.find(clip => clip.id === 'clip')?.videoEffects; assert.ok(carrierEffects);
				// The maintained decoder consumes the strict numeric carrier. It
				// cannot supply the resource stage; the complete16 owner restores it.
				assert.deepEqual(carrierEffects, scenario.carrier);
				const frameSource = createVideoExactPictureExportFrameSource({
					sampleRate, startFrame: request.startFrame,
					endFrame: request.endFrame, canvas: request.canvas,
				});
				assert.equal(frameSource.frameCount, 1, 'The regression is bounded to one delivery frame.');
				const encoder = await createPinnedExportEncoderV1();
				encoderOwner.value = encoder;
				// Inject only the existing offline encoder seam, standing in for DOM
				// decoder/canvas capture. The strategy creates and owns the exact
				// execution, plan, asset lookup, compositor, and completed ledger.
				return encodeVideoKeyframeVideo(encoder.editor, {
					frameSource, format: request.format, quality: request.quality,
					signal: request.signal, assertCurrent: request.assertCurrent,
					producer: {
						width: 2, height: 2, byteLength: 16,
						async produce(frame, target) {
								await compositor({
								frame, layers: capturedLayers(carrierEffects), width: 2, height: 2,
								rgba: target, signal: request.signal,
							});
							assert.deepEqual(Array.from(target), expected);
						},
						dispose() {},
					},
				});
			},
			async encodeOfflineToSink() { throw new Error('This bounded browser-output regression never opens a sink.'); },
		};
		const strategy = createFramescaperVideoExportStrategyFinishing(PROFILE, dependencies, {
			async loadMediaAsset(key) {
				loads.push(key);
				assert.equal(key, REF.storageKey);
				assert.deepEqual(captures, ['clip']);
				return new Blob([BODY]);
			},
		});
		try {
			const exportProject = strategy.createExportProject({
				canonicalProject,
				delivery: {
					project: { deliveryProjection: true }, audioRenderedFallback: null,
					videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [],
				},
			});
			const plan = strategy.createPlan({
				canonicalProject, exportProject, format: 'mp4', range: 'project', includeAudio: false,
				canvas: { width: 2, height: 2, frameRate: RATE, fit: 'contain', backgroundColor: '#00000000' },
			});
			assert.ok(plan);
			const request: ProductVideoExportStrategyEncodeRequest = {
				canonicalProject, exportProject, plan,
				timingBySourceId: new Map(),
				timingViewsBySourceId: new Map([['source', { kind: 'cfr', rate: RATE, frameCount: 1 }]]),
				videoBlobs: new Map([['source', new Blob(['authenticated-capture-fixture'])]]),
				audioMix: null, editorFfmpeg: {}, webCodecs: null,
				signal: new AbortController().signal, assertCurrent() {}, maximumOutputBytes: undefined,
			};
			const result = await strategy.encode(request);
			assert.equal(offlineCalls, 1);
			assert.deepEqual(captures, ['clip']);
			assert.deepEqual(loads, scenario.load ? [REF.storageKey] : []);
			assert.deepEqual(Array.from(sourcePixels), SOURCE);
			assert.equal(framescaperVideoExportDispositionFinishingFor(plan).exactPlanVersion, scenario.version);
			const encoder = encoderOwner.value;
			assert.ok(encoder);
			assert.deepEqual(encoder.inputCopies, [expected]);
			assert.ok(encoder.calls[0]!.includes('libx264'));
			assert.ok(encoder.calls[0]!.includes('yuv420p'));
			// H264/YUV delivery is lossy and drops alpha. Compare the decoded
			// result with a reference using the observed declared codec arguments.
			assert.deepEqual(encoder.decode(result.bytes), encoder.decode(encoder.referenceEncode(new Uint8Array(expected))));
		} finally { encoderOwner.value?.close(); }
	});
}
