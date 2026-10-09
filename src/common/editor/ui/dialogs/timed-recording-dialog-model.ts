/* SPDX-License-Identifier: AGPL-3.0-only */

export type TimedRecordingEndMode = 'duration' | 'end';

export interface TimedRecordingDialogValue {
	readonly startTime: string;
	readonly endTime: string;
	readonly startTimeMs?: number;
	readonly endTimeMs?: number;
	readonly durationSeconds: number;
	readonly endMode: TimedRecordingEndMode;
}

export interface TimedRecordingDialogRange {
	readonly startTimeMs: number;
	readonly endTimeMs: number;
}

const DEFAULT_DURATION_SECONDS = 60 * 60;

export function createTimedRecordingDialogValue(
	startValue: unknown,
	endValue?: unknown,
): TimedRecordingDialogValue {
	const startTimeMs = dateTimeMs(startValue);
	const suppliedEndTimeMs = dateTimeMs(endValue);
	const endTimeMs = Number.isFinite(suppliedEndTimeMs) && suppliedEndTimeMs > startTimeMs
		? suppliedEndTimeMs
		: startTimeMs + DEFAULT_DURATION_SECONDS * 1_000;
	return Object.freeze({
		startTime: formatDateTimeLocalInput(startTimeMs),
		endTime: formatDateTimeLocalInput(endTimeMs),
		startTimeMs,
		endTimeMs,
		durationSeconds: (endTimeMs - startTimeMs) / 1_000,
		endMode: 'duration',
	});
}

export function normalizeTimedRecordingDialogValue(value: unknown): TimedRecordingDialogValue {
	if (!isRecord(value)) return createTimedRecordingDialogValue(value);
	const startTime = typeof value.startTime === 'string' ? value.startTime : '';
	const endTime = typeof value.endTime === 'string' ? value.endTime : '';
	const durationSeconds = positiveDuration(value.durationSeconds) ?? DEFAULT_DURATION_SECONDS;
	return Object.freeze({
		startTime,
		endTime,
		startTimeMs: dateTimeMs(startTime, value.startTimeMs),
		endTimeMs: dateTimeMs(endTime, value.endTimeMs),
		durationSeconds,
		endMode: value.endMode === 'end' ? 'end' : 'duration',
	});
}

export function updateTimedRecordingDialogStart(
	value: TimedRecordingDialogValue,
	startTime: string,
): TimedRecordingDialogValue {
	const startTimeMs = dateTimeMs(startTime);
	if (value.endMode === 'end') {
		const endTimeMs = dateTimeMs(value.endTime, value.endTimeMs);
		const durationSeconds = elapsedDuration(startTimeMs, endTimeMs, value.durationSeconds);
		return Object.freeze({ ...value, startTime, startTimeMs, endTimeMs, durationSeconds });
	}
	return durationEndValue({ ...value, startTime }, startTimeMs, value.durationSeconds);
}

export function updateTimedRecordingDialogDuration(
	value: TimedRecordingDialogValue,
	durationValue: unknown,
): TimedRecordingDialogValue {
	const durationSeconds = positiveDuration(durationValue) ?? value.durationSeconds;
	const startTimeMs = dateTimeMs(value.startTime, value.startTimeMs);
	return durationEndValue(value, startTimeMs, durationSeconds);
}

export function updateTimedRecordingDialogEnd(
	value: TimedRecordingDialogValue,
	endTime: string,
): TimedRecordingDialogValue {
	const startTimeMs = dateTimeMs(value.startTime, value.startTimeMs);
	const endTimeMs = dateTimeMs(endTime);
	const durationSeconds = elapsedDuration(startTimeMs, endTimeMs, value.durationSeconds);
	return Object.freeze({ ...value, endTime, startTimeMs, endTimeMs, durationSeconds });
}

function elapsedDuration(startTimeMs: number, endTimeMs: number, fallback: number): number {
	return Number.isFinite(startTimeMs) && endTimeMs > startTimeMs
		? (endTimeMs - startTimeMs) / 1_000
		: fallback;
}

function durationEndValue(
	value: TimedRecordingDialogValue,
	startTimeMs: number,
	durationSeconds: number,
): TimedRecordingDialogValue {
	const endTimeMs = Number.isFinite(startTimeMs)
		? startTimeMs + durationSeconds * 1_000
		: dateTimeMs(value.endTime, value.endTimeMs);
	return Object.freeze({
		...value, startTimeMs, endTimeMs, durationSeconds,
		endTime: Number.isFinite(startTimeMs) ? formatDateTimeLocalInput(endTimeMs) : value.endTime,
	});
}

export function updateTimedRecordingDialogEndMode(
	value: TimedRecordingDialogValue,
	endMode: TimedRecordingEndMode,
): TimedRecordingDialogValue {
	if (endMode === 'duration') {
		return updateTimedRecordingDialogDuration({ ...value, endMode }, value.durationSeconds);
	}
	return Object.freeze({ ...value, endMode });
}

export function timedRecordingDialogRange(
	value: unknown,
	nowMs: number = Date.now(),
): TimedRecordingDialogRange | null {
	const normalized = normalizeTimedRecordingDialogValue(value);
	const startTimeMs = dateTimeMs(normalized.startTime, normalized.startTimeMs);
	const endTimeMs = normalized.endMode === 'duration'
		? startTimeMs + normalized.durationSeconds * 1_000
		: dateTimeMs(normalized.endTime, normalized.endTimeMs);
	if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)
		|| !Number.isFinite(new Date(endTimeMs).getTime())
		|| startTimeMs <= nowMs || endTimeMs <= startTimeMs) return null;
	return Object.freeze({ startTimeMs, endTimeMs });
}

function formatDateTimeLocalInput(value: number): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 23).replace(/\.000$/u, '');
}

function dateTimeMs(value: unknown, retainedTimeMs?: unknown): number {
	if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
	if (value instanceof Date) return value.getTime();
	if (typeof value !== 'string' || value === '') return Number.NaN;
	const date = new Date(value);
	const parts = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(value);
	if (parts) {
		const expected = parts.slice(1, 7).map((part) => Number(part ?? 0));
		expected.push(Number((parts[7] ?? '').padEnd(3, '0')));
		const actual = [date.getFullYear(), date.getMonth() + 1, date.getDate(),
			date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()];
		if (actual.some((part, index) => part !== expected[index])) return Number.NaN;
	}
	// A linked local time can occur twice. Keep its instant until the field is edited.
	if (typeof retainedTimeMs === 'number' && Number.isFinite(retainedTimeMs)
		&& dateTimeMs(formatDateTimeLocalInput(retainedTimeMs)) === date.getTime()) {
		return retainedTimeMs;
	}
	return date.getTime();
}

export function timedRecordingLocalDateTimeValid(value: string): boolean {
	return Number.isFinite(dateTimeMs(value));
}

function positiveDuration(value: unknown): number | null {
	const duration = Number(value);
	return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
