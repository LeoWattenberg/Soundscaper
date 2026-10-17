/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeRational, type Rational } from '../../timeline-time.ts';

export function parseMotionExactInput(value: string): Rational {
	if (!/^-?\d+(?:\/[1-9]\d*)?$/u.test(value.trim())) throw new TypeError('Use a whole number or an exact fraction such as 3/2.');
	const [num, den = '1'] = value.trim().split('/'); return normalizeRational({ num: Number(num), den: Number(den) });
}
export const formatMotionExactInput = (value: Rational): string => value.den === 1 ? String(value.num) : `${value.num}/${value.den}`;

export function parseMotionNumberInput(value: string): number {
	const parsed = Number(value);
	if (!value.trim() || !Number.isFinite(parsed) || Object.is(parsed, -0)) throw new TypeError('Enter a finite number.');
	return parsed;
}
