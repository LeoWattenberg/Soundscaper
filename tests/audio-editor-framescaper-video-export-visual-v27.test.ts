/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportDelivery } from '../src/common/editor/controller/product-video-export-strategy.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import type { VideoKeyframeOfflineVideoExportRequest } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import type { VideoKeyframeVideoEncoderRequest } from '../src/common/editor/video-keyframe-video-encoder.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { reconcileFramescaperProjectFeatureRequirementsV27 } from '../src/framescaper/editor-project-feature-requirements-v27.ts';
import { createFramescaperPlaybackProjectServiceV27 } from '../src/framescaper/editor-project-playback-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	cloneFramescaperProjectV27,
	createFramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import {
	createFramescaperVideoExportStrategyV27,
	framescaperVideoExportDispositionV27For,
} from '../src/framescaper/video-export-strategy-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import {
	captureFramescaperExactExportTestFrame,
	composeFramescaperExactExportTestFrame,
} from './helpers/framescaper-exact-export-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 encodes still-only and generator-only pixels with an exact zero-omission ledger', async () => {
	const stillBlob = new Blob(['still-original'], { type: 'image/png' });
	const projects = [
		{ project: generatorProject(), expected: [255, 0, 0, 255] as const, store: undefined },
		{
			project: stillProject(await digestMediaContent(stillBlob)),
			expected: [0, 255, 0, 255] as const,
			store: {
				loadMediaAsset: () => Promise.resolve(stillBlob),
				decodeStillAsset: () => Promise.resolve({
					width: 2, height: 2,
					pixels: greenPixels(),
				}),
			},
		},
	];
	for (const fixture of projects) {
		let rendered: readonly number[] | null = null;
		const strategy = createFramescaperVideoExportStrategyV27(PROFILE, {
			async encodeOffline() { throw new Error('picture-only export must not use the V20 renderer'); },
			async encodeOfflineToSink() { throw new Error('sink path is not used'); },
			async encodePicture(_editorFfmpeg: unknown, request: VideoKeyframeVideoEncoderRequest) {
				const pixels = new Uint8Array(request.producer.byteLength);
				const executionSignal = new AbortController().signal;
				assert.notStrictEqual(executionSignal, request.signal);
				await request.producer.produce(request.frameSource.frame(0), pixels, {
					signal: executionSignal,
				});
				rendered = [...pixels.subarray(0, 4)];
				return encodedResult();
			},
		}, fixture.store);
		const exportProject = strategy.createExportProject({
			canonicalProject: fixture.project, delivery: delivery(fixture.project),
		});
		const plan = strategy.createPlan({
			canonicalProject: fixture.project, exportProject, format: 'mp4', range: 'project',
			includeAudio: false, canvas: { maximumWidth: 2, maximumHeight: 2 },
		});
		assert.ok(plan);
		assert.deepEqual(plan.activeSourceIds, []);
		await strategy.encode({
			canonicalProject: fixture.project, exportProject, plan,
			timingBySourceId: new Map<string, never>(),
			timingViewsBySourceId: new Map<string, VideoSourceTimingView>(),
			videoBlobs: new Map(), audioMix: null, editorFfmpeg: {}, webCodecs: null,
			signal: new AbortController().signal, assertCurrent() {}, maximumOutputBytes: 1_024,
		});
		assert.deepEqual(rendered, fixture.expected);
		const disposition = framescaperVideoExportDispositionV27For(plan);
		assert.deepEqual(disposition.unexplainedOmittedNodeIds, []);
		assert.ok(disposition.nodeDispositions.some(({ kind, disposition: state }) => (
			kind === 'visual' && state === 'executed'
		)));
	}
});

