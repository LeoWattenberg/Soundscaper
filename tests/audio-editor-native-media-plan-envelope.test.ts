/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
	NativeMediaPlanViolationError,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	assertNativeMediaPlanEnvelopeV1,
	createNativeMediaPlanEnvelopeV1,
	divergentNativeMediaPlanEnvelopeFields,
	divergentNativeMediaPlanSummaryFields,
	NATIVE_MEDIA_PLAN_ACCEPTED_VERSIONS,
	NATIVE_MEDIA_PLAN_ENVELOPE_VERSION,
} from '../src/common/editor/native-media-plan-envelope.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import {
	CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
	VIDEO_KEYFRAME_EXPORT_PLAN_VERSION,
} from '../src/common/editor/video-export-plan-version.ts';
import {
	createVideoKeyframeExportPlanV7,
} from '../src/common/editor/video-keyframe-export-plan-v7.ts';

test('the accepted plan union is exactly the canonical graph and keyed V7 plans', () => {
	assert.deepEqual(
		[...NATIVE_MEDIA_PLAN_ACCEPTED_VERSIONS].sort((left, right) => left - right),
		[VIDEO_KEYFRAME_EXPORT_PLAN_VERSION, CANONICAL_VIDEO_EXPORT_PLAN_VERSION]
			.sort((left, right) => left - right),
		'the native tier admits what the product builds, not the versions it once built',
	);
	assert.equal(NATIVE_MEDIA_PLAN_ENVELOPE_VERSION, 1);
});

test('a static graph plan seals into an envelope whose summary is its own semantics', () => {
	const plan = staticPlan();
	const envelope = createNativeMediaPlanEnvelopeV1(plan);

	assert.equal(envelope.envelopeVersion, 1);
	assert.equal(envelope.planVersion, CANONICAL_VIDEO_EXPORT_PLAN_VERSION);
	assert.equal(envelope.strategy, 'framescaper-static-composition');
	assert.match(envelope.fingerprint, /^[a-f0-9]{64}$/u);
	assert.equal(envelope.canonicalByteLength, fingerprintNativeMediaPlan(plan).byteLength);
	assert.deepEqual(envelope.summary.frameRate, { kind: 'decimal', value: 30 });
	assert.deepEqual(envelope.summary.duration, { kind: 'decimal-seconds', seconds: 1 });
	assert.equal(envelope.summary.container, 'mp4');
	assert.equal(envelope.summary.videoEncoder, 'libx264');
	assert.equal(envelope.summary.includesAudio, false);
	assert.equal(envelope.summary.audioCodec, null);
	assert.equal(envelope.summary.projectSampleRate, null);
	assert.equal(envelope.summary.startFrame, 0);
	assert.equal(envelope.summary.durationFrames, 1_000);
	assert.equal(envelope.summary.outputFrameCount, 30);
	assert.equal(envelope.summary.compositionIntervalCount, 1);
	assert.equal(envelope.summary.videoEffectCount, 0);
	assert.equal(envelope.summary.activeClipCount, null);
	assert.deepEqual(envelope.summary.videoSourceInputs, [{
		inputIndex: 0, sourceId: 'source-1', mimeType: 'video/mp4', contentSha256: null,
	}]);
});

test('a static graph plan that includes audio reports its exact staged project sample rate', () => {
	const envelope = createNativeMediaPlanEnvelopeV1(staticPlan({ includeAudio: true }));

	assert.equal(envelope.summary.includesAudio, true);
	assert.equal(envelope.summary.audioCodec, 'aac');
	assert.equal(envelope.summary.audioEncoder, 'aac');
	assert.equal(envelope.summary.projectSampleRate, 1_000);
});

test('a keyed V7 plan reports its exact rational rate and duration rather than a decimal', () => {
	const envelope = createNativeMediaPlanEnvelopeV1(keyedPlan());

	assert.equal(envelope.planVersion, VIDEO_KEYFRAME_EXPORT_PLAN_VERSION);
	assert.equal(envelope.strategy, 'framescaper-keyframed-rgba-v1');
	assert.deepEqual(envelope.summary.frameRate, { kind: 'rational', num: 30_000, den: 1_001 });
	assert.deepEqual(envelope.summary.duration, { kind: 'rational-seconds', num: 1_001, den: 1_000 });
	assert.equal(envelope.summary.projectSampleRate, 48_000);
	assert.equal(envelope.summary.activeClipCount, 2);
	assert.equal(envelope.summary.compositionIntervalCount, null);
	assert.equal(envelope.summary.videoEffectCount, null);
	assert.deepEqual(envelope.summary.videoSourceInputs.map((input) => input.contentSha256), [
		'12'.repeat(32), '34'.repeat(32),
	]);
});

