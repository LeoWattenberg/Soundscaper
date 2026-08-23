/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportDelivery } from '../src/common/editor/controller/product-video-export-strategy.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../src/common/editor/project-owned-feature-requirements.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-management-v27.ts';
import { analyzeVideoMotionV1 } from '../src/common/editor/video-motion-analysis-v27.ts';
import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import { exportVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';
import { createUnreportedVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import type { VideoKeyframeOfflineVideoExportRequest } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import { reconcileFramescaperProjectFeatureRequirementsV27 } from '../src/framescaper/editor-project-feature-requirements-v27.ts';
import { createFramescaperPlaybackProjectServiceV27 } from '../src/framescaper/editor-project-playback-v27.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import {
	cloneFramescaperProjectV27,
	createFramescaperProjectV27,
	reimportFramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import {
	createFramescaperVideoExportStrategyV27,
	framescaperVideoExportDispositionV27For,
} from '../src/framescaper/video-export-strategy-v27.ts';
import { framescaperV20Options, opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';
import {
	captureFramescaperExactExportTestFrame,
	composeFramescaperExactExportTestFrame,
} from './helpers/framescaper-exact-export-fixture.ts';
import { transitionProjectOptions } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 browser strategy delegates exact retime/keyframe encoding through V20', async () => {
	const project = keyedProject();
	const captured: VideoKeyframeOfflineVideoExportRequest[] = [];
	let processedPixel: readonly number[] | null = null;
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE, {
		captureExactFrame: captureFramescaperExactExportTestFrame,
		async encodeOffline(request) {
			captured.push(request);
			const canvas = request.canvas;
			const rgba = new Uint8Array(canvas.width * canvas.height * 4).fill(16);
			for (let offset = 3; offset < rgba.length; offset += 4) rgba[offset] = 255;
			await composeFramescaperExactExportTestFrame(
				request, exportFrame(0, 0), rgba, [16, 16, 16, 255],
			);
			processedPixel = [...rgba.subarray(0, 4)];
			return Object.freeze({
				bytes: Uint8Array.of(1, 2, 3), byteLength: 3, videoEncoder: 'ffmpeg' as const,
				format: 'mp4' as const, extension: '.mp4' as const, mimeType: 'video/mp4' as const,
				frameCount: 10, rgbaChunkCount: 1, outputChunkCount: 1,
			});
		},
		async encodeOfflineToSink() { throw new Error('sink path is not used by this test'); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: delivery(project),
	});
	assert.equal(exportProject.schemaVersion, 27);
	const canonicalClip = (project.clips as Readonly<Record<string, unknown>>[])[0]!;
	const exportClip = (exportProject.clips as Readonly<Record<string, unknown>>[])[0]!;
	assert.deepEqual(exportClip.videoKeyframes, canonicalClip.videoKeyframes);
	assert.deepEqual(exportClip.retimeMap, canonicalClip.retimeMap);
	const plan = strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: { maximumWidth: 640, maximumHeight: 360 },
	});
	assert.equal(plan?.version, 7);
	assert.deepEqual(plan?.activeSourceIds, ['video-source']);
	assert.ok(plan);
	const signal = new AbortController().signal;
	const encoded = await strategy.encode({
		canonicalProject: project, exportProject, plan,
		timingBySourceId: new Map<string, never>(),
		timingViewsBySourceId: rawTiming(project),
		videoBlobs: new Map([['video-source', new Blob(['video'], { type: 'video/mp4' })]]),
		audioMix: null,
		editorFfmpeg: {}, webCodecs: null,
		signal, assertCurrent() {}, maximumOutputBytes: 1_024,
	});
	assert.equal(encoded.byteLength, 3);
	assert.equal(captured.length, 1);
	assert.equal(captured[0]?.project.schemaVersion, 17);
	assert.notStrictEqual(captured[0]?.project, exportProject);
	assert.equal(typeof captured[0]?.rgbaCompositor, 'function');
	assert.deepEqual(processedPixel, [0, 0, 0, 255]);
	assert.deepEqual(framescaperVideoExportDispositionV27For(plan).unexplainedOmittedNodeIds, []);

	const other = keyedProject('other-v27');
	assert.throws(() => strategy.createPlan({
		canonicalProject: other, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: undefined,
	}), /not owned.*exact V27/iu);
});

