/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoRateStretchResultReporter,
	type VideoRateStretchFeedbackCopy,
} from '../src/common/editor/controller/video-rate-stretch-feedback.ts';

const COPY: VideoRateStretchFeedbackCopy = Object.freeze({
	rateStretchLeftEdgeApplied: 'LEFT {rate} {timecode}',
	rateStretchRightEdgeApplied: 'RIGHT {rate} {timecode}',
	rateStretchBoundaryClamped: '(clamped)',
	noRateStretchAvailable: 'No rate stretch available',
});

type RateStretchReporter = ReturnType<typeof createVideoRateStretchResultReporter>;
type RateStretchPlan = Parameters<RateStretchReporter>[0];

test('both edges report the derived rate and exact conformed program timecode', () => {
	for (const row of [
		{ edge: 'left' as const, rate: 2 / 3, expected: 'LEFT 0.67 TC:8000' },
		{ edge: 'right' as const, rate: 1.5, expected: 'RIGHT 1.5 TC:50000' },
	]) {
		const labels: unknown[][] = [];
		const statuses: unknown[][] = [];
		const report = createVideoRateStretchResultReporter({
			copy: COPY,
			label: (sample: number, sequenceId?: string) => {
				labels.push([sample, sequenceId]);
				return `TC:${String(sample)}`;
			},
			setStatus: (...args: [string, 'info' | 'success']) => statuses.push(args),
		});
		const boundarySample = row.edge === 'left' ? 8_000 : 50_000;

		report(plan({
			edge: row.edge,
			boundarySample,
			authorityPlaybackRate: row.rate,
		}));

		assert.deepEqual(labels, [[boundarySample, 'sequence-main']]);
		assert.deepEqual(statuses, [[row.expected, 'success']]);
	}
});

test('clamped feedback appends its localized outcome exactly once', () => {
	const statuses: unknown[][] = [];
	const report = createVideoRateStretchResultReporter({
		copy: COPY,
		label: () => '01:00:10:00',
		setStatus: (...args: [string, 'info' | 'success']) => statuses.push(args),
	});

	report(plan({ edge: 'right', authorityPlaybackRate: 1 / 16, clamped: true }));

	assert.deepEqual(statuses, [[
		'RIGHT 0.06 01:00:10:00 (clamped)', 'success',
	]]);
});

test('no-op is a distinct informational outcome and formats no unavailable values', () => {
	const statuses: unknown[][] = [];
	const report = createVideoRateStretchResultReporter({
		copy: COPY,
		label: () => assert.fail('No-op feedback has no program coordinate to format.'),
		setStatus: (...args: [string, 'info' | 'success']) => statuses.push(args),
	});

	report(plan({ kind: 'noop', edge: 'left' }));
	report(plan({ kind: 'noop', edge: 'right', clamped: true }));

	assert.deepEqual(statuses, [
		['No rate stretch available', 'info'],
		['No rate stretch available', 'info'],
	]);
});

function plan(overrides: Readonly<{
	kind?: 'noop' | 'transform';
	edge?: 'left' | 'right';
	boundarySample?: number;
	authorityPlaybackRate?: number;
	clamped?: boolean;
}> = {}): RateStretchPlan {
	const kind = overrides.kind ?? 'transform';
	return Object.freeze({
		kind,
		edge: overrides.edge ?? 'right',
		activeClipId: 'video',
		authorityClipId: 'video',
		authoritySourceId: 'video-source',
		authoritySequenceId: 'sequence-main',
		requestedBoundarySample: 50_000,
		requestedSequenceFrame: 25,
		appliedSequenceFrame: 25,
		boundarySample: overrides.boundarySample ?? 50_000,
		sequenceFrameDelta: 5,
		durationScale: Object.freeze({ num: 3, den: 2 }),
		authorityPlaybackRate: overrides.authorityPlaybackRate ?? 2 / 3,
		clamped: overrides.clamped ?? false,
		participantClipIds: Object.freeze(['video']),
		transforms: kind === 'noop' ? Object.freeze([]) : Object.freeze([Object.freeze({
			clipId: 'video', trackId: 'video-track', changes: Object.freeze({}),
		})]),
		previews: kind === 'noop' ? Object.freeze([]) : Object.freeze([Object.freeze({
			clipId: 'video', trackId: 'video-track', timelineStartFrame: 20_000,
			durationFrames: 30_000, sourceStartFrame: 100, sourceDurationFrames: 10,
			trimStartFrames: 0, trimEndFrames: 0, fadeInFrames: 0, fadeOutFrames: 0,
		})]),
	}) as unknown as RateStretchPlan;
}
