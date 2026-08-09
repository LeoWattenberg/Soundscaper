/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	acquireVideoTimingIndex,
	mapVideoTimelineFrameToSource,
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';

const source = Object.freeze({
	id: 'lease-video',
	contentSha256: '11'.repeat(32),
});
const clip = Object.freeze({
	id: 'lease-clip',
	kind: 'video',
	sourceId: source.id,
	timelineStartFrame: 0,
	durationFrames: 1_000,
	sourceStartFrame: 0,
	sourceDurationFrames: 3,
	sourceInFrame: 0,
	sourceFrameCount: 3,
});

test('timing leases restore preview state and skip released overlapping registrations', () => {
	registerVideoTimingIndex(source, timing([0n, 100n, 300n], 500n));
	const first = acquireVideoTimingIndex(source, timing([0n, 250n, 400n], 600n));
	const second = acquireVideoTimingIndex(source, timing([0n, 50n, 200n], 400n));
	try {
		assert.equal(mappedSourceFrame(), 2);
		assert.equal(first.release(), false, 'an obscured lease cannot overwrite the current owner');
		assert.equal(mappedSourceFrame(), 2);
		assert.equal(second.release(), true);
		assert.equal(mappedSourceFrame(), 1.75, 'release skips the already-released predecessor');
	} finally {
		first.release();
		second.release();
		unregisterVideoTimingIndex(source);
	}
});

test('a preview registration made during export survives the export lease release', () => {
	const lease = acquireVideoTimingIndex(source, timing([0n, 250n, 400n], 600n));
	try {
		registerVideoTimingIndex(source, timing([0n, 50n, 200n], 400n));
		assert.equal(lease.release(), false);
		assert.equal(mappedSourceFrame(), 2);
	} finally {
		lease.release();
		unregisterVideoTimingIndex(source);
	}
});

function mappedSourceFrame(): number {
	return mapVideoTimelineFrameToSource(clip, 500, { source }).sourceFrame;
}

function timing(
	presentationTicks: readonly bigint[],
	endTicks: bigint,
) {
	return Object.freeze({
		encoding: 'soundscaper-video-timing-v1',
		timescale: 1_000,
		frameCount: presentationTicks.length,
		presentationTicks: Object.freeze([...presentationTicks]),
		finalFrameDurationTicks: endTicks - presentationTicks.at(-1)!,
		endTicks,
	});
}
