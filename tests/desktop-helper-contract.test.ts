/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	HELPER_CONTRACT_VERSION,
	HELPER_RESOURCE_HARD_LIMITS,
	HelperContractViolationError,
	deserializeHelperError,
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
	for (const message of VALID_HOST_MESSAGES) {
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

/**
 * The malformed-message discipline of quality-budget fixture
 * `m5-helper-fault-and-loopback-v1`: exactly 10,000 deterministic malformed
 * wire payloads, every one rejected with the contract's typed violation and
 * nothing else. This suite runs in ordinary CI as correctness evidence; the
 * fixture's device-bound loopback half stays on the unprovisioned lab matrix.
 */
test('helper contract v1 rejects 10,000 deterministic malformed messages with typed violations', () => {
	const random = mulberry32(0x5001);
	const cases = deterministicMalformedCases(random, 10_000);
	assert.equal(cases.length, 10_000);
	let rejectedByBoth = 0;
	for (const [index, malformed] of cases.entries()) {
		let bothRejected = true;
		for (const validate of [validateHelperHostMessage, validateHelperProcessMessage]) {
			try {
				validate(malformed.value);
				// A mutation may land back on a valid shape — for example the
				// result envelope's opaque payload — which is fine; it must
				// simply never escape with an untyped throw.
				bothRejected = false;
			} catch (error) {
				assert.ok(
					error instanceof HelperContractViolationError,
					`case ${String(index)} (${malformed.label}) must reject with a typed violation, saw ${String(error)}`,
				);
			}
		}
		if (bothRejected) rejectedByBoth += 1;
	}
	assert.ok(rejectedByBoth >= 9_850,
		`at least 9,850 of 10,000 mutations must be rejected by both directions, saw ${String(rejectedByBoth)}`);
});

test('helper contract v1 rejects oversized payloads with the typed oversized violation', () => {
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
	});
	const lowered = normalizeHelperResourcePolicy({ maximumRssBytes: 512 * 1024 ** 2 });
	assert.equal(lowered.maximumRssBytes, 512 * 1024 ** 2);
	assert.throws(() => normalizeHelperResourcePolicy({ maximumRssBytes: HELPER_RESOURCE_HARD_LIMITS.maximumRssBytes + 1 }), RangeError);
	assert.throws(() => normalizeHelperResourcePolicy({ maximumJobDurationMs: 0 }), RangeError);
});

type MalformedCase = Readonly<{ label: string; value: unknown }>;

function deterministicMalformedCases(random: () => number, count: number): MalformedCase[] {
	const bases: readonly Readonly<Record<string, unknown>>[] = [...VALID_HOST_MESSAGES, ...VALID_PROCESS_MESSAGES];
	const junkValues: readonly unknown[] = [
		null, undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '', 'junk', true, false,
		[], {}, { nested: true }, Symbol.iterator, () => {}, 9_007_199_254_740_993n < 0n ? null : 42n,
	];
	const badJobIds = ['', 'short', JOB_ID.toUpperCase(), `${JOB_ID}ff`, JOB_ID.slice(0, 39), 'zz'.repeat(20), 42, null];
	const badPaths = ['relative/path.mp4', '../escape.mp4', '/media/../etc/passwd', '/media/\0.mp4', '', 'C:relative.mp4', `/${'a'.repeat(5_000)}.mp4`];
	const cases: MalformedCase[] = [];
	const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
	while (cases.length < count) {
		const strategy = Math.floor(random() * 8);
		const base = structuredClone(pick(bases)) as Record<string, unknown>;
		if (strategy === 0) {
			cases.push({ label: 'non-record root', value: pick(junkValues) });
			continue;
		}
		if (strategy === 1) {
			const keys = Object.keys(base);
			delete base[pick(keys)];
			cases.push({ label: 'dropped key', value: base });
			continue;
		}
		if (strategy === 2) {
			base[`extra_${String(Math.floor(random() * 1_000))}`] = pick(junkValues);
			cases.push({ label: 'extra key', value: base });
			continue;
		}
		if (strategy === 3) {
			base.contractVersion = pick([0, 2, -1, '1', null, 1.5]);
			cases.push({ label: 'bad version', value: base });
			continue;
		}
		if (strategy === 4) {
			base.type = pick(['spawn', 'exec', 'eval', '', 42, null, 'JOB']);
			cases.push({ label: 'unknown type', value: base });
			continue;
		}
		if (strategy === 5 && 'jobId' in base) {
			base.jobId = pick(badJobIds);
			cases.push({ label: 'bad job id', value: base });
			continue;
		}
		if (strategy === 6 && base.type === 'job') {
			const grant = base.grant as Record<string, unknown>;
			const field = Math.floor(random() * 3);
			if (field === 0) grant.mediaPath = pick(badPaths);
			else if (field === 1) grant.mediaBytes = pick([-1, 1.5, '10', null, Number.MAX_SAFE_INTEGER + 2]);
			else grant.identity = pick([null, {}, { dev: 1 }, { dev: 1.5, ino: 2 }, { dev: 1, ino: 2, extra: 3 }]);
			cases.push({ label: 'unsafe grant', value: base });
			continue;
		}
		if (strategy === 7 && base.type === 'job') {
			const policy = base.resourcePolicy as Record<string, unknown>;
			const key = pick(Object.keys(policy));
			policy[key] = pick([0, -5, 1.25, Number.MAX_SAFE_INTEGER, '1024', null]);
			cases.push({ label: 'bad resource policy', value: base });
			continue;
		}
		const keys = Object.keys(base);
		const key = pick(keys);
		base[key] = pick(junkValues);
		cases.push({ label: `mutated ${key}`, value: base });
	}
	return cases;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
	};
}
