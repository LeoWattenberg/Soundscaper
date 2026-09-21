/* SPDX-License-Identifier: AGPL-3.0-only */

const TAKE_CYCLE_ID_MAXIMUM_LENGTH = 256;
const TAKE_CYCLE_SOURCE_NAME_MAXIMUM_LENGTH = 255;

export function takeCycleStableId(
	value: unknown,
	name: string,
	maximumLength = TAKE_CYCLE_ID_MAXIMUM_LENGTH,
): string {
	if (!Number.isSafeInteger(maximumLength) || maximumLength < 1) {
		throw new RangeError('Take cycle ID maximum length must be a positive safe integer.');
	}
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > maximumLength
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

export function takeCycleStableName(value: unknown): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value.length > TAKE_CYCLE_SOURCE_NAME_MAXIMUM_LENGTH) {
		throw new TypeError('Take cycle source name is invalid.');
	}
	return value;
}
