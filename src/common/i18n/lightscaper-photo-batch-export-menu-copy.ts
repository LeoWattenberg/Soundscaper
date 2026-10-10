/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({ downloadSelected: 'Download selected photos…', queue: 'Export queue…' });
const DE = Object.freeze({ downloadSelected: 'Ausgewählte Fotos herunterladen…', queue: 'Export-Warteschlange…' });
export function photoBatchExportMenuCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
