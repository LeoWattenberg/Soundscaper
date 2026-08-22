/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_FEATURE_CAPABILITY_IDS,
	PROJECT_FEATURE_VIDEO_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';
import {
	VIDEO_TRANSITION_ALLOCATION_FIELD_V1,
	VIDEO_TRANSITION_LIMITS_V1,
	assertVideoTransitionProjectLimitV1,
	normalizeVideoTransitionAllocationsV1,
	normalizeVideoTransitionCollectionV1,
	normalizeVideoTransitionV1,
	validateVideoTransitionCollectionV1,
	validateVideoTransitionV1,
	type VideoTransitionV1,
} from '../src/common/editor/video-transition-v1.ts';
import {
	createDefaultDissolveVideoTransitionV1,
	videoTransitionFeatureRequirementsV1,
	videoTransitionTypeFeatureIdV1,
	VIDEO_TRANSITION_TYPE_REGISTRY_V1,
	VIDEO_TRANSITIONS_PROJECT_REQUIREMENT_V1,
} from '../src/common/editor/video-transition-registry.ts';
import {
	normalizeCanonicalTransitionClipEdgesV1,
	resolveVideoTransitionV1,
	validateCanonicalTransitionClipEdgesV1,
	videoTransitionGeometryV1,
} from '../src/common/editor/video-transition-resolution.ts';

const STARTS = new Map([
	['transition-a', 12],
	['transition-b', 8],
	['transition-c', 12],
]);

function transition(
	id = 'transition-a',
	outgoingClipId = 'clip-a',
	incomingClipId = 'clip-b',
	durationFrames = 8,
): VideoTransitionV1 {
	return {
		schemaVersion: 1,
		id,
		type: 'dissolve',
		outgoingClipId,
		incomingClipId,
		alignment: 'center-on-cut',
		durationFrames,
		curve: {
			anchors: [
				{ position: { num: 0, den: 1 }, value: 0 },
				{ position: { num: durationFrames, den: 1 }, value: 1 },
			],
			segments: [{ kind: 'linear' }],
		},
	};
}

function edge(
	clipId: string,
	sourceId: string,
	sequenceStartFrame: number,
	sequenceFrameCount: number,
): Record<string, unknown> {
	return {
		clipId,
		sourceId,
		sequenceStartFrame,
		sequenceFrameCount,
		sequenceRate: { num: 24, den: 1 },
		sourceInFrame: 0,
		sourceFrameCount: sequenceFrameCount,
		sourceRate: { num: 24, den: 1 },
		retimeMap: null,
	};
}

function edges(): Record<string, unknown> {
	return {
		schemaVersion: 1,
		sequenceId: 'sequence-1',
		trackId: 'track-1',
		outgoing: edge('clip-a', 'source-a', 0, 20),
		incoming: edge('clip-b', 'source-b', 12, 20),
	};
}

test('V22 freezes transition capabilities, protocol limits, allocation spelling, and dissolve registry', () => {
	assert.deepEqual(VIDEO_TRANSITION_LIMITS_V1, {
		maximumTransitionsPerTrack: 16_384,
		maximumTransitionsPerProject: 100_000,
		maximumDurationFrames: 2_000_000,
		maximumCurveAnchors: 4_096,
	});
	assert.equal(VIDEO_TRANSITION_ALLOCATION_FIELD_V1, 'videoTransitionAllocations');
	assert.equal(PROJECT_FEATURE_CAPABILITY_IDS.videoTransitions,
		'org.soundscaper.capability.video-transitions');
	assert.equal(PROJECT_FEATURE_CAPABILITY_IDS.videoTransitionDissolve,
		'org.soundscaper.capability.video-transition.dissolve');
	const products = Object.values(PRODUCT_PROFILES as unknown as Readonly<Record<string, Readonly<{
		id: string;
		capabilities: Readonly<Record<string, unknown>>;
	}>>>);
	for (const product of products) {
		assert.equal(product.capabilities.videoTransitions, false, product.id);
		assert.equal(product.capabilities.videoTransitionDissolve, false, product.id);
	}
	assert.equal(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS.includes(
		PROJECT_FEATURE_CAPABILITY_IDS.videoTransitions as never,
	), false);
	assert.equal(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS.includes(
		PROJECT_FEATURE_CAPABILITY_IDS.videoTransitionDissolve as never,
	), false);
	assert.deepEqual(VIDEO_TRANSITION_TYPE_REGISTRY_V1, [{
		type: 'dissolve',
		featureId: 'org.soundscaper.capability.video-transition.dissolve',
		requirementId: 'framescaper.video-transition.dissolve',
		displayName: 'Dissolve video transitions',
		label: 'Dissolve',
		resolutionContract: 'complementary-progress-v1',
		previewConsumer: 'video-transition-resolution-v1',
		exportConsumer: 'video-transition-resolution-v1',
	}]);
	assert.equal(VIDEO_TRANSITIONS_PROJECT_REQUIREMENT_V1.displayName, 'Video transitions');
	assertDeepFrozen(VIDEO_TRANSITION_TYPE_REGISTRY_V1);
});

