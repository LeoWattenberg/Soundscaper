/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TRANSIENT_ANALYSIS_ALGORITHM,
	detectPcmTransients,
	normalizeTransientAnalysisParameters,
	type TransientAnalysisResult,
} from '../src/common/editor/transient-analysis.ts';
import {
	TRANSIENT_ANALYSIS_DERIVATIVE_BINDING_VERSION,
	createTransientAnalysisCacheRecord,
	inspectTransientAnalysisCacheRecord,
	normalizeTransientAnalysisCacheRecord,
	transientAnalysisIdentity,
	type TransientAnalysisIdentity,
} from '../src/common/editor/storage/transient-analysis-cache.ts';

const SOURCE_DIGEST = 'a'.repeat(64);
const PARAMETERS = Object.freeze({
	windowFrames: 64,
	hopFrames: 32,
	baselineWindowHops: 4,
	sensitivity: 1.5,
	minimumSpacingFrames: 128,
	floorDbfs: -60,
});

test('PCM transient analysis is deterministic, source-frame exact, and input preserving', () => {
	const channels = transientFixture();
	const before = channels.map((channel) => channel.slice());
	const first = detectPcmTransients(channels, {
		sourceStartFrame: 1_000,
		channelPolicy: 'linked-peak',
		parameters: PARAMETERS,
	});
	const second = detectPcmTransients(channels, {
		sourceStartFrame: 1_000,
		channelPolicy: 'linked-peak',
		parameters: { ...PARAMETERS },
	});

	assert.deepEqual(first, second);
	assert.deepEqual(first.sourceRange, { startFrame: 1_000, endFrame: 5_096 });
	assert.deepEqual(first.transients.map(({ sourceFrame }) => sourceFrame), [1_512, 2_536, 4_072]);
	assert.ok(first.transients.every(({ strength }) => strength > 0 && strength <= 1));
	assert.equal(first.algorithmId, TRANSIENT_ANALYSIS_ALGORITHM.id);
	assert.equal(first.algorithmRevision, TRANSIENT_ANALYSIS_ALGORITHM.revision);
	assert.ok(Object.isFrozen(first));
	assert.ok(Object.isFrozen(first.parameters));
	assert.ok(Object.isFrozen(first.transients));
	assert.ok(first.transients.every(Object.isFrozen));
	assert.deepEqual(channels, before);

	const boundary = new Float32Array(128);
	boundary[0] = 1;
	assert.deepEqual(detectPcmTransients([boundary], {
		sourceStartFrame: 99,
		parameters: PARAMETERS,
	}).transients.map(({ sourceFrame }) => sourceFrame), [99]);
});

test('channel policy is explicit and cancellation cannot erase linked-channel attacks', () => {
	const left = new Float32Array(1_024);
	const right = new Float32Array(1_024);
	left[512] = 1;
	right[512] = -1;
	const linked = detectPcmTransients([left, right], {
		channelPolicy: 'linked-peak', parameters: PARAMETERS,
	});
	const mono = detectPcmTransients([left, right], {
		channelPolicy: 'mono-average', parameters: PARAMETERS,
	});

	assert.deepEqual(linked.transients.map(({ sourceFrame }) => sourceFrame), [512]);
	assert.deepEqual(mono.transients, []);
});

test('analysis parameters and PCM geometry are closed, bounded, and finite', () => {
	assert.deepEqual(normalizeTransientAnalysisParameters(PARAMETERS), PARAMETERS);
	assert.throws(
		() => normalizeTransientAnalysisParameters({ ...PARAMETERS, futureKnob: 1 }),
		/unknown transient analysis parameter/iu,
	);
	for (const parameters of [
		{ ...PARAMETERS, windowFrames: 0 },
		{ ...PARAMETERS, hopFrames: 65 },
		{ ...PARAMETERS, baselineWindowHops: 0 },
		{ ...PARAMETERS, sensitivity: Number.NaN },
		{ ...PARAMETERS, minimumSpacingFrames: -1 },
		{ ...PARAMETERS, floorDbfs: 1 },
	]) {
		assert.throws(() => normalizeTransientAnalysisParameters(parameters));
	}
	assert.throws(
		() => detectPcmTransients([new Float32Array(4), new Float32Array(3)]),
		/equally sized/iu,
	);
	const nonFinite = new Float32Array(4);
	nonFinite[2] = Number.NaN;
	assert.throws(() => detectPcmTransients([nonFinite]), /finite PCM samples/iu);
	assert.throws(
		() => detectPcmTransients([new Float32Array(4)], { channelPolicy: 'left-only' as never }),
		/channel policy/iu,
	);
});

