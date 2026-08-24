/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	helperNativeJobGrantResourceUsage,
	validateHelperNativeJobGrant,
} from '../desktop/helper-native-job-contract.ts';
import { HelperContractViolationError } from '../desktop/helper-wire-admission.ts';
import { createOfxHostInvocationV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import { createOfxHostInvocationV2 } from '../src/common/editor/native-ofx-host-contract-v2.ts';
import { createOfxRetimerSourceTimeV1 } from '../src/common/editor/native-ofx-retimer-source-time.ts';
import { createVideoRetimeExactOrdinalAuthority } from '../src/common/editor/video-retime-exact-ordinal-authority.ts';
import { bindCfrTiming, createFiveModeIntent } from './helpers/video-retime-export-fixtures.ts';

const PLAN_SHA256 = '1'.repeat(64);
const PLUGIN_SHA256 = '2'.repeat(64);
const STATE_SHA256 = '3'.repeat(64);
const PLAN_STREAM_ID = '10'.repeat(20);
const INPUT_STREAM_ID = '20'.repeat(20);
const OUTPUT_STREAM_ID = '30'.repeat(20);

function binding(direction: 'host-to-helper' | 'helper-to-host', streamId: string) {
	return Object.freeze({
		dataPlaneVersion: 1 as const,
		transport: 'message-port' as const,
		streamId,
		direction,
		byteLength: 4,
		sha256: direction === 'host-to-helper' && streamId === PLAN_STREAM_ID
			? PLAN_SHA256 : '4'.repeat(64),
		maximumChunkBytes: 4,
		maximumInFlightChunks: 1,
	});
}

function outputReservation() {
	return Object.freeze({
		dataPlaneVersion: 1 as const,
		transport: 'message-port' as const,
		streamId: OUTPUT_STREAM_ID,
		direction: 'helper-to-host' as const,
		exactByteLength: 4,
		maximumByteLength: 4,
		maximumChunkBytes: 4,
		maximumInFlightChunks: 1,
	});
}

function invocation(version: 1 | 2) {
	const common = {
		invocationId: `ofx-v${String(version)}-dispatch`,
		unifiedPlanVersion: version === 1 ? 12 : 14,
		unifiedPlanSha256: PLAN_SHA256,
		nodeId: 'openfx-node',
		instanceId: 'openfx-instance',
		pluginId: 'org.framescaper.Dispatch',
		pluginBinarySha256: PLUGIN_SHA256,
		context: 'filter',
		action: 'render',
		stateSha256: STATE_SHA256,
		inputFrameStreamIds: [INPUT_STREAM_ID],
		outputFrameStreamId: OUTPUT_STREAM_ID,
		outputOrdinal: 7,
		requestedBackend: 'cpu',
		abortSignalId: `abort-v${String(version)}-dispatch`,
	};
	return version === 1
		? createOfxHostInvocationV1(common)
		: createOfxHostInvocationV2(common);
}

function grant(version: 1 | 2) {
	return {
		executable: executable('ofx-host', '/runtime/ofx-host', '5'.repeat(64)),
		pluginBinary: executable('ofx-plugin', '/plugins/dispatch.ofx', PLUGIN_SHA256),
		invocation: invocation(version),
		plan: binding('host-to-helper', PLAN_STREAM_ID),
		inputs: [{
			name: 'Source', sourceRef: 'source-1', pixelFormat: 'rgba8',
			width: 1, height: 1, rowBytes: 4,
			frame: binding('host-to-helper', INPUT_STREAM_ID),
		}],
		output: {
			pixelFormat: 'rgba8', width: 1, height: 1, rowBytes: 4,
			frame: outputReservation(),
		},
		scratch: {
			rootPath: '/scratch/framescaper', rootIdentity: { dev: 1, ino: 4 },
			reservationId: 'aa'.repeat(20), maximumBytes: 4_096,
		},
	};
}

function executable(role: 'ofx-host' | 'ofx-plugin', path: string, sha256: string) {
	return Object.freeze({ role, path, bytes: 4_096, sha256, identity: { dev: 1, ino: 3 } });
}

function unsafeGrant(error: unknown): boolean {
	return error instanceof HelperContractViolationError && error.code === 'unsafe-grant';
}

test('OFX helper dispatch preserves exact V1 and admits exact V2', () => {
	for (const version of [1, 2] as const) {
		const admitted = validateHelperNativeJobGrant('ofx-host', grant(version));
		if (!('invocation' in admitted)) throw new Error('A render grant admitted as Interact.');
		assert.equal(admitted.invocation.schemaVersion, version);
		assert.equal(admitted.invocation.unifiedPlanVersion, version === 1 ? 12 : 14);
		assert.equal(Object.isFrozen(admitted), true);
		assert.ok(helperNativeJobGrantResourceUsage('ofx-host', admitted).inputBytes > 0);
	}
});

test('a V14 Retimer invocation admits the oracle SourceTime and survives the grant boundary', () => {
	const timing = bindCfrTiming('curve-source', 20, { num: 1, den: 1 });
	const authority = createVideoRetimeExactOrdinalAuthority(
		createFiveModeIntent(),
		new Map([['curve-source', timing]]),
	);
	const sourceTime = createOfxRetimerSourceTimeV1(authority, {
		outputOrdinal: 7, clipId: 'curve-clip', sourceId: 'curve-source',
	});
	const retimerInput = (retimerSourceTime: unknown) => ({
		invocationId: 'ofx-v2-retimer',
		unifiedPlanVersion: 14,
		unifiedPlanSha256: PLAN_SHA256,
		nodeId: 'openfx-node',
		instanceId: 'openfx-instance',
		pluginId: 'org.framescaper.Dispatch',
		pluginBinarySha256: PLUGIN_SHA256,
		context: 'retimer',
		action: 'render',
		stateSha256: STATE_SHA256,
		inputFrameStreamIds: [INPUT_STREAM_ID],
		outputFrameStreamId: OUTPUT_STREAM_ID,
		outputOrdinal: 7,
		requestedBackend: 'cpu',
		abortSignalId: 'abort-v2-retimer',
		retimerSourceTime,
	});
	// The genuine oracle value constructs: the identity check runs on the
	// caller's value, not on a snapshot that can never re-enter the WeakSet.
	const invocation = createOfxHostInvocationV2(retimerInput(sourceTime));
	assert.equal(invocation.context, 'retimer');
	assert.deepEqual(invocation.retimerSourceTime, { ...sourceTime });
	// The grant admission clones across the main-to-helper boundary and must
	// still admit the invocation on structural evidence.
	const admitted = validateHelperNativeJobGrant('ofx-host', { ...grant(2), invocation });
	if (!('invocation' in admitted)) throw new Error('A render grant admitted as Interact.');
	assert.equal(admitted.invocation.context, 'retimer');
	assert.deepEqual(admitted.invocation.retimerSourceTime, { ...sourceTime });
	// A structurally identical SourceTime that never visited the oracle is forged.
	assert.throws(() => createOfxHostInvocationV2(retimerInput(structuredClone(sourceTime))),
		/exact ordinal oracle/iu);
});

test('OFX helper dispatch rejects crossed, unknown, and widened invocation versions', () => {
	const v1 = grant(1);
	const v2 = grant(2);
	for (const candidate of [
		{ ...v1, invocation: { ...v1.invocation, schemaVersion: 2 } },
		{ ...v2, invocation: { ...v2.invocation, schemaVersion: 1 } },
		{ ...v2, invocation: { ...v2.invocation, schemaVersion: 3 } },
		{ ...v2, invocation: { ...v2.invocation, compatibilityVersion: 1 } },
		{ ...v2, compatibilityMode: 'v1' },
	]) assert.throws(() => validateHelperNativeJobGrant('ofx-host', candidate), unsafeGrant);
});