test('selected V27 export executes masks and adjustments while accounting freeze and preset state', async () => {
	const stillBlob = new Blob(['visual-still-original'], { type: 'image/png' });
	const project = visualFinishingProject(await digestMediaContent(stillBlob));
	let rendered: Uint8Array<ArrayBuffer> | null = null;
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE, {
		async encodeOffline() { throw new Error('visual-only export must not use V20 rendering'); },
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
		async encodePicture(_editorFfmpeg: unknown, request: VideoKeyframeVideoEncoderRequest) {
			const pixels = new Uint8Array(request.producer.byteLength);
			await request.producer.produce(request.frameSource.frame(0), pixels, {
				signal: request.signal!,
			});
			rendered = pixels.slice() as Uint8Array<ArrayBuffer>;
			return encodedResult();
		},
	}, {
		loadMediaAsset: () => Promise.resolve(stillBlob),
		decodeStillAsset: () => Promise.resolve({ width: 2, height: 2, pixels: greenPixels() }),
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: { maximumWidth: 2, maximumHeight: 2 },
	});
	assert.ok(plan);
	await strategy.encode({
		canonicalProject: project, exportProject, plan,
		timingBySourceId: new Map<string, never>(),
		timingViewsBySourceId: new Map<string, VideoSourceTimingView>(),
		videoBlobs: new Map(), audioMix: null, editorFfmpeg: {}, webCodecs: null,
		signal: new AbortController().signal, assertCurrent() {}, maximumOutputBytes: 1_024,
	});
	assert.ok(rendered);
	assert.ok(rendered[0]! > rendered[1]! && rendered[0]! < 255, 'masked left pixel is adjusted red');
	assert.ok(rendered[5]! > rendered[4]! && rendered[5]! < 255, 'unmasked right pixel is adjusted green');
	const disposition = framescaperVideoExportDispositionV27For(plan);
	const states = new Map(disposition.nodeDispositions.map(
		({ nodeId, disposition: state }) => [nodeId, state],
	));
	for (const modelId of ['a-still-clip', 'z-solid-clip', 'half-mask', 'adjustment', 'video-freeze:still-source']) {
		assert.equal([...states].find(([nodeId]) => nodeId.includes(modelId))?.[1], 'executed');
	}
	assert.equal([...states].find(([nodeId]) => nodeId.includes('look-preset'))?.[1], 'verified-inventory');
	assert.deepEqual(disposition.unexplainedOmittedNodeIds, []);
});

test('selected V27 export executes clip presentation opacity and masks over the delivery canvas', async () => {
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { maskMattes: [{
			schemaVersion: 1, id: 'video-half-mask', kind: 'mask', inputs: [],
			nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle',
				x: 0, y: 0, width: 0.5, height: 1 }], outputNodeId: 'shape',
		}] },
		finishing: { visualPresentations: [{
			schemaVersion: 1, id: 'video-presentation', owner: { kind: 'clip', id: 'video-clip' },
			enabled: true, opacity: 0.5, blendMode: 'normal', grade: null,
			processorStackId: null, maskMatteIds: ['video-half-mask'],
		}] },
	});
	const rendered: { pixels: Uint8Array<ArrayBuffer> | null } = { pixels: null };
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE, {
		captureExactFrame: captureFramescaperExactExportTestFrame,
		async encodeOffline(request) {
			const pixels = new Uint8Array(request.canvas.width * request.canvas.height * 4);
			for (let offset = 0; offset < pixels.length; offset += 4) {
				pixels[offset] = 200;
				pixels[offset + 3] = 255;
			}
			await composeFramescaperExactExportTestFrame(
				request, keyedFrame(), pixels, [200, 0, 0, 255],
			);
			rendered.pixels = pixels.slice() as Uint8Array<ArrayBuffer>;
			return encodedResult();
		},
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: { maximumWidth: 2, maximumHeight: 2 },
	});
	assert.ok(plan);
	await strategy.encode({
		canonicalProject: project, exportProject, plan,
		timingBySourceId: new Map<string, never>(), timingViewsBySourceId: rawTiming(project),
		videoBlobs: new Map([['video-source', new Blob(['video'])]]), audioMix: null,
		editorFfmpeg: {}, webCodecs: null, signal: new AbortController().signal,
		assertCurrent() {}, maximumOutputBytes: 1_024,
	});
	assert.ok(rendered.pixels);
	assert.ok(rendered.pixels[0]! > 0 && rendered.pixels[0]! < 200,
		'masked picture is composited at authored opacity');
	assert.deepEqual([...rendered.pixels.subarray(4, 8)], [0, 0, 0, 255]);
	assert.equal(framescaperVideoExportDispositionV27For(plan).nodeDispositions.find(
		({ nodeId }) => nodeId.includes('video-half-mask'),
	)?.disposition, 'executed');
});

