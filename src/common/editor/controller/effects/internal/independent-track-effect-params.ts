/* SPDX-License-Identifier: AGPL-3.0-only */

/** A single track's stereo channels always retain their common clock. */
export function independentTrackEffectParams(
	effectType: string, params: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return effectType === 'audacity-truncate-silence' && params.independent === true
		? { ...params, independent: false } : params;
}