test('selected V27 browser strategy selects exact keyed and product-owned visual RGBA routes', () => {
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE);
	const baseline = createFramescaperProjectV27(PROFILE, framescaperV20Options());
	const baselineExport = strategy.createExportProject({
		canonicalProject: baseline, delivery: delivery(baseline),
	});
	assert.equal(strategy.createPlan({
		canonicalProject: baseline, exportProject: baselineExport, format: 'mp4', range: 'project',
		includeAudio: false, canvas: undefined,
	})?.version, 7);

	const transition = createFramescaperProjectV27(PROFILE, transitionProjectOptions());
	const transitionExport = strategy.createExportProject({
		canonicalProject: transition, delivery: delivery(transition),
	});
	assert.equal(strategy.createPlan({
		canonicalProject: transition, exportProject: transitionExport,
		format: 'mp4', range: 'project', includeAudio: false, canvas: undefined,
	})?.version, 7);

	const generator = generatorProject();
	const generatorExport = strategy.createExportProject({
		canonicalProject: generator, delivery: delivery(generator),
	});
	assert.equal(strategy.createPlan({
		canonicalProject: generator, exportProject: generatorExport,
		format: 'mp4', range: 'project', includeAudio: false, canvas: undefined,
	})?.version, 13);

	const overriddenValue = structuredClone(baseline) as unknown as Record<string, unknown>;
	const interpretation = (overriddenValue.videoSourceColorInterpretations as Record<string, unknown>[])[0]!;
	interpretation.provenance = 'user-override';
	const overridden = cloneFramescaperProjectV27(PROFILE, overriddenValue);
	assert.doesNotThrow(() => strategy.createExportProject({
		canonicalProject: overridden, delivery: delivery(overridden),
	}));
	const mixedValue = structuredClone(baseline) as unknown as Record<string, unknown>;
	const mixer = mixedValue.mixer as { edges: Array<Record<string, unknown>> };
	mixer.edges[0]!.level = 0.5;
	mixedValue.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		mixedValue,
		mixedValue.featureRequirements as Parameters<typeof reconcileProjectOwnedFeatureRequirements>[1],
	);
	mixedValue.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(PROFILE, mixedValue);
	const mixed = cloneFramescaperProjectV27(PROFILE, mixedValue);
	const mixedExport = strategy.createExportProject({
		canonicalProject: mixed, delivery: delivery(mixed),
	});
	assert.equal(mixedExport.schemaVersion, 27);
	assert.equal(((mixedExport.mixer as { edges: Array<{ level: number }> }).edges[0]?.level), 0.5);

	const legacy = reimportFramescaperProjectV27(PROFILE, createFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, framescaperV20Options(),
	));
	assert.throws(() => strategy.createExportProject({
		canonicalProject: legacy, delivery: delivery(legacy),
	}), /legacy unmanaged source/iu);

	const hdrOptions = structuredClone(framescaperV20Options());
	const hdrSource = (hdrOptions.sources as Array<Record<string, unknown>>)[0]!;
	const hdrCharacteristics = structuredClone(createUnreportedVideoSourceCharacteristics()) as unknown as Record<string, unknown>;
	hdrCharacteristics.colour = {
		primaries: 'bt2020', transfer: 'smpte2084', matrix: 'bt2020nc', range: 'limited',
	};
	hdrSource.characteristics = hdrCharacteristics;
	const hdr = createFramescaperProjectV27(PROFILE, hdrOptions);
	assert.equal(hdr.videoSourceColorInterpretations[0]?.provenance, 'metadata');
	assert.throws(() => strategy.createExportProject({
		canonicalProject: hdr, delivery: delivery(hdr),
	}), /HDR or wide-gamut source interpretation/iu);
});

