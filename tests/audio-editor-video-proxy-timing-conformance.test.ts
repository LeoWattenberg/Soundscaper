/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	VIDEO_PROXY_TIMING_MAXIMUM_FRAMES,
	proveVideoProxyTimingConformance,
	videoProxyTimingConformanceInfo,
	type VideoProxyTimingConformance,
} from '../src/common/editor/video-proxy-timing-conformance.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
	type VideoTimingAssetReference,
} from '../src/common/editor/video-timing-asset.ts';

const NTSC = Object.freeze({ num: 30_000, den: 1_001 });
const ORIGINAL_SHA256 = '8d'.repeat(32);
const PROXY_SHA256 = '4c'.repeat(32);
const CONFORMANCE_SOURCE_URL = new URL(
	'../src/common/editor/video-proxy-timing-conformance.ts',
	import.meta.url,
);

test('proves exact CFR boundary conformance and returns only authenticated frozen evidence', () => {
	const original = cfrTiming('original', 120, { num: 24, den: 1 });
	const proxy = cfrTiming('proxy', 120, { num: 48, den: 2 });

	const proof = proveVideoProxyTimingConformance(original, proxy);
	const info = videoProxyTimingConformanceInfo(proof);

	assert.deepEqual(info, {
		kind: 'video-proxy-timing-conformance',
		version: 1,
		rule: 'exact-presentation-boundaries-v1',
		originalSourceId: 'original',
		proxySourceId: 'proxy',
		frameCount: 120,
		boundaryCount: 121,
	});
	assertDeepFrozen(proof);
	assertDeepFrozen(info);
	const serializedProof: unknown = JSON.parse(JSON.stringify(proof));
	for (const candidate of [
		{ ...info },
		structuredClone(proof),
		serializedProof,
		null,
		'not-a-proof',
	]) {
		assert.throws(
			() => videoProxyTimingConformanceInfo(candidate as VideoProxyTimingConformance),
			/authentic|proof|conformance|token/iu,
			'cloned, serialized, and wrong-type values must not become authenticated evidence',
		);
	}
});

test('distinguishes exact NTSC from the nearby decimal rate without an epsilon', () => {
	const original = cfrTiming('ntsc-original', 300, NTSC);
	const decimalProxy = cfrTiming('decimal-proxy', 300, { num: 2_997, den: 100 });

	assert.throws(
		() => proveVideoProxyTimingConformance(original, decimalProxy),
		/exact|boundary|timing|conform/iu,
	);
});

test('accepts equal CFR and verified VFR boundaries despite representation and nominal-rate differences', () => {
	const original = cfrTiming('cfr-original', 4, NTSC);
	const proxy = vfrTiming({
		id: 'vfr-proxy',
		digest: PROXY_SHA256,
		nominalRate: { num: 24, den: 1 },
		timescale: 30_000,
		presentationTicks: [0n, 1_001n, 2_002n, 3_003n],
		finalFrameDurationTicks: 1_001n,
	});

	const info = videoProxyTimingConformanceInfo(
		proveVideoProxyTimingConformance(original, proxy),
	);
	assert.equal(info.frameCount, 4);
	assert.equal(info.boundaryCount, 5);
});

test('accepts verified VFR indexes with exactly rescaled timescales', () => {
	const original = vfrTiming({
		id: 'vfr-original',
		digest: ORIGINAL_SHA256,
		timescale: 1_000,
		presentationTicks: [0n, 40n, 105n, 150n],
		finalFrameDurationTicks: 90n,
	});
	const proxy = vfrTiming({
		id: 'vfr-proxy',
		digest: PROXY_SHA256,
		timescale: 2_000,
		presentationTicks: [0n, 80n, 210n, 300n],
		finalFrameDurationTicks: 180n,
	});

	assert.equal(
		videoProxyTimingConformanceInfo(
			proveVideoProxyTimingConformance(original, proxy),
		).rule,
		'exact-presentation-boundaries-v1',
	);
});

test('rejects any unequal interior boundary even when frame count and terminal duration agree', () => {
	const frameCount = 257;
	const originalTicks = uniformTicks(frameCount, 1_001n);
	const changedTicks = [...originalTicks];
	changedTicks[173] = changedTicks[173]! + 1n;
	const original = vfrTiming({
		id: 'complete-original',
		digest: ORIGINAL_SHA256,
		timescale: 30_000,
		presentationTicks: originalTicks,
		finalFrameDurationTicks: 1_001n,
	});
	const proxy = vfrTiming({
		id: 'sampled-proxy',
		digest: PROXY_SHA256,
		timescale: 30_000,
		presentationTicks: changedTicks,
		finalFrameDurationTicks: 1_001n,
	});

	assert.throws(
		() => proveVideoProxyTimingConformance(original, proxy),
		/exact|boundary|timing|conform/iu,
		'conformance must inspect every presentation boundary rather than samples',
	);
});

