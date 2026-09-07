/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleClipGain } from '../src/common/editor/engine/clip-gain.ts';
import type { EngineClip } from '../src/common/editor/engine/types.ts';

type ParamCall = readonly ['set' | 'linear', number, number];

class MockParam {
	value = 1;
	readonly calls: ParamCall[] = [];

	setValueAtTime(value: number, time: number): AudioParam {
		this.value = value;
		this.calls.push(['set', value, time]);
		return this.param;
	}

	linearRampToValueAtTime(value: number, time: number): AudioParam {
		this.value = value;
		this.calls.push(['linear', value, time]);
		return this.param;
	}

	get param(): AudioParam { return this as unknown as AudioParam; }
}

// Replays the recorded automation the way an AudioParam would: a `set` holds
// its value until the next event, a `linear` ramps to it from the previous one.
function scheduledValueAt(calls: readonly ParamCall[], time: number): number {
	assert.ok(calls.length > 0, 'no automation was scheduled');
	let previous = calls[0] as ParamCall;
	if (time <= previous[2]) return previous[1];
	for (const call of calls.slice(1)) {
		const [kind, value, at] = call;
		if (time > at) {
			previous = call;
			continue;
		}
		if (kind === 'set') return previous[1];
		const span = at - previous[2];
		if (span <= 0) return value;
		return previous[1] + ((value - previous[1]) * (time - previous[2]) / span);
	}
	return previous[1];
}

function clip(fields: Partial<EngineClip> = {}): EngineClip {
	return { id: 'clip', sourceId: 'source', durationFrames: 30, ...fields };
}

test('a crossfade-out contained in a clip returns to unity right after the overlap', () => {
	const fadeIn = new MockParam();
	const fadeOut = new MockParam();
	const clipGain = new MockParam();

	scheduleClipGain(
		fadeIn.param, fadeOut.param, clipGain.param,
		clip(), 0, 30, 30, 0, 1,
		{ crossfadeOutRanges: [[5, 15]] },
	);

	assert.equal(scheduledValueAt(fadeOut.calls, 0), 1);
	assert.equal(scheduledValueAt(fadeOut.calls, 5), 1);
	assert.ok(Math.abs(scheduledValueAt(fadeOut.calls, 10) - 0.5) < 1e-9, 'the overlap should fade out');
	assert.equal(scheduledValueAt(fadeOut.calls, 15), 0);
	for (const frame of [16, 17, 20, 25, 29, 30]) {
		assert.ok(
			scheduledValueAt(fadeOut.calls, frame) >= 0.99,
			`frame ${frame} should play at unity gain, got ${scheduledValueAt(fadeOut.calls, frame)}`,
		);
	}
});

test('a crossfade-out running to the clip end still fades to silence at the end', () => {
	const fadeIn = new MockParam();
	const fadeOut = new MockParam();
	const clipGain = new MockParam();

	scheduleClipGain(
		fadeIn.param, fadeOut.param, clipGain.param,
		clip(), 0, 30, 30, 0, 1,
		{ crossfadeOutRanges: [[15, 30]] },
	);

	assert.equal(scheduledValueAt(fadeOut.calls, 15), 1);
	assert.ok(Math.abs(scheduledValueAt(fadeOut.calls, 22.5) - 0.5) < 1e-9, 'the tail should fade out');
	assert.equal(scheduledValueAt(fadeOut.calls, 30), 0);
	assert.ok(
		fadeOut.calls.every(([, , at]) => at <= 30),
		'no automation should be scheduled past the clip end',
	);
});

test('two contained crossfade-outs each restore unity gain between them', () => {
	const fadeIn = new MockParam();
	const fadeOut = new MockParam();
	const clipGain = new MockParam();

	scheduleClipGain(
		fadeIn.param, fadeOut.param, clipGain.param,
		clip({ durationFrames: 40 }), 0, 40, 40, 0, 1,
		{ crossfadeOutRanges: [[5, 10], [25, 30]] },
	);

	assert.equal(scheduledValueAt(fadeOut.calls, 10), 0);
	assert.ok(scheduledValueAt(fadeOut.calls, 11) >= 0.99, 'the gap should play at unity gain');
	assert.ok(scheduledValueAt(fadeOut.calls, 20) >= 0.99, 'the gap should play at unity gain');
	assert.equal(scheduledValueAt(fadeOut.calls, 25), 1);
	assert.equal(scheduledValueAt(fadeOut.calls, 30), 0);
	assert.ok(scheduledValueAt(fadeOut.calls, 35) >= 0.99, 'the tail should play at unity gain');
});

test('an explicit fade-out still applies over a contained crossfade-out', () => {
	const fadeIn = new MockParam();
	const fadeOut = new MockParam();
	const clipGain = new MockParam();

	scheduleClipGain(
		fadeIn.param, fadeOut.param, clipGain.param,
		clip({ fadeOutFrames: 10 }), 0, 30, 30, 0, 1,
		{ crossfadeOutRanges: [[5, 15]] },
	);

	assert.equal(scheduledValueAt(fadeOut.calls, 15), 0);
	assert.ok(Math.abs(scheduledValueAt(fadeOut.calls, 16) - 1) < 1e-9, 'unity resumes after the overlap');
	assert.ok(Math.abs(scheduledValueAt(fadeOut.calls, 25) - 0.5) < 1e-9, 'the explicit fade-out survives');
	assert.equal(scheduledValueAt(fadeOut.calls, 30), 0);
});