test('selected V27 picture export retains explicit captions for sidecar-only delivery', () => {
	const captionTrack = {
		schemaVersion: 1 as const, id: 'captions-en', sequenceId: 'main-sequence',
		name: 'English', language: 'en', styles: [], regions: [], speakers: [],
		cues: [{
			schemaVersion: 1 as const, id: 'cue-1', startFrame: 0, endFrame: 48_000,
			text: 'Sidecar caption', styleId: null, regionId: null, speakerId: null, words: [],
		}],
	};
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: { captionTracks: [captionTrack] },
	});
	const sidecar = exportVideoCaptionTrackV1(captionTrack, {
		format: 'srt', sampleRate: 48_000,
	});
	assert.match(sidecar.text, /Sidecar caption/u);
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE);
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	assert.deepEqual(exportProject.videoCaptionTracks, [captionTrack]);
	assert.equal(strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: undefined,
	})?.version, 7);
});

test('selected V27 keyed export consumes the canonical dissolve resolver', async () => {
	const project = createFramescaperProjectV27(PROFILE, transitionProjectOptions());
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE, {
		captureExactFrame: captureFramescaperExactExportTestFrame,
		async encodeOffline(request) {
			const rgba = new Uint8Array(request.canvas.width * request.canvas.height * 4).fill(32);
			for (let offset = 3; offset < rgba.length; offset += 4) rgba[offset] = 255;
			await composeFramescaperExactExportTestFrame(
				request, transitionExportFrame(), rgba, [32, 32, 32, 255],
			);
			return encodedResult();
		},
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: { maximumWidth: 4, maximumHeight: 4 },
	});
	assert.ok(plan);
	await strategy.encode({
		canonicalProject: project, exportProject, plan,
		timingBySourceId: new Map<string, never>(), timingViewsBySourceId: rawTiming(project),
		videoBlobs: new Map([['video-source', new Blob(['video'])]]), audioMix: null,
		editorFfmpeg: {}, webCodecs: null, signal: new AbortController().signal,
		assertCurrent() {}, maximumOutputBytes: 1_024,
	});
	const disposition = framescaperVideoExportDispositionV27For(plan);
	assert.deepEqual(disposition.unexplainedOmittedNodeIds, []);
	assert.ok(disposition.nodeDispositions.some(({ kind, disposition: state }) => (
		kind === 'transition' && state === 'executed'
	)));
});

