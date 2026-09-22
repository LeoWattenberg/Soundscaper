/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TimedRecordingToastRange {
	readonly startTimeMs: number;
	readonly endTimeMs?: number;
}

export interface TimedRecordingToastPresentation {
	readonly phase: 'scheduled' | 'recording';
	readonly timeRemaining: string | null;
}

export function timedRecordingToastPresentation(
	scheduled: TimedRecordingToastRange | null | undefined,
	active: TimedRecordingToastRange | null | undefined,
	nowMs: number,
): TimedRecordingToastPresentation | null {
	if (scheduled) return {
		phase: 'scheduled',
		timeRemaining: formatCountdown(scheduled.startTimeMs - nowMs),
	};
	if (active) return {
		phase: 'recording',
		timeRemaining: active.endTimeMs === undefined
			? null : formatCountdown(Math.min(
				active.endTimeMs - active.startTimeMs,
				active.endTimeMs - nowMs,
			)),
	};
	return null;
}

function formatCountdown(remainingMs: number): string {
	const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
	const hours = Math.floor(seconds / 3_600);
	const minutes = Math.floor(seconds % 3_600 / 60);
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
