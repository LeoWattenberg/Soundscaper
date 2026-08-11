/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	FrameCanonicalEdgeTrimPlan,
	FrameCanonicalEdgeTrimPreview,
	FrameCanonicalEdgeTrimRequest,
} from '../src/common/editor/frame-canonical-edge-trim-domain.ts';
import {
	commitTimelineTrimPointer,
	resolveTimelineTrimPointerPreview,
} from '../src/common/editor/ui/timeline/trim-pointer-routing.ts';

test('video-bearing preview uses the absolute pointer boundary and never invokes legacy ratio arithmetic', () => {
	const session = trimSession({ activeKind: 'audio', linkedVideo: true });
	const plan = trimPlan([
		preview('video', 'video-track', 10_000, 20_000, 2, 10),
		preview('audio', 'audio-track', 10_000, 20_000, 1_000, 20_000),
	]);
	const videoCalls: FrameCanonicalEdgeTrimRequest[] = [];
	const legacyCalls: unknown[][] = [];
	let legacyDeltaCalls = 0;
	const result = resolveTimelineTrimPointerPreview({
		projectIndex: projectIndex(),
		session,
		edge: 'left',
		requestedBoundarySample: 12_345,
		legacyRequestedDelta: () => { legacyDeltaCalls += 1; return 987; },
		previewVideo: (request) => {
			videoCalls.push(request);
			return plan;
		},
		createLegacyPreview: (...args: unknown[]) => {
			legacyCalls.push(args);
			return legacyPreview();
		},
	});

	assert.deepEqual(videoCalls, [{
		activeClipId: 'audio', edge: 'left', requestedBoundarySample: 12_345,
	}]);
	assert.deepEqual(legacyCalls, []);
	assert.equal(legacyDeltaCalls, 0);
	const adaptedPreviews = plan.previews.map((item) => ({
		...item,
		waveformPreviewKind: 'trim',
	}));
	assert.deepEqual(result, {
		...adaptedPreviews[1],
		previews: adaptedPreviews,
	});
	assert.notEqual((result as { previews?: unknown }).previews, plan.previews);
	assert.ok((result as { previews: readonly Readonly<Record<string, unknown>>[] }).previews
		.every((item) => item.waveformPreviewKind === 'trim'));
	assert.equal(Object.hasOwn(result ?? {}, 'transforms'), false);
	assert.equal(Object.hasOwn(result ?? {}, 'requestedDelta'), false);
});

test('video no-op or refusal does not fall back to the legacy preview helper', () => {
	for (const videoResult of [noopPlan(), null]) {
		const legacyCalls: unknown[][] = [];
		const result = resolveTimelineTrimPointerPreview({
			projectIndex: projectIndex(),
			session: trimSession({ activeKind: 'video' }),
			edge: 'right',
			requestedBoundarySample: 45_000,
			legacyRequestedDelta: () => assert.fail('Canonical trim computed a legacy delta.'),
			previewVideo: () => videoResult,
			createLegacyPreview: (...args: unknown[]) => {
				legacyCalls.push(args);
				return legacyPreview();
			},
		});
		assert.equal(result, null);
		assert.deepEqual(legacyCalls, []);
	}
});

test('audio-only preview preserves the established createClipTrimPreview path', () => {
	const session = trimSession({ activeKind: 'audio' });
	const index = projectIndex();
	const expected = legacyPreview();
	const videoCalls: FrameCanonicalEdgeTrimRequest[] = [];
	const legacyCalls: unknown[][] = [];
	const result = resolveTimelineTrimPointerPreview({
		projectIndex: index,
		session,
		edge: 'right',
		requestedBoundarySample: 31_337,
		legacyRequestedDelta: () => -2_663,
		previewVideo: (request) => {
			videoCalls.push(request);
			return noopPlan();
		},
		createLegacyPreview: (...args: unknown[]) => {
			legacyCalls.push(args);
			return expected;
		},
	});

	assert.deepEqual(videoCalls, []);
	assert.equal(result, expected);
	assert.equal(legacyCalls.length, 1);
	assert.equal(legacyCalls[0]?.[0], index);
	assert.equal(legacyCalls[0]?.[1], session);
	assert.equal(legacyCalls[0]?.[2], -2_663);
	assert.equal(legacyCalls[0]?.[3], 'right');
});

