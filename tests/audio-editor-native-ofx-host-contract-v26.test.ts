/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertOfxHostInvocationV1,
	assertOfxRuntimeProcessBatchV1,
	createOfxHostInvocationV1,
	normalizeOfxInteractEventV1,
	resolveOfxRenderBackendV1,
	OFX_HOST_ACTIONS_V1,
	OFX_HOST_EXECUTION_CONTRACT_V1,
} from '../src/common/editor/native-ofx-host-contract.ts';
import { createOfxRetimerSourceTimeV1 } from '../src/common/editor/native-ofx-retimer-source-time.ts';
import { createVideoRetimeExactOrdinalAuthority } from '../src/common/editor/video-retime-exact-ordinal-authority.ts';
import {
	assertOfxEffectStateV26,
	resolveOfxEffectStateV26,
	type OfxEffectStateV26,
} from '../src/common/editor/native-ofx-state-v26.ts';
import {
	bindCfrTiming,
	createFiveModeIntent,
} from './helpers/video-retime-export-fixtures.ts';

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);
const HOST_PLAN = Object.freeze({
	unifiedPlanVersion: 12 as const,
	unifiedPlanSha256: SHA_D,
	nodeId: 'openfx-node',
	instanceId: 'ofx-instance-1',
	outputOrdinal: 3,
});

test('the closed V26 host surface covers all contexts, suites, actions, interactions, and CPU', () => {
	assert.deepEqual(OFX_HOST_EXECUTION_CONTRACT_V1.contexts, [
		'generator', 'filter', 'transition', 'paint', 'retimer', 'general',
	]);
	for (const suite of [
		'OfxImageEffectSuite', 'OfxPropertySuite', 'OfxParameterSuite',
		'OfxMemorySuite', 'OfxMultiThreadSuite', 'OfxMessageSuite',
		'OfxProgressSuite', 'OfxTimeLineSuite', 'OfxDialogSuite', 'OfxInteractSuite',
		'OfxDrawSuite', 'OfxParametricParameterSuite',
		'OfxImageEffectOpenGLRenderSuite', 'OfxOpenCLProgramSuite',
	]) assert.equal(OFX_HOST_EXECUTION_CONTRACT_V1.suites.includes(suite), true, suite);
	for (const unimplementedSuite of [
		'OfxImageEffectPlaneSuite', 'OfxVendorCudaSuite',
	]) assert.equal(OFX_HOST_EXECUTION_CONTRACT_V1.suites.includes(unimplementedSuite), false);
	for (const action of ['describe', 'describe-in-context', 'frames-needed', 'render', 'abort']) {
		assert.equal(OFX_HOST_ACTIONS_V1.includes(action as never), true, action);
	}
	assert.deepEqual(OFX_HOST_EXECUTION_CONTRACT_V1.interacts, [
		'interact-v1', 'overlay-interact-v2', 'custom-parameter-interact', 'draw-suite-v1',
	]);
	assert.equal(OFX_HOST_EXECUTION_CONTRACT_V1.interacts.includes('interact-v2' as never), false);
	assert.equal(OFX_HOST_EXECUTION_CONTRACT_V1.cpuRenderingRequired, true);
	assert.equal(OFX_HOST_EXECUTION_CONTRACT_V1.offscreenUiOnly, true);
	assert.deepEqual(OFX_HOST_EXECUTION_CONTRACT_V1.deniedAuthorities, [
		'network', 'arbitrary-filesystem', 'vendor-top-level-window',
	]);
});

