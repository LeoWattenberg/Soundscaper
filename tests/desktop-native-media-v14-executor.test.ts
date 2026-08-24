/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { NATIVE_MEDIA_CPU_BACKEND, NATIVE_MEDIA_WEB_BACKEND } from '../src/common/editor/native-media-backend-policy.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	executeNativeMediaPlanV14,
} from '../desktop/native-media-v14-executor.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { normalizeNativeMediaImageSequenceSourceV25 } from '../src/common/editor/native-media-image-sequence-v25.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('selected V14 retries only a typed closed backend refusal through Web Core', async () => {
	const fixture = executionFixture();
	const failures: string[] = [];
	let webCalls = 0;
	const error = Object.assign(new Error('native subset unavailable'), {
		code: 'unsupported-render-subset',
	});
	const result = await executeNativeMediaPlanV14({
		...fixture,
		native: { async execute() { throw error; } },
		web: { async execute() { webCalls += 1; return fixture.receipt; } },
		onBackendFailure: (backend) => { failures.push(backend); },
	});
	assert.equal(result.outcome, 'web-core');
	assert.equal(result.backend, NATIVE_MEDIA_WEB_BACKEND);
	assert.deepEqual(result.failedBackends, [NATIVE_MEDIA_CPU_BACKEND]);
	assert.deepEqual(failures, [NATIVE_MEDIA_CPU_BACKEND]);
	assert.equal(webCalls, 1);
});

test('selected V14 never downgrades authority or publication failures', async () => {
	const fixture = executionFixture();
	for (const error of [
		new Error('destination authority changed'),
		Object.assign(new Error('source changed'), { code: 'source-changed' }),
	]) {
		let webCalls = 0;
		await assert.rejects(() => executeNativeMediaPlanV14({
			...fixture,
			native: { async execute() { throw error; } },
			web: { async execute() { webCalls += 1; return fixture.receipt; } },
		}), (observed) => observed === error);
		assert.equal(webCalls, 0);
	}
});

test('a carrier-owned image-sequence source requires no original-body grant', async () => {
	const fixture = sequenceExecutionFixture();
	assert.equal(fixture.envelope.plan.nodes.some((node) => (
		node.kind === 'professional-media' && node.imageSequence !== null
	)), true, 'the fixture plan must carry a carrier-owned sequence source');
	let nativeCalls = 0;
	// The sequence source's pixels arrive through the evaluated carrier, so the
	// executor must dispatch with no original-body grants instead of refusing.
	const result = await executeNativeMediaPlanV14({
		...fixture,
		sources: [],
		native: {
			async execute(attempt) {
				nativeCalls += 1;
				assert.deepEqual(attempt.sources, []);
				return fixture.receipt;
			},
		},
		web: { async execute() { throw new Error('the web fallback must not run'); } },
	});
	assert.equal(result.outcome, 'native');
	assert.equal(nativeCalls, 1);
});

function sequenceExecutionFixture() {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[])[0]!;
	const characteristics = createUnreportedVideoSourceCharacteristicsV25();
	const packSha256 = 'aa'.repeat(32);
	const inventorySha256 = 'bb'.repeat(32);
	source.storageKey = `image-sequence-pack-sha256:${packSha256}`;
	source.contentSha256 = packSha256;
	source.characteristics = characteristics;
	source.imageSequence = normalizeNativeMediaImageSequenceSourceV25({
		kind: 'video', sourceType: 'image-sequence', version: 1,
		id: 'video-source', name: 'Video', stem: 'shot_', extension: 'png',
		frameNumberWidth: 4, firstFrameNumber: 1, lastFrameNumber: 10,
		frameCount: 10, frameRate: { num: 10, den: 1 },
		inventory: {
			kind: 'image-sequence-inventory', version: 1,
			storageKey: `image-sequence-inventory-sha256:${inventorySha256}`,
			sha256: inventorySha256, byteLength: 512, frameCount: 10,
			firstFrameNumber: 1, lastFrameNumber: 10,
		},
		sourcePack: {
			kind: 'image-sequence-source-pack',
			storageKey: `image-sequence-pack-sha256:${packSha256}`,
			sha256: packSha256, byteLength: 8_192,
		},
		characteristics,
	});
	const project = createFramescaperProjectV28(profile, {
		...options, id: 'v14-sequence-executor', title: 'V14 sequence executor',
		videoTransitionsByTrackId: { 'video-track': [] },
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	return Object.freeze({
		jobId: '34'.repeat(20),
		envelope,
		backendPlan: Object.freeze({
			platform: 'linux' as const, operation: 'encode' as const,
			attempts: Object.freeze([NATIVE_MEDIA_CPU_BACKEND]),
			fallback: NATIVE_MEDIA_WEB_BACKEND, reason: 'cpu-only' as const,
		}),
		rootGrantId: 'cd'.repeat(16),
		relativeDestination: 'renders/v14-sequence.mov',
		receipt: Object.freeze({
			planFingerprint: envelope.fingerprint, byteLength: 128,
			sha256: 'ef'.repeat(32), publication: 'verified-temporary' as const,
		}),
	});
}

function executionFixture() {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, {
		...framescaperV20Options(), id: 'v14-executor', title: 'V14 executor',
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	return Object.freeze({
		jobId: '12'.repeat(20),
		envelope,
		backendPlan: Object.freeze({
			platform: 'linux' as const, operation: 'encode' as const,
			attempts: Object.freeze([NATIVE_MEDIA_CPU_BACKEND]),
			fallback: NATIVE_MEDIA_WEB_BACKEND, reason: 'cpu-only' as const,
		}),
		sources: Object.freeze(plan.sources.map((source) => Object.freeze({
			sourceId: source.sourceId, grantId: 'ab'.repeat(16),
			contentSha256: requiredDigest(source.contentSha256),
		}))),
		rootGrantId: 'cd'.repeat(16),
		relativeDestination: 'renders/v14.mov',
		receipt: Object.freeze({
			planFingerprint: envelope.fingerprint, byteLength: 128,
			sha256: 'ef'.repeat(32), publication: 'verified-temporary' as const,
		}),
	});
}

function requiredDigest(value: string | null): string {
	if (value === null) throw new Error('The V14 execution fixture source has no digest.');
	return value;
}
