/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Audacity ValueWarper/WarpingTransformer, adapted from
 * d7c60d876efbff48be78a7bcf472a3baf632ea4c.
 */

function clamp(value: number, minimum: number, maximum: number): number {
	return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}

function coefficient(minimum: number, maximum: number, middle?: number): number {
	if (middle === undefined || !Number.isFinite(middle) || middle <= minimum || middle >= maximum) return 0;
	const normalized = (middle - minimum) / (maximum - minimum);
	const result = 2 * Math.log((1 - normalized) / normalized);
	return Math.abs(result) < 1e-12 ? 0 : result;
}

/** Actual parameter value to the knob's displayed 0..1 position. */
export function audacityKnobPosition(value: number, minimum: number, maximum: number, middle?: number): number {
	if (maximum <= minimum) return 0;
	const normalized = (clamp(value, minimum, maximum) - minimum) / (maximum - minimum);
	if (normalized === 0 || normalized === 1) return normalized;
	const c = coefficient(minimum, maximum, middle);
	return c === 0 ? normalized : Math.log1p(normalized * Math.expm1(c)) / c;
}

/** Knob display/drag position to the actual parameter value. */
export function audacityKnobValue(position: number, minimum: number, maximum: number, middle?: number): number {
	if (maximum <= minimum) return minimum;
	const normalized = clamp(position, 0, 1);
	if (normalized === 0) return minimum;
	if (normalized === 1) return maximum;
	const c = coefficient(minimum, maximum, middle);
	const value = c === 0 ? normalized : Math.expm1(c * normalized) / Math.expm1(c);
	return minimum + value * (maximum - minimum);
}
