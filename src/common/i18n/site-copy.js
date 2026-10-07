/* SPDX-License-Identifier: AGPL-3.0-only */

import { localeLanguage } from './locale.js';
import { SITE_SIDEBAR_COPY_BY_LOCALE } from './site-sidebar-copy.js';

const SITE_COPY_ENTRIES = Object.freeze([
	['lightscaperTitle', 'Lightscaper', 'Lightscaper'],
	['lightscaperMetaDescription', 'A local-first photo library and non-destructive develop editor.', 'Eine lokale Fotobibliothek mit nondestruktiver Bildentwicklung.'],
	['photoEditor', 'Photo editor', 'Foto-Editor'],
	['workspacePhoto', 'Photo library', 'Fotobibliothek'],
	['photoFileMenu', 'File', 'Datei'],
	['photoViewMenu', 'View', 'Ansicht'],
	['photoShowLibrary', 'Show photo library', 'Fotobibliothek anzeigen'],
	['photoHideLibrary', 'Hide photo library', 'Fotobibliothek ausblenden'],
	['photoEmptyLibrary', 'Your photo library is empty.', 'Deine Fotobibliothek ist leer.'],
	['photoMenuLabel', 'Application menu', 'Anwendungsmenü'],
	['photoImportPhotos', 'Import photos…', 'Fotos importieren…'],
	['photoChooseFiles', 'Choose photos', 'Fotos auswählen'],
	['photoImportAction', 'Import', 'Importieren'],
	['photoCancelAction', 'Cancel', 'Abbrechen'],
	['photoFirstPage', 'First page / refresh', 'Erste Seite / aktualisieren'],
	['photoNextPage', 'Next page', 'Nächste Seite'],
	['photoPhotoMenu', 'Photo', 'Foto'],
	['photoRateStars', 'Rate {count} stars', 'Mit {count} Sternen bewerten'],
	['photoRating', 'Rating', 'Bewertung'],
	['photoFlag', 'Flag', 'Kennzeichnung'],
	['photoUnflagged', 'Unflagged', 'Ohne Kennzeichnung'],
	['photoPick', 'Pick', 'Auswahl'],
	['photoReject', 'Reject', 'Aussortiert'],
	['photoColorLabel', 'Color label', 'Farbmarkierung'],
	['photoColorNone', 'None', 'Keine'],
	['photoColorRed', 'Red', 'Rot'],
	['photoColorYellow', 'Yellow', 'Gelb'],
	['photoColorGreen', 'Green', 'Grün'],
	['photoColorBlue', 'Blue', 'Blau'],
	['photoColorPurple', 'Purple', 'Violett'],
	['photoWorking', 'Working with your photo library…', 'Deine Fotobibliothek wird bearbeitet…'],
	['photoImported', 'Imported', 'Importiert'],
	['photoImportFailed', 'Import failed', 'Import fehlgeschlagen'],
	['photoMetadataNotice', 'Some metadata could not be displayed.', 'Einige Metadaten konnten nicht angezeigt werden.'],
	['productEditors', 'Editors', 'Editoren'],
	['framescaperEyebrow', 'Local video editing', 'Video lokal bearbeiten'],
	['framescaperTitle', 'Framescaper', 'Framescaper'],
	['framescaperIntro', 'Edit video and sound nondestructively, combine layers and effects, and export the finished video.', 'Schneide Video und Ton nondestruktiv, kombiniere Ebenen und Effekte und exportiere das fertige Video.'],
	['framescaperMetaDescription', 'Beta: A browser-based video editor inspired by Audacity 4.', 'Beta: Ein browserbasierter Videoeditor, inspiriert von Audacity 4.'],
	['eyebrow', 'Local multitrack audio editing', 'Mehrspur-Audio lokal bearbeiten'],
	['title', 'Soundscaper', 'Soundscaper'],
	['intro', 'Record audio, edit multiple tracks nondestructively, mix effects, and inspect loudness and frequency content.', 'Nimm Audio auf, schneide mehrere Spuren nondestruktiv, mische Effekte und prüfe Lautheit und Spektrum.'],
	['privacy', 'Your recordings, projects, and audio files stay on this device and are processed entirely in your browser.', 'Deine Aufnahmen, Projekte und Audiodateien bleiben auf diesem Gerät und werden ausschließlich in deinem Browser verarbeitet.'],
	['metaDescription', "It's practically Audacity 4 in the browser! Includes more features, completely private & open source", 'Praktisch Audacity 4 im Browser! Mit mehr Funktionen, vollständig privat & quelloffen'],
	['introExpand', 'Show introduction', 'Einführung anzeigen'],
	['introCollapse', 'Hide introduction', 'Einführung ausblenden'],
	['workspace', 'Workspace', 'Arbeitsbereich'],
	['workspaceModern', 'Soundscaper', 'Soundscaper'],
	['workspaceAudacity', 'Audacity', 'Audacity'],
	['workspaceMusic', 'Music', 'Musik'],
	['workspaceClassic', 'Classic', 'Klassisch'],
	['workspaceVideo', 'Video editor', 'Video-Editor'],
	['loading', 'Loading project', 'Projekt wird geladen'],
	['loadingEditorFiles', 'Loading editor files', 'Editordateien werden geladen'],
	['preparingEditor', 'Preparing editor', 'Editor wird vorbereitet'],
	['genericError', 'The action failed: {message}', 'Die Aktion ist fehlgeschlagen: {message}'],
	['staleBuildTitle', 'Editor is out of date', 'Editor ist veraltet'],
	['staleBuildMessage', 'A newer version of the editor has been published, so this function can no longer be loaded. Reload to get the current version. Your project stays saved on this device.', 'Es wurde eine neuere Version des Editors veröffentlicht, deshalb lässt sich diese Funktion nicht mehr laden. Lade neu, um die aktuelle Version zu erhalten. Dein Projekt bleibt auf diesem Gerät gespeichert.'],
	['staleBuildCancel', 'Cancel', 'Abbrechen'],
	['staleBuildReload', 'Reload', 'Neu laden'],
]);

export const SITE_COPY_BY_LOCALE = deepFreeze({
	en: {
		...Object.fromEntries(SITE_COPY_ENTRIES.map(([key, en]) => [key, en])),
		...SITE_SIDEBAR_COPY_BY_LOCALE.en,
	},
	de: {
		...Object.fromEntries(SITE_COPY_ENTRIES.map(([key, , de]) => [key, de])),
		...SITE_SIDEBAR_COPY_BY_LOCALE.de,
	},
});

export function bundledSiteCopyForLocale(locale = 'en') {
	return localeLanguage(locale) === 'de' ? SITE_COPY_BY_LOCALE.de : SITE_COPY_BY_LOCALE.en;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