test('complete V27 program exports original-authoritative editorial, proxy, audio, captions, and finishing', async () => {
	const project = completeProgramProject();
	const captured: { request: VideoKeyframeOfflineVideoExportRequest | null } = { request: null };
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE, {
		captureExactFrame: captureFramescaperExactExportTestFrame,
		async encodeOffline(request) {
			captured.request = request;
			const pixels = new Uint8Array(request.canvas.width * request.canvas.height * 4).fill(24);
			for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
			await composeFramescaperExactExportTestFrame(
				request, keyedFrame(), pixels, [24, 24, 24, 255],
			);
			return encodedResult();
		},
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	const canonicalSource = (project.sources as readonly Readonly<{
		readonly id: string; readonly kind: string;
		readonly proxyAttachment?: Readonly<{ readonly storageKey: string }> | null;
	}>[]).find(({ id }) => id === 'video-source')!;
	const exportedSource = (exportProject.sources as Readonly<Record<string, unknown>>[])[0]!;
	assert.ok(canonicalSource.kind === 'video' && canonicalSource.proxyAttachment);
	assert.equal(exportedSource.proxyAttachment, undefined);
	assert.equal((exportProject.automationLanes as unknown[]).length, 1);
	assert.equal(((exportProject.mixer as { edges: Array<{ level: number }> }).edges[0]?.level), 0.5);
	const plan = strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: true, canvas: { maximumWidth: 4, maximumHeight: 4 }, captions: 'sidecar',
	});
	assert.ok(plan);
	assert.equal(plan.version, 7);
	const originalInput = plan.inputs.find(({ kind }) => kind === 'video-source');
	assert.equal(originalInput?.storageKey, 'video-source');
	assert.notEqual(originalInput?.storageKey,
		canonicalSource.kind === 'video' ? canonicalSource.proxyAttachment?.storageKey : undefined);
	const originalBlob = new Blob(['original-video'], { type: 'video/mp4' });
	const audioMix = new Blob(['rendered-v21-mix'], { type: 'audio/wav' });
	await strategy.encode({
		canonicalProject: project, exportProject, plan,
		timingBySourceId: new Map<string, never>(), timingViewsBySourceId: rawTiming(project),
		videoBlobs: new Map([['video-source', originalBlob]]), audioMix,
		editorFfmpeg: {}, webCodecs: null, signal: new AbortController().signal,
		assertCurrent() {}, maximumOutputBytes: 1_024,
	});
	assert.ok(captured.request);
	assert.strictEqual(captured.request.audioMix, audioMix);
	assert.strictEqual(captured.request.sources[0]?.blob, originalBlob);
	assert.ok((captured.request.project.clips as Readonly<Record<string, unknown>>[])[0]?.retimeMap);
	const disposition = framescaperVideoExportDispositionV27For(plan);
	assert.deepEqual(disposition.captionTrackIds, ['captions-en']);
	assert.equal(disposition.captionDisposition, 'sidecar-only');
	assert.equal(disposition.audioDisposition, 'shared-v21-delivery');
	assert.ok(disposition.originalSourceIds.includes('video-source'));
	assert.deepEqual(disposition.unexplainedOmittedNodeIds, []);
	assert.ok(disposition.nodeDispositions.some(({ kind, disposition: state }) => (
		kind === 'clip' && state === 'executed'
	)));
	assert.ok(disposition.nodeDispositions.some(({ kind, disposition: state }) => (
		kind === 'visual' && state === 'executed'
	)));
});

function generatorProject() {
	return createFramescaperProjectV27(PROFILE, {
		...visualOnlyOptions([generatorClip()]), videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { generatorSources: [generatorSource()] },
	});
}

function stillProject(contentSha256: string) {
	return createFramescaperProjectV27(PROFILE, {
		...visualOnlyOptions([stillClip('still-clip')]), videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { stillSources: [stillSource(contentSha256)] },
	});
}

function visualFinishingProject(contentSha256: string) {
	const freezeState = { schemaVersion: 1, kind: 'video-freeze', renderedSourceId: 'still-source' };
	const freezeFallback = createVideoFreezeFallbackV1({
		renderedSourceId: 'still-source', renderedAssetSha256: contentSha256,
		authoredStateSha256: fingerprintNativeMediaPlan(freezeState).sha256,
		inputIdentitiesSha256: 'aa'.repeat(32), renderPlanFingerprintSha256: 'bb'.repeat(32),
		nativeEffectFingerprintSha256: 'cc'.repeat(32),
	});
	return createFramescaperProjectV27(PROFILE, {
		...visualOnlyOptions([stillClip('a-still-clip'), { ...generatorClip(), id: 'z-solid-clip' }]),
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			stillSources: [stillSource(contentSha256)], generatorSources: [generatorSource()],
			adjustmentLayers: [{
				schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				targetTrackIds: ['video-track'], effectIds: [],
			}],
			presets: [{
				schemaVersion: 1, kind: 'video-preset', id: 'look-preset', name: 'Look',
				modelKind: 'adjustment-layer', authoredStateSha256: 'dd'.repeat(32),
			}],
			maskMattes: [{
				schemaVersion: 1, id: 'half-mask', kind: 'mask', inputs: [],
				nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle',
					x: 0, y: 0, width: 0.5, height: 1 }], outputNodeId: 'shape',
			}], freezeFallbacks: [freezeFallback],
		},
		finishing: { visualPresentations: [{
			schemaVersion: 1, id: 'solid-mask', owner: { kind: 'generator', id: 'solid-source' },
			enabled: true, opacity: 1, blendMode: 'normal', grade: null,
			processorStackId: null, maskMatteIds: ['half-mask'],
		}, {
			schemaVersion: 1, id: 'adjustment-grade', owner: { kind: 'adjustment-layer', id: 'adjustment' },
			enabled: true, opacity: 1, blendMode: 'normal', grade: darkeningGrade(),
			processorStackId: null, maskMatteIds: [],
		}] },
	});
}