test('Soundscaper mixed-media trim preserves its legacy preview and commit path', () => {
	const session = trimSession({ activeKind: 'audio', linkedVideo: true, edge: 'right' });
	const legacy = legacyPreview();
	const previewResult = resolveTimelineTrimPointerPreview({
		projectIndex: projectIndex(), session, edge: 'right', requestedBoundarySample: 31_337,
		canonicalVideoTrim: false,
		legacyRequestedDelta: () => -2_663,
		previewVideo: () => assert.fail('Soundscaper called the Framescaper planner.'),
		createLegacyPreview: () => legacy,
	});
	assert.equal(previewResult, legacy);

	const audioCalls: unknown[][] = [];
	const commitResult = commitTimelineTrimPointer({
		session, edge: 'right', requestedBoundarySample: 28_000,
		canonicalVideoTrim: false,
		dragPreview: { ...legacy, durationFrames: 18_000 },
		commitVideo: () => assert.fail('Soundscaper called the Framescaper commit path.'),
		commitAudio: (...args: unknown[]) => { audioCalls.push(args); return 'legacy-mixed'; },
	});
	assert.equal(commitResult, 'legacy-mixed');
	assert.deepEqual(audioCalls, [['audio', { durationFrames: 18_000 }]]);
});

test('video finish commits only the final absolute boundary and ignores stale preview transforms and deltas', () => {
	const calls: unknown[][] = [];
	const stalePreview = {
		...preview('audio', 'audio-track', 20_000, 10_000, 5_000, 10_000),
		requestedBoundarySample: 30_000,
		requestedDelta: -18_000,
		transforms: [{ clipId: 'stale', changes: { durationFrames: 1 } }],
	};
	const result = commitTimelineTrimPointer({
		session: trimSession({ activeKind: 'audio', linkedVideo: true }),
		edge: 'right',
		requestedBoundarySample: 37_777,
		dragPreview: stalePreview,
		commitVideo: (...args: unknown[]) => {
			calls.push(args);
			return 'committed-live-plan';
		},
		commitAudio: () => assert.fail('Video-bearing trim must not use clip.trim.'),
	});

	assert.equal(result, 'committed-live-plan');
	assert.deepEqual(calls, [[{
		activeClipId: 'audio', edge: 'right', requestedBoundarySample: 37_777,
	}]]);
	assert.equal(Object.hasOwn(calls[0]?.[0] as object, 'transforms'), false);
	assert.equal(Object.hasOwn(calls[0]?.[0] as object, 'requestedDelta'), false);
});

test('audio-only finish derives the same legacy left and right clip.trim changes', () => {
	const leftCalls: unknown[][] = [];
	const left = commitTimelineTrimPointer({
		session: trimSession({ activeKind: 'audio', edge: 'left' }),
		edge: 'left',
		requestedBoundarySample: 15_000,
		dragPreview: { ...legacyPreview(), timelineStartFrame: 15_000, durationFrames: 15_000 },
		commitVideo: () => assert.fail('Audio-only trim must not use video trim.'),
		commitAudio: (...args: unknown[]) => {
			leftCalls.push(args);
			return 'legacy-left';
		},
	});
	assert.equal(left, 'legacy-left');
	assert.deepEqual(leftCalls, [['audio', {
		timelineStartFrame: 15_000,
		durationFrames: 15_000,
	}]]);

	const rightCalls: unknown[][] = [];
	const right = commitTimelineTrimPointer({
		session: trimSession({ activeKind: 'audio', edge: 'right' }),
		edge: 'right',
		requestedBoundarySample: 28_000,
		dragPreview: { ...legacyPreview(), timelineStartFrame: 10_000, durationFrames: 18_000 },
		commitVideo: () => assert.fail('Audio-only trim must not use video trim.'),
		commitAudio: (...args: unknown[]) => {
			rightCalls.push(args);
			return 'legacy-right';
		},
	});
	assert.equal(right, 'legacy-right');
	assert.deepEqual(rightCalls, [['audio', { durationFrames: 18_000 }]]);
});

