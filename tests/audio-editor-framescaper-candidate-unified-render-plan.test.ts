/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { normalizeNativeMediaImageSequenceSourceV25 } from '../src/common/editor/native-media-image-sequence-v25.ts';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import { createDefaultDissolveVideoTransitionV1 } from '../src/common/editor/video-transition-registry.ts';
import {
	assertUnifiedExactRenderPlanV9,
	assertUnifiedExactRenderPlanV10,
	assertUnifiedExactRenderPlanV11,
	assertUnifiedExactRenderPlanV12,
	fingerprintUnifiedExactRenderPlan,
	type UnifiedExactRenderClipNode,
	type UnifiedExactRenderOpenFxNode,
	type UnifiedExactRenderProfessionalMediaNode,
	type UnifiedExactRenderTransitionNode,
} from '../src/common/editor/unified-exact-render-plan.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import {
	createFramescaperDormantCandidateRenderSession,
} from '../src/framescaper/editor-dormant-candidate-render-session.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanV22,
	type FramescaperUnifiedExactRenderAuthority,
} from '../src/framescaper/editor-project-unified-render-plan-v22.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanV24,
} from '../src/framescaper/editor-project-unified-render-plan-v24.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanV25,
} from '../src/framescaper/editor-project-unified-render-plan-v25.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanV26,
} from '../src/framescaper/editor-project-unified-render-plan-v26.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v22.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import { createFramescaperProjectV22, type FramescaperProjectV22 } from '../src/framescaper/editor-project-v22.ts';
import { createFramescaperProjectV24, type FramescaperProjectV24 } from '../src/framescaper/editor-project-v24.ts';
import { createFramescaperProjectV25, type FramescaperProjectV25 } from '../src/framescaper/editor-project-v25.ts';
import { createFramescaperProjectV26 } from '../src/framescaper/editor-project-v26.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);
const RATE_10 = Object.freeze({ num: 10, den: 1 });

test('V22 builds deterministic V9 source-time and transition authority from an exact project', () => {
	const project = transitionProject();
	const authority = renderAuthority(project, 16);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		project,
		authority,
	);
	assertUnifiedExactRenderPlanV9(plan);
	assert.equal(plan.version, 9);
	assert.equal(plan.sources.length, 1);
	assert.deepEqual(plan.nodes.map(({ kind }) => kind), ['clip', 'clip', 'transition']);
	const clips = plan.nodes.filter((node): node is UnifiedExactRenderClipNode => node.kind === 'clip');
	assert.equal(clips[0]?.sourceTimeMapping.intent.intersections[0]?.clipId, 'outgoing-clip');
	assert.equal(clips[1]?.sourceTimeMapping.intent.intersections[0]?.clipId, 'incoming-clip');
	const transition = plan.nodes.find(
		(node): node is UnifiedExactRenderTransitionNode => node.kind === 'transition',
	);
	assert.equal(transition?.edges.outgoing.retimeMap, null);
	assert.equal(transition?.transition.durationFrames, 4);
	assert.deepEqual(
		fingerprintUnifiedExactRenderPlan(plan),
		fingerprintUnifiedExactRenderPlan(createFramescaperProjectUnifiedExactRenderPlanV22(
			FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, project, authority,
		)),
	);
});

test('V22 refuses unavailable audio authority, unbound timing, and omitted inherited picture state', () => {
	const project = transitionProject();
	const authority = renderAuthority(project, 16);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		project,
		{ ...authority, includeAudio: true, audioLayout: 'stereo' },
	), /audio.*not represented|fail closed/iu);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		project,
		{ ...authority, timingViews: new Map() },
	), /timing.*exact|video-source/iu);
	const keyed = structuredClone(project) as unknown as Record<string, unknown>;
	const clip = (keyed.clips as Record<string, unknown>[])[0]!;
	clip.videoKeyframes = opacityKeyframes();
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		keyed,
		authority,
	), /keyframe|project.*valid/iu);
});