test('rejects frame-count and final-frame-duration differences independently', () => {
	const original = vfrTiming({
		id: 'shape-original',
		digest: ORIGINAL_SHA256,
		timescale: 1_000,
		presentationTicks: [0n, 40n, 80n],
		finalFrameDurationTicks: 40n,
	});
	const longerProxy = vfrTiming({
		id: 'longer-proxy',
		digest: PROXY_SHA256,
		timescale: 1_000,
		presentationTicks: [0n, 40n, 80n, 120n],
		finalFrameDurationTicks: 40n,
	});
	const terminalDriftProxy = vfrTiming({
		id: 'terminal-proxy',
		digest: PROXY_SHA256,
		timescale: 1_000,
		presentationTicks: [0n, 40n, 80n],
		finalFrameDurationTicks: 41n,
	});

	assert.throws(
		() => proveVideoProxyTimingConformance(original, longerProxy),
		/frame count|frameCount|boundary|timing|conform/iu,
	);
	assert.throws(
		() => proveVideoProxyTimingConformance(original, terminalDriftProxy),
		/final|terminal|boundary|timing|conform/iu,
	);
});

test('authenticates both bound timing inputs before reading their public fields', () => {
	const original = cfrTiming('secure-original', 8, NTSC);
	const clone = Object.freeze({ ...original }) as BoundVideoSourceTimingView;
	const structuredCloneToken = structuredClone(original) as BoundVideoSourceTimingView;
	const serializedToken: unknown = JSON.parse(JSON.stringify(original));
	let forgedReads = 0;
	const forged = Object.freeze(Object.defineProperties({}, {
		sourceId: { enumerable: true, get: () => { forgedReads += 1; return 'forged-proxy'; } },
		frameCount: { enumerable: true, get: () => { forgedReads += 1; return 8; } },
		kind: { enumerable: true, get: () => { forgedReads += 1; return 'cfr'; } },
	})) as BoundVideoSourceTimingView;

	for (const candidate of [clone, structuredCloneToken, serializedToken, null, 42]) {
		assert.throws(
			() => proveVideoProxyTimingConformance(
				candidate as BoundVideoSourceTimingView,
				original,
			),
			/authentic|bound|timing|token/iu,
		);
	}
	assert.throws(
		() => proveVideoProxyTimingConformance(original, forged),
		/authentic|bound|timing|token/iu,
	);
	assert.equal(forgedReads, 0);
});

test('returns fresh proof identities and requires distinct original and proxy source identities', () => {
	const freshOriginal = cfrTiming('fresh-original', 8, NTSC);
	const freshProxy = cfrTiming('fresh-proxy', 8, NTSC);
	const first = proveVideoProxyTimingConformance(freshOriginal, freshProxy);
	const second = proveVideoProxyTimingConformance(freshOriginal, freshProxy);
	const firstInfo = videoProxyTimingConformanceInfo(first);
	const secondInfo = videoProxyTimingConformanceInfo(second);

	assert.notStrictEqual(first, second);
	assert.notStrictEqual(firstInfo, secondInfo);
	assert.deepEqual(firstInfo, secondInfo);

	const original = cfrTiming('same-source', 8, NTSC);
	const secondToken = cfrTiming('same-source', 8, NTSC);

	assert.throws(
		() => proveVideoProxyTimingConformance(original, original),
		/source|identity|distinct|proxy|original/iu,
	);
	assert.throws(
		() => proveVideoProxyTimingConformance(original, secondToken),
		/source|identity|distinct|proxy|original/iu,
	);
});

