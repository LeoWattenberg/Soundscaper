/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	FrameCanonicalRollRippleTrimPlan,
	FrameCanonicalRollRippleTrimPreview,
	FrameCanonicalRollRippleTrimRequest,
} from '../src/common/editor/frame-canonical-roll-ripple-trim-domain.ts';
import {
	captureTimelineRollRippleTrimPointerMode,
	commitTimelineRollRippleTrimPointer,
	resolveTimelineRollRippleTrimPointerPreview,
} from '../src/common/editor/ui/timeline/roll-ripple-trim-pointer-routing.ts';

test('pointer-down captures only non-touch Framescaper video-bearing Alt gestures', () => {
	for (const row of [
		{ name: 'Alt roll', altKey: true, shiftKey: false, expected: 'roll' },
		{ name: 'Alt Shift ripple', altKey: true, shiftKey: true, expected: 'ripple' },
		{ name: 'ordinary', altKey: false, shiftKey: false, expected: null },
		{ name: 'Shift ordinary', altKey: false, shiftKey: true, expected: null },
		{ name: 'touch ordinary', altKey: true, shiftKey: true, pointerType: 'touch', expected: null },
		{ name: 'Soundscaper ordinary', altKey: true, shiftKey: false, canonicalVideoTrim: false, expected: null },
		{ name: 'audio-only ordinary', altKey: true, shiftKey: false, audioOnly: true, expected: null },
	] as const) {
		const mode = captureTimelineRollRippleTrimPointerMode({
			session: pointerSession({ audioOnly: row.audioOnly ?? false }),
			canonicalVideoTrim: row.canonicalVideoTrim ?? true,
			pointerType: row.pointerType ?? 'mouse',
			altKey: row.altKey,
			shiftKey: row.shiftKey,
		});
		assert.equal(mode, row.expected, row.name);
	}
});

test('captured mode routes one absolute request and adapts every preview by change kind', () => {
	const base = pointerSession();
	const captured = captureTimelineRollRippleTrimPointerMode({
		session: base,
		canonicalVideoTrim: true,
		pointerType: 'mouse',
		altKey: true,
		shiftKey: true,
	});
	assert.equal(captured, 'ripple');
	const session = Object.freeze({ ...base, rollRippleMode: captured });
	const plan = transformPlan('ripple');
	const requests: FrameCanonicalRollRippleTrimRequest[] = [];
	const projectKinds = new Map<string, 'audio' | 'video'>([
		['grouped-audio', 'audio'],
		['suffix-audio', 'audio'],
		['suffix-video', 'video'],
	]);
	const result = resolveTimelineRollRippleTrimPointerPreview({
		session,
		edge: 'left',
		requestedBoundarySample: 12_345,
		previewRollRipple: (request) => {
			requests.push(request);
			return plan;
		},
		clipKind: (clipId) => projectKinds.get(clipId) ?? null,
		previewOrdinary: () => assert.fail('Captured ripple used ordinary trim preview.'),
	});

	assert.deepEqual(requests, [{
		mode: 'ripple', activeClipId: 'active-audio', edge: 'left',
		requestedBoundarySample: 12_345,
	}]);
	assert.ok(Object.isFrozen(requests[0]));
	assert.deepEqual(result, {
		...plan.previews[0],
		waveformPreviewKind: 'trim',
		guideSample: plan.resolvedSourceCutSample,
		previews: [
			{ ...plan.previews[0], waveformPreviewKind: 'trim' },
			plan.previews[1],
			{ ...plan.previews[2], waveformPreviewKind: 'trim' },
			plan.previews[3],
			plan.previews[4],
		],
	});
	const adapted = (result as {
		readonly previews: readonly Readonly<Record<string, unknown>>[];
	}).previews;
	assert.deepEqual(adapted.map((preview) => [
		preview.clipId,
		preview.changeKind,
		preview.waveformPreviewKind,
	]), [
		['active-audio', 'source-trim', 'trim'],
		['active-video', 'source-trim', undefined],
		['grouped-audio', 'source-trim', 'trim'],
		['suffix-audio', 'placement-only', undefined],
		['suffix-video', 'placement-only', undefined],
	]);
	assert.equal(Object.hasOwn(session.originals ?? {}, 'grouped-audio'), false);
	assert.equal(Object.hasOwn(plan.previews[0] ?? {}, 'waveformPreviewKind'), false);
	assert.ok(Object.isFrozen(result));
	assert.ok(Object.isFrozen(adapted));
	assert.ok(adapted.every(Object.isFrozen));
});

