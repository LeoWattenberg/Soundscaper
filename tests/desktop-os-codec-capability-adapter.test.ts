/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	verifyOperatingSystemCodecCapabilities,
	type OperatingSystemCodecCanaryRequest,
	type OperatingSystemCodecCanaryRunner,
} from '../desktop/os-codec-capability-adapter.ts';
import {
	createOperatingSystemDesktopCodecProvider,
	type DesktopCodecCapability,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';
import type { DesktopCodecOperation } from '../src/common/editor/desktop-codec-coordinator.ts';

const H264 = videoCapability('wmf-h264-main-nv12-decode', 'mp4', 'h264', 'main', 'nv12');
const AAC = audioCapability('apple-aac-lc-f32p-encode', 'encode', 'm4a', 'aac', 'lc', 'f32p');
const HEVC = videoCapability('apple-hevc-main10-p010-decode', 'mov', 'hevc', 'main10', 'p010le');

test('Linux is unavailable without invoking a canary and macOS x64 is rejected', async () => {
	let calls = 0;
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'linux-arm64', osVersion: '6.14.0', candidates: [{ capability: H264 }],
		runner: { run: () => { calls += 1; return Promise.reject(new Error('must not run')); } },
	});
	assert.equal(result.status, 'unavailable');
	assert.equal(result.unavailableReason, 'linux-no-system-codec-provider');
	assert.equal(result.providerOptions.canaryVerifiedCapabilities.length, 0);
	assert.equal(result.observations.length, 0);
	assert.equal(calls, 0);
	await assert.rejects(() => verifyOperatingSystemCodecCapabilities({
		target: 'mac-x64' as 'mac-arm64', osVersion: '15.4', candidates: [], runner: null,
	}), /target/iu);
});

test('Windows Media Foundation admits only an exact echoed canary tuple', async () => {
	const requests: OperatingSystemCodecCanaryRequest[] = [];
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'win-x64', osVersion: '10.0.26100', candidates: [{ capability: H264 }],
		runner: runner((request) => {
			requests.push(request);
			return passed(request, '11'.repeat(32));
		}),
	});
	assert.equal(result.status, 'available');
	assert.equal(result.unavailableReason, null);
	assert.equal(requests[0]?.implementation, 'windows-media-foundation');
	assert.equal(requests[0]?.target, 'win-x64');
	assert.equal(requests[0]?.capability, result.providerOptions.canaryVerifiedCapabilities[0]?.capability);
	assert.equal(Object.isFrozen(requests[0]), true);
	assert.equal(Object.isFrozen(requests[0]?.capability), true);
	assert.match(result.providerOptions.capabilityGeneration, /^os-canary-[a-f0-9]{64}$/u);

	const provider = createOperatingSystemDesktopCodecProvider(result.providerOptions);
	assert.equal((await provider.preflight(asOperation(H264, { width: 1_920, height: 1_080 }), {})).disposition, 'supported');
	assert.equal(provider.resolve(asOperation(H264, { width: 1_920, height: 1_080 }))?.implementation,
		'windows-media-foundation');
	assert.equal((await provider.preflight(asOperation(H264, {
		profile: 'high', width: 1_920, height: 1_080,
	}), {})).disposition, 'unsupported');
	assert.equal((await provider.preflight(asOperation(H264, {
		width: 8_194, height: 1_080,
	}), {})).disposition, 'unsupported');
});

