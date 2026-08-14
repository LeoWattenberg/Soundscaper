/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	calculateAudioEditorMetronomeSchedule,
} from '../src/common/editor/controller/transport-model.ts';
import {
	createEditorTransportService,
	type TransportServiceRuntime,
} from '../src/common/editor/controller/transport-service.ts';

const SAMPLE_RATE = 48_000;
const BPM = 120;
const BEAT_SECONDS = 60 / BPM;
const RUN_SECONDS = 12;

interface PendingTimer {
	readonly callback: () => void;
	readonly dueAt: number;
}

interface MetronomeRun {
	readonly jitterSeconds: number;
	readonly stallEvery: number;
	readonly stallSeconds: number;
}

/**
 * The metronome must take its rhythm from the audio clock, not from the timer that decides
 * when to look ahead. Driving it with a deliberately bad timer is the only way to see the
 * difference: with an accurate timer even a drifting scheduler looks correct.
 */
test('the metronome keeps an exact pulse under a jittery, stalling timer', async () => {
	const clicks = await runMetronome({ jitterSeconds: 0.03, stallEvery: 7, stallSeconds: 0.06 });

	// Every pulse of the run, once each, exactly one beat apart. Re-deriving the next pulse
	// from the live playhead on every wake-up dropped one whenever the timer ran late and
	// repeated one whenever it ran early, so both the count and the spacing followed the
	// jitter instead of the tempo.
	assert.deepEqual(clicks, expectedPulses(clicks.length));
	assert.ok(clicks.length >= Math.floor(RUN_SECONDS / BEAT_SECONDS) - 1, `only ${String(clicks.length)} clicks`);
	assert.equal(new Set(clicks).size, clicks.length, 'no pulse is scheduled twice');
});

test('timer jitter cannot change the pulse train at all', async () => {
	const steady = await runMetronome({ jitterSeconds: 0, stallEvery: 0, stallSeconds: 0 });
	const jittery = await runMetronome({ jitterSeconds: 0.03, stallEvery: 5, stallSeconds: 0.06 });
	assert.deepEqual(jittery, steady);
});

test('a stall longer than the lookahead drops pulses rather than firing them late', async () => {
	// A pulse whose audio-clock time has already passed cannot be sounded on the beat, and
	// sounding it late would be worse than silence. What must not happen is drift: whatever
	// survives still lands exactly on the tempo grid, and nothing is doubled.
	const clicks = await runMetronome({ jitterSeconds: 0, stallEvery: 4, stallSeconds: 0.5 });
	for (const click of clicks) {
		const beat = click / BEAT_SECONDS;
		assert.ok(Math.abs(beat - Math.round(beat)) < 0.002, `click at ${click.toFixed(4)}s is off the grid`);
	}
	assert.equal(new Set(clicks).size, clicks.length, 'no pulse is scheduled twice');
	assert.ok(clicks.length > 0, 'the metronome keeps running through the stalls');
});

function expectedPulses(count: number): readonly number[] {
	return Array.from({ length: count }, (_, index) => Number((index * BEAT_SECONDS).toFixed(9)));
}

async function runMetronome(options: MetronomeRun): Promise<readonly number[]> {
	const clicks: number[] = [];
	let clock = 0;
	// A holder, not a bare local: the timer is only ever assigned inside the stub below,
	// which the compiler cannot see, so a plain variable narrows to null and then to never.
	const timer: { current: PendingTimer | null } = { current: null };
	let wakeups = 0;
	let seed = 1;
	// A deterministic wobble: the point is a timer that never fires when it was asked to.
	const jitter = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return ((seed / 2_147_483_648) - 0.5) * 2 * options.jitterSeconds;
	};

	const context = {
		get currentTime() { return clock; },
		destination: {},
		createOscillator: () => ({
			frequency: { setValueAtTime: () => undefined },
			connect: () => undefined,
			disconnect: () => undefined,
			start: (when: number) => { clicks.push(Number(when.toFixed(9))); },
			stop: () => undefined,
			set onended(_callback: (() => void) | null) { /* nothing to release in the harness */ },
		}),
		createGain: () => ({
			gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
			connect: () => undefined,
			disconnect: () => undefined,
		}),
	};

	const project = {
		sampleRate: SAMPLE_RATE,
		tempo: { bpm: BPM, timeSignature: { numerator: 4, denominator: 4 } },
		selection: null,
		loop: null,
	};
	const state: Record<string, unknown> = {
		metronomeEnabled: true,
		metronomeTimer: 0,
		metronomeAnchor: null,
		metronomePending: [],
		transportState: 'playing',
		disposed: false,
	};
	const runtime: TransportServiceRuntime = {
		AUDIO_EDITOR_SAMPLE_RATE: SAMPLE_RATE,
		calculateAudioEditorMetronomeSchedule,
		getProject: () => project,
		state,
		persistSetting: async () => undefined,
		productSettingKey: (name: string) => name,
		publishDocumentSnapshot: () => undefined,
		copy: {},
		engine: {
			getState: () => ({ playbackRate: 1 }),
			// The playhead advances with the audio clock, exactly as during playback.
			getPositionFrames: () => Math.round(clock * SAMPLE_RATE),
			getAudioContext: async () => context,
		},
	};

	const realSetTimeout = globalThis.setTimeout;
	const realClearTimeout = globalThis.clearTimeout;
	globalThis.setTimeout = ((callback: () => void, delayMs: number) => {
		wakeups += 1;
		const stall = options.stallEvery > 0 && wakeups % options.stallEvery === 0 ? options.stallSeconds : 0;
		timer.current = { callback, dueAt: clock + Math.max(0, delayMs / 1000 + jitter() + stall) };
		return 1 as unknown as ReturnType<typeof setTimeout>;
	}) as typeof globalThis.setTimeout;
	globalThis.clearTimeout = (() => { timer.current = null; }) as typeof globalThis.clearTimeout;

	try {
		const service = createEditorTransportService(runtime);
		service.syncMetronome();
		await settle();
		for (;;) {
			const next = timer.current;
			if (!next || next.dueAt >= RUN_SECONDS) break;
			timer.current = null;
			clock = next.dueAt;
			next.callback();
			await settle();
		}
	} finally {
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
	}
	return Object.freeze(clicks.filter((click) => click < RUN_SECONDS));
}

/** Let the scheduler's awaited audio-context lookup resolve before advancing the clock. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}