function visualOnlyOptions(clips: readonly Readonly<Record<string, unknown>>[]) {
	const options = framescaperV20Options();
	options.sources = [];
	options.clips = clips;
	(options.projectBin as Record<string, unknown>).clips = [];
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	track.clipIds = clips.map(({ id }) => String(id));
	options.tracks = [track];
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = ['video-track'];
	return options;
}

function stillClip(id: string) {
	return { schemaVersion: 1, kind: 'still', id, sourceId: 'still-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10 };
}

function generatorClip() {
	return { schemaVersion: 1, kind: 'generator', id: 'solid-clip', sourceId: 'solid-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10 };
}

function stillSource(contentSha256: string) {
	return { schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Still',
		mimeType: 'image/png', storageKey: 'still-storage', contentSha256,
		width: 2, height: 2, hasAlpha: false };
}

function generatorSource() {
	return { schemaVersion: 1, kind: 'generator', id: 'solid-source', name: 'Solid',
		width: 2, height: 2, frameRate: { num: 10, den: 1 }, frameCount: 10,
		generator: { kind: 'solid', color: '#ff0000ff' } };
}

function darkeningGrade() {
	return { schemaVersion: 1, exposureStops: -1, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null };
}

function completeProgramProject() {
	const options = framescaperV20Options();
	const clip = (options.clips as Record<string, unknown>[])[0]!;
	clip.retimeMap = {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 10, den: 1 } },
			{ outerFrame: 10, sourceFrame: { num: 0, den: 1 } },
		], segments: [{ mode: 'constant-reverse' }],
	};
	const visualClip = { ...generatorClip(), id: 'program-title' };
	(options.clips as Record<string, unknown>[]).push(visualClip);
	((options.tracks as Record<string, unknown>[])[0]!.clipIds as string[]).push('program-title');
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { generatorSources: [generatorSource()] },
		finishing: {
			visualPresentations: [{
				schemaVersion: 1, id: 'program-grade', owner: { kind: 'clip', id: 'video-clip' },
				enabled: true, opacity: 1, blendMode: 'normal', grade: darkeningGrade(),
				processorStackId: null, maskMatteIds: [],
			}, {
				schemaVersion: 1, id: 'program-title-mix', owner: { kind: 'generator', id: 'solid-source' },
				enabled: true, opacity: 0.5, blendMode: 'screen', grade: null,
				processorStackId: null, maskMatteIds: [],
			}],
			captionTracks: [captionTrack()], automationLanes: [automationLane()],
		},
	});
	const mutable = structuredClone(project) as unknown as Record<string, unknown>;
	((mutable.sources as Record<string, unknown>[])[0]!).proxyAttachment = proxyAttachment();
	((mutable.mixer as { edges: Array<Record<string, unknown>> }).edges[0]!).level = 0.5;
	mutable.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(PROFILE, mutable);
	return cloneFramescaperProjectV27(PROFILE, mutable);
}

function proxyAttachment() {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${'34'.repeat(32)}`,
		mimeType: 'video/mp4', byteLength: 4_096, sha256: '34'.repeat(32),
		originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${'56'.repeat(32)}`, sha256: '56'.repeat(32),
			sourceSha256: '34'.repeat(32), byteLength: 112, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		}, audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function captionTrack() {
	return {
		schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence',
		name: 'English', language: 'en', styles: [], regions: [], speakers: [],
		cues: [{ schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000,
			text: 'Programme', styleId: null, regionId: null, speakerId: null, words: [] }],
	};
}

function automationLane() {
	return {
		id: 'automation-master-gain',
		address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [{ id: 'point-1', position: 0, value: 0.75 }],
		segments: [],
	};
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

function keyedFrame() {
	return {
		index: 0, timelineSample: 0, timelinePosition: { num: 0, den: 1 },
		layers: [{ clips: [{ clipId: 'video-clip', sourceId: 'video-source',
			presentationDescriptor: { drawableSourceFrame: 9, outerCell: 0 } }] }],
	};
}

function greenPixels(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from({ length: 16 }, (_unused, index) => (
		index % 4 === 1 || index % 4 === 3 ? 255 : 0
	)) as Uint8Array<ArrayBuffer>;
}

function encodedResult() {
	return Object.freeze({
		bytes: Uint8Array.of(1, 2, 3), byteLength: 3, videoEncoder: 'ffmpeg' as const,
		format: 'mp4' as const, extension: '.mp4' as const, mimeType: 'video/mp4' as const,
		frameCount: 10, rgbaChunkCount: 1, outputChunkCount: 1,
	});
}

function delivery(project: ReturnType<typeof createFramescaperProjectV27>): ProductVideoExportDelivery {
	return createFramescaperPlaybackProjectServiceV27(PROFILE)
		.projectForVideoRenderedFallbackDelivery(project) as ProductVideoExportDelivery;
}
