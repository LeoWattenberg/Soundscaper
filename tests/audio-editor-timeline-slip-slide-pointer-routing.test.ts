/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	FrameCanonicalSlipSlidePlan,
	FrameCanonicalSlipSlidePreview,
	FrameCanonicalSlipSlideRequest,
} from '../src/common/editor/frame-canonical-slip-slide-domain.ts';
import type {
	FrameCanonicalSlipSlidePointerAuthority,
	FrameCanonicalSlipSlidePointerCapture,
} from '../src/common/editor/frame-canonical-slip-slide-pointer-request.ts';
import {
	captureTimelineSlipSlidePointerGesture,
	commitTimelineSlipSlidePointer,
	resolveTimelineSlipSlidePointerPreview,
} from '../src/common/editor/ui/timeline/slip-slide-pointer-routing.ts';

test('pointer-down captures only exact primary Framescaper video-bearing body chords', () => {
	for (const row of [
		{ name: 'Alt slip', expected: 'slip', altKey: true, shiftKey: false },
		{ name: 'Alt Shift slide', expected: 'slide', altKey: true, shiftKey: true },
		{ name: 'ordinary', expected: null, altKey: false, shiftKey: false },
		{ name: 'Shift ordinary', expected: null, altKey: false, shiftKey: true },
		{ name: 'trim handle', expected: null, altKey: true, shiftKey: false, kind: 'trim-left' },
		{ name: 'touch', expected: null, altKey: true, shiftKey: false, pointerType: 'touch' },
		{ name: 'non-primary', expected: null, altKey: true, shiftKey: false, isPrimary: false },
		{ name: 'Soundscaper', expected: null, altKey: true, shiftKey: false, canonicalVideoTrim: false },
		{ name: 'audio only', expected: null, altKey: true, shiftKey: false, audioOnly: true },
		{ name: 'Control conflict', expected: null, altKey: true, shiftKey: false, ctrlKey: true },
		{ name: 'Meta conflict', expected: null, altKey: true, shiftKey: true, metaKey: true },
	] as const) {
		const captures: FrameCanonicalSlipSlidePointerCapture[] = [];
		const result = captureTimelineSlipSlidePointerGesture({
			session: pointerSession({ kind: row.kind, audioOnly: row.audioOnly }),
			canonicalVideoTrim: row.canonicalVideoTrim ?? true,
			pointerType: row.pointerType ?? 'mouse',
			isPrimary: row.isPrimary ?? true,
			altKey: row.altKey,
			shiftKey: row.shiftKey,
			ctrlKey: row.ctrlKey ?? false,
			metaKey: row.metaKey ?? false,
			pointerDownSample: 12_345,
			capturePointerAuthority: (capture) => {
				captures.push(capture);
				const authority = capture.mode === 'slip' ? slipAuthority() : slideAuthority();
				return Object.freeze({
					...authority,
					activeClipId: capture.activeClipId,
					pointerDownSample: capture.pointerDownSample,
				});
			},
		});
		assert.equal(result?.mode ?? null, row.expected, row.name);
		assert.equal(captures.length, row.expected === null ? 0 : 1, row.name);
		if (row.expected !== null) {
			assert.deepEqual(captures[0], {
				mode: row.expected, activeClipId: 'active-audio', pointerDownSample: 12_345,
			}, row.name);
			assert.ok(Object.isFrozen(captures[0]), row.name);
			assert.ok(Object.isFrozen(result), row.name);
		}
	}
});

test('slip preview uses immutable authority, tags source waveforms, and has no program guides', () => {
	const requests: FrameCanonicalSlipSlideRequest[] = [];
	const session = capturedSession('slip');
	const plan = transformPlan('slip');
	const result = resolveTimelineSlipSlidePointerPreview({
		session,
		currentPointerSample: 25_000,
		previewSlipSlide: (request) => {
			requests.push(request);
			return plan;
		},
		clipKind: (clipId) => clipId.endsWith('audio') ? 'audio' : 'video',
		previewOrdinary: () => assert.fail('Captured slip used ordinary move preview.'),
	});

	assert.deepEqual(requests, [{
		mode: 'slip', activeClipId: 'active-audio', requestedSourceInFrame: 22,
	}]);
	assert.deepEqual(result, {
		...plan.previews[0],
		slipSlideMode: 'slip',
		sourceSlipPreview: true,
		waveformPreviewKind: 'trim',
		previews: [
			{
				...plan.previews[0], slipSlideMode: 'slip', sourceSlipPreview: true,
				waveformPreviewKind: 'trim',
			},
			{ ...plan.previews[1], slipSlideMode: 'slip', sourceSlipPreview: true },
		],
	});
	assert.equal(Object.hasOwn(result as object, 'guideSamples'), false);
	assert.equal(Object.hasOwn(plan.previews[0] ?? {}, 'waveformPreviewKind'), false);
	assert.ok(Object.isFrozen(result));
	assert.ok((result as { readonly previews: readonly object[] }).previews.every(Object.isFrozen));
});