test('derivative identity canonically binds digest, range, channel policy, parameters, and revision', () => {
	const identity = transientAnalysisIdentity({
		sourceSha256: SOURCE_DIGEST,
		sourceRange: { startFrame: 128, endFrame: 2_048 },
		channelPolicy: 'linked-peak',
		parameters: PARAMETERS,
	});
	assert.equal(
		identity.key,
		'transient-analysis-sha256:c4ab2002f4cca6dc5a5994df9ce6dce7dd66d6edb7c4e5c0e69ddf4b24f6d4c0',
	);
	assert.deepEqual(identity, {
		key: identity.key,
		derivativeBindingVersion: TRANSIENT_ANALYSIS_DERIVATIVE_BINDING_VERSION,
		sourceSha256: SOURCE_DIGEST,
		sourceRange: { startFrame: 128, endFrame: 2_048 },
		channelPolicy: 'linked-peak',
		algorithmId: TRANSIENT_ANALYSIS_ALGORITHM.id,
		algorithmRevision: TRANSIENT_ANALYSIS_ALGORITHM.revision,
		parameters: PARAMETERS,
	});
	assert.equal(
		transientAnalysisIdentity({
			sourceSha256: SOURCE_DIGEST,
			sourceRange: { endFrame: 2_048, startFrame: 128 },
			channelPolicy: 'linked-peak',
			parameters: {
				floorDbfs: -60, minimumSpacingFrames: 128, sensitivity: 1.5,
				baselineWindowHops: 4, hopFrames: 32, windowFrames: 64,
			},
		}).key,
		identity.key,
	);

	const variants = [
		identityFor({ sourceSha256: 'b'.repeat(64) }),
		identityFor({ sourceRange: { startFrame: 129, endFrame: 2_048 } }),
		identityFor({ channelPolicy: 'mono-average' }),
		identityFor({ parameters: { ...PARAMETERS, sensitivity: 2 } }),
		identityFor({ algorithm: { id: TRANSIENT_ANALYSIS_ALGORITHM.id, revision: 2 } }),
	];
	assert.ok(variants.every(({ key }) => key !== identity.key));
	assert.throws(
		() => identityFor({ sourceSha256: SOURCE_DIGEST.toUpperCase() }),
		/lowercase SHA-256/iu,
	);
	assert.throws(
		() => identityFor({ sourceRange: { startFrame: 20, endFrame: 10 } }),
		/source range/iu,
	);
});

test('cache records round-trip only when identity and payload integrity are exact', () => {
	const analysis = analysisFixture();
	const identity = identityForAnalysis(analysis);
	const record = createTransientAnalysisCacheRecord(identity, analysis);
	const normalized = normalizeTransientAnalysisCacheRecord(JSON.parse(JSON.stringify(record)));
	const inspected = inspectTransientAnalysisCacheRecord(normalized, identity);

	assert.equal(record.key, identity.key);
	assert.match(record.payloadSha256, /^[a-f0-9]{64}$/u);
	assert.equal(record.size, record.payloadByteLength);
	assert.equal(inspected.status, 'hit');
	assert.equal(inspected.discard, false);
	assert.deepEqual(inspected.analysis, analysis);
	assert.ok(Object.isFrozen(normalized));
	assert.ok(Object.isFrozen(normalized.transients));
	assert.ok(normalized.transients.every(Object.isFrozen));
});

