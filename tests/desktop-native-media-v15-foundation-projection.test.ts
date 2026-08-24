/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NativeMediaV15FoundationProjectionRefusal,
	projectNativeMediaV15FoundationForV14Verification,
} from '../desktop/native-media-v15-foundation-projection.ts';
import { createNativeMediaPlanEnvelopeV3 } from '../src/common/editor/native-media-plan-envelope-v3.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV15 } from '../src/framescaper/editor-project-unified-render-delivery-v15.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
const SHA_A = 'aa'.repeat(32);

test('artifact-free V15 projects to a separately fingerprinted exact V14 verification foundation', () => {
	const project = createFramescaperProjectV28(PROFILE, framescaperV20Options());
	const authority = createFramescaperNativeRenderPlanAuthorityV28(project);
	const source = createNativeMediaPlanEnvelopeV3(
		createFramescaperProjectUnifiedExactRenderPlanV15(PROFILE, project, authority, {
			deliveryProfile: 'encode-mov-prores-422-hq',
		}),
	);
	const projection = projectNativeMediaV15FoundationForV14Verification(source);

	assert.equal(projection.sourcePlanFingerprint, source.fingerprint);
	assert.equal(projection.executionFoundation.planVersion, 14);
	assert.equal(projection.executionFoundation.plan.deliveryProfile, source.plan.deliveryProfile);
	assert.notEqual(projection.executionFoundation.fingerprint, source.fingerprint);
	assert.deepEqual(projection.executionFoundation.plan.nodes, source.plan.nodes);
	assert.deepEqual(projection.executionFoundation.plan.sources, source.plan.sources);
	assert.equal(Object.isFrozen(projection), true);
	assert.equal(Object.isFrozen(projection.executionFoundation.plan), true);
});

test('V15 verification projection refuses caption and companion artifacts before V14 reuse', () => {
	const project = createFramescaperProjectV28(PROFILE, {
		...framescaperV20Options(), finishing: { captionTracks: [captionTrack()] },
	});
	const mov = createFramescaperNativeRenderPlanAuthorityV28(project);
	const caption = createNativeMediaPlanEnvelopeV3(
		createFramescaperProjectUnifiedExactRenderPlanV15(PROFILE, project, mov, {
			deliveryProfile: 'encode-mov-prores-422-hq',
			captionRequest: {
				trackId: 'captions-en', mux: true, burnIn: false, sidecar: null,
			},
		}),
	);
	assert.throws(() => projectNativeMediaV15FoundationForV14Verification(caption), (error: unknown) => (
		error instanceof NativeMediaV15FoundationProjectionRefusal
		&& error.code === 'caption-artifacts-unbound'
	));

	const delivery = {
		kind: 'image-sequence' as const, format: 'png' as const,
		frameRate: { num: 24, den: 1 }, preserveAlpha: true as const,
	};
	const image = createFramescaperNativeRenderPlanAuthorityV28(project, delivery);
	const companion = createNativeMediaPlanEnvelopeV3(
		createFramescaperProjectUnifiedExactRenderPlanV15(PROFILE, project, image, {
			deliveryProfile: 'encode-png-sequence',
			companionAudio: { formatId: 'bwf', sampleFormat: 'int24' },
		}),
	);
	assert.throws(() => projectNativeMediaV15FoundationForV14Verification(companion), (error: unknown) => (
		error instanceof NativeMediaV15FoundationProjectionRefusal
		&& error.code === 'companion-audio-artifacts-unbound'
	));
});

test('V15 verification projection rejects another envelope generation and tampered metadata', () => {
	const project = createFramescaperProjectV28(PROFILE, framescaperV20Options());
	const authority = createFramescaperNativeRenderPlanAuthorityV28(project);
	const source = createNativeMediaPlanEnvelopeV3(
		createFramescaperProjectUnifiedExactRenderPlanV15(PROFILE, project, authority, {
			deliveryProfile: 'encode-mov-prores-422-hq',
		}),
	);
	const v14 = structuredClone(source) as unknown as Record<string, unknown>;
	v14.plan = structuredClone(source.plan);
	(v14.plan as Record<string, unknown>).version = 14;
	delete (v14.plan as Record<string, unknown>).captionDelivery;
	delete (v14.plan as Record<string, unknown>).companionAudio;
	assert.throws(() => projectNativeMediaV15FoundationForV14Verification(v14), /Envelope V3|derived|V15/iu);

	const tampered = structuredClone(source);
	(tampered as unknown as { fingerprint: string }).fingerprint = SHA_A;
	assert.throws(() => projectNativeMediaV15FoundationForV14Verification(tampered), /fingerprint.*derived/iu);
});

function captionTrack(): Record<string, unknown> {
	return {
		schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence', name: 'English',
		language: 'en', styles: [], regions: [], speakers: [], cues: [{
			schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000, text: 'Caption',
			styleId: null, regionId: null, speakerId: null, words: [],
		}],
	};
}