test('one invocation is fingerprint-bound, cancellable, closed, and carries no ambient authority', () => {
	const invocation = createOfxHostInvocationV1({
		invocationId: 'invocation-1',
		...HOST_PLAN,
		pluginId: 'net.example.Blur',
		pluginBinarySha256: SHA_A,
		context: 'filter',
		action: 'render',
		stateSha256: SHA_B,
		inputFrameStreamIds: ['stream-source'],
		outputFrameStreamId: 'stream-output',
		requestedBackend: 'cuda',
		abortSignalId: 'abort-1',
	});
	assert.doesNotThrow(() => assertOfxHostInvocationV1(invocation));
	assert.equal(invocation.pluginFingerprint, `net.example.Blur@${SHA_A}`);
	assert.equal(invocation.unifiedPlanSha256, SHA_D);
	assert.equal(invocation.outputOrdinal, 3);
	assert.equal(JSON.stringify(invocation).includes('/'), false);
	assert.throws(
		() => assertOfxHostInvocationV1({ ...invocation, pluginBinaryPath: '/plugins/blur.ofx' }),
		/exactly|schema keys/iu,
	);
	const missingOrdinal = { ...invocation } as Record<string, unknown>;
	delete missingOrdinal.outputOrdinal;
	assert.throws(() => assertOfxHostInvocationV1(missingOrdinal), /schema keys|outputOrdinal/iu);
	assert.throws(
		() => assertOfxHostInvocationV1({ ...invocation, pluginFingerprint: `net.example.Blur@${SHA_B}` }),
		/fingerprint/iu,
	);
	assert.throws(
		() => createOfxHostInvocationV1({
			...invocation,
			context: 'retimer',
			retimerSourceTime: null,
		}),
		/SourceTime/iu,
	);
});

test('every image-effect context enters the same isolated invocation boundary', () => {
	for (const context of OFX_HOST_EXECUTION_CONTRACT_V1.contexts) {
		const retimerSourceTime = context === 'retimer' ? exactSourceTime() : undefined;
		const invocation = createOfxHostInvocationV1({
			invocationId: `invocation-${context}`,
			...HOST_PLAN,
			pluginId: 'net.example.Conformance',
			pluginBinarySha256: SHA_A,
			context,
			action: 'render',
			stateSha256: SHA_B,
			inputFrameStreamIds: context === 'generator' ? [] : ['stream-source'],
			outputFrameStreamId: 'stream-output',
			requestedBackend: 'cpu',
			abortSignalId: 'abort-1',
			retimerSourceTime,
		});
		assert.equal(invocation.context, context);
		assert.equal(invocation.retimerSourceTime?.parameter ?? null,
			context === 'retimer' ? 'SourceTime' : null);
	}
});

test('a runtime process refuses a second plug-in binary fingerprint', () => {
	const first = createOfxHostInvocationV1({
		invocationId: 'invocation-first', ...HOST_PLAN, pluginId: 'net.example.First',
		pluginBinarySha256: SHA_A, context: 'filter', action: 'render', stateSha256: SHA_B,
		inputFrameStreamIds: ['stream-source'], outputFrameStreamId: 'stream-output',
		requestedBackend: 'cpu', abortSignalId: 'abort-first',
	});
	const second = createOfxHostInvocationV1({
		invocationId: 'invocation-second', ...HOST_PLAN, pluginId: 'net.example.Second',
		pluginBinarySha256: SHA_B, context: 'filter', action: 'render', stateSha256: SHA_C,
		inputFrameStreamIds: ['stream-source'], outputFrameStreamId: 'stream-output',
		requestedBackend: 'cpu', abortSignalId: 'abort-second',
	});
	assert.doesNotThrow(() => assertOfxRuntimeProcessBatchV1({
		pluginFingerprint: first.pluginFingerprint, invocations: [first],
	}));
	assert.throws(() => assertOfxRuntimeProcessBatchV1({
		pluginFingerprint: first.pluginFingerprint, invocations: [first, second],
	}), /only one binary fingerprint/iu);
});

function exactSourceTime() {
	const sourceId = 'curve-source';
	const authority = createVideoRetimeExactOrdinalAuthority(
		createFiveModeIntent(),
		new Map([[sourceId, bindCfrTiming(sourceId, 20, { num: 1, den: 1 })]]),
	);
	return createOfxRetimerSourceTimeV1(authority, {
		outputOrdinal: 3, clipId: 'curve-clip', sourceId,
	});
}

