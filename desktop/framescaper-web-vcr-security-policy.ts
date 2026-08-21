/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_WEB_VCR_URL_LIMIT = 2_048;
export const FRAMESCAPER_WEB_VCR_POPUP_LIMIT = 4;
export const FRAMESCAPER_WEB_VCR_WHEEL_DELTA_LIMIT = 4_096;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const KEY_MODIFIERS = ['alt', 'control', 'meta', 'shift'] as const;
const POINTER_EVENTS = ['move', 'down', 'up'] as const;
const POINTER_BUTTONS = ['none', 'left', 'middle', 'right'] as const;

export type FramescaperWebVcrKeyModifier = typeof KEY_MODIFIERS[number];
export type FramescaperWebVcrInput =
	| Readonly<{
		readonly kind: 'pointer';
		readonly event: typeof POINTER_EVENTS[number];
		readonly x: number;
		readonly y: number;
		readonly button: typeof POINTER_BUTTONS[number];
		readonly clickCount: number;
	}>
	| Readonly<{
		readonly kind: 'wheel';
		readonly x: number;
		readonly y: number;
		readonly deltaX: number;
		readonly deltaY: number;
	}>
	| Readonly<{
		readonly kind: 'key';
		readonly event: 'down' | 'up';
		readonly keyCode: string;
		readonly modifiers: readonly FramescaperWebVcrKeyModifier[];
	}>;

export interface FramescaperWebVcrAdmittedUrl {
	readonly url: string;
}

/** Admits top-level and popup destinations without provider-specific exceptions. */
export function admitFramescaperWebVcrUrl(value: unknown): Readonly<FramescaperWebVcrAdmittedUrl> {
	if (typeof value !== 'string' || value.length === 0 || value.length > FRAMESCAPER_WEB_VCR_URL_LIMIT) {
		throw new TypeError('Web VCR URL must be a bounded string.');
	}
	if (value !== value.trim() || CONTROL_CHARACTER.test(value)) {
		throw new TypeError('Web VCR URL contains whitespace or control characters.');
	}
	if (value === 'about:blank') return Object.freeze({ url: value });
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError('Web VCR URL is invalid.');
	}
	if (parsed.protocol !== 'https:' || !parsed.hostname) {
		throw new TypeError('Web VCR navigation requires HTTPS.');
	}
	if (parsed.username || parsed.password) {
		throw new TypeError('Web VCR URLs cannot contain credentials.');
	}
	if (parsed.href.length > FRAMESCAPER_WEB_VCR_URL_LIMIT) {
		throw new TypeError('Canonical Web VCR URL exceeds the length limit.');
	}
	return Object.freeze({ url: parsed.href });
}

/** The guest profile has no permission allowlist; capture is granted to the trusted app instead. */
export function framescaperWebVcrPermissionAllowed(_permission: string): false {
	return false;
}

export function cancelFramescaperWebVcrDownload(
	event: Readonly<{ preventDefault(): void }>,
	item: Readonly<{ cancel(): void }>,
): void {
	if (!event || typeof event.preventDefault !== 'function' || !item || typeof item.cancel !== 'function') {
		throw new TypeError('Web VCR download denial requires Electron event and item seams.');
	}
	event.preventDefault();
	item.cancel();
}

export function webVcrPopupAllowed(value: Readonly<{
	readonly url: string;
	readonly phase: string;
	readonly openPopupCount: number;
}>): boolean {
	if (!value || typeof value !== 'object' || value.phase !== 'ready'
		|| !Number.isSafeInteger(value.openPopupCount) || value.openPopupCount < 0
		|| value.openPopupCount >= FRAMESCAPER_WEB_VCR_POPUP_LIMIT) return false;
	try {
		const admitted = admitFramescaperWebVcrUrl(value.url);
		return admitted.url !== 'about:blank';
	} catch {
		return false;
	}
}

export function validateFramescaperWebVcrInput(value: unknown): Readonly<FramescaperWebVcrInput> {
	const kind = value && typeof value === 'object' && !Array.isArray(value)
		? (value as Readonly<{ kind?: unknown }>).kind
		: undefined;
	if (kind === 'pointer') return validatePointerInput(value);
	if (kind === 'wheel') return validateWheelInput(value);
	if (kind === 'key') return validateKeyInput(value);
	throw new TypeError('Web VCR input kind is invalid.');
}

function validatePointerInput(value: unknown): Readonly<FramescaperWebVcrInput> {
	const record = closedRecord(
		value,
		['kind', 'event', 'x', 'y', 'button', 'clickCount'],
		'Web VCR pointer input',
	);
	if (!POINTER_EVENTS.includes(record.event as typeof POINTER_EVENTS[number])
		|| !POINTER_BUTTONS.includes(record.button as typeof POINTER_BUTTONS[number])) {
		throw new TypeError('Web VCR pointer event is invalid.');
	}
	const x = normalizedCoordinate(record.x);
	const y = normalizedCoordinate(record.y);
	if (!Number.isSafeInteger(record.clickCount) || Number(record.clickCount) < 0
		|| Number(record.clickCount) > 3) {
		throw new RangeError('Web VCR pointer click count is invalid.');
	}
	if (record.event !== 'move' && record.button === 'none') {
		throw new TypeError('Web VCR pointer button is required for button events.');
	}
	return Object.freeze({
		kind: 'pointer',
		event: record.event as 'move' | 'down' | 'up',
		x,
		y,
		button: record.button as 'none' | 'left' | 'middle' | 'right',
		clickCount: Number(record.clickCount),
	});
}

function validateWheelInput(value: unknown): Readonly<FramescaperWebVcrInput> {
	const record = closedRecord(value, ['kind', 'x', 'y', 'deltaX', 'deltaY'], 'Web VCR wheel input');
	const deltaX = wheelDelta(record.deltaX);
	const deltaY = wheelDelta(record.deltaY);
	return Object.freeze({
		kind: 'wheel',
		x: normalizedCoordinate(record.x),
		y: normalizedCoordinate(record.y),
		deltaX,
		deltaY,
	});
}

function validateKeyInput(value: unknown): Readonly<FramescaperWebVcrInput> {
	const record = closedRecord(value, ['kind', 'event', 'keyCode', 'modifiers'], 'Web VCR key input');
	if ((record.event !== 'down' && record.event !== 'up') || typeof record.keyCode !== 'string'
		|| record.keyCode.length === 0 || record.keyCode.length > 32 || CONTROL_CHARACTER.test(record.keyCode)) {
		throw new TypeError('Web VCR key input is invalid.');
	}
	if (!Array.isArray(record.modifiers) || record.modifiers.length > KEY_MODIFIERS.length
		|| record.modifiers.some((modifier) => !KEY_MODIFIERS.includes(modifier as FramescaperWebVcrKeyModifier))
		|| new Set(record.modifiers).size !== record.modifiers.length) {
		throw new TypeError('Web VCR key modifiers are invalid.');
	}
	return Object.freeze({
		kind: 'key',
		event: record.event,
		keyCode: record.keyCode,
		modifiers: Object.freeze([...record.modifiers] as FramescaperWebVcrKeyModifier[]),
	});
}

function normalizedCoordinate(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError('Web VCR input coordinate must be between zero and one.');
	}
	return value;
}

function wheelDelta(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)
		|| Math.abs(value) > FRAMESCAPER_WEB_VCR_WHEEL_DELTA_LIMIT) {
		throw new RangeError('Web VCR wheel delta exceeds the bound.');
	}
	return value;
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<string, unknown>>;
}