test('slide preview renders the complete participant plan and both conformed center guides', () => {
	const session = capturedSession('slide');
	const plan = transformPlan('slide');
	const result = resolveTimelineSlipSlidePointerPreview({
		session,
		currentPointerSample: 3_000,
		previewSlipSlide: () => plan,
		clipKind: (clipId) => clipId.endsWith('audio') ? 'audio' : 'video',
		previewOrdinary: () => assert.fail('Captured slide used ordinary move preview.'),
	});
	const observed = result as {
		readonly slipSlideMode: string;
		readonly guideSamples: Readonly<{ readonly start: number; readonly end: number }>;
		readonly previews: readonly Readonly<Record<string, unknown>>[];
	};

	assert.equal(observed.slipSlideMode, 'slide');
	assert.deepEqual(observed.guideSamples, { start: 22_000, end: 70_000 });
	assert.deepEqual(observed.previews.map((preview) => [
		preview.clipId, preview.changeKind, preview.waveformPreviewKind,
	]), [
		['left-audio', 'neighbor-trim', 'trim'],
		['active-audio', 'placement', undefined],
		['right-video', 'neighbor-trim', undefined],
	]);
	assert.ok(Object.isFrozen(observed.guideSamples));
	assert.ok(Object.isFrozen(observed.previews));
});

test('captured no-op, refusal, and missing authority clear preview without ordinary fallback', () => {
	for (const row of [
		{ authority: slipAuthority(), result: noopPlan('slip') },
		{ authority: slipAuthority(), result: null },
		{ authority: null, result: transformPlan('slip') },
	] as const) {
		let ordinaryCalls = 0;
		const result = resolveTimelineSlipSlidePointerPreview({
			session: Object.freeze({
				...pointerSession(), slipSlideMode: 'slip' as const,
				slipSlidePointerAuthority: row.authority,
			}),
			currentPointerSample: 25_000,
			previewSlipSlide: () => row.result,
			previewOrdinary: () => { ordinaryCalls += 1; return { stale: true }; },
		});
		assert.equal(result, null);
		assert.equal(ordinaryCalls, 0);
	}
});

test('ordinary routes remain unchanged when no slip/slide chord was captured', () => {
	const session = Object.freeze({
		...pointerSession(), slipSlideMode: null, slipSlidePointerAuthority: null,
	});
	const ordinaryPreview = Object.freeze({ route: 'move' });
	assert.equal(resolveTimelineSlipSlidePointerPreview({
		session,
		currentPointerSample: 25_000,
		previewSlipSlide: () => assert.fail('Ordinary move used slip/slide preview.'),
		previewOrdinary: () => ordinaryPreview,
	}), ordinaryPreview);
	assert.equal(commitTimelineSlipSlidePointer({
		session,
		currentPointerSample: 30_000,
		commitSlipSlide: () => assert.fail('Ordinary move used slip/slide commit.'),
		commitOrdinary: () => 'ordinary-commit',
	}), 'ordinary-commit');
});

test('release rebuilds from the final absolute pointer and never commits stale preview data', () => {
	const calls: FrameCanonicalSlipSlideRequest[] = [];
	const session = Object.freeze({
		...capturedSession('slide'),
		preview: Object.freeze({
			requestedStartSample: 21_000,
			transforms: Object.freeze([{ clipId: 'stale' }]),
		}),
	});
	const result = commitTimelineSlipSlidePointer({
		session,
		currentPointerSample: 5_000,
		commitSlipSlide: (request) => {
			calls.push(request);
			return 'fresh-live-commit';
		},
		commitOrdinary: () => assert.fail('Captured slide used ordinary move commit.'),
	});

	assert.equal(result, 'fresh-live-commit');
	assert.deepEqual(calls, [{
		mode: 'slide', activeClipId: 'active-audio', requestedStartSample: 24_000,
	}]);
	assert.equal(Object.hasOwn(calls[0] ?? {}, 'preview'), false);
	assert.equal(Object.hasOwn(calls[0] ?? {}, 'transforms'), false);
});

test('captured zero-delta release still sends the immutable no-op target to a fresh commit', () => {
	const calls: FrameCanonicalSlipSlideRequest[] = [];
	const session = capturedSession('slip');
	assert.equal(commitTimelineSlipSlidePointer({
		session,
		currentPointerSample: 1_000,
		commitSlipSlide: (request) => { calls.push(request); return 'noop-replanned'; },
		commitOrdinary: () => assert.fail('Captured zero-delta slip sought or moved ordinarily.'),
	}), 'noop-replanned');
	assert.deepEqual(calls, [{
		mode: 'slip', activeClipId: 'active-audio', requestedSourceInFrame: 10,
	}]);
});