test('two consumers of the same plan derive the same fingerprint and summary', () => {
	for (const plan of [staticPlan(), keyedPlan()]) {
		const web = createNativeMediaPlanEnvelopeV1(plan);
		// The detached consumer never shares an in-process object identity.
		const native = createNativeMediaPlanEnvelopeV1(JSON.parse(JSON.stringify(plan)));

		assert.deepEqual(divergentNativeMediaPlanEnvelopeFields(web, native), []);
		assert.equal(web.fingerprint, native.fingerprint);
		assert.doesNotThrow(() => assertNativeMediaPlanEnvelopeV1(native));
	}
});

test('the canonical form preserves field order and rejects non-canonical values', () => {
	const forward = canonicalizeNativeMediaPlan({ a: 1, b: [2, { c: 3, a: 4 }] });
	const reordered = canonicalizeNativeMediaPlan({ b: [2, { a: 4, c: 3 }], a: 1 });

	assert.equal(forward, '{"a":1,"b":[2,{"c":3,"a":4}]}');
	// A shuffled document is a different document, not a formatting variant:
	// each canonical plan version defines its own exact field order.
	assert.notEqual(forward, reordered);
	assert.equal(canonicalizeNativeMediaPlan({ zero: -0 }), '{"zero":0}');

	const hidden = { visible: 1 };
	Object.defineProperty(hidden, 'shadow', { enumerable: false, value: 2 });
	assert.throws(() => canonicalizeNativeMediaPlan(hidden), /enumerable own properties/u);

	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	for (const [value, pattern] of [
		[{ rate: Number.NaN }, /finite numbers/u],
		[{ rate: Number.POSITIVE_INFINITY }, /finite numbers/u],
		[{ missing: undefined }, /undefined values/u],
		[{ big: 1n }, /canonical JSON values/u],
		[{ when: new Date(0) }, /plain records/u],
		[{ bytes: new Uint8Array(1) }, /plain records/u],
		[cyclic, /circular references/u],
	] as const) {
		assert.throws(() => canonicalizeNativeMediaPlan(value), pattern);
	}

	const sparse = { holes: [1, , 3] as unknown[] };
	assert.throws(() => canonicalizeNativeMediaPlan(sparse), /sparse arrays/u);
});

test('a plan fingerprint is the SHA-256 of exactly its canonical bytes', () => {
	const plan = staticPlan();
	const fingerprint = fingerprintNativeMediaPlan(plan);

	assert.equal(fingerprint.canonical, canonicalizeNativeMediaPlan(plan));
	assert.equal(
		fingerprint.sha256,
		bytesToHex(sha256(new TextEncoder().encode(fingerprint.canonical))),
	);
});

test('the canonical form never invokes a hostile accessor and refuses symbol keys', () => {
	let reads = 0;
	const hostile = {};
	Object.defineProperty(hostile, 'version', {
		enumerable: true,
		get: () => { reads += 1; return CANONICAL_VIDEO_EXPORT_PLAN_VERSION; },
	});

	assert.throws(() => canonicalizeNativeMediaPlan(hostile), /own data properties/u);
	assert.throws(() => createNativeMediaPlanEnvelopeV1(hostile), /canonical plan versions/u);
	assert.equal(reads, 0);

	const symbolled: Record<string, unknown> = { version: CANONICAL_VIDEO_EXPORT_PLAN_VERSION };
	(symbolled as Record<symbol, unknown>)[Symbol('trap')] = 1;
	assert.throws(() => canonicalizeNativeMediaPlan(symbolled), /symbol-keyed/u);
});

test('an unknown plan version is refused rather than generically accepted', () => {
	for (const version of [null, undefined, 0, 5, 6, 9, 20, '7', 6.5]) {
		const plan = { ...staticPlan(), version } as Record<string, unknown>;
		assert.throws(() => createNativeMediaPlanEnvelopeV1(plan), (error: unknown) => {
			assert.ok(error instanceof NativeMediaPlanViolationError);
			assert.equal(error.code, 'unsupported-version');
			return true;
		});
	}
});

