/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Rational } from '../../timeline-time.ts';

export function parseVideoKeyframePosition(value: string): number | Rational {
	const parts = value.trim().split('/');
	if (parts.length === 1) return parseVideoKeyframeNumber(parts[0] ?? '');
	if (parts.length !== 2 || parts.some((part) => !part.trim())) throw new TypeError('An exact rational uses num/den.');
	const num = Number(parts[0]); const den = Number(parts[1]);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) {
		throw new TypeError('An exact rational uses safe integer num/den.');
	}
	return Object.freeze({ num, den });
}

export function parseVideoKeyframeNumber(value: string): number {
	if (!value.trim()) throw new TypeError('A finite number is required.');
	const result = Number(value);
	if (!Number.isFinite(result) || Object.is(result, -0)) throw new TypeError('A finite number without negative zero is required.');
	return result;
}
