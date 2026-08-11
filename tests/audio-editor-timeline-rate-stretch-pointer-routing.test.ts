/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	FrameCanonicalRateStretchPlan,
	FrameCanonicalRateStretchPreview,
	FrameCanonicalRateStretchRequest,
} from '../src/common/editor/frame-canonical-rate-stretch-domain.ts';
import {
	commitTimelineRateStretchPointer,
	resolveTimelineRateStretchPointerPreview,
	usesFrameCanonicalTimelineRateStretch,
} from '../src/common/editor/ui/timeline/rate-stretch-pointer-routing.ts';

test('only existing Framescaper video stretch handles use the canonical route', () => {
	for (const row of [
		{ name: 'video left', kind: 'stretch-left', originalKind: 'video', capability: true, expected: true },
		{ name: 'video right', kind: 'stretch-right', originalKind: 'video', capability: true, expected: true },
		{ name: 'Soundscaper video', kind: 'stretch-right', originalKind: 'video', capability: false, expected: false },
		{ name: 'audio stretch', kind: 'stretch-left', originalKind: 'audio', capability: true, expected: false },
		{ name: 'video trim', kind: 'trim-left', originalKind: 'video', capability: true, expected: false },
	] as const) {
		assert.equal(usesFrameCanonicalTimelineRateStretch({
			session: pointerSession(row.kind, row.originalKind),
			canonicalVideoTrim: row.capability,
		}), row.expected, row.name);
	}
});

test('preview sends one absolute request, projects every participant, and tags audio waveforms', () => {
	const session = pointerSession('stretch-right', 'video');
	const plan = transformPlan();
	const requests: FrameCanonicalRateStretchRequest[] = [];
	const result = resolveTimelineRateStretchPointerPreview({
		session,
		canonicalVideoTrim: true,
		requestedBoundarySample: 37_777,
		previewRateStretch: (request) => {
			requests.push(request);
			return plan;
		},
		clipKind: (clipId) => clipId.endsWith('audio') ? 'audio' : 'video',
		previewOrdinary: () => assert.fail('Canonical video stretch used the legacy preview.'),
	});

	assert.deepEqual(requests, [{
		activeClipId: 'video', edge: 'right', requestedBoundarySample: 37_777,
	}]);
	assert.ok(Object.isFrozen(requests[0]));
	assert.deepEqual(result, {
		...plan.previews[1],
		rateStretchPreview: true,
		rateStretchGuideSample: 36_000,
		rateStretchGuideEdge: 'right',
		previews: [
			{
				...plan.previews[0], rateStretchPreview: true,
				waveformPreviewKind: 'rate-stretch',
			},
			{ ...plan.previews[1], rateStretchPreview: true },
		],
	});
	assert.equal(Object.hasOwn(plan.previews[0] ?? {}, 'waveformPreviewKind'), false);
	const adapted = (result as { readonly previews: readonly object[] }).previews;
	assert.ok(Object.isFrozen(result));
	assert.ok(Object.isFrozen(adapted));
	assert.ok(adapted.every(Object.isFrozen));
});

test('refusal and no-op clear stale canonical previews without legacy fallback', () => {
	for (const plannerResult of [null, noopPlan()]) {
		let ordinaryCalls = 0;
		assert.equal(resolveTimelineRateStretchPointerPreview({
			session: pointerSession('stretch-left', 'video'),
			canonicalVideoTrim: true,
			requestedBoundarySample: 12_000,
			previewRateStretch: () => plannerResult,
			previewOrdinary: () => { ordinaryCalls += 1; return { stale: true }; },
		}), null);
		assert.equal(ordinaryCalls, 0);
	}
});

test('release replans from the final absolute point and never commits preview transforms', () => {
	const calls: FrameCanonicalRateStretchRequest[] = [];
	const session = Object.freeze({
		...pointerSession('stretch-left', 'video'),
		preview: Object.freeze({
			requestedBoundarySample: 12_000,
			transforms: Object.freeze([{ clipId: 'stale' }]),
		}),
	});
	assert.equal(commitTimelineRateStretchPointer({
		session,
		canonicalVideoTrim: true,
		requestedBoundarySample: 9_999,
		commitRateStretch: (request) => { calls.push(request); return 'fresh-live-commit'; },
		commitOrdinary: () => assert.fail('Canonical video stretch used the legacy commit.'),
	}), 'fresh-live-commit');
	assert.deepEqual(calls, [{
		activeClipId: 'video', edge: 'left', requestedBoundarySample: 9_999,
	}]);
	assert.equal(Object.hasOwn(calls[0] ?? {}, 'preview'), false);
	assert.equal(Object.hasOwn(calls[0] ?? {}, 'transforms'), false);
	assert.ok(Object.isFrozen(calls[0]));
});

