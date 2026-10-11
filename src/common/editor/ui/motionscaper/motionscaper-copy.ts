/* SPDX-License-Identifier: AGPL-3.0-only */

import { localeLanguage } from '../../../i18n/locale.js';
import { bundledSiteCopyForLocale } from '../../../i18n/site-copy.js';

const ENTRIES = [
	['motionscaperNewComposition', 'New Composition', 'Neue Komposition'],
	['motionscaperUnavailable', 'Composition creation is not available in this build.', 'Das Erstellen von Kompositionen ist in dieser Version noch nicht verfügbar.'],
	['motionscaperWorkspaceEmpty', 'Create a composition from the File menu to begin.', 'Erstelle zum Beginnen eine Komposition über das Menü Datei.'],
	['motionscaperFileMenu', 'File', 'Datei'],
	['motionscaperViewMenu', 'View', 'Ansicht'],
	['motionscaperApplicationMenu', 'Application menu', 'Anwendungsmenü'],
	['motionscaperFullscreen', 'Toggle fullscreen', 'Vollbild umschalten'],
] as const;

/** Product command copy loads with its editor, outside every initial site graph. */
export function motionscaperCopy(locale: string): Readonly<Record<string, string>> {
	const column = localeLanguage(locale) === 'de' ? 2 : 1;
	return Object.freeze({ ...bundledSiteCopyForLocale(locale),
		...Object.fromEntries(ENTRIES.map((entry) => [entry[0], entry[column]])) });
}
