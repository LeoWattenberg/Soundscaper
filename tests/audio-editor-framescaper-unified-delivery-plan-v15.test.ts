/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNativeMediaPlanEnvelopeV3 } from '../src/common/editor/native-media-plan-envelope-v3.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import {
	createFramescaperProjectUnifiedRenderDeliveryBundleV15,
	createFramescaperProjectNativeMediaPlanEnvelopeV15,
	createFramescaperProjectUnifiedExactRenderPlanV15,
} from '../src/framescaper/editor-project-unified-render-delivery-v15.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
const SHA_A = 'aa'.repeat(32);

test('selected V15 delivery projects the validated V14 graph and seals its envelope', () => {
	const project = projectWithCaptions();
	const authority = createFramescaperNativeRenderPlanAuthorityV28(project);
	const v14 = createFramescaperProjectUnifiedExactRenderPlanV28(PROFILE, project, authority);
	const bundle = createFramescaperProjectUnifiedRenderDeliveryBundleV15(PROFILE, project, authority, {
		deliveryProfile: 'encode-mov-prores-422-hq',
		captionRequest: {
			trackId: 'captions-en', mux: true, burnIn: false, sidecar: 'srt',
		},
	});
	const v15 = bundle.plan;

	assert.equal(bundle.envelope.plan, bundle.plan);
	assert.equal(v15.version, 15);
	assert.equal(v15.deliveryProfile, 'encode-mov-prores-422-hq');
	assert.deepEqual(v15.nodes, v14.nodes);
	assert.deepEqual(v15.tracks, v14.tracks);
	assert.deepEqual(v15.sources, v14.sources);
	assert.equal(v15.captionDelivery?.trackId, 'captions-en');
	assert.equal(
		v15.captionDelivery?.mux?.documentSha256,
		bundle.captionAdapter?.muxDocument?.sha256,
	);
	assert.equal(
		v15.captionDelivery?.sidecar?.documentSha256,
		bundle.captionAdapter?.sidecarDocument?.sha256,
	);
	assert.equal(v15.companionAudio, null);

	const envelope = createFramescaperProjectNativeMediaPlanEnvelopeV15(
		PROFILE, project, authority, {
			deliveryProfile: 'encode-mov-prores-422-hq',
			captionRequest: {
				trackId: 'captions-en', mux: true, burnIn: false, sidecar: 'srt',
			},
		},
	);
	assert.equal(envelope.planVersion, 15);
	assert.equal(envelope.plan.version, 15);
	assert.equal(envelope.summary.captionDelivery?.trackId, 'captions-en');
	assert.doesNotThrow(() => assertNativeMediaPlanEnvelopeV3(envelope));
});

test('selected V15 image sequence binds optional ordinary companion audio', () => {
	const delivery = {
		kind: 'image-sequence' as const,
		format: 'png' as const,
		frameRate: { num: 24, den: 1 },
		preserveAlpha: true as const,
	};
	const project = projectWithCaptions();
	const authority = createFramescaperNativeRenderPlanAuthorityV28(project, delivery);
	const bundle = createFramescaperProjectUnifiedRenderDeliveryBundleV15(PROFILE, project, authority, {
		deliveryProfile: 'encode-png-sequence',
		companionAudio: companionAudioChoice(),
	});
	const plan = bundle.plan;

	assert.equal(plan.output.includeAudio, false);
	assert.equal(plan.captionDelivery, null);
	assert.deepEqual(plan.companionAudio, {
		formatId: 'bwf', fileName: 'audio.wav',
		planFingerprint: bundle.companionAudioBundle!.authority.planFingerprint,
		recoveryClass: 'atomic-restart',
	});
	assert.equal(
		JSON.stringify(bundle.companionAudioBundle?.plan),
		bundle.companionAudioBundle?.planPayload,
	);
	assert.deepEqual(bundle.companionAudioBundle?.plan.range, {
		startFrame: plan.timebase.sampleStart,
		endFrame: plan.timebase.sampleStart + plan.timebase.sampleDuration,
		durationFrames: plan.timebase.sampleDuration,
	});
	assert.equal(bundle.companionAudioBundle?.plan.mode, 'mix');
	assert.equal(bundle.companionAudioBundle?.plan.tailFrames, 0);
	assert.equal(bundle.companionAudioBundle?.plan.outputFrames, plan.timebase.sampleDuration);
	assert.equal(bundle.companionAudioBundle?.plan.encoding.sampleFormat, 'int24');
	assert.equal(
		JSON.parse(bundle.companionAudioBundle!.authorityPayload).project.revision,
		project.revision,
	);
	assert.equal(Object.isFrozen(bundle.companionAudioBundle?.plan), true);
});

