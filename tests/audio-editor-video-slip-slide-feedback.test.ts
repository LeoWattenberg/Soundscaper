/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoSlipSlideResultReporter,
	type VideoSlipSlideFeedbackCopy,
} from '../src/common/editor/controller/video-slip-slide-feedback.ts';
import type { FrameCanonicalSlipSlidePlan } from '../src/common/editor/frame-canonical-slip-slide-domain.ts';

const COPY: VideoSlipSlideFeedbackCopy = Object.freeze({
	slipApplied: 'SLIP {frames} {sourceTimecode}',
	slideApplied: 'SLIDE {frames} {programStartTimecode} {programEndTimecode}',
	trimBoundaryClamped: '(clamped)',
	noTrimAvailable: 'No trim available',
});

test('slip feedback reports signed applied source frames and resulting source timecode', () => {
	for (const row of [
		{ sourceFrameDelta: 3, expectedFrames: '+3' },
		{ sourceFrameDelta: -2, expectedFrames: '-2' },
	] as const) {
		const sourceLabels: unknown[][] = [];
		const statuses: unknown[][] = [];
		const report = createVideoSlipSlideResultReporter({
			copy: COPY,
			sourceLabel: (sourceId, sourceFrame) => {
				sourceLabels.push([sourceId, sourceFrame]);
				return '10:00:00:12';
			},
			programLabel: () => assert.fail('Slip feedback does not format program timecode.'),
			setStatus: (...args) => statuses.push(args),
		});

		report(slipPlan({ sourceFrameDelta: row.sourceFrameDelta }));

		assert.deepEqual(sourceLabels, [['source-main', 42]]);
		assert.deepEqual(statuses, [[`SLIP ${row.expectedFrames} 10:00:00:12`, 'success']]);
	}
});

test('slide feedback reports signed applied sequence frames and resulting center endpoints', () => {
	const programLabels: unknown[][] = [];
	const statuses: unknown[][] = [];
	const report = createVideoSlipSlideResultReporter({
		copy: COPY,
		sourceLabel: () => assert.fail('Slide feedback does not format source timecode.'),
		programLabel: (sample, sequenceId) => {
			programLabels.push([sample, sequenceId]);
			return sample === 24_000 ? '01:00:00:12' : '01:00:00:16';
		},
		setStatus: (...args) => statuses.push(args),
	});

	report(slidePlan({ sequenceFrameDelta: -4 }));

	assert.deepEqual(programLabels, [
		[24_000, 'sequence-main'],
		[32_000, 'sequence-main'],
	]);
	assert.deepEqual(statuses, [[
		'SLIDE -4 01:00:00:12 01:00:00:16', 'success',
	]]);
});

test('a clamp marker is appended once to either changed mode', () => {
	const statuses: unknown[][] = [];
	const report = createVideoSlipSlideResultReporter({
		copy: COPY,
		sourceLabel: () => 'source',
		programLabel: (sample) => sample === 24_000 ? 'start' : 'end',
		setStatus: (...args) => statuses.push(args),
	});

	report(slipPlan({ sourceFrameDelta: 1, clamped: true }));
	report(slidePlan({ sequenceFrameDelta: 2, clamped: true }));

	assert.deepEqual(statuses, [
		['SLIP +1 source (clamped)', 'success'],
		['SLIDE +2 start end (clamped)', 'success'],
	]);
});

test('no-op is informational and never formats unavailable coordinates', () => {
	const statuses: unknown[][] = [];
	const report = createVideoSlipSlideResultReporter({
		copy: COPY,
		sourceLabel: () => assert.fail('No-op feedback has no source coordinate.'),
		programLabel: () => assert.fail('No-op feedback has no program coordinate.'),
		setStatus: (...args) => statuses.push(args),
	});

	report(slipPlan({ kind: 'noop', sourceFrameDelta: 0 }));
	report(slidePlan({ kind: 'noop', sequenceFrameDelta: 0 }));

	assert.deepEqual(statuses, [
		['No trim available', 'info'],
		['No trim available', 'info'],
	]);
});

function slipPlan(overrides: Readonly<{
	kind?: 'noop' | 'transform';
	sourceFrameDelta: number;
	clamped?: boolean;
}>): FrameCanonicalSlipSlidePlan {
	return plan({
		mode: 'slip',
		requestedSourceInFrame: 43,
		appliedSourceInFrame: 42,
		sourceFrameDelta: overrides.sourceFrameDelta,
		clamped: overrides.clamped ?? false,
		kind: overrides.kind ?? 'transform',
	});
}

function slidePlan(overrides: Readonly<{
	kind?: 'noop' | 'transform';
	sequenceFrameDelta: number;
	clamped?: boolean;
}>): FrameCanonicalSlipSlidePlan {
	return plan({
		mode: 'slide',
		requestedStartSample: 23_999,
		requestedSequenceStartFrame: 12,
		appliedSequenceStartFrame: 12,
		appliedStartSample: 24_000,
		appliedEndSample: 32_000,
		sequenceFrameDelta: overrides.sequenceFrameDelta,
		clamped: overrides.clamped ?? false,
		kind: overrides.kind ?? 'transform',
	});
}

function plan(overrides: Readonly<Record<string, unknown>>): FrameCanonicalSlipSlidePlan {
	const kind = overrides.kind === 'noop' ? 'noop' : 'transform';
	return Object.freeze({
		...overrides,
		kind,
		activeClipId: 'center-video',
		authorityClipId: 'center-video',
		authoritySourceId: 'source-main',
		authoritySequenceId: 'sequence-main',
		participantClipIds: Object.freeze(['center-video']),
		leftClipIds: Object.freeze<string[]>([]),
		centerClipIds: Object.freeze(['center-video']),
		rightClipIds: Object.freeze<string[]>([]),
		sourceRanges: Object.freeze([Object.freeze({
			clipId: 'center-video', sourceStartFrame: 42, sourceEndFrame: 46,
		})]),
		transforms: kind === 'noop' ? [] as const : Object.freeze([Object.freeze({
			clipId: 'center-video', trackId: 'video-track', changes: Object.freeze({}),
		})]),
		previews: kind === 'noop' ? [] as const : Object.freeze([Object.freeze({
			clipId: 'center-video', trackId: 'video-track', changeKind: 'source-slip' as const,
			timelineStartFrame: 24_000, durationFrames: 8_000,
			sourceStartFrame: 42, sourceDurationFrames: 4,
			trimStartFrames: 0, trimEndFrames: 0,
			fadeInFrames: 0, fadeOutFrames: 0,
		})]),
	}) as unknown as FrameCanonicalSlipSlidePlan;
}
