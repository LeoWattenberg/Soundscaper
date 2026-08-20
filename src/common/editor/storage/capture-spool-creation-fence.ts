/* SPDX-License-Identifier: AGPL-3.0-only */

export interface CaptureSpoolCreationFence {
	readonly key: string;
	readonly expected: unknown;
}

export function normalizeCaptureSpoolCreationFence(value: unknown): CaptureSpoolCreationFence | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== 2) {
		throw new TypeError('Capture spool creation fence must be a closed data record.');
	}
	const key = Object.getOwnPropertyDescriptor(value, 'key');
	const expected = Object.getOwnPropertyDescriptor(value, 'expected');
	if (!key?.enumerable || !Object.hasOwn(key, 'value') || !expected?.enumerable
		|| !Object.hasOwn(expected, 'value') || typeof key.value !== 'string' || !key.value.length
		|| key.value.length > 1_024 || key.value !== key.value.normalize('NFC')
		|| /[\u0000-\u001f\u007f]/u.test(key.value)) {
		throw new TypeError('Capture spool creation fence is invalid.');
	}
	return Object.freeze({ key: key.value, expected: expected.value });
}

export interface CaptureSpoolConditionalKeyValuePort {
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	putIfAbsentWhenCurrent?(
		fenceKey: string, expectedFence: unknown, key: string, value: unknown,
	): PromiseLike<boolean> | boolean;
	replaceIfCurrent(key: string, expected: unknown, replacement: unknown): PromiseLike<boolean> | boolean;
	replaceIfCurrentWhenCurrent?(
		fenceKey: string, expectedFence: unknown, key: string, expected: unknown, replacement: unknown,
	): PromiseLike<boolean> | boolean;
}

export function putCaptureSpoolIfFenceCurrent(
	values: CaptureSpoolConditionalKeyValuePort,
	fence: CaptureSpoolCreationFence | undefined,
	key: string,
	value: unknown,
): PromiseLike<boolean> | boolean {
	if (!fence) return values.putIfAbsent(key, value);
	const put = values.putIfAbsentWhenCurrent;
	if (typeof put !== 'function') throw new TypeError('Capture spool creation requires an atomic creation fence.');
	return put.call(values, fence.key, fence.expected, key, value);
}

export function replaceCaptureSpoolIfFenceCurrent(
	values: CaptureSpoolConditionalKeyValuePort,
	fence: CaptureSpoolCreationFence | undefined,
	key: string,
	expected: unknown,
	replacement: unknown,
): PromiseLike<boolean> | boolean {
	if (!fence) return values.replaceIfCurrent(key, expected, replacement);
	const replace = values.replaceIfCurrentWhenCurrent;
	if (typeof replace !== 'function') throw new TypeError('Capture spool creation requires an atomic creation fence.');
	return replace.call(values, fence.key, fence.expected, key, expected, replacement);
}