test('keeps CFR proof O(1) and non-CFR proof one short-circuiting N+1 boundary loop', async () => {
	const source = await readFile(CONFORMANCE_SOURCE_URL, 'utf8');

	assert.match(
		source,
		/if \(originalInfo\.kind === 'cfr' && proxyInfo\.kind === 'cfr'\) \{\s*assertSameExactBoundary\(original, proxy, 1\);\s*\} else \{\s*for \(let boundary = 0; boundary <= frameCount; boundary \+= 1\) \{\s*assertSameExactBoundary\(original, proxy, boundary\);\s*\}\s*\}/u,
		'CFR must compare one duration while any VFR path compares exactly ordinal boundaries 0 through N',
	);
	assert.match(
		source,
		/originalTime\.numerator !== proxyTime\.numerator\s*\|\|\s*originalTime\.denominator !== proxyTime\.denominator/u,
		'already reduced exact times must compare directly without a new cross-product',
	);
	assert.match(
		source,
		/function assertSameExactBoundary\([\s\S]*?boundary:\s*number[\s\S]*?\): void \{\s*const position = Object\.freeze\(\{ numerator: BigInt\(boundary\), denominator: 1n \}\);\s*const originalTime = videoSourceFrameTime\(original, position\);\s*const proxyTime = videoSourceFrameTime\(proxy, position\);/u,
		'the loop ordinal must flow directly into the existing exact boundary authority for both views',
	);
	assert.equal(
		[...source.matchAll(/\bvideoSourceFrameTime\s*\(/gu)].length,
		2,
		'the shared scalar comparator must own the only exact-boundary calls',
	);
	assert.doesNotMatch(
		source,
		/Array\.from\s*\(|new\s+Array\s*\(|\[\s*\.\.\.|\.(?:map|flatMap|filter|reduce|forEach|push)\s*\(/u,
		'conformance must not materialize or retain a boundary collection',
	);
	assert.doesNotMatch(source, /test(?:ing)?(?:Counter|Hook)|boundaryCallCount/iu);
});

test('shares the timing-asset frame ceiling and refuses oversized CFR work before iteration', () => {
	assert.equal(VIDEO_PROXY_TIMING_MAXIMUM_FRAMES, VIDEO_TIMING_ASSET_MAXIMUM_FRAMES);
	const oversizedOriginal = cfrTiming(
		'oversized-original',
		VIDEO_PROXY_TIMING_MAXIMUM_FRAMES + 1,
		{ num: 24, den: 1 },
	);
	const oversizedProxy = cfrTiming(
		'oversized-proxy',
		VIDEO_PROXY_TIMING_MAXIMUM_FRAMES + 1,
		{ num: 24, den: 1 },
	);

	assert.throws(
		() => proveVideoProxyTimingConformance(oversizedOriginal, oversizedProxy),
		/maximum|limit|frame|bound/iu,
	);
});

function cfrTiming(
	id: string,
	frameCount: number,
	rate: Readonly<{ num: number; den: number }>,
): BoundVideoSourceTimingView {
	const source = {
		id,
		kind: 'video',
		contentSha256: id === 'original' ? ORIGINAL_SHA256 : PROXY_SHA256,
		frameRate: { ...rate },
		sourceFrameCount: frameCount,
		timingAsset: null,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { ...rate } },
	};
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'cfr',
		rate: Object.freeze({ ...rate }),
		frameCount,
	});
	return bindVideoSourceTimingView(new Map([[id, view]]), source);
}

function vfrTiming(options: Readonly<{
	id: string;
	digest: string;
	timescale: number;
	presentationTicks: readonly bigint[];
	finalFrameDurationTicks: bigint;
	nominalRate?: Readonly<{ num: number; den: number }>;
}>): BoundVideoSourceTimingView {
	const publication = createVideoTimingAssetPublication(options.digest, {
		timescale: options.timescale,
		presentationTicks: options.presentationTicks,
		finalFrameDurationTicks: options.finalFrameDurationTicks,
	});
	const reference = publication.reference as Readonly<VideoTimingAssetReference>;
	const index = validateVideoTimingAssetBytes(reference, publication.bytes);
	const rate = options.nominalRate ?? NTSC;
	const source = {
		id: options.id,
		kind: 'video',
		contentSha256: options.digest,
		frameRate: { ...rate },
		sourceFrameCount: options.presentationTicks.length,
		timingAsset: reference,
		timingDecision: { mode: 'exact', rate: { ...rate }, backend: 'fixture-demuxer' },
	};
	const view: VideoSourceTimingView = Object.freeze({ kind: 'vfr', reference, index });
	return bindVideoSourceTimingView(new Map([[options.id, view]]), source);
}

function uniformTicks(frameCount: number, step: bigint): readonly bigint[] {
	return Object.freeze(Array.from({ length: frameCount }, (_value, index) => BigInt(index) * step));
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