test('selected V15 envelope retains authenticated VFR timing while it is built', () => {
	const publication = createVideoTimingAssetPublication('12'.repeat(32), {
		timescale: 100,
		presentationTicks: [0n, 8n, 20n, 30n, 42n, 50n, 62n, 70n, 82n, 90n],
		finalFrameDurationTicks: 10n,
	});
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[])[0]!;
	source.timingAsset = publication.reference;
	source.timingDecision = { mode: 'exact', rate: { num: 10, den: 1 }, backend: 'demuxer' };
	const project = createFramescaperProjectV28(PROFILE, {
		...options, finishing: { captionTracks: [captionTrack()] },
	});
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr', reference: publication.reference,
		index: validateVideoTimingAssetBytes(publication.reference, publication.bytes),
	});
	const authority = {
		...createFramescaperNativeRenderPlanAuthorityV28(projectWithCaptions()),
		timingViews: new Map([['video-source', view]]),
	};
	const envelope = createFramescaperProjectNativeMediaPlanEnvelopeV15(
		PROFILE, project, authority, { deliveryProfile: 'encode-mov-prores-422-hq' },
	);

	assert.equal(envelope.planVersion, 15);
	assert.equal(envelope.plan.sources[0]?.timing.kind, 'vfr');
});

test('selected V15 delivery fails closed on inconsistent profile and authorities', () => {
	const project = projectWithCaptions();
	const movAuthority = createFramescaperNativeRenderPlanAuthorityV28(project);
	const imageDelivery = {
		kind: 'image-sequence' as const,
		format: 'png' as const,
		frameRate: { num: 24, den: 1 },
		preserveAlpha: true as const,
	};
	const imageAuthority = createFramescaperNativeRenderPlanAuthorityV28(project, imageDelivery);
	const companion = companionAudioChoice();

	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV15(
		PROFILE, project, movAuthority, { deliveryProfile: 'encode-mp4-h264' },
	), /codec tuple|container/iu);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV15(
		PROFILE, project, movAuthority,
		{ deliveryProfile: 'encode-mov-prores-422-hq', companionAudio: companion },
	), /Companion audio.*image-sequence/iu);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV15(
		PROFILE, project, imageAuthority, {
			deliveryProfile: 'encode-png-sequence',
			captionRequest: {
				trackId: 'missing', mux: false, burnIn: false, sidecar: 'vtt',
			},
		},
	), /caption delivery track missing/iu);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV15(
		PROFILE, project, imageAuthority, {
			deliveryProfile: 'encode-png-sequence', hiddenFallback: true,
		} as never,
	), /unsupported field/iu);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV15(
		PROFILE, project, imageAuthority, {
			deliveryProfile: 'encode-png-sequence', companionAudio: undefined,
		},
	), /companion audio.*plain object/iu);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV15(
		PROFILE, project, imageAuthority, {
			deliveryProfile: 'encode-png-sequence',
			companionAudio: { ...companion, plan: { format: 'bwf' } },
		} as never,
	), /unsupported field/iu);
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanV15(
		PROFILE, project, movAuthority, {
			deliveryProfile: 'encode-mov-prores-422-hq',
			captionRequest: {
				trackId: 'captions-en', mux: true, burnIn: false, sidecar: null,
				cueSetSha256: SHA_A,
			},
		} as never,
	), /invalid closed shape/iu);
});

function projectWithCaptions() {
	return createFramescaperProjectV28(PROFILE, {
		...framescaperV20Options(),
		finishing: { captionTracks: [captionTrack()] },
	});
}

function captionTrack(): Record<string, unknown> {
	return {
		schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence', name: 'English',
		language: 'en', styles: [], regions: [], speakers: [], cues: [{
			schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000, text: 'Caption',
			styleId: null, regionId: null, speakerId: null, words: [],
		}],
	};
}

function companionAudioChoice() {
	return { formatId: 'bwf' as const, sampleFormat: 'int24' as const };
}