test('mac-arm64 routes audio and video canaries through only the reviewed Apple frameworks', async () => {
	const implementations: string[] = [];
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'mac-arm64', osVersion: '15.4',
		candidates: [{ capability: AAC }, { capability: HEVC }],
		runner: runner((request) => {
			implementations.push(request.implementation);
			return passed(request, request.capability.id === AAC.id ? '22'.repeat(32) : '33'.repeat(32));
		}),
	});
	assert.deepEqual(implementations, [
		'apple-audiotoolbox-avfoundation',
		'apple-avfoundation-videotoolbox',
	]);
	assert.equal(result.providerOptions.canaryVerifiedCapabilities.length, 2);
	const provider = createOperatingSystemDesktopCodecProvider(result.providerOptions);
	assert.equal(provider.resolve(asOperation(AAC, { sampleRate: 48_000, channelCount: 2 }))?.implementation,
		'apple-audiotoolbox-avfoundation');
	assert.equal(provider.resolve(asOperation(HEVC, { width: 3_840, height: 2_160 }))?.implementation,
		'apple-avfoundation-videotoolbox');
});

test('no injected native canary means no OS codec claim', async () => {
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'win-arm64', osVersion: '10.0.26100', candidates: [{ capability: H264 }], runner: null,
	});
	assert.equal(result.status, 'unavailable');
	assert.equal(result.unavailableReason, 'native-canary-adapter-unavailable');
	assert.deepEqual(result.providerOptions.canaryVerifiedCapabilities, []);
	assert.deepEqual(result.observations, [{
		capabilityId: H264.id, disposition: 'unavailable', reason: 'canary-adapter-unavailable',
	}]);
});

test('throws, malformed results, legacy fields, and mismatched echoes fail closed per tuple', async () => {
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'win-x64', osVersion: '10.0.26100',
		candidates: [
			{ capability: H264 },
			{ capability: { ...H264, id: 'wmf-h264-mismatched-evidence' } },
			{ capability: { ...H264, id: 'wmf-h264-malformed-evidence' } },
			{ capability: { ...H264, id: 'wmf-h264-legacy-evidence-field' } },
			{ capability: { ...H264, id: 'wmf-h264-legacy-status' } },
			{ capability: { ...H264, id: 'wmf-h264-runner-failed' } },
		],
		runner: runner((request) => {
			if (request.capability.id === H264.id) return passed(request, '44'.repeat(32));
			if (request.capability.id.endsWith('mismatched-evidence')) return {
				...passed(request, '55'.repeat(32)), capabilityDigest: '66'.repeat(32),
			};
			if (request.capability.id.endsWith('malformed-evidence')) return {
				...passed(request, '77'.repeat(32)), unreviewedClaim: true,
			};
			if (request.capability.id.endsWith('legacy-evidence-field')) return {
				...passed(request, '88'.repeat(32)), evidenceDigest: '88'.repeat(32),
			};
			if (request.capability.id.endsWith('legacy-status')) return {
				...passed(request, '99'.repeat(32)), status: 'qualified',
			};
			throw new Error('private native runtime failure');
		}),
	});
	assert.equal(result.status, 'available');
	assert.deepEqual(result.providerOptions.canaryVerifiedCapabilities.map(({ capability }) => capability.id), [H264.id]);
	assert.deepEqual(result.observations.map(({ disposition, reason }) => ({ disposition, reason })), [
		{ disposition: 'verified', reason: null },
		{ disposition: 'rejected', reason: 'mismatched-canary-result' },
		{ disposition: 'rejected', reason: 'malformed-canary-result' },
		{ disposition: 'rejected', reason: 'malformed-canary-result' },
		{ disposition: 'rejected', reason: 'malformed-canary-result' },
		{ disposition: 'unavailable', reason: 'canary-failed' },
	]);
});

test('typed native refusal and timeout remain unavailable rather than advertised', async () => {
	const refused = await verifyOperatingSystemCodecCapabilities({
		target: 'mac-arm64', osVersion: '15.4', candidates: [{ capability: AAC }],
		runner: { run: () => Promise.resolve({
			contractVersion: 1, status: 'unavailable', reason: 'tuple-unsupported',
		}) },
	});
	assert.equal(refused.status, 'unavailable');
	assert.deepEqual(refused.observations, [{
		capabilityId: AAC.id, disposition: 'unavailable', reason: 'tuple-unsupported',
	}]);

	const timedOut = await verifyOperatingSystemCodecCapabilities({
		target: 'mac-arm64', osVersion: '15.4', candidates: [{ capability: HEVC }],
		maximumDurationMs: 5,
		runner: { run: () => new Promise(() => {}) },
	});
	assert.equal(timedOut.status, 'unavailable');
	assert.equal(timedOut.observations[0]?.reason, 'canary-timeout');
});