test('a plan whose canonical shape is not the exact graph contract is refused before I/O', () => {
	for (const [mutate, pattern] of [
		[(plan: Record<string, unknown>) => { plan.container = 'webm'; }, /format metadata/u],
		[(plan: Record<string, unknown>) => { plan.mimeType = 'video/webm'; }, /format metadata/u],
		[(plan: Record<string, unknown>) => { plan.outputFrameCount = 0; }, /outputFrameCount/u],
		[(plan: Record<string, unknown>) => { plan.durationSeconds = 0; }, /durationSeconds/u],
		[(plan: Record<string, unknown>) => { plan.extra = 1; }, /exactly its schema keys/u],
		[(plan: Record<string, unknown>) => { delete plan.filterPlan; }, /exactly its schema keys/u],
		[(plan: Record<string, unknown>) => {
			(plan.range as Record<string, unknown>).endFrame = 999;
		}, /exact frame span/u],
		[(plan: Record<string, unknown>) => {
			(plan.canvas as Record<string, unknown>).width = 4_000;
		}, /declared maximum/u],
		[(plan: Record<string, unknown>) => {
			(plan.canvas as Record<string, unknown>).fit = 'fill';
		}, /unsupported fit/u],
		[(plan: Record<string, unknown>) => {
			delete (plan.canvas as Record<string, unknown>).fit;
		}, /exactly its schema keys/u],
		[(plan: Record<string, unknown>) => {
			(plan.filterPlan as Record<string, unknown>).strategy = 'node-graph';
		}, /layered-composition/u],
		[(plan: Record<string, unknown>) => {
			(plan.intervals as Record<string, unknown>[])[0]!.durationFrames = 400;
		}, /exact frame span/u],
	] as const) {
		const plan = JSON.parse(JSON.stringify(staticPlan())) as Record<string, unknown>;
		mutate(plan);
		assert.throws(() => createNativeMediaPlanEnvelopeV1(plan), pattern);
	}
});

test('intervals that do not actually tile their export range are refused', () => {
	for (const intervals of [
		// Overlapping frames 400-500, paid for by a gap of the same length.
		[interval(0, 500), interval(400, 900)],
		[interval(0, 400), interval(400, 600), interval(500, 1_000)],
		// A hole in the middle, again with a compensating overlap.
		[interval(0, 600), interval(500, 700), interval(800, 1_000)],
		// Later frames first: an out-of-order tiling maps the range backwards.
		[interval(500, 1_000), interval(0, 500)],
		// Nothing at all covers a range that must cover at least one frame.
		[],
	]) {
		const plan = JSON.parse(JSON.stringify(staticPlan())) as Record<string, unknown>;
		const template = (plan.intervals as Record<string, unknown>[])[0]!;
		plan.intervals = intervals.map((entry, index) => ({
			...template,
			index,
			timelineStartFrame: entry.startFrame,
			timelineEndFrame: entry.endFrame,
			outputStartFrame: entry.startFrame,
			durationFrames: entry.endFrame - entry.startFrame,
		}));
		assert.throws(() => createNativeMediaPlanEnvelopeV1(plan), /do not tile their own export range/u);
	}
});

test('intervals that tile their export range exactly are admitted', () => {
	const plan = JSON.parse(JSON.stringify(staticPlan())) as Record<string, unknown>;
	const template = (plan.intervals as Record<string, unknown>[])[0]!;
	plan.intervals = [interval(0, 400), interval(400, 1_000)].map((entry, index) => ({
		...template,
		index,
		timelineStartFrame: entry.startFrame,
		timelineEndFrame: entry.endFrame,
		outputStartFrame: entry.startFrame,
		durationFrames: entry.endFrame - entry.startFrame,
	}));

	assert.equal(createNativeMediaPlanEnvelopeV1(plan).summary.compositionIntervalCount, 2);
});

test('a gapped timeline the renderer really produces still tiles its export range', () => {
	const project = singleClipProject();
	project.clips[0]!.durationFrames = 300;
	project.clips[0]!.sourceDurationFrames = 300;
	project.clips.push({ ...project.clips[0]!, id: 'clip-2', timelineStartFrame: 600 });
	project.tracks[0]!.clipIds = ['clip-1', 'clip-2'];
	const plan = createVideoExportPlan(project, {
		includeAudio: false,
		range: { startFrame: 0, endFrame: 1_000 },
	}) as Record<string, unknown>;

	assert.equal((plan.intervals as unknown[]).length, 4);
	assert.equal(createNativeMediaPlanEnvelopeV1(plan).summary.compositionIntervalCount, 4);
});

test('a summary whose fields are serialized in another order still describes its plan', () => {
	const envelope = createNativeMediaPlanEnvelopeV1(staticPlan());
	const reordered = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
	reordered.summary = reverseKeys(envelope.summary as unknown as Record<string, unknown>);

	assert.deepEqual(
		divergentNativeMediaPlanSummaryFields(reordered.summary, envelope.summary),
		[],
	);
	assert.doesNotThrow(() => assertNativeMediaPlanEnvelopeV1(reordered));
});