test('transition normalization is detached, recursively frozen, idempotent, and keeps open type slugs', () => {
	const input = transition();
	const normalized = normalizeVideoTransitionV1(input);
	assert.deepEqual(normalized, input);
	assert.notStrictEqual(normalized, input);
	assert.notStrictEqual(normalized.curve, input.curve);
	assertDeepFrozen(normalized);
	assert.deepEqual(normalizeVideoTransitionV1(normalized), normalized);
	assert.deepEqual(validateVideoTransitionV1(normalized), normalized);

	const opaque = normalizeVideoTransitionV1({ ...input, type: 'vendor-wipe' });
	assert.equal(opaque.type, 'vendor-wipe');
	assert.equal(videoTransitionTypeFeatureIdV1(opaque.type),
		'org.soundscaper.capability.video-transition.vendor-wipe');

	const defaultDissolve = createDefaultDissolveVideoTransitionV1({
		id: 'transition-default', outgoingClipId: 'clip-a', incomingClipId: 'clip-b', durationFrames: 8,
	});
	assert.deepEqual(defaultDissolve, transition('transition-default'));
});

test('transition normalization rejects hostile records and noncanonical curves', () => {
	const valid = transition();
	assert.throws(() => normalizeVideoTransitionV1({ ...valid, extra: true }), /unsupported|field/iu);
	assert.throws(() => normalizeVideoTransitionV1({ ...valid, type: 'Dissolve' }), /type|slug/iu);
	assert.throws(() => normalizeVideoTransitionV1({ ...valid, durationFrames: 2_000_001 }), /duration|2000000/iu);
	assert.throws(() => normalizeVideoTransitionV1({ ...valid, curve: {
		...valid.curve,
		anchors: [
			{ position: { num: -0, den: 1 }, value: 0 },
			{ position: { num: 8, den: 1 }, value: 1 },
		],
	} }), /negative zero|canonical|position/iu);
	assert.throws(() => normalizeVideoTransitionV1({ ...valid, curve: {
		...valid.curve,
		anchors: [
			{ position: { num: 0, den: 1 }, value: 0 },
			{ position: { num: 16, den: 2 }, value: 1 },
		],
	} }), /canonical|reduced|rational/iu);
	assert.throws(() => normalizeVideoTransitionV1({ ...valid, curve: {
		...valid.curve,
		anchors: [
			{ position: { num: 0, den: 1 }, value: 0 },
			{ position: { num: 8, den: 1 }, value: 1.1 },
		],
	} }), /0.*1|value|range/iu);

	let getterCalls = 0;
	const accessor = { ...valid } as Record<string, unknown>;
	Object.defineProperty(accessor, 'curve', {
		enumerable: true,
		get() { getterCalls += 1; return valid.curve; },
	});
	assert.throws(() => normalizeVideoTransitionV1(accessor), /data property|accessor/iu);
	assert.equal(getterCalls, 0);

	const tooManyAnchors = Array.from({ length: 4_097 }, (_, index) => ({
		position: { num: index, den: 1 }, value: index === 4_096 ? 1 : 0,
	}));
	assert.throws(() => normalizeVideoTransitionV1({ ...valid, durationFrames: 4_096, curve: {
		anchors: tooManyAnchors,
		segments: Array.from({ length: 4_096 }, () => ({ kind: 'linear' })),
	} }), /4096|anchor/iu);
});

test('track collections normalize to the frozen overlap/pair/identity order and enforce exact caps', () => {
	const input = [
		transition('transition-c', 'clip-c', 'clip-d'),
		transition('transition-a', 'clip-a', 'clip-b'),
		transition('transition-b', 'clip-e', 'clip-f'),
	];
	const normalized = normalizeVideoTransitionCollectionV1(input, STARTS);
	assert.deepEqual(normalized.map(({ id }) => id), ['transition-b', 'transition-a', 'transition-c']);
	assertDeepFrozen(normalized);
	assert.throws(() => validateVideoTransitionCollectionV1(input, STARTS), /canonical.*order/iu);
	assert.deepEqual(validateVideoTransitionCollectionV1(normalized, STARTS), normalized);
	assert.throws(() => normalizeVideoTransitionCollectionV1([
		transition('transition-a'), transition('transition-a', 'clip-c', 'clip-d'),
	], STARTS), /duplicate.*transition.*ID/iu);
	assert.throws(() => normalizeVideoTransitionCollectionV1([
		transition('transition-a'), transition('transition-c'),
	], STARTS), /duplicate.*pair/iu);
	assert.throws(() => normalizeVideoTransitionCollectionV1(
		new Array(16_385).fill(transition()), STARTS,
	), /16384|entries/iu);
	assert.doesNotThrow(() => assertVideoTransitionProjectLimitV1([new Array(100_000)]));
	assert.throws(() => assertVideoTransitionProjectLimitV1([new Array(100_000), new Array(1)]),
		/100000|project/iu);
});

