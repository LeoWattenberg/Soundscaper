/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from './editor-freesound-attribution-copy.ts';

/** Hand-authored copy for Freesound discovery and the project attribution report. */
export const FREESOUND_ATTRIBUTION_COPY_BY_LOCALE = Object.freeze({
	de: Object.freeze({
		metadataTab: 'Quellen', panel: 'Freesound',
		intro: 'Importierte Quellen, die aktuell auf der Zeitleiste verwendet oder in der Projektablage aufbewahrt werden.',
		exportCsv: 'CSV exportieren', empty: 'Keine importierten Quellen werden aktuell verwendet oder in der Projektablage aufbewahrt.',
		track: 'Spur', currentUse: 'Aktuelle Verwendung', sources: 'Quellen', by: 'Von',
		license: 'Lizenz', importedMetadata: 'Importierte Metadaten',
		searchLabel: 'Freesound durchsuchen', searchPlaceholder: 'Sounds suchen', search: 'Suchen',
		filterLicense: 'Lizenz', licenseAll: 'Alle Lizenzen', licenseCc0: 'CC0',
		licenseAttribution: 'Namensnennung',
		licenseAttributionNoncommercial: 'Namensnennung – nicht kommerziell',
		sort: 'Sortieren nach', sortRelevance: 'Relevanz', sortNewest: 'Neueste',
		sortDownloads: 'Meiste Downloads', sortRating: 'Beste Bewertung',
		searching: 'Freesound wird durchsucht', searchError: 'Die Freesound-Suche ist fehlgeschlagen.',
		importError: 'Der Freesound-Sound konnte nicht importiert werden.',
		unavailable: 'Freesound ist derzeit nicht verfügbar.',
		searchPrompt: 'Durchsuche Freesound nach Audio für dieses Projekt.',
		noResults: 'Keine Sounds entsprechen dieser Suche.', resultsCount: '{count} Sounds',
		results: 'Freesound-Ergebnisse', byInline: 'von', preview: 'Vorhören', stopPreview: 'Vorhören beenden',
		insertAtPlayhead: 'Am Abspielkopf einfügen', addToProjectBin: 'Zur Projektablage hinzufügen',
		pagination: 'Freesound-Ergebnisseiten', previousPage: 'Zurück', nextPage: 'Weiter',
		page: 'Seite {page} von {pages}', resultsProvidedBy: 'Ergebnisse von', siteName: 'Freesound.org',
	}),
	en: FREESOUND_ATTRIBUTION_ENGLISH_COPY,
});

export function freesoundAttributionCopy(locale, publishedCopy = {}) {
	const base = String(locale || 'en').toLowerCase().startsWith('de')
		? FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.de
		: FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en;
	return resolveEditorCopyScope('freesoundAttribution', base, publishedCopy);
}