test('an envelope that misdescribes its own plan is refused', () => {
	const envelope = createNativeMediaPlanEnvelopeV1(staticPlan());
	const detached = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
	assert.doesNotThrow(() => assertNativeMediaPlanEnvelopeV1(detached));

	for (const mutate of [
		(value: Record<string, unknown>) => { value.fingerprint = '0'.repeat(64); },
		(value: Record<string, unknown>) => { value.planVersion = VIDEO_KEYFRAME_EXPORT_PLAN_VERSION; },
		(value: Record<string, unknown>) => { value.strategy = 'framescaper-keyframed-rgba-v1'; },
		(value: Record<string, unknown>) => { value.canonicalByteLength = Number(value.canonicalByteLength) + 1; },
		(value: Record<string, unknown>) => {
			(value.summary as Record<string, unknown>).outputFrameCount = 31;
		},
		(value: Record<string, unknown>) => {
			(value.summary as Record<string, unknown>).videoEffectCount = 4;
		},
	]) {
		const tampered = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
		mutate(tampered);
		assert.throws(
			() => assertNativeMediaPlanEnvelopeV1(tampered),
			/does not describe its own plan/u,
		);
	}

	const wrongVersion = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
	wrongVersion.envelopeVersion = 2;
	assert.throws(() => assertNativeMediaPlanEnvelopeV1(wrongVersion), /envelope version is unsupported/u);

	const extraKey = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
	extraKey.note = 'x';
	assert.throws(() => assertNativeMediaPlanEnvelopeV1(extraKey), /exactly its schema keys/u);
});

test('summary divergence is reported field by field for the parity gate', () => {
	const web = createNativeMediaPlanEnvelopeV1(staticPlan());
	const divergent = {
		...web.summary,
		outputFrameCount: 31,
		frameRate: { kind: 'decimal', value: 29.97 },
	};

	assert.deepEqual(
		divergentNativeMediaPlanSummaryFields(divergent, web.summary),
		['frameRate', 'outputFrameCount'],
	);
	assert.deepEqual(divergentNativeMediaPlanSummaryFields(null, web.summary), ['summary']);
	assert.deepEqual(
		divergentNativeMediaPlanSummaryFields({ ...web.summary, extra: 1 }, web.summary),
		['extra'],
	);
});

function interval(startFrame: number, endFrame: number) {
	return { startFrame, endFrame };
}

/** How a foreign producer that shares no field order would emit the same value. */
function reverseKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(reverseKeys);
	if (value === null || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value)
		.reverse()
		.map(([key, nested]) => [key, reverseKeys(nested)]));
}

function staticPlan(options: Readonly<{ includeAudio?: boolean }> = {}): Record<string, unknown> {
	return createVideoExportPlan(singleClipProject(), {
		includeAudio: options.includeAudio === true,
		range: { startFrame: 0, endFrame: 1_000 },
	}) as Record<string, unknown>;
}

function keyedPlan(): Record<string, unknown> {
	const durationFrames = 48_048;
	return createVideoKeyframeExportPlanV7({
		format: 'mp4',
		sampleRate: 48_000,
		range: { startFrame: 96_000, endFrame: 96_000 + durationFrames, durationFrames },
		canvas: {
			width: 1_280,
			height: 720,
			frameRate: { num: 30_000, den: 1_001 },
			fit: 'contain',
			pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
			referenceClipId: 'clip-a',
			referenceSourceId: 'source-a',
		},
		activeClipIds: ['clip-a', 'clip-b'],
		activeSourceIds: ['source-a', 'source-b'],
		sources: [keyedSource('source-a', '12'), keyedSource('source-b', '34')],
		includeAudio: true,
		audioFileName: 'audio-mix.wav',
	}) as unknown as Record<string, unknown>;
}

function keyedSource(id: string, digestByte: string): Record<string, unknown> {
	return {
		kind: 'video', id, storageKey: `storage-${id}`, mimeType: 'video/mp4',
		contentSha256: digestByte.repeat(32),
	};
}

function singleClipProject() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video',
			id: 'source-1',
			name: 'Source',
			mimeType: 'video/mp4',
			storageKey: 'media/source-1',
			frameCount: 10_000,
			sampleRate: 1_000,
			width: 1_280,
			height: 720,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: 'aac',
			hasAudio: false,
			posterStorageKey: null,
			thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video',
			id: 'clip-1',
			sourceId: 'source-1',
			title: 'Clip',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 10_000,
			durationFrames: 10_000,
			trimStartFrames: 0,
			trimEndFrames: 0,
			speedRatio: 1,
			groupId: null,
			avLinkId: null,
			binItemId: null,
			color: 'blue',
		}],
		tracks: [{
			type: 'video',
			id: 'track-1',
			name: 'Video',
			clipIds: ['clip-1'],
			mute: false,
			hidden: false,
			collapsed: false,
			height: 120,
			laneGroupId: null,
		}],
	};
}
