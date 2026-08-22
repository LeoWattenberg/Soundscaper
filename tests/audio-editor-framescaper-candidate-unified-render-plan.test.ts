/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../src/common/editor/project-owned-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from '../src/common/editor/project-feature-requirements.ts';
import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import {
	assertUnifiedExactRenderPlanV9,
	assertUnifiedExactRenderPlanV10,
	assertUnifiedExactRenderPlanV11,
	assertUnifiedExactRenderPlanV12,
	createUnifiedExactRenderPlan,
	fingerprintUnifiedExactRenderPlan,
	type UnifiedExactRenderClipNode,
	type UnifiedExactRenderOpenFxNode,
	type UnifiedExactRenderProfessionalMediaNode,
	type UnifiedExactRenderTransitionNode,
	type UnifiedExactRenderVisualNode,
} from '../src/common/editor/unified-exact-render-plan.ts';
import {
	createFramescaperDormantCandidateRenderSession,
} from '../src/framescaper/editor-dormant-candidate-render-session.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV22,
} from '../src/framescaper/editor-project-feature-requirements-v22.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanV22,
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
import { createFramescaperProjectV22 } from '../src/framescaper/editor-project-v22.ts';
import { opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';
import {
	candidateProfile,
	candidateTransitionProject,
	freshness,
	openFxProject,
	professionalProject,
	renderAuthority,
	transitionProject,
	transitionProjectOptions,
	UNIFIED_RENDER_SHA_A as SHA_A,
	UNIFIED_RENDER_SHA_B as SHA_B,
	UNIFIED_RENDER_SHA_D as SHA_D,
	videoFreezeState,
	visualFreshness,
	visualProject,
} from './helpers/framescaper-unified-render-project-fixture.ts';

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

test('V22 carries keyed picture and track-compositing authority while refusing absent audio authority', () => {
	const project = transitionProject();
	const authority = renderAuthority(project, 16);
	const keyed = structuredClone(project) as unknown as Record<string, unknown>;
	const clips = keyed.clips as Record<string, unknown>[];
	clips[0]!.videoKeyframes = opacityKeyframes();
	clips[0]!.videoComposition = {
		...(clips[0]!.videoComposition as Record<string, unknown>), opacity: 0.75,
	};
	clips[0]!.videoEffects = [{
		id: 'effect', type: 'color-adjust', enabled: true,
		params: { brightness: 0.1, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 },
	}];
	const tracks = keyed.tracks as Record<string, unknown>[];
	tracks[0]!.hidden = true;
	tracks[0]!.mute = true;
	tracks[0]!.solo = true;
	keyed.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		keyed, keyed.featureRequirements as ProjectFeatureRequirementsManifest,
	);
	keyed.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, keyed,
	);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		keyed,
		{
			...authority, includeAudio: true, audioLayout: 'stereo',
			codecs: { ...authority.codecs, audio: 'aac', audioEncoder: 'aac' },
		},
	), /Audio authority is not represented/iu);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, keyed, authority,
	);
	const picture = plan.nodes.find((node): node is UnifiedExactRenderClipNode => (
		node.kind === 'clip' && node.clipId === 'outgoing-clip'
	));
	assert.deepEqual(plan.tracks, [{
		trackId: 'video-track', sequenceOrder: 0, hidden: true, mute: true, solo: true,
	}]);
	assert.equal(picture?.pictureState.composition.opacity, 0.75);
	assert.equal(picture?.pictureState.videoEffects[0]?.id, 'effect');
	assert.equal(picture?.pictureState.videoKeyframes.curves.length, 1);
});

test('V22 carries deterministic cross-track overlap order while retaining exact timing refusal', () => {
	const options = transitionProjectOptions();
	const clips = options.clips as Record<string, unknown>[];
	clips.push({
		kind: 'video', id: 'upper-clip', sourceId: 'video-source', title: 'Upper',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
	});
	const tracks = options.tracks as Record<string, unknown>[];
	tracks.splice(1, 0, {
		...structuredClone(tracks[0]!), id: 'upper-track', name: 'Upper',
		clipIds: ['upper-clip'], mute: false, solo: false, hidden: false,
	});
	tracks.splice(2, 0, {
		...structuredClone(tracks[0]!), id: 'empty-track', name: 'Empty', clipIds: [],
		mute: false, solo: false, hidden: true,
	});
	const sequence = (options.sequences as Record<string, unknown>[])[0]!;
	sequence.trackIds = ['video-track', 'upper-track', 'empty-track', 'audio-track'];
	const project = createFramescaperProjectV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, options,
	);
	const authority = renderAuthority(project, 16);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, project, authority,
	);
	const pictures = plan.nodes.filter(
		(node): node is UnifiedExactRenderClipNode => node.kind === 'clip',
	);
	assert.deepEqual(plan.tracks.map(({ sequenceOrder }) => sequenceOrder), [0, 1, 2]);
	assert.deepEqual(plan.tracks.map(({ trackId }) => trackId), [
		'video-track', 'upper-track', 'empty-track',
	]);
	assert.deepEqual([...new Set(pictures.map(({ trackId }) => trackId))], ['video-track', 'upper-track']);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		project,
		{ ...authority, timingViews: new Map() },
	), /timing.*exact|video-source/iu);
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
	const repeated = visualProject(undefined, true);
	const repeatedPlan = createFramescaperProjectUnifiedExactRenderPlanV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		repeated,
		{
			...renderAuthority(repeated, 30),
			visualFreshnessByModelId: visualFreshness(repeated),
		},
	);
	const stills = repeatedPlan.nodes.filter((node): node is UnifiedExactRenderVisualNode => (
		node.kind === 'visual' && node.modelKind === 'still'
	));
	assert.deepEqual(stills.map(({ modelId }) => modelId), ['still-clip', 'still-clip-upper']);
	assert.deepEqual(stills.map(({ placement }) => placement?.trackId), ['video-track', 'upper-track']);
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
	const freezeNode = frozenPlan.nodes.find((node): node is UnifiedExactRenderVisualNode => (
		node.kind === 'visual' && node.modelKind === 'video-freeze'
	));
	assert.deepEqual(freezeNode, {
		kind: 'visual', nodeId: 'render:visual:video-freeze:video-source',
		modelId: 'video-freeze:video-source',
		modelKind: 'video-freeze', authoredState, placement: null, freshness: freezeFreshness,
		authoredFallback: fallback,
		fallbackDisposition: {
			status: 'fresh', mode: 'frozen', changedComponents: [],
			authoredStatePreserved: true, reportsDegradation: false,
		},
		frozenFallback: fallback,
	});
	assert.equal(
		fingerprintUnifiedExactRenderPlan(frozenPlan).sha256,
		'a1863b23e2d2e8ef31eab25a4be666cd061661b8714aae21f38c9a534d88583a',
	);
});

