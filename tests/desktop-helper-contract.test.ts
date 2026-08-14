/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	HELPER_CONTRACT_VERSION,
	HELPER_JOB_DURATION_HARD_LIMITS,
	HELPER_JOB_KINDS,
	HELPER_PROBE_JOB_KINDS,
	HELPER_RESOURCE_HARD_LIMITS,
	MAXIMUM_HELPER_WIRE_MESSAGE_BYTES,
	HelperContractViolationError,
	deserializeHelperError,
	helperJobGrantInputBytes,
	normalizeHelperResourcePolicy,
	serializeHelperError,
	validateHelperHostMessage,
	validateHelperProbeResult,
	validateHelperProcessMessage,
} from '../desktop/helper-contract.ts';
import {
	VIDEO_TIMING_ASSET_HEADER_BYTES,
	VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
} from '../src/common/editor/video-timing-asset-reference.ts';

const JOB_ID = 'ab'.repeat(20);

const VALID_JOB = Object.freeze({
	contractVersion: 1,
	type: 'job',
	jobId: JOB_ID,
	kind: 'probe-video-source',
	grant: { mediaPath: '/media/example.mp4', mediaBytes: 1024, identity: { dev: 3, ino: 42 } },
	resourcePolicy: {
		maximumInputBytes: 1024 ** 3,
		maximumJobDurationMs: 60_000,
		maximumRssBytes: 1024 ** 3,
	},
});

const VALID_FUTURE_JOBS = Object.freeze([
	{
		...VALID_JOB,
		kind: 'audio-device',
		grant: {
			backend: 'coreaudio',
			deviceHandle: 'main-resolved-device-7',
			direction: 'duplex',
			mode: 'shared',
		},
	},
	{
		...VALID_JOB,
		kind: 'plugin-scan',
		grant: {
			rootPath: '/Library/Audio/Plug-Ins/VST3',
			format: 'vst3',
			identity: { dev: 3, ino: 43 },
		},
	},
	{
		...VALID_JOB,
		kind: 'plugin-host',
		grant: {
			binaryPath: '/Library/Audio/Plug-Ins/VST3/example.vst3',
			binaryBytes: 4_096,
			binarySha256: 'a'.repeat(64),
			format: 'vst3',
			identity: { dev: 3, ino: 44 },
		},
	},
]);

const VALID_HOST_MESSAGES = Object.freeze([
	VALID_JOB,
	{ contractVersion: 1, type: 'cancel', jobId: JOB_ID },
	{ contractVersion: 1, type: 'shutdown' },
]);

const VALID_PROCESS_MESSAGES = Object.freeze([
	{ contractVersion: 1, type: 'hello', kinds: ['probe-video-source'] },
	{ contractVersion: 1, type: 'heartbeat', jobId: null },
	{ contractVersion: 1, type: 'heartbeat', jobId: JOB_ID },
	{ contractVersion: 1, type: 'progress', jobId: JOB_ID, value: 0.5 },
	{ contractVersion: 1, type: 'progress', jobId: JOB_ID, value: null },
	{ contractVersion: 1, type: 'result', jobId: JOB_ID, result: { anything: true } },
	{ contractVersion: 1, type: 'error', jobId: JOB_ID, error: { name: 'Error', message: 'failed' } },
	{ contractVersion: 1, type: 'cancelled', jobId: JOB_ID },
]);

test('helper contract v1 accepts every well-formed wire message', () => {
	for (const message of [...VALID_HOST_MESSAGES, ...VALID_FUTURE_JOBS]) {
		const validated = validateHelperHostMessage(structuredClone(message));
		assert.equal(validated.contractVersion, HELPER_CONTRACT_VERSION);
		assert.equal(validated.type, message.type);
	}
	for (const message of VALID_PROCESS_MESSAGES) {
		const validated = validateHelperProcessMessage(structuredClone(message));
		assert.equal(validated.contractVersion, HELPER_CONTRACT_VERSION);
		assert.equal(validated.type, message.type);
	}
});