test('V24 builds V10 visual and fresh external freeze authority deterministically', () => {
	const project = visualProject();
	const authority = {
		...renderAuthority(project, 30),
		visualFreshnessByModelId: visualFreshness(project),
	};
	const plan = createFramescaperProjectUnifiedExactRenderPlanV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		project,
		authority,
	);
	assertUnifiedExactRenderPlanV10(plan);
	assert.deepEqual(plan.nodes.filter(({ kind }) => kind === 'visual').map((node) => (
		node.kind === 'visual' ? node.modelKind : ''
	)), ['still', 'title', 'adjustment-layer', 'preset', 'mask-matte']);
	const unused = new Map(authority.visualFreshnessByModelId);
	unused.set('unused', freshness({ unused: true }));
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		project,
		{ ...authority, visualFreshnessByModelId: unused },
	), /freshness.*exact|unused/iu);

	const authoredState = videoFreezeState('video-source');
	const freezeFreshness = freshness(authoredState);
	const fallback = createVideoFreezeFallbackV1({
		renderedSourceId: 'video-source', renderedAssetSha256: '12'.repeat(32),
		...freezeFreshness,
	});
	const frozen = visualProject(fallback);
	const frozenAuthority = {
		...renderAuthority(frozen, 30),
		visualFreshnessByModelId: visualFreshness(frozen),
	};
	const frozenPlan = createFramescaperProjectUnifiedExactRenderPlanV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		frozen,
		frozenAuthority,
	);
	assertUnifiedExactRenderPlanV10(frozenPlan);
	const freezeNode = frozenPlan.nodes.find((node) => (
		node.kind === 'visual' && node.modelKind === 'video-freeze'
	));
	assert.deepEqual(freezeNode, {
		kind: 'visual', nodeId: 'render:visual:video-source', modelId: 'video-source',
		modelKind: 'video-freeze', authoredState, freshness: freezeFreshness,
		frozenFallback: fallback,
	});
	assert.equal(
		fingerprintUnifiedExactRenderPlan(frozenPlan).sha256,
		'01326403334f4688ba3adc37d4a9c61fcba185bad99f8e7272eb0a4dd36030ce',
	);
});

test('V24 refuses stale, unverifiable, and wrong-source freeze fallback authority', () => {
	const authoredState = videoFreezeState('video-source');
	const exactFreshness = freshness(authoredState);
	const fallback = createVideoFreezeFallbackV1({
		renderedSourceId: 'video-source', renderedAssetSha256: '12'.repeat(32),
		...exactFreshness,
	});
	const project = visualProject(fallback);
	const authority = {
		...renderAuthority(project, 30),
		visualFreshnessByModelId: visualFreshness(project),
	};
	const stale = new Map(authority.visualFreshnessByModelId);
	stale.set('video-source', { ...exactFreshness, inputIdentitiesSha256: SHA_A });
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		project,
		{ ...authority, visualFreshnessByModelId: stale },
	), /fallback.*freshness|stale/iu);
	const unverifiable = new Map(authority.visualFreshnessByModelId);
	unverifiable.delete('video-source');
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		project,
		{ ...authority, visualFreshnessByModelId: unverifiable },
	), /no exact freshness|freshness.*exact/iu);
	assert.throws(() => visualProject(createVideoFreezeFallbackV1({
		renderedSourceId: 'video-source', renderedAssetSha256: SHA_D,
		...exactFreshness,
	})), /digest.*rendered source|external asset/iu);
});

test('V25 builds V11 professional image-sequence authority over the original pack', () => {
	const project = professionalProject();
	const plan = createFramescaperProjectUnifiedExactRenderPlanV25(
		FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
		project,
		{ ...renderAuthority(project, 10), visualFreshnessByModelId: new Map() },
	);
	assertUnifiedExactRenderPlanV11(plan);
	const professional = plan.nodes.find(
		(node): node is UnifiedExactRenderProfessionalMediaNode => node.kind === 'professional-media',
	);
	assert.equal(professional?.imageSequence?.inventory.sha256, SHA_B);
	assert.equal(professional?.imageSequence?.sourcePack.sha256, SHA_A);
	assert.equal(professional?.exportAuthority, 'original');
	assert.equal(plan.sources[0]?.mimeType, 'application/vnd.soundscaper.image-sequence-pack');
});

