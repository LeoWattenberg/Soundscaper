/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	bindVideoSourceTimingView,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
	type ExactSourcePosition,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const SOURCE_SHA256 = '8d'.repeat(32);
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

test('binds one immutable CFR authority and evaluates exact NTSC-shaped positions', () => {
	const sourceTarget = cfrSource('cfr-source', 100);
	const viewTarget: VideoSourceTimingView = {
		kind: 'cfr', rate: { ...NTSC }, frameCount: 100,
	};
	const source = trackedRecord(sourceTarget);
	const view = trackedRecord(viewTarget);
	const timingViews = new CountingTimingMap([['cfr-source', view.proxy as VideoSourceTimingView]]);

	const timing = bindVideoSourceTimingView(timingViews, source.proxy);
	const readsAfterBind = source.reads() + view.reads();

	assert.deepEqual(timing, { sourceId: 'cfr-source', frameCount: 100, kind: 'cfr' });
	assert.equal(Object.isFrozen(timing), true);
	assert.deepEqual(videoSourceFrameTime(timing, position(30_000n, 1_001n)), exact(1n));
	assert.deepEqual(videoSourceFrameTime(timing, position(1n, 2n)), exact(1_001n, 60_000n));
	assert.equal(Object.isFrozen(videoSourceFrameTime(timing, position(1n, 2n))), true);

	(viewTarget as { rate: { num: number; den: number }; frameCount: number }).rate.num = 1;
	(viewTarget as { frameCount: number }).frameCount = 1;
	sourceTarget.sourceFrameCount = 1;
	timingViews.clear();
	const rebound = bindVideoSourceTimingView(timingViews, source.proxy);
	assert.strictEqual(rebound, timing, 'the same source/map pair must reuse its authenticated token');
	assert.deepEqual(videoSourceFrameTime(timing, position(30_000n, 1_001n)), exact(1n));
	assert.equal(timingViews.getCalls, 1);
	assert.equal(source.reads() + view.reads(), readsAfterBind);
});

test('interpolates verified VFR positions exactly through the unequal final frame', () => {
	const publication = createVideoTimingAssetPublication(SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n, 105n, 150n],
		finalFrameDurationTicks: 90n,
	});
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const sourceTarget = exactSource('vfr-source', publication.reference);
	const viewTarget = {
		kind: 'vfr' as const,
		reference: publication.reference,
		index,
	};
	const source = trackedRecord(sourceTarget);
	const view = trackedRecord(viewTarget);
	const timingViews = new CountingTimingMap([['vfr-source', view.proxy as VideoSourceTimingView]]);

	const timing = bindVideoSourceTimingView(timingViews, source.proxy);
	const readsAfterBind = source.reads() + view.reads();
	const terminalFirst = videoSourceFrameTime(timing, position(4n));

	assert.deepEqual(timing, { sourceId: 'vfr-source', frameCount: 4, kind: 'vfr' });
	assert.deepEqual(terminalFirst, exact(6n, 25n));
	assert.deepEqual(videoSourceFrameTime(timing, position(0n)), exact(0n));
	assert.deepEqual(videoSourceFrameTime(timing, position(1n)), exact(1n, 25n));
	assert.deepEqual(videoSourceFrameTime(timing, position(3n, 2n)), exact(29n, 400n));
	assert.deepEqual(videoSourceFrameTime(timing, position(7n, 2n)), exact(39n, 200n));
	assert.deepEqual(videoSourceFrameTime(timing, position(4n)), terminalFirst);
	assertDeepFrozen(terminalFirst);
	assert.equal(timingViews.getCalls, 1);
	assert.equal(source.reads() + view.reads(), readsAfterBind);
});