function pointerSession(options: Readonly<{ kind?: string; audioOnly?: boolean }> = {}) {
	const activeAudio = Object.freeze({ id: 'active-audio', kind: 'audio' });
	const originals: Record<string, Readonly<{ readonly id: string; readonly kind: string }>> = {
		[activeAudio.id]: activeAudio,
	};
	const clipIds: string[] = [activeAudio.id];
	if (options.audioOnly !== true) {
		const activeVideo = Object.freeze({ id: 'active-video', kind: 'video' });
		originals[activeVideo.id] = activeVideo;
		clipIds.push(activeVideo.id);
	}
	return Object.freeze({
		kind: options.kind ?? 'move',
		clipId: activeAudio.id,
		clipIds: Object.freeze(clipIds),
		original: activeAudio,
		originals: Object.freeze(originals),
	});
}

function capturedSession(mode: 'slip' | 'slide') {
	return Object.freeze({
		...pointerSession(),
		slipSlideMode: mode,
		slipSlidePointerAuthority: mode === 'slip' ? slipAuthority() : slideAuthority(),
	});
}

function slipAuthority(): FrameCanonicalSlipSlidePointerAuthority {
	return Object.freeze({
		mode: 'slip', activeClipId: 'active-audio', pointerDownSample: 1_000,
		sourceInFrame: 10, sourceOutFrame: 34, programDurationSamples: 48_000,
		timingView: Object.freeze({
			kind: 'cfr' as const, rate: Object.freeze({ num: 24, den: 1 }), frameCount: 1_000,
		}),
	});
}

function slideAuthority(): FrameCanonicalSlipSlidePointerAuthority {
	return Object.freeze({
		mode: 'slide', activeClipId: 'active-audio', pointerDownSample: 1_000,
		programStartSample: 20_000,
	});
}

function transformPlan(mode: 'slip' | 'slide'): FrameCanonicalSlipSlidePlan {
	const previews = mode === 'slip' ? Object.freeze([
		preview('active-audio', 'audio-track', 'source-slip'),
		preview('active-video', 'video-track', 'source-slip'),
	]) : Object.freeze([
		preview('left-audio', 'audio-track', 'neighbor-trim'),
		preview('active-audio', 'audio-track', 'placement'),
		preview('right-video', 'video-track', 'neighbor-trim'),
	]);
	return Object.freeze({
		...diagnostics(mode),
		kind: 'transform' as const,
		transforms: Object.freeze(previews.map(({ clipId, trackId }) => Object.freeze({
			clipId, trackId, changes: Object.freeze({ sourceStartFrame: 2 }),
		}))),
		previews,
	}) as FrameCanonicalSlipSlidePlan;
}

function noopPlan(mode: 'slip' | 'slide'): FrameCanonicalSlipSlidePlan {
	return Object.freeze({
		...diagnostics(mode), kind: 'noop' as const, transforms: [] as const, previews: [] as const,
	}) as FrameCanonicalSlipSlidePlan;
}

function diagnostics(mode: 'slip' | 'slide') {
	const common = {
		mode,
		activeClipId: 'active-audio',
		authorityClipId: 'active-video',
		authoritySourceId: 'video-source',
		authoritySequenceId: 'main',
		clamped: false,
		participantClipIds: Object.freeze(mode === 'slip'
			? ['active-audio', 'active-video']
			: ['left-audio', 'active-audio', 'right-video']),
		leftClipIds: Object.freeze(mode === 'slide' ? ['left-audio'] : []),
		centerClipIds: Object.freeze(mode === 'slide'
			? ['active-audio'] : ['active-audio', 'active-video']),
		rightClipIds: Object.freeze(mode === 'slide' ? ['right-video'] : []),
		sourceRanges: Object.freeze([]),
	};
	return mode === 'slip' ? {
		...common,
		mode,
		requestedSourceInFrame: 22,
		appliedSourceInFrame: 22,
		sourceFrameDelta: 12,
	} : {
		...common,
		mode,
		requestedStartSample: 22_000,
		requestedSequenceStartFrame: 11,
		appliedSequenceStartFrame: 11,
		appliedStartSample: 22_000,
		appliedEndSample: 70_000,
		sequenceFrameDelta: 1,
	};
}

function preview(
	clipId: string,
	trackId: string,
	changeKind: 'source-slip' | 'neighbor-trim' | 'placement',
): FrameCanonicalSlipSlidePreview {
	return Object.freeze({
		clipId, trackId, changeKind,
		timelineStartFrame: 20_000,
		durationFrames: 48_000,
		sourceStartFrame: 10,
		sourceDurationFrames: 24,
		trimStartFrames: 0,
		trimEndFrames: 0,
		fadeInFrames: 0,
		fadeOutFrames: 0,
	});
}