test('selected V27 export loads digest-bound LUT and motion bodies before encoding', async () => {
	const options = framescaperV20Options();
	const source = (options.sources as Readonly<Record<string, unknown>>[])[0]!;
	const stack = motionStack();
	const gray = createGrayVideoFrameV1({
		width: 8, height: 8, samples: new Array<number>(64).fill(0),
	});
	const analysis = await analyzeVideoMotionV1({
		analysisId: 'analysis-1',
		inputSha256: String(source.contentSha256),
		processorStack: stack,
		frames: [{ frameNumber: 0, frame: gray }, { frameNumber: 1, frame: gray }],
	});
	const lutText = constantWhiteCube();
	const parsedLut = parseCubeLutV1(lutText);
	const project = createFramescaperProjectV27(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			visualPresentations: [{
				schemaVersion: 1, id: 'presentation-1',
				owner: { kind: 'clip', id: 'video-clip' },
				enabled: true, opacity: 1, blendMode: 'normal',
				grade: {
					schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
					lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1,
					lut: {
						storageKey: `lut-sha256:${parsedLut.sha256}`,
						sha256: parsedLut.sha256, byteLength: parsedLut.byteLength,
						size: parsedLut.size, domainMin: parsedLut.domainMin,
						domainMax: parsedLut.domainMax,
					},
				},
				processorStackId: 'stack-1', maskMatteIds: [],
			}],
			processorStacks: [stack],
			motionAnalyses: [analysis.reference],
		},
	});
	const loads: string[] = [];
	let processedPixel: readonly number[] | null = null;
	let encodeCalls = 0;
	const dependencies = {
		captureExactFrame: captureFramescaperExactExportTestFrame,
		async encodeOffline(request: VideoKeyframeOfflineVideoExportRequest) {
			encodeCalls += 1;
			const rgba = new Uint8Array(request.canvas.width * request.canvas.height * 4).fill(16);
			for (let offset = 3; offset < rgba.length; offset += 4) rgba[offset] = 255;
			await composeFramescaperExactExportTestFrame(
				request, exportFrame(1, 1), rgba, [16, 16, 16, 255],
			);
			processedPixel = [...rgba.subarray(0, 4)];
			return encodedResult();
		},
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
	};
	const bodies = new Map<string, Blob>([
		[`lut-sha256:${parsedLut.sha256}`, new Blob([lutText])],
		[analysis.reference.storageKey, new Blob([analysis.bytes])],
	]);
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE, dependencies, {
		loadMediaAsset(storageKey) {
			loads.push(storageKey);
			return Promise.resolve(bodies.get(storageKey) ?? null);
		},
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: { maximumWidth: 4, maximumHeight: 4 },
	});
	assert.ok(plan);
	const signal = new AbortController().signal;
	await strategy.encode({
		canonicalProject: project, exportProject, plan,
		timingBySourceId: new Map<string, never>(), timingViewsBySourceId: rawTiming(project),
		videoBlobs: new Map([['video-source', new Blob(['video'])]]), audioMix: null,
		editorFfmpeg: {}, webCodecs: null, signal, assertCurrent() {}, maximumOutputBytes: 1_024,
	});
	assert.deepEqual(loads, [`lut-sha256:${parsedLut.sha256}`, analysis.reference.storageKey]);
	assert.equal(encodeCalls, 1);
	assert.deepEqual(processedPixel, [255, 255, 255, 255]);

	const missing = createFramescaperVideoExportStrategyV27(PROFILE, dependencies, {
		loadMediaAsset: () => Promise.resolve(null),
	});
	const missingExport = missing.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	const missingPlan = missing.createPlan({
		canonicalProject: project, exportProject: missingExport, format: 'mp4', range: 'project',
		includeAudio: false, canvas: { maximumWidth: 4, maximumHeight: 4 },
	});
	assert.ok(missingPlan);
	await assert.rejects(missing.encode({
		canonicalProject: project, exportProject: missingExport, plan: missingPlan,
		timingBySourceId: new Map<string, never>(), timingViewsBySourceId: rawTiming(project),
		videoBlobs: new Map([['video-source', new Blob(['video'])]]), audioMix: null,
		editorFfmpeg: {}, webCodecs: null, signal, assertCurrent() {}, maximumOutputBytes: 1_024,
	}), /finishing asset.*missing|missing or stale/iu);
	assert.equal(encodeCalls, 1);
});

function keyedProject(id = 'keyed-v27') {
	const options = framescaperV20Options();
	options.id = id;
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
	});
	const mutable = project as unknown as Record<string, unknown>;
	const clip = (mutable.clips as Record<string, unknown>[])[0]!;
	clip.videoKeyframes = opacityKeyframes(10);
	clip.retimeMap = {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 10, den: 1 } },
			{ outerFrame: 10, sourceFrame: { num: 0, den: 1 } },
		],
		segments: [{ mode: 'constant-reverse' }],
	};
	mutable.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		mutable,
		mutable.featureRequirements as Parameters<typeof reconcileProjectOwnedFeatureRequirements>[1],
	);
	mutable.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(PROFILE, mutable);
	return cloneFramescaperProjectV27(PROFILE, mutable);
}