function trimSession(options: Readonly<{
	activeKind: 'audio' | 'video';
	linkedVideo?: boolean;
	edge?: 'left' | 'right';
}>) {
	const active = {
		id: options.activeKind === 'video' ? 'video' : 'audio',
		kind: options.activeKind,
		timelineStartFrame: 10_000,
		durationFrames: 20_000,
		sourceStartFrame: options.activeKind === 'video' ? 2 : 1_000,
		sourceDurationFrames: options.activeKind === 'video' ? 10 : 20_000,
	};
	const originals: Record<string, Readonly<Record<string, unknown>>> = { [active.id]: active };
	const clipIds = [active.id];
	if (options.linkedVideo && active.kind !== 'video') {
		originals.video = {
			id: 'video', kind: 'video', timelineStartFrame: 10_000, durationFrames: 20_000,
			sourceStartFrame: 2, sourceDurationFrames: 10,
		};
		clipIds.push('video');
	}
	const edge = options.edge ?? 'left';
	return {
		kind: `trim-${edge}`,
		clipId: active.id,
		clipIds,
		original: active,
		originals,
		startX: 100,
		startY: 20,
		lane: Object.freeze({ id: 'lane' }),
	};
}

function preview(
	clipId: string,
	trackId: string,
	timelineStartFrame: number,
	durationFrames: number,
	sourceStartFrame: number,
	sourceDurationFrames: number,
): FrameCanonicalEdgeTrimPreview {
	return Object.freeze({
		clipId, trackId, timelineStartFrame, durationFrames,
		sourceStartFrame, sourceDurationFrames,
		trimStartFrames: 0, trimEndFrames: 0,
		fadeInFrames: 0, fadeOutFrames: 0,
	});
}

function trimPlan(previews: readonly FrameCanonicalEdgeTrimPreview[]): FrameCanonicalEdgeTrimPlan {
	return Object.freeze({
		kind: 'transform',
		activeClipId: 'audio',
		edge: 'left',
		sequenceId: 'main',
		requestedBoundarySample: 12_345,
		requestedSequenceFrame: 8,
		appliedSequenceFrame: 8,
		sequenceFrameDelta: 1,
		resolvedSampleDelta: 1_600,
		boundarySample: 12_800,
		clamped: false,
		participantClipIds: Object.freeze(previews.map(({ clipId }) => clipId)),
		transforms: Object.freeze(previews.map(({ clipId, trackId }) => Object.freeze({
			clipId, trackId, changes: Object.freeze({ durationFrames: 1 }),
		}))),
		previews: Object.freeze([...previews]),
	});
}

function noopPlan(): FrameCanonicalEdgeTrimPlan {
	return Object.freeze({
		kind: 'noop',
		activeClipId: 'video',
		edge: 'right',
		sequenceId: 'main',
		requestedBoundarySample: 45_000,
		requestedSequenceFrame: 30,
		appliedSequenceFrame: 30,
		sequenceFrameDelta: 0,
		resolvedSampleDelta: 0,
		boundarySample: 48_000,
		clamped: true,
		participantClipIds: Object.freeze(['video']),
		transforms: [] as const,
		previews: [] as const,
	});
}

function legacyPreview() {
	return {
		clipId: 'audio',
		trackId: 'audio-track',
		waveformPreviewKind: 'trim',
		timelineStartFrame: 10_000,
		durationFrames: 20_000,
		sourceStartFrame: 1_000,
		sourceDurationFrames: 20_000,
		previews: [],
	};
}

function projectIndex() {
	return {
		sourceById: new Map([['audio-source', { id: 'audio-source', frameCount: 100_000 }]]),
		trackByClipId: new Map([['audio', { id: 'audio-track' }]]),
	};
}