test('valid old identities are stale and explicitly disposable, never cache hits', () => {
	const currentAnalysis = analysisFixture();
	const currentIdentity = identityForAnalysis(currentAnalysis);
	const oldIdentity = identityForAnalysis(currentAnalysis, {
		algorithm: { id: TRANSIENT_ANALYSIS_ALGORITHM.id, revision: 2 },
	});
	const oldAnalysis: TransientAnalysisResult = {
		...currentAnalysis,
		algorithmRevision: 2,
	};
	const oldRecord = createTransientAnalysisCacheRecord(oldIdentity, oldAnalysis);
	const inspected = inspectTransientAnalysisCacheRecord(oldRecord, currentIdentity);

	assert.equal(inspected.status, 'stale');
	assert.equal(inspected.discard, true);
	assert.equal(inspected.analysis, null);
	assert.deepEqual(inspectTransientAnalysisCacheRecord(null, currentIdentity), {
		status: 'miss', discard: false, analysis: null,
	});
});

test('tampered, malformed, and accessor-backed cache records fail closed as corrupt', () => {
	const analysis = analysisFixture();
	const identity = identityForAnalysis(analysis);
	const record = createTransientAnalysisCacheRecord(identity, analysis);
	const payloadTamper = cloneRecord(record);
	payloadTamper.transients[0]!.strength /= 2;
	const bindingTamper = cloneRecord(record);
	bindingTamper.sourceRange.startFrame += 1;
	const duplicateFrame = cloneRecord(record);
	duplicateFrame.transients[1]!.sourceFrame = duplicateFrame.transients[0]!.sourceFrame;

	for (const corrupt of [payloadTamper, bindingTamper, duplicateFrame, { ...record, extra: true }]) {
		assert.deepEqual(inspectTransientAnalysisCacheRecord(corrupt, identity), {
			status: 'corrupt', discard: true, analysis: null,
		});
		assert.throws(() => normalizeTransientAnalysisCacheRecord(corrupt));
	}

	let reads = 0;
	const accessor = Object.defineProperty({ ...record }, 'key', {
		enumerable: true,
		get: () => { reads += 1; return record.key; },
	});
	assert.equal(inspectTransientAnalysisCacheRecord(accessor, identity).status, 'corrupt');
	assert.equal(reads, 0);
});

function transientFixture(): Float32Array[] {
	const left = new Float32Array(4_096);
	const right = new Float32Array(4_096);
	left[512] = 1;
	right[1_536] = 0.8;
	left[3_072] = 0.65;
	return [left, right];
}

function analysisFixture(): TransientAnalysisResult {
	return detectPcmTransients(transientFixture(), {
		sourceStartFrame: 1_000,
		channelPolicy: 'linked-peak',
		parameters: PARAMETERS,
	});
}

function identityFor(
	overrides: Partial<Parameters<typeof transientAnalysisIdentity>[0]> = {},
): Readonly<TransientAnalysisIdentity> {
	return transientAnalysisIdentity({
		sourceSha256: SOURCE_DIGEST,
		sourceRange: { startFrame: 128, endFrame: 2_048 },
		channelPolicy: 'linked-peak',
		parameters: PARAMETERS,
		...overrides,
	});
}

function identityForAnalysis(
	analysis: TransientAnalysisResult,
	overrides: Partial<Parameters<typeof transientAnalysisIdentity>[0]> = {},
): Readonly<TransientAnalysisIdentity> {
	return transientAnalysisIdentity({
		sourceSha256: SOURCE_DIGEST,
		sourceRange: analysis.sourceRange,
		channelPolicy: analysis.channelPolicy,
		parameters: analysis.parameters,
		...overrides,
	});
}

interface MutableCacheRecord {
	transients: Array<{ sourceFrame: number; strength: number }>;
	sourceRange: { startFrame: number; endFrame: number };
	[field: string]: unknown;
}

function cloneRecord(value: unknown): MutableCacheRecord {
	return JSON.parse(JSON.stringify(value)) as MutableCacheRecord;
}