test('V24 marks stale and unverifiable freeze fallback authority bypass-only', () => {
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
	stale.set('video-freeze:video-source', { ...exactFreshness, inputIdentitiesSha256: SHA_A });
	const stalePlan = createFramescaperProjectUnifiedExactRenderPlanV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		project,
		{ ...authority, visualFreshnessByModelId: stale },
	);
	const staleNode = stalePlan.nodes.find((node): node is UnifiedExactRenderVisualNode => (
		node.kind === 'visual' && node.modelKind === 'video-freeze'
	));
	assert.equal(staleNode?.fallbackDisposition?.status, 'stale');
	assert.equal(staleNode?.fallbackDisposition?.mode, 'bypass');
	assert.equal(staleNode?.frozenFallback, null);
	assert.deepEqual(staleNode?.authoredFallback, fallback);
	const unverifiable = new Map(authority.visualFreshnessByModelId);
	unverifiable.delete('video-freeze:video-source');
	const unverifiablePlan = createFramescaperProjectUnifiedExactRenderPlanV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		project,
		{ ...authority, visualFreshnessByModelId: unverifiable },
	);
	const unverifiableNode = unverifiablePlan.nodes.find((node): node is UnifiedExactRenderVisualNode => (
		node.kind === 'visual' && node.modelKind === 'video-freeze'
	));
	assert.equal(unverifiableNode?.freshness, null);
	assert.equal(unverifiableNode?.fallbackDisposition?.status, 'unverifiable');
	assert.equal(unverifiableNode?.fallbackDisposition?.mode, 'bypass');
	assert.equal(unverifiableNode?.frozenFallback, null);
	assert.throws(() => visualProject(createVideoFreezeFallbackV1({
		renderedSourceId: 'video-source', renderedAssetSha256: SHA_D,
		...exactFreshness,
	})), /digest.*rendered source|external asset/iu);
});

test('V24 cross-binds still bytes and refuses unresolved adjustment or mask graph references', () => {
	const project = visualProject();
	const plan = createFramescaperProjectUnifiedExactRenderPlanV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		project,
		{
			...renderAuthority(project, 30),
			visualFreshnessByModelId: visualFreshness(project),
		},
	);
	const brokenStill = structuredClone(plan) as unknown as Record<string, unknown>;
	const stillSource = (brokenStill.sources as Record<string, unknown>[])
		.find((source) => source.sourceId === 'still-source');
	if (!stillSource) throw new RangeError('Missing still source fixture.');
	stillSource.storageKey = 'different-storage';
	assert.throws(
		() => createUnifiedExactRenderPlan(brokenStill),
		/still.*exact external|external plan source/iu,
	);
	for (const [modelId, change] of [
		['adjustment', (state: Record<string, unknown>) => { state.targetTrackIds = ['missing-track']; }],
		['adjustment', (state: Record<string, unknown>) => { state.effectIds = ['missing-effect']; }],
		['mask', (state: Record<string, unknown>) => {
			const input = (state.inputs as Record<string, unknown>[])[0]!;
			input.sourceRef = 'missing-source';
		}],
	] as const) {
		const hostile = structuredClone(plan) as unknown as Record<string, unknown>;
		const visual = (hostile.nodes as Record<string, unknown>[]).find(
			(node) => node.kind === 'visual' && node.modelId === modelId,
		);
		if (!visual) throw new RangeError(`Missing ${modelId} visual fixture.`);
		const state = visual.authoredState as Record<string, unknown>;
		change(state);
		visual.freshness = {
			...(visual.freshness as Record<string, unknown>),
			authoredStateSha256: fingerprintNativeMediaPlan(state).sha256,
		};
		assert.throws(
			() => createUnifiedExactRenderPlan(hostile),
			/unknown track|unresolved|missing-(?:track|effect|source)/iu,
		);
	}
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