test('V26 builds only active V12 OpenFX state and rejects unrepresentable active dependencies', () => {
	const project = openFxProject('video-source');
	const authority = { ...renderAuthority(project, 10), visualFreshnessByModelId: new Map() };
	const plan = createFramescaperProjectUnifiedExactRenderPlanV26(
		FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE,
		project,
		authority,
	);
	assertUnifiedExactRenderPlanV12(plan);
	const effect = plan.nodes.find(
		(node): node is UnifiedExactRenderOpenFxNode => node.kind === 'openfx',
	);
	assert.equal(effect?.state.instanceId, 'ofx-instance');
	assert.equal(effect?.state.inputs[0]?.sourceRef, 'video-source');
	const audioInput = openFxProject('audio-source');
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV26(
		FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE,
		audioInput,
		{ ...renderAuthority(audioInput, 10), visualFreshnessByModelId: new Map() },
	), /OpenFX.*input|render graph|represent/iu);
});

test('dormant V22/V24/V25/V26 sessions adopt one exact plan for clip preview and export', async () => {
	for (const [generation, expectedPlanVersion] of [
		[22, 9], [24, 10], [25, 11], [26, 12],
	] as const) {
		const project = candidateTransitionProject(generation);
		const baseAuthority = renderAuthority(project as Readonly<Record<string, unknown>>, 16);
		const authority = generation === 22 ? baseAuthority : {
			...baseAuthority, visualFreshnessByModelId: new Map(),
		};
		const session = createFramescaperDormantCandidateRenderSession({
			generation, profile: candidateProfile(generation), project, authority,
		});
		assert.equal(session.status, 'dormant-candidate-render-session');
		assert.equal(session.plan.version, expectedPlanVersion);
		assert.equal(Object.isFrozen(session.plan), true);
		const exporting = session.createClipExportFrameSource('outgoing-clip');
		const exported = exporting.frameAt(2);
		let previewOrdinal = -1;
		const preview = session.createClipPreviewConsumer('outgoing-clip', {
			pause() {}, assertCurrent() {},
			present(request) {
				previewOrdinal = request.drawableSourceFrame;
				return Promise.resolve({ mediaTime: request.targetSeconds });
			},
		}, { onPresented() {} });
		assert.deepEqual(await preview.requestFrame({
			outputOrdinal: 2, clipId: 'outgoing-clip', sourceId: 'video-source',
		}), { kind: 'presented' });
		assert.equal(previewOrdinal, exported.pictures[0]?.sourceOrdinal);
		preview.dispose();
	}
});

test('every dormant plan generation shares its exact transition preview/export resolver', () => {
	for (const generation of [22, 24, 25, 26] as const) {
		const project = candidateTransitionProject(generation);
		const baseAuthority = renderAuthority(project as Readonly<Record<string, unknown>>, 16);
		const session = createFramescaperDormantCandidateRenderSession({
			generation,
			profile: candidateProfile(generation),
			project,
			authority: generation === 22 ? baseAuthority : {
				...baseAuthority, visualFreshnessByModelId: new Map(),
			},
		});
		const preview = session.createTransitionPreviewResolver('transition');
		const exporting = session.createTransitionExportResolver('transition');
		assert.deepEqual(
			preview.resolveAtSequencePosition({ num: 8, den: 1 }),
			exporting.resolveAtSequencePosition({ num: 8, den: 1 }),
		);
	}
	assert.throws(() => createFramescaperDormantCandidateRenderSession({
		generation: 22,
		profile: FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		project: candidateTransitionProject(24),
		authority: renderAuthority(
			candidateTransitionProject(24) as Readonly<Record<string, unknown>>, 16,
		),
	}), /V22|profile|schema 22|generation/iu);
});

function transitionProject(): FramescaperProjectV22 {
	return createFramescaperProjectV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, transitionProjectOptions(),
	);
}

