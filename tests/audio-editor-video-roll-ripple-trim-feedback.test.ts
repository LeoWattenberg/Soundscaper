/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoRollRippleTrimResultReporter,
	type VideoRollRippleTrimFeedbackCopy,
} from '../src/common/editor/controller/video-roll-ripple-trim-feedback.ts';
import type { FrameCanonicalRollRippleTrimPlan } from '../src/common/editor/frame-canonical-roll-ripple-trim-domain.ts';
import { SEQUENCE_TIMING_COPY_BY_LOCALE } from '../src/common/i18n/sequence-timing-copy.js';

const COPY: VideoRollRippleTrimFeedbackCopy = Object.freeze({
	rollLeftEdgeApplied: 'ROLL-LEFT {frames} {sourceTimecode} {programTimecode}',
	rollRightEdgeApplied: 'ROLL-RIGHT {frames} {sourceTimecode} {programTimecode}',
	rippleLeftEdgeApplied: 'RIPPLE-LEFT {frames} {sourceTimecode} {programTimecode}',
	rippleRightEdgeApplied: 'RIPPLE-RIGHT {frames} {sourceTimecode} {programTimecode}',
	trimBoundaryClamped: '(clamped)',
	noTrimAvailable: 'No trim available',
});

test('localized mode and edge templates receive actual signed frames and both resolved timecodes', () => {
	for (const row of [
		{ mode: 'roll', edge: 'left', prefix: 'ROLL-LEFT' },
		{ mode: 'roll', edge: 'right', prefix: 'ROLL-RIGHT' },
		{ mode: 'ripple', edge: 'left', prefix: 'RIPPLE-LEFT' },
		{ mode: 'ripple', edge: 'right', prefix: 'RIPPLE-RIGHT' },
	] as const) {
		const labels: unknown[][] = [];
		const statuses: unknown[][] = [];
		const report = createVideoRollRippleTrimResultReporter({
			copy: COPY,
			label: (sample, sequenceId) => {
				labels.push([sample, sequenceId]);
				return sample === 12_000 ? '01:00:00:06' : '01:00:00:15';
			},
			setStatus: (...args) => statuses.push(args),
		});

		report(transformPlan({ mode: row.mode, edge: row.edge, sequenceFrameDelta: 3 }));

		assert.deepEqual(labels, [
			[12_000, 'sequence-main'],
			[30_000, 'sequence-main'],
		], `${row.mode}:${row.edge}`);
		assert.deepEqual(statuses, [[
			`${row.prefix} +3 01:00:00:06 01:00:00:15`, 'success',
		]], `${row.mode}:${row.edge}`);
	}
});

test('negative applied frames retain their sign and a clamp marker is appended once', () => {
	const statuses: unknown[][] = [];
	const report = createVideoRollRippleTrimResultReporter({
		copy: COPY,
		label: (sample) => sample === 12_000 ? 'source' : 'program',
		setStatus: (...args) => statuses.push(args),
	});

	report(transformPlan({
		mode: 'ripple', edge: 'left', sequenceFrameDelta: -2, clamped: true,
	}));

	assert.deepEqual(statuses, [[
		'RIPPLE-LEFT -2 source program (clamped)', 'success',
	]]);
});

test('no-op uses existing informational copy without formatting unavailable coordinates', () => {
	const statuses: unknown[][] = [];
	const report = createVideoRollRippleTrimResultReporter({
		copy: COPY,
		label: () => assert.fail('A no-op has no applied coordinates to format.'),
		setStatus: (...args) => statuses.push(args),
	});

	report(noopPlan());

	assert.deepEqual(statuses, [['No trim available', 'info']]);
});

test('English and German copy expose all four menu labels and complete feedback placeholders', () => {
	for (const locale of ['en', 'de'] as const) {
		const copy = SEQUENCE_TIMING_COPY_BY_LOCALE[locale];
		for (const key of [
			'rollLeftToPlayhead',
			'rollRightToPlayhead',
			'rippleLeftToPlayhead',
			'rippleRightToPlayhead',
		] as const) assert.ok(copy[key].length > 0, `${locale}:${key}`);
		for (const key of [
			'rollLeftEdgeApplied',
			'rollRightEdgeApplied',
			'rippleLeftEdgeApplied',
			'rippleRightEdgeApplied',
		] as const) {
			assert.match(copy[key], /\{frames\}/u, `${locale}:${key}:frames`);
			assert.match(copy[key], /\{sourceTimecode\}/u, `${locale}:${key}:source`);
			assert.match(copy[key], /\{programTimecode\}/u, `${locale}:${key}:program`);
		}
	}
});

function transformPlan(overrides: Readonly<{
	mode: 'roll' | 'ripple';
	edge: 'left' | 'right';
	sequenceFrameDelta: number;
	clamped?: boolean;
}>): FrameCanonicalRollRippleTrimPlan {
	return Object.freeze({
		...diagnostics(overrides),
		kind: 'transform',
		transforms: Object.freeze([Object.freeze({
			clipId: 'video', trackId: 'video-track', changes: Object.freeze({ durationFrames: 20_000 }),
		})]),
		previews: Object.freeze([Object.freeze({
			clipId: 'video', trackId: 'video-track', changeKind: 'source-trim' as const,
			timelineStartFrame: 10_000, durationFrames: 20_000,
			sourceStartFrame: 1_000, sourceDurationFrames: 20_000,
			trimStartFrames: 0, trimEndFrames: 0,
			fadeInFrames: 0, fadeOutFrames: 0,
		})]),
	});
}

function noopPlan(): FrameCanonicalRollRippleTrimPlan {
	return Object.freeze({
		...diagnostics({
			mode: 'ripple', edge: 'right', sequenceFrameDelta: 0, clamped: false,
		}),
		kind: 'noop', transforms: [] as const, previews: [] as const,
	});
}

function diagnostics(input: Readonly<{
	mode: 'roll' | 'ripple';
	edge: 'left' | 'right';
	sequenceFrameDelta: number;
	clamped?: boolean;
}>) {
	return {
		mode: input.mode,
		activeClipId: 'video',
		edge: input.edge,
		sequenceId: 'sequence-main',
		sequenceRate: Object.freeze({ num: 24, den: 1 }),
		requestedBoundarySample: 12_345,
		requestedSequenceFrame: 6,
		appliedSequenceFrame: 6,
		sequenceFrameDelta: input.sequenceFrameDelta,
		programFrameDelta: input.mode === 'roll' ? 0 : input.sequenceFrameDelta,
		resolvedProgramSampleDelta: 2_000,
		resolvedSourceCutSample: 12_000,
		programEditSample: 30_000,
		clamped: input.clamped ?? false,
		edgeClipIds: Object.freeze(['video']),
		neighborClipIds: Object.freeze<string[]>([]),
		shiftedClipIds: Object.freeze<string[]>([]),
	};
}