test('no-op and run-normalized refusal clear preview without falling back to ordinary trim', () => {
	for (const plannerResult of [noopPlan(), null]) {
		let ordinaryCalls = 0;
		const result = resolveTimelineRollRippleTrimPointerPreview({
			session: { ...pointerSession(), rollRippleMode: 'ripple' },
			edge: 'right',
			requestedBoundarySample: 45_000,
			previewRollRipple: () => plannerResult,
			previewOrdinary: () => { ordinaryCalls += 1; return { stale: true }; },
		});
		assert.equal(result, null);
		assert.equal(ordinaryCalls, 0);
	}
});

test('release uses captured mode and final absolute sample, never stale preview authority', () => {
	const calls: FrameCanonicalRollRippleTrimRequest[] = [];
	const base = pointerSession();
	const captured = captureTimelineRollRippleTrimPointerMode({
		session: base,
		canonicalVideoTrim: true,
		pointerType: 'mouse',
		altKey: true,
		shiftKey: true,
	});
	const session = {
		...base,
		rollRippleMode: captured,
		preview: Object.freeze({
			requestedBoundarySample: 30_000,
			transforms: Object.freeze([{ clipId: 'stale' }]),
		}),
	};
	const result = commitTimelineRollRippleTrimPointer({
		session,
		edge: 'right',
		requestedBoundarySample: 37_777,
		commitRollRipple: (request) => {
			calls.push(request);
			return 'committed-fresh-plan';
		},
		commitOrdinary: () => assert.fail('Captured ripple used ordinary trim commit.'),
	});

	assert.equal(result, 'committed-fresh-plan');
	assert.deepEqual(calls, [{
		mode: 'ripple', activeClipId: 'active-audio', edge: 'right',
		requestedBoundarySample: 37_777,
	}]);
	assert.ok(Object.isFrozen(calls[0]));
	assert.equal(Object.hasOwn(calls[0] ?? {}, 'preview'), false);
	assert.equal(Object.hasOwn(calls[0] ?? {}, 'transforms'), false);
});

test('ordinary, Soundscaper, touch, and audio-only sessions retain their existing route', () => {
	for (const row of [
		{ name: 'unmodified Framescaper', canonicalVideoTrim: true, pointerType: 'mouse', audioOnly: false, altKey: false },
		{ name: 'Soundscaper', canonicalVideoTrim: false, pointerType: 'mouse', audioOnly: false, altKey: true },
		{ name: 'touch', canonicalVideoTrim: true, pointerType: 'touch', audioOnly: false, altKey: true },
		{ name: 'audio only', canonicalVideoTrim: true, pointerType: 'mouse', audioOnly: true, altKey: true },
	] as const) {
		const base = pointerSession({ audioOnly: row.audioOnly });
		const mode = captureTimelineRollRippleTrimPointerMode({
			session: base,
			canonicalVideoTrim: row.canonicalVideoTrim,
			pointerType: row.pointerType,
			altKey: row.altKey,
			shiftKey: false,
		});
		const session = { ...base, rollRippleMode: mode };
		let previewCalls = 0;
		const ordinaryPreview = Object.freeze({ route: row.name });
		assert.equal(resolveTimelineRollRippleTrimPointerPreview({
			session, edge: 'left', requestedBoundarySample: 12_345,
			previewRollRipple: () => assert.fail(`${row.name} used roll/ripple preview.`),
			previewOrdinary: () => { previewCalls += 1; return ordinaryPreview; },
		}), ordinaryPreview, row.name);
		assert.equal(previewCalls, 1, row.name);

		let commitCalls = 0;
		assert.equal(commitTimelineRollRippleTrimPointer({
			session, edge: 'left', requestedBoundarySample: 12_345,
			commitRollRipple: () => assert.fail(`${row.name} used roll/ripple commit.`),
			commitOrdinary: () => { commitCalls += 1; return `ordinary:${row.name}`; },
		}), `ordinary:${row.name}`, row.name);
		assert.equal(commitCalls, 1, row.name);
	}
});

