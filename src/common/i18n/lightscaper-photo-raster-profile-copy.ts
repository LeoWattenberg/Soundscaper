/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({ label: 'Output color profile', srgb: 'sRGB (default)', displayP3: 'Display P3',
	pngRequired: 'Display P3 output requires PNG. Choose PNG or sRGB.' });
const DE = Object.freeze({ label: 'Ausgabe-Farbprofil', srgb: 'sRGB (Standard)', displayP3: 'Display P3',
	pngRequired: 'Display-P3-Ausgabe erfordert PNG. Wähle PNG oder sRGB.' });
export function photoRasterProfileCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
