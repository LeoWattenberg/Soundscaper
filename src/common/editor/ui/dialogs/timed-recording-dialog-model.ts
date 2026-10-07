/* SPDX-License-Identifier: AGPL-3.0-only */

export type TimedRecordingEndMode = 'duration' | 'end';

export interface TimedRecordingDialogValue {
	readonly startTime: string;
	readonly endTime: string;
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
		const endTimeMs = dateTimeMs(value.endTime);
		const durationSeconds = Number.isFinite(startTimeMs) && endTimeMs > startTimeMs
			? (endTimeMs - startTimeMs) / 1_000
			: value.durationSeconds;
		return Object.freeze({ ...value, startTime, durationSeconds });
	}
	const endTime = Number.isFinite(startTimeMs)
		? formatDateTimeLocalInput(startTimeMs + value.durationSeconds * 1_000)
		: value.endTime;
	return Object.freeze({ ...value, startTime, endTime });
}

export function updateTimedRecordingDialogDuration(
	value: TimedRecordingDialogValue,
	durationValue: unknown,
): TimedRecordingDialogValue {
	const durationSeconds = positiveDuration(durationValue) ?? value.durationSeconds;
	const startTimeMs = dateTimeMs(value.startTime);
	const endTime = Number.isFinite(startTimeMs)
		? formatDateTimeLocalInput(startTimeMs + durationSeconds * 1_000)
		: value.endTime;
	return Object.freeze({ ...value, durationSeconds, endTime });
}

export function updateTimedRecordingDialogEnd(
	value: TimedRecordingDialogValue,
	endTime: string,
): TimedRecordingDialogValue {
	const startTimeMs = dateTimeMs(value.startTime);
	const endTimeMs = dateTimeMs(endTime);
	const durationSeconds = Number.isFinite(startTimeMs) && endTimeMs > startTimeMs
		? (endTimeMs - startTimeMs) / 1_000
		: value.durationSeconds;
	return Object.freeze({ ...value, endTime, durationSeconds });
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
	const startTimeMs = dateTimeMs(normalized.startTime);
	const endTimeMs = normalized.endMode === 'duration'
		? startTimeMs + normalized.durationSeconds * 1_000
		: dateTimeMs(normalized.endTime);
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

function dateTimeMs(value: unknown): number {
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
