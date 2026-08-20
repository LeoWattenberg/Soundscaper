/* SPDX-License-Identifier: AGPL-3.0-only */

export interface CapturePauseSpan {
	readonly startedAtMs: number;
	readonly endedAtMs: number;
	readonly durationMs: number;
}

export interface CaptureActiveTimeSnapshot {
	readonly startedAtMs: number;
	readonly observedAtMs: number;
	readonly stoppedAtMs: number | null;
	readonly wallTimeMs: number;
	readonly pausedTimeMs: number;
	readonly activeTimeMs: number;
	readonly activeTimeUs: number;
	readonly paused: boolean;
	readonly pauseSpans: readonly Readonly<CapturePauseSpan>[];
}

export interface FramescaperCaptureActiveTimeClock {
	readonly snapshot: (observedAtMs: number) => Readonly<CaptureActiveTimeSnapshot>;
	readonly pause: (pausedAtMs: number) => Readonly<CaptureActiveTimeSnapshot>;
	readonly resume: (resumedAtMs: number) => Readonly<CaptureActiveTimeSnapshot>;
	readonly stop: (stoppedAtMs: number) => Readonly<CaptureActiveTimeSnapshot>;
}

/**
 * Creates one caller-clocked media timeline. Pauses stay explicit and are
 * removed from packet presentation time without changing the monotonic origin.
 */
export function createFramescaperCaptureActiveTimeClock(
	startedAtMs: number,
): FramescaperCaptureActiveTimeClock {
	const normalizedStart = finiteNonNegativeTime(startedAtMs, 'Capture clock start time');
	let lastObservedAtMs = normalizedStart;
	let currentPauseStartedAtMs: number | null = null;
	let stoppedAtMs: number | null = null;
	const pauseSpans: CapturePauseSpan[] = [];

	function observe(value: number, action: string): number {
		const observedAtMs = finiteNonNegativeTime(value, `Capture clock ${action} time`);
		if (observedAtMs < lastObservedAtMs) {
			throw new RangeError('Capture clock time cannot move backwards.');
		}
		lastObservedAtMs = observedAtMs;
		return observedAtMs;
	}

	function assertRunning(): void {
		if (stoppedAtMs !== null) throw new Error('Capture clock is already stopped.');
	}

	function createSnapshot(requestedAtMs: number): Readonly<CaptureActiveTimeSnapshot> {
		const effectiveObservedAtMs = stoppedAtMs ?? requestedAtMs;
		const completePausedTimeMs = pauseSpans.reduce(
			(total, span) => total + span.durationMs,
			0,
		);
		const openPausedTimeMs = currentPauseStartedAtMs === null
			? 0
			: effectiveObservedAtMs - currentPauseStartedAtMs;
		const wallTimeMs = effectiveObservedAtMs - normalizedStart;
		const pausedTimeMs = completePausedTimeMs + openPausedTimeMs;
		const activeTimeMs = wallTimeMs - pausedTimeMs;
		const activeTimeUs = millisecondsToSafeMicroseconds(activeTimeMs);
		return Object.freeze({
			startedAtMs: normalizedStart,
			observedAtMs: effectiveObservedAtMs,
			stoppedAtMs,
			wallTimeMs,
			pausedTimeMs,
			activeTimeMs,
			activeTimeUs,
			paused: currentPauseStartedAtMs !== null,
			pauseSpans: Object.freeze(pauseSpans.map((span) => Object.freeze({ ...span }))),
		});
	}

	function snapshot(observedAtMs: number): Readonly<CaptureActiveTimeSnapshot> {
		return createSnapshot(observe(observedAtMs, 'observation'));
	}

	function pause(pausedAtMs: number): Readonly<CaptureActiveTimeSnapshot> {
		assertRunning();
		if (currentPauseStartedAtMs !== null) throw new Error('Capture clock is already paused.');
		const normalizedPause = observe(pausedAtMs, 'pause');
		currentPauseStartedAtMs = normalizedPause;
		return createSnapshot(normalizedPause);
	}

	function resume(resumedAtMs: number): Readonly<CaptureActiveTimeSnapshot> {
		assertRunning();
		if (currentPauseStartedAtMs === null) throw new Error('Capture clock is not paused.');
		const normalizedResume = observe(resumedAtMs, 'resume');
		pauseSpans.push(Object.freeze({
			startedAtMs: currentPauseStartedAtMs,
			endedAtMs: normalizedResume,
			durationMs: normalizedResume - currentPauseStartedAtMs,
		}));
		currentPauseStartedAtMs = null;
		return createSnapshot(normalizedResume);
	}

	function stop(value: number): Readonly<CaptureActiveTimeSnapshot> {
		assertRunning();
		const normalizedStop = observe(value, 'stop');
		if (currentPauseStartedAtMs !== null) {
			pauseSpans.push(Object.freeze({
				startedAtMs: currentPauseStartedAtMs,
				endedAtMs: normalizedStop,
				durationMs: normalizedStop - currentPauseStartedAtMs,
			}));
			currentPauseStartedAtMs = null;
		}
		stoppedAtMs = normalizedStop;
		return createSnapshot(normalizedStop);
	}

	return Object.freeze({ snapshot, pause, resume, stop });
}

function finiteNonNegativeTime(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be a finite non-negative number.`);
	}
	return value;
}

function millisecondsToSafeMicroseconds(milliseconds: number): number {
	const microseconds = Math.round(milliseconds * 1_000);
	if (!Number.isSafeInteger(microseconds) || microseconds < 0) {
		throw new RangeError('Capture active time exceeds the safe microsecond range.');
	}
	return microseconds;
}