function transitionProjectOptions() {
	const options = framescaperV20Options();
	const clips = options.clips as Record<string, unknown>[];
	clips[0]!.id = 'outgoing-clip';
	clips.push({
		kind: 'video', id: 'incoming-clip', sourceId: 'video-source', title: 'Incoming',
		sequenceId: 'main-sequence', sequenceStartFrame: 6, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
	});
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	track.clipIds = ['outgoing-clip', 'incoming-clip'];
	return {
		...options,
		videoTransitionsByTrackId: {
			'video-track': [createDefaultDissolveVideoTransitionV1({
				id: 'transition', outgoingClipId: 'outgoing-clip', incomingClipId: 'incoming-clip',
				durationFrames: 4,
			})],
		},
	};
}

function candidateTransitionProject(generation: 22 | 24 | 25 | 26): unknown {
	const options = transitionProjectOptions();
	if (generation === 22) {
		return createFramescaperProjectV22(FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, options);
	}
	if (generation === 24) {
		return createFramescaperProjectV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, options);
	}
	if (generation === 25) {
		return createFramescaperProjectV25(FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, options);
	}
	return createFramescaperProjectV26(FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE, {
		...options, ofxEffects: [],
	});
}

function candidateProfile(generation: 22 | 24 | 25 | 26): unknown {
	if (generation === 22) return FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE;
	if (generation === 24) return FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE;
	if (generation === 25) return FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE;
	return FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE;
}

function visualProject(freezeFallback?: ReturnType<typeof createVideoFreezeFallbackV1>): FramescaperProjectV24 {
	const options = framescaperV20Options();
	const still = stillSource();
	const stillClip = visualClip('still', 'still-clip', 'still-source', 10);
	const generator = generatorSource();
	const generatorClip = {
		...visualClip('generator', 'generator-clip', 'generator-source', 20),
		sourceInFrame: 0, sourceFrameCount: 10,
	};
	(options.clips as Record<string, unknown>[]).push(stillClip, generatorClip);
	((options.tracks as Record<string, unknown>[])[0]!.clipIds as string[]).push('still-clip', 'generator-clip');
	return createFramescaperProjectV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			stillSources: [still], generatorSources: [generator],
			adjustmentLayers: [adjustment()], presets: [preset()], maskMattes: [mask()],
			freezeFallbacks: freezeFallback === undefined ? [] : [freezeFallback],
		},
	});
}

function professionalProject(): FramescaperProjectV25 {
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[])[0]!;
	const characteristics = createUnreportedVideoSourceCharacteristicsV25();
	source.storageKey = `image-sequence-pack-sha256:${SHA_A}`;
	source.contentSha256 = SHA_A;
	source.characteristics = characteristics;
	source.imageSequence = normalizeNativeMediaImageSequenceSourceV25({
		kind: 'video', sourceType: 'image-sequence', version: 1,
		id: 'video-source', name: 'Video', stem: 'shot_', extension: 'png',
		frameNumberWidth: 4, firstFrameNumber: 1, lastFrameNumber: 10,
		frameCount: 10, frameRate: RATE_10,
		inventory: {
			kind: 'image-sequence-inventory', version: 1,
			storageKey: `image-sequence-inventory-sha256:${SHA_B}`,
			sha256: SHA_B, byteLength: 512, frameCount: 10,
			firstFrameNumber: 1, lastFrameNumber: 10,
		},
		sourcePack: {
			kind: 'image-sequence-source-pack', storageKey: `image-sequence-pack-sha256:${SHA_A}`,
			sha256: SHA_A, byteLength: 8_192,
		},
		characteristics,
	});
	return createFramescaperProjectV25(FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
	});
}

