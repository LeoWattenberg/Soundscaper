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