test('topology allocations use one closed replayable carrier and reject duplicates', () => {
	const allocation = {
		trackId: 'track-1',
		outgoingClipId: 'clip-a',
		incomingClipId: 'clip-b',
		transitionId: 'transition-a',
	};
	const normalized = normalizeVideoTransitionAllocationsV1([allocation]);
	assert.deepEqual(normalized, [allocation]);
	assertDeepFrozen(normalized);
	assert.throws(() => normalizeVideoTransitionAllocationsV1([
		allocation, { ...allocation },
	]), /duplicate.*allocation|transition/iu);
	assert.throws(() => normalizeVideoTransitionAllocationsV1([{ ...allocation, unused: true }]),
		/unsupported|field/iu);
});

test('canonical edge snapshots retain exact rates and retime authority as a closed frozen value', () => {
	const input = edges();
	const normalized = normalizeCanonicalTransitionClipEdgesV1(input);
	assert.deepEqual(normalized, input);
	assert.notStrictEqual(normalized, input);
	assert.notStrictEqual(normalized.outgoing, input.outgoing);
	assertDeepFrozen(normalized);
	assert.deepEqual(validateCanonicalTransitionClipEdgesV1(normalized), normalized);

	const retimed = edges();
	(retimed.outgoing as Record<string, unknown>).retimeMap = {
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
			{ outerFrame: 20, sourceFrame: { num: 20, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	};
	assert.equal(normalizeCanonicalTransitionClipEdgesV1(retimed).outgoing.retimeMap?.version, 2);

	const extra = edges();
	(extra.outgoing as Record<string, unknown>).derivedEndFrame = 20;
	assert.throws(() => normalizeCanonicalTransitionClipEdgesV1(extra), /unsupported|field/iu);
	const rate = edges();
	(rate.incoming as Record<string, unknown>).sequenceRate = { num: 48, den: 2 };
	assert.throws(() => normalizeCanonicalTransitionClipEdgesV1(rate), /canonical|reduced|rate/iu);
});

test('shared resolution validates proper pair geometry, preserves cuts, and evaluates terminal progress', () => {
	const center = videoTransitionGeometryV1(transition(), edges());
	assert.deepEqual({ start: center.overlapStartFrame, end: center.overlapEndFrame, cut: center.cutFrame },
		{ start: 12, end: 20, cut: 16 });
	assert.equal(videoTransitionGeometryV1({ ...transition(), alignment: 'start-at-cut' }, edges()).cutFrame, 12);
	assert.equal(videoTransitionGeometryV1({ ...transition(), alignment: 'end-at-cut' }, edges()).cutFrame, 20);

	const middle = resolveVideoTransitionV1(transition(), edges(), { num: 16, den: 1 });
	assert.deepEqual({
		progress: middle.progress,
		outgoingWeight: middle.outgoingWeight,
		incomingWeight: middle.incomingWeight,
		activeFrame: middle.activeFrame,
	}, { progress: 0.5, outgoingWeight: 0.5, incomingWeight: 0.5, activeFrame: true });
	const terminal = resolveVideoTransitionV1(transition(), edges(), 20);
	assert.deepEqual({ progress: terminal.progress, activeFrame: terminal.activeFrame },
		{ progress: 1, activeFrame: false });

	assert.throws(() => videoTransitionGeometryV1({ ...transition(), incomingClipId: 'wrong' }, edges()),
		/pair|incoming/iu);
	assert.throws(() => videoTransitionGeometryV1({ ...transition(), durationFrames: 7 }, edges()),
		/duration|overlap/iu);
	const touching = edges();
	(touching.incoming as Record<string, unknown>).sequenceStartFrame = 20;
	assert.throws(() => videoTransitionGeometryV1(transition(), touching), /proper overlap|geometry/iu);
	assert.throws(() => resolveVideoTransitionV1({ ...transition(), type: 'vendor-wipe' }, edges(), 16),
		/unregistered|unavailable|vendor-wipe/iu);
});

test('requirement helpers derive umbrella and sorted per-type bypass declarations', () => {
	assert.deepEqual(videoTransitionFeatureRequirementsV1([]), []);
	assert.deepEqual(videoTransitionFeatureRequirementsV1([transition()]).map((item) => item.displayName), [
		'Video transitions',
		'Dissolve video transitions',
	]);
	const requirements = videoTransitionFeatureRequirementsV1([
		transition(), { ...transition('transition-c', 'clip-c', 'clip-d'), type: 'vendor-wipe' },
	]);
	assert.deepEqual(requirements.map(({ id, featureId, displayName }) => ({ id, featureId, displayName })), [{
		id: 'framescaper.video-transitions',
		featureId: 'org.soundscaper.capability.video-transitions',
		displayName: 'Video transitions',
	}, {
		id: 'framescaper.video-transition.dissolve',
		featureId: 'org.soundscaper.capability.video-transition.dissolve',
		displayName: 'Dissolve video transitions',
	}, {
		id: 'framescaper.video-transition.vendor-wipe',
		featureId: 'org.soundscaper.capability.video-transition.vendor-wipe',
		displayName: 'Video transition type: vendor-wipe',
	}]);
	assert.ok(requirements.every(({ disposition, fallback }) => disposition === 'bypass' && fallback === null));
	assertDeepFrozen(requirements);
});

function assertDeepFrozen(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child);
}