test('GPU failure visibly retries CPU without mutating authored state', () => {
	assert.deepEqual(resolveOfxRenderBackendV1({
		requestedBackend: 'cuda', supportedBackends: ['cpu', 'cuda'], failedBackends: [],
	}), {
		backend: 'cuda', retriedOnCpu: false, reportsDegradation: false,
	});
	assert.deepEqual(resolveOfxRenderBackendV1({
		requestedBackend: 'cuda', supportedBackends: ['cpu', 'cuda'], failedBackends: ['cuda'],
	}), {
		backend: 'cpu', retriedOnCpu: true, reportsDegradation: true,
	});
	assert.throws(() => resolveOfxRenderBackendV1({
		requestedBackend: 'metal', supportedBackends: ['metal'], failedBackends: ['metal'],
	}), /CPU/iu);
});

test('offscreen Interact events are normalized and cannot request native windows', () => {
	assert.deepEqual(normalizeOfxInteractEventV1({
		kind: 'pointer', phase: 'down', sequence: 3, x: 0.25, y: 0.75, button: 1,
		modifiers: ['alt', 'shift'],
	}), {
		kind: 'pointer', phase: 'down', sequence: 3, x: 0.25, y: 0.75, button: 1,
		modifiers: ['alt', 'shift'],
	});
	assert.throws(() => normalizeOfxInteractEventV1({
		kind: 'vendor-window', sequence: 4,
	}), /unsupported|offscreen/iu);
	assert.throws(() => normalizeOfxInteractEventV1({
		kind: 'pointer', phase: 'motion', sequence: 5, x: 1.1, y: 0, button: 0, modifiers: [],
	}), /normalized/iu);
});

test('V26 persisted state is context/input/fingerprint bound and fallback freshness is exact', () => {
	const state = effectState();
	assert.doesNotThrow(() => assertOfxEffectStateV26(state));
	assert.deepEqual(resolveOfxEffectStateV26(state, {
		availability: 'available',
		pluginId: 'net.example.Blur',
		binarySha256: SHA_A,
		freshness: freshness(),
	}), { mode: 'render', authoredStatePreserved: true, reportsDegradation: false });
	for (const availability of ['missing', 'crashed', 'revoked', 'quarantined'] as const) {
		assert.deepEqual(resolveOfxEffectStateV26(state, {
			availability, pluginId: null, binarySha256: null, freshness: freshness(),
		}), { mode: 'frozen', authoredStatePreserved: true, reportsDegradation: true }, availability);
	}
	assert.deepEqual(resolveOfxEffectStateV26(state, {
		availability: 'fingerprint-changed', pluginId: 'net.example.Blur', binarySha256: SHA_B,
		freshness: { ...freshness(), renderPlanFingerprintSha256: SHA_A },
	}), { mode: 'bypass', authoredStatePreserved: true, reportsDegradation: true });
	assert.throws(() => assertOfxEffectStateV26({
		...state,
		attachment: { kind: 'filter', targetId: '/tmp/clip' },
	}), /project identity|path/iu);
});

function freshness() {
	return {
		authoredStateSha256: SHA_A,
		inputIdentitiesSha256: SHA_B,
		renderPlanFingerprintSha256: SHA_C,
		nativeEffectFingerprintSha256: SHA_D,
	};
}

function effectState(): OfxEffectStateV26 {
	return {
		schemaVersion: 1,
		instanceId: 'ofx-instance-1',
		pluginId: 'net.example.Blur',
		binarySha256: SHA_A,
		context: 'filter',
		attachment: { kind: 'filter', targetId: 'video-clip-1' },
		inputs: [{ name: 'Source', sourceRef: 'video-source-1' }],
		parameters: [{ name: 'radius', type: 'double', value: [2], keyframes: [
			{ frame: 0, value: 2 }, { frame: 10, value: 5 },
		] }],
		customEncodings: {},
		enabled: true,
		freshness: freshness(),
		frozenFallback: {
			externalMediaSourceId: 'ofx-frozen-source-1',
			renderedAssetSha256: SHA_A,
			frameCount: 240,
			freshness: freshness(),
		},
	};
}