test('authenticates timing tokens before reading public fields and refuses malformed exact work', () => {
	const timing = bindVideoSourceTimingView(
		new Map([['secure-source', cfrView(8)]]),
		cfrSource('secure-source', 8),
	);
	const clone = Object.freeze({ ...timing });
	let forgedReads = 0;
	const forged = Object.freeze(Object.defineProperties({}, {
		sourceId: { enumerable: true, get: () => { forgedReads += 1; return 'secure-source'; } },
		frameCount: { enumerable: true, get: () => { forgedReads += 1; return 8; } },
		kind: { enumerable: true, get: () => { forgedReads += 1; return 'cfr'; } },
	}));

	assert.throws(() => videoSourceFrameTime(clone as BoundVideoSourceTimingView, position(1n)), /bound|timing|token|authentic/iu);
	assert.throws(() => videoSourceFrameTime(forged as BoundVideoSourceTimingView, position(1n)), /bound|timing|token|authentic/iu);
	assert.equal(forgedReads, 0);
	for (const candidate of [
		position(-1n),
		position(9n),
		{ numerator: 1n, denominator: 0n },
		{ numerator: 2n, denominator: 2n },
		{ numerator: 1n, denominator: 1n << 4_096n },
	]) {
		assert.throws(
			() => videoSourceFrameTime(timing, candidate as ExactSourcePosition),
			/bound|canonical|denominator|reduced|4096|complexity|bit/iu,
		);
	}

	let queryReads = 0;
	const accessorQuery = Object.defineProperties({}, {
		numerator: { enumerable: true, get: () => { queryReads += 1; return 1n; } },
		denominator: { enumerable: true, get: () => { queryReads += 1; return 1n; } },
	});
	assert.throws(
		() => videoSourceFrameTime(timing, accessorQuery as ExactSourcePosition),
		/accessor|data property|enumerable|exact|position/iu,
	);
	assert.equal(queryReads, 0);
	const growthTiming = bindVideoSourceTimingView(new Map([[
		'growth-source',
		cfrView(8, { num: 1, den: Number.MAX_SAFE_INTEGER }),
	]]), cfrSource('growth-source', 8, { num: 1, den: Number.MAX_SAFE_INTEGER }));
	const boundedButGrowing = position((1n << 4_095n) - 1n, 1n << 4_095n);
	assert.throws(
		() => videoSourceFrameTime(growthTiming, boundedButGrowing),
		/4096|complexity|bit/iu,
		'a canonical input within 4,096 bits must refuse when exact CFR composition exceeds the ceiling',
	);
	assert.throws(
		() => bindVideoSourceTimingView(new Map([['audio-source', cfrView(8)]]), {
			...cfrSource('audio-source', 8), kind: 'audio',
		}),
		/video|kind/iu,
	);
});

test('captures CFR source identity and view rate once before validation and token construction', () => {
	let sourceIdReads = 0;
	let viewRateReads = 0;
	const sourceTarget = cfrSource('stable-source', 100);
	const viewTarget = { kind: 'cfr' as const, rate: { ...NTSC }, frameCount: 100 };
	const source = new Proxy(sourceTarget, {
		get(target, key, receiver) {
			if (key === 'id') {
				sourceIdReads += 1;
				return sourceIdReads === 1 ? 'stable-source' : 'changed-source';
			}
			return Reflect.get(target, key, receiver);
		},
	});
	const view = new Proxy(viewTarget, {
		get(target, key, receiver) {
			if (key === 'rate') {
				viewRateReads += 1;
				return viewRateReads === 1 ? target.rate : { num: 1, den: 1 };
			}
			return Reflect.get(target, key, receiver);
		},
	});

	const timing = bindVideoSourceTimingView(
		new Map([['stable-source', view as VideoSourceTimingView]]),
		source,
	);

	assert.deepEqual(timing, { sourceId: 'stable-source', frameCount: 100, kind: 'cfr' });
	assert.deepEqual(videoSourceFrameTime(timing, position(30_000n, 1_001n)), exact(1n));
	assert.equal(sourceIdReads, 0, 'binding must not invoke a source identity getter trap');
	assert.equal(viewRateReads, 0, 'binding must not invoke a view-rate getter trap');
});

test('rejects CFR source and view accessors without invoking them', () => {
	let sourceReads = 0;
	const source = cfrSource('accessor-source', 8);
	Object.defineProperty(source, 'id', {
		enumerable: true,
		get() { sourceReads += 1; return 'accessor-source'; },
	});
	assert.throws(
		() => bindVideoSourceTimingView(new Map([['accessor-source', cfrView(8)]]), source),
		/accessor|data property|enumerable|source/iu,
	);
	assert.equal(sourceReads, 0);

	let rateReads = 0;
	const view = Object.defineProperty({ kind: 'cfr', frameCount: 8 }, 'rate', {
		enumerable: true,
		get() { rateReads += 1; return NTSC; },
	});
	assert.throws(
		() => bindVideoSourceTimingView(
			new Map([['accessor-view', view as VideoSourceTimingView]]),
			cfrSource('accessor-view', 8),
		),
		/accessor|data property|enumerable|rate|view/iu,
	);
	assert.equal(rateReads, 0);
});