test('helper contract v1 negotiates closed job families and kind-correlated main grants', () => {
	assert.deepEqual(HELPER_JOB_KINDS, [
		'probe-video-source', 'audio-device', 'plugin-scan', 'plugin-host',
	]);
	assert.deepEqual(HELPER_PROBE_JOB_KINDS, ['probe-video-source']);
	const hello = validateHelperProcessMessage({
		contractVersion: 1,
		type: 'hello',
		kinds: ['audio-device', 'plugin-host'],
	});
	assert.equal(hello.type, 'hello');
	assert.deepEqual(hello.type === 'hello' ? hello.kinds : null, ['audio-device', 'plugin-host']);
	assert.equal(helperJobGrantInputBytes('probe-video-source', VALID_JOB.grant), 1_024);
	assert.equal(helperJobGrantInputBytes('audio-device', VALID_FUTURE_JOBS[0].grant), 0);
	assert.equal(helperJobGrantInputBytes('plugin-scan', VALID_FUTURE_JOBS[1].grant), 0);
	assert.equal(helperJobGrantInputBytes('plugin-host', VALID_FUTURE_JOBS[2].grant), 4_096);
	assert.throws(() => helperJobGrantInputBytes('audio-device', VALID_JOB.grant), HelperContractViolationError);
	assert.throws(() => helperJobGrantInputBytes(
		'unknown-kind' as 'audio-device', VALID_FUTURE_JOBS[0].grant,
	), (error: unknown) => error instanceof HelperContractViolationError && error.code === 'unknown-kind');

	for (const value of [
		{ ...VALID_FUTURE_JOBS[0], grant: VALID_FUTURE_JOBS[2].grant },
		{ ...VALID_FUTURE_JOBS[0], grant: { ...VALID_FUTURE_JOBS[0].grant, mediaPath: '/not-admitted' } },
		{ ...VALID_FUTURE_JOBS[0], grant: { ...VALID_FUTURE_JOBS[0].grant, deviceHandle: 'é'.repeat(513) } },
		{ ...VALID_FUTURE_JOBS[0], grant: { ...VALID_FUTURE_JOBS[0].grant, deviceHandle: 'device\0tail' } },
		{ ...VALID_FUTURE_JOBS[1], grant: { ...VALID_FUTURE_JOBS[1].grant, rootPath: 'relative/VST3' } },
		{ ...VALID_FUTURE_JOBS[1], grant: { ...VALID_FUTURE_JOBS[1].grant, rootPath: `/${'é'.repeat(2_048)}` } },
		{ ...VALID_FUTURE_JOBS[1], grant: { ...VALID_FUTURE_JOBS[1].grant, format: 'dll' } },
		{ ...VALID_FUTURE_JOBS[2], grant: { ...VALID_FUTURE_JOBS[2].grant, binarySha256: 'A'.repeat(64) } },
		{ ...VALID_FUTURE_JOBS[2], grant: { ...VALID_FUTURE_JOBS[2].grant, binaryPath: `/${'e'.repeat(4_097)}` } },
	]) {
		assert.throws(() => validateHelperHostMessage(value), (error: unknown) => (
			error instanceof HelperContractViolationError && error.code === 'unsafe-grant'
		));
	}
	assert.throws(() => validateHelperProcessMessage({
		contractVersion: 1,
		type: 'hello',
		kinds: ['plugin-host', 'plugin-host'],
	}), HelperContractViolationError);
});

test('helper contract v1 rejects every well-formed message in the wrong direction', () => {
	for (const message of VALID_PROCESS_MESSAGES) {
		assert.throws(() => validateHelperHostMessage(structuredClone(message)), (error: unknown) => (
			error instanceof HelperContractViolationError && error.code === 'wrong-direction'
		));
	}
	for (const message of VALID_HOST_MESSAGES) {
		assert.throws(() => validateHelperProcessMessage(structuredClone(message)), (error: unknown) => (
			error instanceof HelperContractViolationError && error.code === 'wrong-direction'
		));
	}
});

/**
 * The malformed-message discipline of quality-budget fixture
 * `m5-helper-fault-and-loopback-v1`: exactly 10,000 deterministic malformed
 * wire payloads, every one rejected with the contract's typed violation and
 * nothing else. This suite runs in ordinary CI as correctness evidence; the
 * fixture's device-bound loopback half stays on the unprovisioned lab matrix.
 */