test('verification identity binds exact tuples and result digests into immutable output', async () => {
	const collect = (resultDigest: string) => verifyOperatingSystemCodecCapabilities({
		target: 'win-x64' as const, osVersion: '10.0.26100', candidates: [{ capability: H264 }],
		runner: runner((request) => passed(request, resultDigest)),
	});
	const first = await collect('88'.repeat(32));
	const repeated = await collect('88'.repeat(32));
	const changed = await collect('99'.repeat(32));
	assert.equal(first.providerOptions.capabilityGeneration, repeated.providerOptions.capabilityGeneration);
	assert.notEqual(first.providerOptions.capabilityGeneration, changed.providerOptions.capabilityGeneration);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.isFrozen(first.providerOptions), true);
	assert.equal(Object.isFrozen(first.observations), true);
	assert.equal(Object.isFrozen(first.providerOptions.canaryVerifiedCapabilities), true);
	assert.throws(() => {
		(first.providerOptions as { osVersion: string }).osVersion = 'changed';
	}, TypeError);
});

function runner(
	answer: (request: OperatingSystemCodecCanaryRequest) => unknown,
): OperatingSystemCodecCanaryRunner {
	return { run: (request) => Promise.resolve(answer(request)) };
}

function passed(request: OperatingSystemCodecCanaryRequest, resultDigest: string) {
	return {
		contractVersion: 1 as const, status: 'passed' as const,
		target: request.target, osVersion: request.osVersion,
		capabilityId: request.capability.id, capabilityDigest: request.capabilityDigest,
		implementation: request.implementation, nativeApiReached: true as const,
		exactTuplePassed: true as const, resultDigest,
	};
}

function videoCapability(
	id: string, container: string, codec: string, profile: string, pixelFormat: string,
): DesktopCodecCapability {
	return Object.freeze({
		id, direction: 'decode', mediaKind: 'video', container, codec, profile,
		sampleFormat: null, pixelFormat, sampleRate: null, channelCount: null,
		width: Object.freeze({ minimum: 16, maximum: 8_192, multipleOf: 2 }),
		height: Object.freeze({ minimum: 16, maximum: 8_192, multipleOf: 2 }),
	});
}

function audioCapability(
	id: string, direction: 'encode' | 'decode', container: string, codec: string,
	profile: string | null, sampleFormat: string,
): DesktopCodecCapability {
	return Object.freeze({
		id, direction, mediaKind: 'audio', container, codec, profile, sampleFormat,
		pixelFormat: null,
		sampleRate: Object.freeze({ minimum: 8_000, maximum: 192_000, multipleOf: 1 }),
		channelCount: Object.freeze({ minimum: 1, maximum: 8, multipleOf: 1 }),
		width: null, height: null,
	});
}

function asOperation(
	capability: DesktopCodecCapability, overrides: Partial<DesktopCodecOperation>,
): DesktopCodecOperation {
	return Object.freeze({
		direction: capability.direction, mediaKind: capability.mediaKind,
		container: capability.container, codec: capability.codec, profile: capability.profile,
		sampleFormat: capability.sampleFormat, pixelFormat: capability.pixelFormat,
		sampleRate: typeof capability.sampleRate === 'number' ? capability.sampleRate : null,
		channelCount: typeof capability.channelCount === 'number' ? capability.channelCount : null,
		width: typeof capability.width === 'number' ? capability.width : null,
		height: typeof capability.height === 'number' ? capability.height : null,
		...overrides,
	});
}