function pointerSession(options: Readonly<{ audioOnly?: boolean }> = {}) {
	const activeAudio = Object.freeze({ id: 'active-audio', kind: 'audio' });
	if (options.audioOnly === true) {
		return Object.freeze({
			clipId: activeAudio.id,
			clipIds: Object.freeze([activeAudio.id]),
			original: activeAudio,
			originals: Object.freeze({ [activeAudio.id]: activeAudio }),
		});
	}
	const activeVideo = Object.freeze({ id: 'active-video', kind: 'video' });
	return Object.freeze({
		clipId: activeAudio.id,
		clipIds: Object.freeze([activeAudio.id, activeVideo.id]),
		original: activeAudio,
		originals: Object.freeze({
			[activeAudio.id]: activeAudio,
			[activeVideo.id]: activeVideo,
		}),
	});
}

function transformPlan(mode: 'roll' | 'ripple'): FrameCanonicalRollRippleTrimPlan {
	const previews = Object.freeze([
		preview('active-audio', 'audio-track', 'source-trim'),
		preview('active-video', 'video-track', 'source-trim'),
		preview('grouped-audio', 'grouped-audio-track', 'source-trim'),
		preview('suffix-audio', 'audio-track', 'placement-only'),
		preview('suffix-video', 'video-track', 'placement-only'),
	]);
	return Object.freeze({
		...diagnostics(mode),
		kind: 'transform',
		transforms: Object.freeze(previews.map(({ clipId, trackId }) => Object.freeze({
			clipId, trackId, changes: Object.freeze({ durationFrames: 20_000 }),
		}))),
		previews,
	});
}

function noopPlan(): FrameCanonicalRollRippleTrimPlan {
	return Object.freeze({
		...diagnostics('ripple'),
		kind: 'noop', transforms: [] as const, previews: [] as const,
	});
}

function diagnostics(mode: 'roll' | 'ripple') {
	return {
		mode,
		activeClipId: 'active-audio',
		edge: 'left' as const,
		sequenceId: 'main',
		sequenceRate: Object.freeze({ num: 24, den: 1 }),
		requestedBoundarySample: 12_345,
		requestedSequenceFrame: 6,
		appliedSequenceFrame: 6,
		sequenceFrameDelta: 1,
		programFrameDelta: mode === 'roll' ? 0 : -1,
		resolvedProgramSampleDelta: mode === 'roll' ? 0 : -2_000,
		resolvedSourceCutSample: 12_000,
		programEditSample: 30_000,
		clamped: false,
		edgeClipIds: Object.freeze(['active-audio', 'active-video']),
		neighborClipIds: Object.freeze(mode === 'roll' ? ['suffix-audio', 'suffix-video'] : []),
		shiftedClipIds: Object.freeze(mode === 'ripple' ? ['suffix-audio', 'suffix-video'] : []),
	};
}

function preview(
	clipId: string,
	trackId: string,
	changeKind: 'source-trim' | 'placement-only',
): FrameCanonicalRollRippleTrimPreview {
	return Object.freeze({
		clipId, trackId, changeKind,
		timelineStartFrame: clipId.startsWith('suffix') ? 30_000 : 10_000,
		durationFrames: 20_000,
		sourceStartFrame: 1_000,
		sourceDurationFrames: 20_000,
		trimStartFrames: 0,
		trimEndFrames: 0,
		fadeInFrames: 0,
		fadeOutFrames: 0,
	});
}
