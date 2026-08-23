/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import {
	assertUnifiedExactRenderPlanV13,
	createUnifiedExactRenderPlan,
	type UnifiedExactRenderFinishingNode,
} from '../src/common/editor/unified-exact-render-plan.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanV27,
} from '../src/framescaper/editor-project-unified-render-plan-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import {
	renderAuthority,
	UNIFIED_RENDER_SHA_A,
	UNIFIED_RENDER_SHA_B,
} from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 builds V13 from V24 visuals plus managed finishing authority', () => {
	const project = finishingProject();
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	assertUnifiedExactRenderPlanV13(plan);
	assert.equal(plan.version, 13);
	assert.equal(plan.nodes.some(({ kind }) => kind === 'professional-media' || kind === 'openfx'), false);
	assert.throws(() => createNativeMediaPlanEnvelopeV1(plan), /versions.*7.*12|unsupported-version|only.*exact/iu);
	const finishing = plan.nodes.find(
		(node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing',
	);
	assert.ok(finishing);
	assert.equal(finishing.colorContext.workingSpace, 'linear-rec709-d65');
	assert.equal(finishing.sourceInterpretations[0]?.provenance, 'default-video-bt709-limited');
	assert.equal(finishing.visualPresentations[0]?.owner.id, 'video-clip');
	assert.equal(finishing.processorStacks[0]?.sourceId, 'video-source');
	assert.equal(finishing.motionAnalyses[0]?.sha256, UNIFIED_RENDER_SHA_B);
	assert.equal(finishing.captionDisposition, 'sidecar-only');
	assert.equal(finishing.captionTracks[0]?.sequenceId, 'main-sequence');
	assert.deepEqual(finishing.audioContext.audioTracks, [{ id: 'audio-track', effectIds: [] }]);
	assert.equal(finishing.audioContext.mixer.outputs[0]?.role, 'main');
	assert.equal(finishing.audioContext.automationLanes[0]?.id, 'automation-master-gain');
	assert.equal(plan.output.includeAudio, false);
});

test('V13 is a selected branch and rejects dormant native-media and OpenFX node families', () => {
	const project = finishingProject();
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	for (const kind of ['professional-media', 'openfx']) {
		const hostile = structuredClone(plan) as unknown as Record<string, unknown>;
		(hostile.nodes as Record<string, unknown>[]).push({ kind });
		assert.throws(
			() => createUnifiedExactRenderPlan(hostile),
			/V13.*(?:native|professional|OpenFX)|selected.*branch|unsupported/iu,
		);
	}
});

test('V13 requires exact color/source/caption/audio reference closure', () => {
	const project = finishingProject();
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	const missingInterpretation = structuredClone(plan) as unknown as Record<string, unknown>;
	const finishing = (missingInterpretation.nodes as Record<string, unknown>[])
		.find(({ kind }) => kind === 'finishing')!;
	finishing.sourceInterpretations = [];
	assert.throws(() => createUnifiedExactRenderPlan(missingInterpretation), /interpretation.*exact|every.*source/iu);

	const muxClaim = structuredClone(plan) as unknown as Record<string, unknown>;
	const muxFinishing = (muxClaim.nodes as Record<string, unknown>[])
		.find(({ kind }) => kind === 'finishing')!;
	muxFinishing.captionDisposition = 'mux';
	assert.throws(() => createUnifiedExactRenderPlan(muxClaim), /caption.*sidecar|mux/iu);

	const missingTrack = structuredClone(plan) as unknown as Record<string, unknown>;
	const audio = ((missingTrack.nodes as Record<string, unknown>[])
		.find(({ kind }) => kind === 'finishing')!.audioContext as Record<string, unknown>);
	audio.audioTracks = [];
	assert.throws(() => createUnifiedExactRenderPlan(missingTrack), /automation.*owner|audio track|mixer.*track/iu);
});

function finishingProject() {
	return createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			visualPresentations: [{
				schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'video-clip' },
				enabled: true, opacity: 1, blendMode: 'normal', grade: null,
				processorStackId: 'stack-1', maskMatteIds: [],
			}],
			processorStacks: [{
				schemaVersion: 1, id: 'stack-1', sourceId: 'video-source', processors: [{
					schemaVersion: 1, id: 'tracking-1', kind: 'tracking', enabled: true,
					maximumFeatures: 128, quality: 0.05, minimumDistance: 3,
					windowRadius: 3, pyramidLevels: 3,
				}],
			}],
			motionAnalyses: [{
				schemaVersion: 1, id: 'analysis-1', sourceId: 'video-source',
				processorStackId: 'stack-1', inputSha256: UNIFIED_RENDER_SHA_A,
				settingsSha256: UNIFIED_RENDER_SHA_B,
				storageKey: `motion-sha256:${UNIFIED_RENDER_SHA_B}`,
				sha256: UNIFIED_RENDER_SHA_B, byteLength: 4_096, startFrame: 0, endFrame: 10,
			}],
			captionTracks: [{
				schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence',
				name: 'English', language: 'en', styles: [], regions: [], speakers: [],
				cues: [{
					schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000,
					text: 'Caption', styleId: null, regionId: null, speakerId: null, words: [],
				}],
			}],
			automationLanes: [{
				id: 'automation-master-gain',
				address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
				timebase: 'absolute-samples', points: [{ id: 'point-1', position: 0, value: 1 }],
				segments: [],
			}],
		},
	});
}
