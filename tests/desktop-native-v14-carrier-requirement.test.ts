/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { framescaperNativeQueueEnqueueRequest } from '../desktop/native-services-lifecycle-contracts.ts';
import { nativeRenderInputExactEnvelope, nativeRenderInputStageRequired } from '../desktop/native-services-render-input-contract.ts';
import { canonicalizeNativeMediaPlan, fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { nativeMediaV14RenderFamily } from '../src/common/editor/native-media-v14-render-family.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
const STAGE_ID = 'ab'.repeat(20);

test('main requires a carrier for managed-color V14 and forbids one for the exact CPU subset', () => {
	const carrierPlan = plan(false);
	const cpuPlan = plan(true);
	assert.equal(nativeMediaV14RenderFamily(carrierPlan), 'evaluated-rgba-carrier-v1');
	assert.equal(nativeMediaV14RenderFamily(cpuPlan), 'single-full-frame-clip-v1');
	assert.equal(nativeRenderInputStageRequired(envelope(carrierPlan)), true);
	assert.equal(nativeRenderInputStageRequired(envelope(cpuPlan)), false);
	assert.equal(framescaperNativeQueueEnqueueRequest(request(carrierPlan, STAGE_ID)).derivedInputStageId, STAGE_ID);
	assert.throws(() => framescaperNativeQueueEnqueueRequest(request(carrierPlan, null)), /derived-input stage/iu);
	assert.equal(framescaperNativeQueueEnqueueRequest(request(cpuPlan, null)).derivedInputStageId, null);
	assert.throws(() => framescaperNativeQueueEnqueueRequest(request(cpuPlan, STAGE_ID)), /derived-input stage/iu);
});

test('native V14 proxy generation admits no renderer carrier for its authenticated original', () => {
	const proxyPlan = plan(false);
	assert.equal(framescaperNativeQueueEnqueueRequest(
		request(proxyPlan, null, 'proxy-generation'),
	).derivedInputStageId, null);
	assert.throws(() => framescaperNativeQueueEnqueueRequest(
		request(proxyPlan, STAGE_ID, 'proxy-generation'),
	), /proxy generation cannot name a derived-input stage/iu);
});

function plan(legacyUnmanaged: boolean) {
	const options = legacyUnmanaged ? silentVideoOptions() : framescaperV20Options();
	if (legacyUnmanaged) {
		const derived = createFramescaperProjectV28(PROFILE, options);
		options.finishing = { sourceColorInterpretations: derived.videoSourceColorInterpretations.map(
			(value) => ({ ...value, provenance: 'legacy-unmanaged-encoded' }),
		) };
	}
	const project = createFramescaperProjectV28(PROFILE, options);
	return createFramescaperProjectUnifiedExactRenderPlanV28(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
}

function envelope(planValue: ReturnType<typeof plan>) {
	return nativeRenderInputExactEnvelope(
		canonicalizeNativeMediaPlan(planValue), fingerprintNativeMediaPlan(planValue).sha256, 14,
	);
}

function silentVideoOptions(): Record<string, unknown> {
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).filter(({ kind }) => kind !== 'audio');
	options.clips = (options.clips as Array<Record<string, unknown>>).filter(({ kind }) => kind !== 'audio');
	options.tracks = (options.tracks as Array<Record<string, unknown>>).filter(({ type }) => type !== 'audio');
	options.sequences = (options.sequences as Array<Record<string, unknown>>).map((sequence) => ({
		...sequence, trackIds: (sequence.trackIds as string[]).filter((id) => id !== 'audio-track'),
	}));
	return options;
}

function request(
	planValue: ReturnType<typeof plan>,
	derivedInputStageId: string | null,
	taskKind: 'encoded-export' | 'proxy-generation' = 'encoded-export',
) {
	return Object.freeze({
		taskKind, planVersion: 14, derivedInputStageId,
		planFingerprint: fingerprintNativeMediaPlan(planValue).sha256,
		planPayload: canonicalizeNativeMediaPlan(planValue), projectId: String(planValue.project.id),
		projectRevision: Number(planValue.project.revision),
		inputFingerprints: planValue.sources.map(({ sourceId, contentSha256 }) => ({ sourceId, sha256: contentSha256 })),
		rootGrantId: 'cd'.repeat(16), relativeDestination: 'renders/v28.mov',
		reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3,
			scratchBytes: 32 * 1024 ** 3, minimumFreeBytes: 0, hardwareBackend: null },
		recoveryClass: 'atomic-restart',
	});
}
