/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bundled source IDs whose menus now invoke a first-party streaming processor. */
export const NYQUIST_REGULAR_EFFECT_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({
	'nyquist:delay': 'multi-tap-delay',
	'nyquist:highpass': 'highpass-filter',
	'nyquist:lowpass': 'lowpass-filter',
	'nyquist:noisegate': 'noise-gate',
	'nyquist:notch': 'notch-filter',
	'nyquist:shelffilter': 'shelf-filter',
	'nyquist:tremolo': 'tremolo',
	'nyquist:vocoder': 'vocoder',
});

export function regularEffectReplacementForNyquistPlugin(id: string): string | null {
	return Object.hasOwn(NYQUIST_REGULAR_EFFECT_REPLACEMENTS, id)
		? NYQUIST_REGULAR_EFFECT_REPLACEMENTS[id] ?? null
		: null;
}
