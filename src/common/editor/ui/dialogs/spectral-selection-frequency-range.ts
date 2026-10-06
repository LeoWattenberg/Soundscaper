/* SPDX-License-Identifier: AGPL-3.0-only */

/** A frequency endpoint needs an actual numeric draft before any spectral edit. */
export function spectralSelectionFrequencyRangeValid(
	minimumDraft: number | string,
	maximumDraft: number | string,
	nyquist: number,
): boolean {
	if (!String(minimumDraft).trim() || !String(maximumDraft).trim()) return false;
	const minimum = Number(minimumDraft);
	const maximum = Number(maximumDraft);
	return Number.isFinite(minimum) && Number.isFinite(maximum)
		&& Number.isFinite(nyquist) && minimum >= 0 && maximum <= nyquist && maximum > minimum;
}
