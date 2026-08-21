/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyFramescaperWebVcrTargetObservationV1,
	transitionFramescaperWebVcrCaptureStateV1,
} from '../desktop/framescaper-web-vcr-runtime-capture-state.ts';
import type { FramescaperWebVcrRuntimeSessionV1 } from '../desktop/framescaper-web-vcr-runtime-support.ts';
import { referenceFor, runtime } from './desktop-framescaper-web-vcr-runtime-fixture.ts';

const TOKEN = 'e'.repeat(32);
const OWNER = Object.freeze(Object.create(null)) as object;

test('an ended event fenced before CDP acknowledgement rejects preparation without becoming stale', async () => {
	let acknowledge!: () => void;
	const calls: Array<string | null> = [];
	const target = Object.freeze({
		targetId: 'a'.repeat(32), generation: 1, mediaState: 'playing' as const,
		aperture: { x: 0, y: 0, width: 1, height: 1 },
		intrinsicSize: { width: 1920, height: 1080 },
	});
	const state = {
		captureState: 'ready', captureTransitionPending: false, captureTransitionInvalidated: false,
		activeRecordingToken: null, targetEndedRecordingToken: null,
		target, navigation: { generation: 1, isLoading: false },
		window: { isDestroyed: () => false },
		observer: {
			setRecordingToken: async (value: string | null) => {
				calls.push(value);
				if (value !== null) await new Promise<void>((resolve) => { acknowledge = resolve; });
			},
		},
	} as unknown as FramescaperWebVcrRuntimeSessionV1;
	const preparing = transitionFramescaperWebVcrCaptureStateV1(state, {
		version: 1, sessionId: 'b'.repeat(32), generation: 1,
		state: 'preparing', recordingToken: TOKEN,
	}, () => true);
	await Promise.resolve();
	assert.equal(state.activeRecordingToken, TOKEN, 'host stages the token before awaiting isolated-world ack');
	assert.equal(applyFramescaperWebVcrTargetObservationV1(state, {
		navigationGeneration: 1,
		selection: { kind: 'manual', reason: 'no-playing-video' },
		targets: [{ targetId: target.targetId, generation: 1, mediaState: 'ended' }],
		endedTarget: { targetId: target.targetId, generation: 1, endedRecordingToken: null },
	}), 'ignored', 'an event queued before the recording token was installed stays stale');
	assert.equal(state.target?.mediaState, 'playing');
	assert.equal(applyFramescaperWebVcrTargetObservationV1(state, {
		navigationGeneration: 1,
		selection: { kind: 'manual', reason: 'no-playing-video' },
		targets: [{ targetId: target.targetId, generation: 1, mediaState: 'ended' }],
		endedTarget: { targetId: target.targetId, generation: 1, endedRecordingToken: TOKEN },
	}), 'changed');
	acknowledge();
	assert.equal(await preparing, false);
	assert.equal(state.captureState, 'ready');
	assert.equal(state.activeRecordingToken, null);
	assert.equal(state.target?.mediaState, 'ended');
	assert.deepEqual(calls, [TOKEN, null]);
});

test('a recording-fence failure terminalizes the coherent ready host and permits a fresh retry', async () => {
	const harness = runtime({ fenceFailure: true });
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	assert.equal(await harness.value.setCaptureState(OWNER, {
		...referenceFor(opened), state: 'preparing', recordingToken: TOKEN,
	}), false);
	assert.equal(harness.snapshots.at(-1)?.phase, 'failed');
	assert.equal(harness.windows[0]?.destroyed, true);
	const retried = await harness.value.open(OWNER, { resolution: '1080p' });
	assert.equal(retried.phase, 'ready');
	assert.equal(retried.generation, opened.generation + 1);
});

test('pending preparation locks browser mutation and navigation invalidates without host recovery', async () => {
	const harness = runtime({ deferFence: true });
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	const preparing = harness.value.setCaptureState(OWNER, {
		...reference, state: 'preparing', recordingToken: TOKEN,
	});
	await Promise.resolve();
	assert.equal(harness.windows[0]?.openWindow('https://login.example.com/').action, 'deny');
	await assert.rejects(() => harness.value.dispatch(OWNER, {
		...reference, kind: 'pointer-input', action: 'move', x: 0.5, y: 0.5,
		button: 'none', deltaX: 0, deltaY: 0, modifiers: [],
	}), /locked|capture/iu);
	await assert.rejects(() => harness.value.open(OWNER, { resolution: '1080p' }), /pending|capture/iu);
	let prevented = false;
	harness.windows[0]?.emitContent('will-navigate', {
		preventDefault: () => { prevented = true; },
	}, 'https://example.com/replacement');
	assert.equal(prevented, true);
	harness.resolveFence();
	assert.equal(await preparing, false);
	assert.equal(harness.snapshots.at(-1)?.phase, 'ready');
	assert.equal(harness.windows[0]?.destroyed, false);
});