test('zero-distance canonical release commits while Soundscaper and audio retain legacy identity', () => {
	let canonicalCalls = 0;
	assert.equal(commitTimelineRateStretchPointer({
		session: pointerSession('stretch-right', 'video'),
		canonicalVideoTrim: true,
		requestedBoundarySample: 24_000,
		commitRateStretch: () => { canonicalCalls += 1; return 'canonical-noop'; },
		commitOrdinary: () => assert.fail('Canonical no-op fell through to legacy behavior.'),
	}), 'canonical-noop');
	assert.equal(canonicalCalls, 1);

	for (const row of [
		{ name: 'Soundscaper', session: pointerSession('stretch-right', 'video'), capability: false },
		{ name: 'audio', session: pointerSession('stretch-left', 'audio'), capability: true },
	] as const) {
		const ordinaryPreview = Object.freeze({ route: row.name });
		assert.equal(resolveTimelineRateStretchPointerPreview({
			session: row.session,
			canonicalVideoTrim: row.capability,
			requestedBoundarySample: 24_000,
			previewRateStretch: () => assert.fail(`${row.name} used canonical preview.`),
			previewOrdinary: () => ordinaryPreview,
		}), ordinaryPreview, row.name);
		assert.equal(commitTimelineRateStretchPointer({
			session: row.session,
			canonicalVideoTrim: row.capability,
			requestedBoundarySample: 24_000,
			commitRateStretch: () => assert.fail(`${row.name} used canonical commit.`),
			commitOrdinary: () => `legacy:${row.name}`,
		}), `legacy:${row.name}`, row.name);
	}
});

function pointerSession(kind: string, originalKind: 'audio' | 'video') {
	const original = Object.freeze({
		id: originalKind === 'video' ? 'video' : 'audio',
		kind: originalKind,
		timelineStartFrame: 12_000,
		durationFrames: 12_000,
	});
	return Object.freeze({
		kind,
		clipId: original.id,
		clipIds: Object.freeze([original.id]),
		trackId: `${originalKind}-track`,
		original,
		originals: Object.freeze({ [original.id]: original }),
	});
}

function transformPlan(): FrameCanonicalRateStretchPlan {
	const previews = Object.freeze([
		preview('linked-audio', 'audio-track'),
		preview('video', 'video-track'),
	]);
	return Object.freeze({
		...diagnostics(),
		kind: 'transform' as const,
		transforms: Object.freeze(previews.map(({ clipId, trackId }) => Object.freeze({
			clipId, trackId, changes: Object.freeze({ durationFrames: 24_000 }),
		}))),
		previews,
	});
}

function noopPlan(): FrameCanonicalRateStretchPlan {
	return Object.freeze({
		...diagnostics(),
		kind: 'noop' as const,
		transforms: [] as const,
		previews: [] as const,
	});
}

function diagnostics() {
	return {
		activeClipId: 'video',
		edge: 'right' as const,
		authorityClipId: 'video',
		authoritySourceId: 'video-source',
		authoritySequenceId: 'main',
		sequenceRate: Object.freeze({ num: 24, den: 1 }),
		requestedBoundarySample: 37_777,
		requestedSequenceFrame: 18,
		appliedSequenceFrame: 18,
		boundarySample: 36_000,
		sequenceFrameDelta: 6,
		durationScale: Object.freeze({ num: 2, den: 1 }),
		authorityPlaybackRate: 0.5,
		clamped: true,
		participantClipIds: Object.freeze(['video', 'linked-audio']),
	};
}

function preview(clipId: string, trackId: string): FrameCanonicalRateStretchPreview {
	return Object.freeze({
		clipId,
		trackId,
		changeKind: 'rate-stretch',
		timelineStartFrame: 12_000,
		durationFrames: 24_000,
		sourceStartFrame: 10,
		sourceDurationFrames: 10,
		trimStartFrames: 0,
		trimEndFrames: 0,
		fadeInFrames: 0,
		fadeOutFrames: 0,
	});
}
