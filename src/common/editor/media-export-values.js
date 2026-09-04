/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The value tables and range checks export settings are admitted against.
 *
 * They sit beside the format registry rather than inside it because the
 * per-codec settings modules need the same checks, and importing them back out
 * of the registry would make the registry depend on its own consumers.
 */

/** The bit rates each compressed format offers, in kbps. */
export const BIT_RATES = Object.freeze({
	mp3: [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	opus: [64, 96, 128, 160, 192, 256, 320],
	mp2: [128, 160, 192, 224, 256, 320, 384],
	'aac-m4a': [96, 128, 160, 192, 256, 320],
});

export function integerInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
	return number;
}

export function numberInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be from ${minimum} to ${maximum}.`);
	return number;
}

export function allowedNumber(value, allowed, name) {
	const number = Number(value);
	if (!allowed.includes(number)) throw new RangeError(`${name} must be one of ${allowed.join(', ')} kbps.`);
	return number;
}