test('helper contract v1 rejects exactly 10,000 assigned-direction malformed cases', () => {
	const cases = deterministicMalformedCases(10_000);
	assert.equal(cases.length, 10_000);
	for (const [index, malformed] of cases.entries()) {
		const validate = malformed.direction === 'host'
			? validateHelperHostMessage
			: validateHelperProcessMessage;
		assert.throws(() => validate(malformed.value), (error: unknown) => (
			error instanceof HelperContractViolationError
		), `case ${String(index)} (${malformed.direction}: ${malformed.label}) must reject with a typed violation`);
	}
});

test('helper contract v1 applies the exact global envelope bound before family semantics', () => {
	const resultBase = { contractVersion: 1, type: 'result', jobId: JOB_ID, result: '' };
	const baseBytes = Buffer.byteLength(JSON.stringify(resultBase), 'utf8');
	const atLimit = { ...resultBase, result: 'x'.repeat(MAXIMUM_HELPER_WIRE_MESSAGE_BYTES - baseBytes) };
	assert.equal(Buffer.byteLength(JSON.stringify(atLimit), 'utf8'), MAXIMUM_HELPER_WIRE_MESSAGE_BYTES);
	assert.equal(validateHelperProcessMessage(atLimit).type, 'result');
	assert.throws(() => validateHelperProcessMessage({ ...atLimit, result: `${atLimit.result}x` }), (error: unknown) => (
		error instanceof HelperContractViolationError && error.code === 'oversized'
	));

	for (const message of [...VALID_HOST_MESSAGES, ...VALID_PROCESS_MESSAGES]) {
		const validate = VALID_HOST_MESSAGES.includes(message as never)
			? validateHelperHostMessage
			: validateHelperProcessMessage;
		assert.throws(() => validate({ ...message, padding: 'x'.repeat(64 * 1024) }), (error: unknown) => (
			error instanceof HelperContractViolationError && error.code === 'oversized'
		), `oversized ${message.type} must fail at the global admission gate`);
	}
	assert.throws(() => validateHelperProcessMessage({
		contractVersion: 1,
		type: 'hello',
		kinds: Array.from({ length: 8_000 }, () => 'not-a-kind'),
	}), (error: unknown) => error instanceof HelperContractViolationError && error.code === 'oversized');

	const oversizedCharacteristics = {
		timingAsset: new Uint8Array(VIDEO_TIMING_ASSET_HEADER_BYTES),
		nominalRate: { num: 30, den: 1 },
		characteristics: { padding: 'x'.repeat(65 * 1024) },
	};
	assert.throws(() => validateHelperProbeResult(oversizedCharacteristics), (error: unknown) => (
		error instanceof HelperContractViolationError && error.code === 'oversized'
	));
	const oversizedAsset = {
		timingAsset: new Uint8Array(VIDEO_TIMING_ASSET_MAXIMUM_BYTES + 8),
		nominalRate: { num: 30, den: 1 },
		characteristics: null,
	};
	assert.throws(() => validateHelperProbeResult(oversizedAsset), (error: unknown) => (
		error instanceof HelperContractViolationError && error.code === 'oversized'
	));
	assert.throws(() => validateHelperProcessMessage({
		...resultBase,
		result: { timingAsset: new Uint8Array(VIDEO_TIMING_ASSET_MAXIMUM_BYTES + 1) },
	}), (error: unknown) => error instanceof HelperContractViolationError && error.code === 'oversized');
});

