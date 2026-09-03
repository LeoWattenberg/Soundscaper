/* SPDX-License-Identifier: AGPL-3.0-only */

import { localeLanguage } from './locale.js';
import { SITE_SIDEBAR_COPY_BY_LOCALE } from './site-sidebar-copy.js';

const SITE_COPY_ENTRIES = Object.freeze([
	['framescaperEyebrow', 'Local video editing', 'Video lokal bearbeiten'],
	['framescaperTitle', 'Framescaper', 'Framescaper'],
	['framescaperIntro', 'Edit video and sound nondestructively, combine layers and effects, and export the finished video.', 'Schneide Video und Ton nondestruktiv, kombiniere Ebenen und Effekte und exportiere das fertige Video.'],
	['framescaperMetaDescription', 'Local-first video editor in your browser.', 'Lokaler Video-Editor im Browser.'],
	['eyebrow', 'Local multitrack audio editing', 'Mehrspur-Audio lokal bearbeiten'],
	['title', 'Soundscaper', 'Soundscaper'],
	['intro', 'Record audio, edit multiple tracks nondestructively, mix effects, and inspect loudness and frequency content.', 'Nimm Audio auf, schneide mehrere Spuren nondestruktiv, mische Effekte und prüfe Lautheit und Spektrum.'],
	['privacy', 'Your recordings, projects, and audio files stay on this device and are processed entirely in your browser.', 'Deine Aufnahmen, Projekte und Audiodateien bleiben auf diesem Gerät und werden ausschließlich in deinem Browser verarbeitet.'],
	['metaDescription', 'Local-first multitrack audio editor in your browser.', 'Lokaler Mehrspur-Audio-Editor im Browser.'],
	['introExpand', 'Show introduction', 'Einführung anzeigen'],
	['introCollapse', 'Hide introduction', 'Einführung ausblenden'],
	['workspace', 'Workspace', 'Arbeitsbereich'],
	['workspaceModern', 'Soundscaper', 'Soundscaper'],
	['workspaceAudacity', 'Audacity', 'Audacity'],
	['workspaceMusic', 'Music', 'Musik'],
	['workspaceClassic', 'Classic', 'Klassisch'],
	['workspaceVideo', 'Video editor', 'Video-Editor'],
	['loading', 'Loading project', 'Projekt wird geladen'],
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