function openFxProject(inputSourceId: string) {
	return createFramescaperProjectV26(FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
		ofxEffects: [{
			schemaVersion: 1, instanceId: 'ofx-instance', pluginId: 'net.example.Filter',
			binarySha256: SHA_A, context: 'filter',
			attachment: { kind: 'filter', targetId: 'video-clip' },
			inputs: [{ name: 'Source', sourceRef: inputSourceId }],
			parameters: [], customEncodings: {}, enabled: true,
			freshness: {
				authoredStateSha256: SHA_A, inputIdentitiesSha256: SHA_B,
				renderPlanFingerprintSha256: SHA_C, nativeEffectFingerprintSha256: SHA_D,
			},
			frozenFallback: null,
		}],
	});
}

function renderAuthority(project: Readonly<Record<string, unknown>>, frameCount: number): FramescaperUnifiedExactRenderAuthority {
	const timingViews = new Map<string, VideoSourceTimingView>();
	for (const source of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (source.kind !== 'video') continue;
		timingViews.set(String(source.id), Object.freeze({
			kind: 'cfr', rate: source.frameRate as typeof RATE_10,
			frameCount: Number(source.sourceFrameCount),
		}));
	}
	return {
		sequenceId: 'main-sequence', sampleStart: 0,
		sampleDuration: frameCount * 4_800, outputRate: RATE_10,
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		canvas: {
			width: 1_920, height: 1_080, fit: 'contain', pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
		},
		includeAudio: false, audioLayout: null, timingViews,
	};
}

function visualFreshness(project: FramescaperProjectV24) {
	const sourceById = new Map(project.sources.map((source) => [String(source.id), source]));
	const states = new Map<string, unknown>();
	for (const clip of project.clips) {
		if (clip.kind !== 'still' && clip.kind !== 'generator') continue;
		states.set(String(clip.sourceId), { source: sourceById.get(String(clip.sourceId)), clip });
	}
	for (const state of project.videoAdjustmentLayers) states.set(state.id, state);
	for (const state of project.videoVisualPresets) states.set(state.id, state);
	for (const state of project.videoMaskMattes) states.set(state.id, state);
	for (const fallback of project.videoFreezeFallbacks) {
		states.set(fallback.renderedSourceId, videoFreezeState(fallback.renderedSourceId));
	}
	return new Map([...states].map(([id, state]) => [id, freshness(state)]));
}

function freshness(state: unknown) {
	return Object.freeze({
		authoredStateSha256: fingerprintNativeMediaPlan(state).sha256,
		inputIdentitiesSha256: SHA_B,
		renderPlanFingerprintSha256: SHA_C,
		nativeEffectFingerprintSha256: SHA_D,
	});
}

function videoFreezeState(renderedSourceId: string) {
	return Object.freeze({ schemaVersion: 1 as const, kind: 'video-freeze' as const, renderedSourceId });
}

function stillSource() {
	return {
		schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate',
		mimeType: 'image/png', storageKey: 'still-storage', contentSha256: SHA_A,
		width: 1_920, height: 1_080, hasAlpha: true,
	};
}

function generatorSource() {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Title',
		width: 1_920, height: 1_080, frameRate: RATE_10, frameCount: 100,
		generator: {
			kind: 'title', text: 'Framescaper', fontFamily: 'soundscaper-sans', fontSize: 72,
			color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle',
		},
	};
}

function visualClip(kind: 'still' | 'generator', id: string, sourceId: string, start: number) {
	return {
		schemaVersion: 1, kind, id, sourceId, sequenceId: 'main-sequence',
		sequenceStartFrame: start, sequenceFrameCount: 10,
	};
}

function adjustment() {
	return {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 30,
		targetTrackIds: ['video-track'], effectIds: [],
	};
}

function preset() {
	return {
		schemaVersion: 1, kind: 'video-preset', id: 'preset', name: 'Look',
		modelKind: 'adjustment-layer', authoredStateSha256: SHA_A,
	};
}

function mask() {
	return {
		schemaVersion: 1, id: 'mask', kind: 'mask',
		inputs: [{ name: 'plate', sourceRef: 'still-source', kind: 'alpha' }],
		nodes: [{
			id: 'shape', kind: 'vector-shape', shape: 'rectangle',
			x: 0, y: 0, width: 1_920, height: 1_080,
		}],
		outputNodeId: 'shape',
	};
}