test('helper wire admission rejects hostile structured-clone shapes without invoking accessors', () => {
	let invoked = false;
	const accessor = { contractVersion: 1, type: 'shutdown' };
	Object.defineProperty(accessor, 'payload', {
		enumerable: true,
		get() {
			invoked = true;
			return 'untrusted';
		},
	});
	const symbolKey = { contractVersion: 1, type: 'shutdown', [Symbol('hidden')]: true };
	const sparse = { contractVersion: 1, type: 'result', jobId: JOB_ID, result: new Array(2) };
	const nonPlain = { contractVersion: 1, type: 'result', jobId: JOB_ID, result: new Date(0) };
	const inherited = { contractVersion: 1, type: 'result', jobId: JOB_ID, result: Object.create({ inherited: true }) };
	const unsupportedView = {
		contractVersion: 1, type: 'result', jobId: JOB_ID, result: new Uint16Array(2),
	};
	const looseView = {
		contractVersion: 1,
		type: 'result',
		jobId: JOB_ID,
		result: new Uint8Array(new ArrayBuffer(64), 8, 32),
	};
	const unsupportedScalar = { contractVersion: 1, type: 'result', jobId: JOB_ID, result: 42n };
	const cyclic: Record<string, unknown> = { contractVersion: 1, type: 'result', jobId: JOB_ID };
	cyclic.result = cyclic;
	let deeplyNested: unknown = null;
	for (let depth = 0; depth < 128; depth += 1) deeplyNested = [deeplyNested];
	const deepResult = { contractVersion: 1, type: 'result', jobId: JOB_ID, result: deeplyNested };
	const sharedResult = typeof SharedArrayBuffer === 'function'
		? {
			contractVersion: 1,
			type: 'result',
			jobId: JOB_ID,
			result: new Uint8Array(new SharedArrayBuffer(VIDEO_TIMING_ASSET_HEADER_BYTES)),
		}
		: null;
	for (const [validate, value] of [
		[validateHelperHostMessage, accessor],
		[validateHelperHostMessage, symbolKey],
		[validateHelperProcessMessage, sparse],
		[validateHelperProcessMessage, nonPlain],
		[validateHelperProcessMessage, inherited],
		[validateHelperProcessMessage, unsupportedView],
		[validateHelperProcessMessage, looseView],
		[validateHelperProcessMessage, unsupportedScalar],
		[validateHelperProcessMessage, cyclic],
		[validateHelperProcessMessage, deepResult],
		...(sharedResult ? [[validateHelperProcessMessage, sharedResult] as const] : []),
	] as const) {
		assert.throws(() => validate(value), (error: unknown) => (
			error instanceof HelperContractViolationError && error.code === 'malformed'
		));
	}
	assert.equal(invoked, false);
});

test('helper contract v1 validates probe results and preserves structured errors round trip', () => {
	const payload = validateHelperProbeResult({
		timingAsset: new Uint8Array(VIDEO_TIMING_ASSET_HEADER_BYTES + 8),
		nominalRate: { num: 30_000, den: 1_001 },
		characteristics: { backend: 'ffmpeg' },
	});
	assert.equal(payload.nominalRate.num, 30_000);
	assert.equal(payload.timingAsset.byteLength, VIDEO_TIMING_ASSET_HEADER_BYTES + 8);
	for (const bad of [
		{ nominalRate: { num: 30, den: 1 }, characteristics: null },
		{ timingAsset: new Uint8Array(4), nominalRate: { num: 30, den: 1 }, characteristics: null },
		{ timingAsset: new Uint8Array(64), nominalRate: { num: 0, den: 1 }, characteristics: null },
		{ timingAsset: new Uint8Array(64), nominalRate: { num: 1.5, den: 1 }, characteristics: null },
		{ timingAsset: new Uint8Array(64), nominalRate: { num: 30, den: 1 }, characteristics: null, extra: 1 },
	]) {
		assert.throws(() => validateHelperProbeResult(bad), HelperContractViolationError);
	}

	const original = new RangeError('The granted media file no longer matches its captured identity.');
	(original as RangeError & { code: string }).code = 'HELPER_GRANT_IDENTITY_MISMATCH';
	const revived = deserializeHelperError(serializeHelperError(original));
	assert.equal(revived.name, 'RangeError');
	assert.equal(revived.message, original.message);
	assert.equal((revived as Error & { code?: string }).code, 'HELPER_GRANT_IDENTITY_MISMATCH');
});