function rawTiming(project: ReturnType<typeof createFramescaperProjectV27>): ReadonlyMap<string, VideoSourceTimingView> {
	const result = new Map<string, VideoSourceTimingView>();
	const sources = project.sources as readonly Readonly<{
		readonly id: string; readonly kind: string;
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly sourceFrameCount: number;
	}>[];
	for (const source of sources) {
		if (source.kind !== 'video') continue;
		result.set(source.id, Object.freeze({
			kind: 'cfr', rate: source.frameRate, frameCount: source.sourceFrameCount,
		}));
	}
	return result;
}

function exportFrame(sourceFrame: number, outerCell: number) {
	return {
		index: outerCell,
		timelineSample: outerCell * 4_800,
		timelinePosition: { num: outerCell * 4_800, den: 1 },
		layers: [{
			clips: [{
				clipId: 'video-clip', sourceId: 'video-source',
				presentationDescriptor: { drawableSourceFrame: sourceFrame, outerCell },
			}],
		}],
	};
}

function transitionExportFrame() {
	return {
		index: 6, timelineSample: 28_800,
		timelinePosition: { num: 28_800, den: 1 },
		layers: [{ clips: [{
			clipId: 'outgoing-clip', sourceId: 'video-source',
			opacity: 1,
			presentationDescriptor: { drawableSourceFrame: 6, outerCell: 6 },
		}, {
			clipId: 'incoming-clip', sourceId: 'video-source',
			opacity: 0,
			presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
		}] }],
	};
}

function motionStack() {
	return {
		schemaVersion: 1 as const, id: 'stack-1', sourceId: 'video-source',
		processors: [{
			schemaVersion: 1 as const, id: 'tracking-1', kind: 'tracking' as const,
			enabled: true, maximumFeatures: 16, quality: 0.05,
			minimumDistance: 2, windowRadius: 2, pyramidLevels: 2,
		}, {
			schemaVersion: 1 as const, id: 'stabilize-1', kind: 'similarity-stabilization' as const,
			enabled: true, motionProvider: 'pyramidal-lucas-kanade' as const,
			analysisId: 'analysis-1', strength: 1,
		}],
	};
}

function constantWhiteCube(): string {
	return `LUT_3D_SIZE 2\n${new Array<string>(8).fill('1 1 1').join('\n')}\n`;
}

function encodedResult() {
	return Object.freeze({
		bytes: Uint8Array.of(1, 2, 3), byteLength: 3, videoEncoder: 'ffmpeg' as const,
		format: 'mp4' as const, extension: '.mp4' as const, mimeType: 'video/mp4' as const,
		frameCount: 10, rgbaChunkCount: 1, outputChunkCount: 1,
	});
}

function generatorProject() {
	const options = visualOnlyOptions({
		schemaVersion: 1, kind: 'generator', id: 'solid-clip', sourceId: 'solid-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	});
	return createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			generatorSources: [{
				schemaVersion: 1, kind: 'generator', id: 'solid-source', name: 'Solid',
				width: 2, height: 2, frameRate: { num: 10, den: 1 }, frameCount: 10,
				generator: { kind: 'solid', color: '#ff0000ff' },
			}],
		},
	});
}

function visualOnlyOptions(
	clipValue: Readonly<Record<string, unknown>> | readonly Readonly<Record<string, unknown>>[],
) {
	const clips = Array.isArray(clipValue) ? clipValue : [clipValue];
	const options = framescaperV20Options();
	options.sources = [];
	options.clips = clips;
	(options.projectBin as Record<string, unknown>).clips = [];
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	track.clipIds = clips.map((clip) => String(clip.id));
	options.tracks = [track];
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = ['video-track'];
	return options;
}

function delivery(project: ReturnType<typeof createFramescaperProjectV27>): ProductVideoExportDelivery {
	return createFramescaperPlaybackProjectServiceV27(PROFILE)
		.projectForVideoRenderedFallbackDelivery(project) as ProductVideoExportDelivery;
}
