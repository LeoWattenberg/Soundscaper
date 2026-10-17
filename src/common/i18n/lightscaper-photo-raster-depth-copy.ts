/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({ label: 'PNG bit depth', eight: '8-bit (default)', sixteen: '16-bit' });
const DE = Object.freeze({ label: 'PNG-Bittiefe', eight: '8 Bit (Standard)', sixteen: '16 Bit' });
export function photoRasterDepthCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