test('helper resource policy is lower-only against the hard limits', () => {
	const defaulted = normalizeHelperResourcePolicy();
	assert.deepEqual(defaulted, {
		maximumInputBytes: HELPER_RESOURCE_HARD_LIMITS.maximumInputBytes,
		maximumJobDurationMs: HELPER_RESOURCE_HARD_LIMITS.maximumJobDurationMs,
		maximumRssBytes: HELPER_RESOURCE_HARD_LIMITS.maximumRssBytes,
		allowNetwork: false,
		allowChildProcesses: false,
		allowOutputFiles: false,
	});
	const lowered = normalizeHelperResourcePolicy({ maximumRssBytes: 512 * 1024 ** 2 });
	assert.equal(lowered.maximumRssBytes, 512 * 1024 ** 2);
	assert.equal(
		normalizeHelperResourcePolicy(undefined, 'plugin-scan').maximumJobDurationMs,
		HELPER_JOB_DURATION_HARD_LIMITS['plugin-scan'],
	);
	assert.ok(HELPER_JOB_DURATION_HARD_LIMITS['plugin-scan'] >= 30 * 60_000);
	assert.equal(HELPER_JOB_DURATION_HARD_LIMITS['audio-device'], 24 * 60 * 60_000);
	assert.equal(HELPER_JOB_DURATION_HARD_LIMITS['plugin-host'], 24 * 60 * 60_000);
	assert.throws(() => normalizeHelperResourcePolicy({
		maximumJobDurationMs: HELPER_JOB_DURATION_HARD_LIMITS['probe-video-source'] + 1,
	}, 'probe-video-source'), RangeError);
	assert.equal(normalizeHelperResourcePolicy({
		maximumJobDurationMs: 30 * 60_000,
	}, 'plugin-scan').maximumJobDurationMs, 30 * 60_000);
	assert.throws(() => validateHelperHostMessage({
		...VALID_JOB,
		resourcePolicy: { ...VALID_JOB.resourcePolicy, allowNetwork: true },
	}), (error: unknown) => error instanceof HelperContractViolationError && error.code === 'malformed');
	assert.throws(() => normalizeHelperResourcePolicy({ maximumRssBytes: HELPER_RESOURCE_HARD_LIMITS.maximumRssBytes + 1 }), RangeError);
	assert.throws(() => normalizeHelperResourcePolicy({ maximumJobDurationMs: 0 }), RangeError);
	assert.throws(() => normalizeHelperResourcePolicy(undefined, 'unknown-kind' as 'audio-device'), RangeError);
});

type MalformedCase = Readonly<{ direction: 'host' | 'process'; label: string; value: unknown }>;

function deterministicMalformedCases(count: number): MalformedCase[] {
	return Array.from({ length: count }, (_, index) => {
		const direction = index % 2 === 0 ? 'host' as const : 'process' as const;
		const ordinal = Math.floor(index / 2);
		const strategy = ordinal % 10;
		const base = structuredClone(direction === 'host'
			? VALID_JOB
			: VALID_PROCESS_MESSAGES[3]) as Record<string, unknown>;
		if (strategy === 0) {
			return { direction, label: 'wrong direction', value: structuredClone(direction === 'host'
				? VALID_PROCESS_MESSAGES[ordinal % VALID_PROCESS_MESSAGES.length]
				: VALID_HOST_MESSAGES[ordinal % VALID_HOST_MESSAGES.length]) };
		}
		if (strategy === 1) return { direction, label: 'non-record root', value: ordinal };
		if (strategy === 2) {
			delete base.type;
			return { direction, label: 'dropped required key', value: base };
		}
		if (strategy === 3) {
			base[`extra_${String(ordinal)}`] = true;
			return { direction, label: 'extra key', value: base };
		}
		if (strategy === 4) {
			base.contractVersion = 2 + ordinal;
			return { direction, label: 'unsupported version', value: base };
		}
		if (strategy === 5) {
			base.type = `unknown-${String(ordinal)}`;
			return { direction, label: 'unknown type', value: base };
		}
		if (strategy === 6) {
			base.jobId = `${JOB_ID.slice(1)}g`;
			return { direction, label: 'bad job id', value: base };
		}
		if (strategy === 7) {
			if (direction === 'host') base.kind = `unknown-${String(ordinal)}`;
			else base.value = 2;
			return { direction, label: 'invalid family value', value: base };
		}
		if (strategy === 8) {
			if (direction === 'host') {
				(base.grant as Record<string, unknown>).mediaPath = `relative-${String(ordinal)}`;
			} else {
				base.value = Number.NaN;
			}
			return { direction, label: 'unsafe nested field', value: base };
		}
		if (direction === 'host') {
			(base.resourcePolicy as Record<string, unknown>).maximumRssBytes = 0;
		} else {
			base.jobId = JOB_ID.toUpperCase();
		}
		return { direction, label: 'invalid lower-only value', value: base };
	});
}