test('captures verified VFR index and reference once and rejects their accessors unopened', () => {
	const publication = createVideoTimingAssetPublication(SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n, 105n, 150n],
		finalFrameDurationTicks: 90n,
	});
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	let indexReads = 0;
	let referenceReads = 0;
	const viewTarget = { kind: 'vfr' as const, reference: publication.reference, index };
	const changingView = new Proxy(viewTarget, {
		get(target, key, receiver) {
			if (key === 'index') {
				indexReads += 1;
				return indexReads === 1 ? target.index : Object.freeze({});
			}
			if (key === 'reference') {
				referenceReads += 1;
				return referenceReads === 1 ? target.reference : Object.freeze({});
			}
			return Reflect.get(target, key, receiver);
		},
	});
	const timing = bindVideoSourceTimingView(
		new Map([['vfr-stable', changingView as VideoSourceTimingView]]),
		exactSource('vfr-stable', publication.reference),
	);

	assert.deepEqual(videoSourceFrameTime(timing, position(7n, 2n)), exact(39n, 200n));
	assert.equal(indexReads, 0);
	assert.equal(referenceReads, 0);

	for (const field of ['index', 'reference'] as const) {
		let accessorReads = 0;
		const accessorView: Record<string, unknown> = {
			kind: 'vfr', reference: publication.reference, index,
		};
		Object.defineProperty(accessorView, field, {
			enumerable: true,
			get() { accessorReads += 1; return field === 'index' ? index : publication.reference; },
		});
		assert.throws(
			() => bindVideoSourceTimingView(
				new Map([['vfr-accessor', accessorView as VideoSourceTimingView]]),
				exactSource('vfr-accessor', publication.reference),
			),
			/accessor|data property|enumerable|index|reference|view/iu,
		);
		assert.equal(accessorReads, 0, `${field} accessor must not be invoked`);
	}
});

function cfrSource(
	id: string,
	sourceFrameCount: number,
	rate: Readonly<{ num: number; den: number }> = NTSC,
): Record<string, unknown> {
	return {
		id,
		kind: 'video',
		contentSha256: SOURCE_SHA256,
		frameRate: { ...rate },
		sourceFrameCount,
		timingAsset: null,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { ...rate } },
	};
}

function exactSource(
	id: string,
	timingAsset: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	return {
		id,
		kind: 'video',
		contentSha256: SOURCE_SHA256,
		frameRate: { ...NTSC },
		sourceFrameCount: 4,
		timingAsset,
		timingDecision: { mode: 'exact', rate: { ...NTSC }, backend: 'demuxer' },
	};
}

function cfrView(
	frameCount: number,
	rate: Readonly<{ num: number; den: number }> = NTSC,
): VideoSourceTimingView {
	return Object.freeze({ kind: 'cfr', rate, frameCount });
}

function position(numerator: bigint, denominator = 1n): ExactSourcePosition {
	return Object.freeze({ numerator, denominator });
}

function exact(numerator: bigint, denominator = 1n) {
	return Object.freeze({ numerator, denominator });
}

class CountingTimingMap extends Map<string, VideoSourceTimingView> {
	getCalls = 0;

	override get(key: string): VideoSourceTimingView | undefined {
		this.getCalls += 1;
		return super.get(key);
	}
}

function trackedRecord<Value extends object>(target: Value) {
	let reads = 0;
	return {
		proxy: new Proxy(target, {
			get(value, key, receiver) {
				reads += 1;
				return Reflect.get(value, key, receiver);
			},
			getOwnPropertyDescriptor(value, key) {
				reads += 1;
				return Reflect.getOwnPropertyDescriptor(value, key);
			},
		}),
		reads: () => reads,
	};
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
