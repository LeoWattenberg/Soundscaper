/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ menu: 'RAW preview source', neutral: 'Neutral Original (default)', camera: 'Camera embedded (when available)' });
const DE = Object.freeze({ menu: 'RAW-Vorschauquelle', neutral: 'Neutrales Original (Standard)', camera: 'Kameravorschau (falls verfügbar)' });

export function photoRawPreviewSourceCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
