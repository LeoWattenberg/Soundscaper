/* SPDX-License-Identifier: AGPL-3.0-only */

export const SPECTRAL_SELECTION_MINIMUM_GAIN_DB = -60;
export const SPECTRAL_SELECTION_MAXIMUM_GAIN_DB = 60;

/** Match typed-value admission to the range advertised by this dialog. */
export function spectralSelectionGainValid(value: number | string): boolean {
	if (typeof value === 'string' && value.trim() === '') return false;
	const gain = Number(value);
	return Number.isFinite(gain) && gain >= SPECTRAL_SELECTION_MINIMUM_GAIN_DB
		&& gain <= SPECTRAL_SELECTION_MAXIMUM_GAIN_DB;
}
