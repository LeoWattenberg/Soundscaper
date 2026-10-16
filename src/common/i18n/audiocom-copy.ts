/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

const ENGLISH = Object.freeze({
	panel: 'audio.com', siteName: 'audio.com', searchLabel: 'Search audio.com',
	searchPlaceholder: 'Search audio', search: 'Search', searching: 'Searching audio.com…',
	searchPrompt: 'Connect to audio.com to search and share audio.', noResults: 'No audio matches this search.',
	results: 'audio.com results', resultsCount: '{count} results', searchError: 'The audio.com search failed.',
	page: 'Page {page} of {pages}', pageNumber: 'Page {page}', pagination: 'audio.com result pages',
	previousPage: 'Previous', nextPage: 'Next', byInline: 'by', playPreview: 'Play preview', stopPreview: 'Stop preview',
	resultsProvidedBy: 'Results provided by', connect: 'Connect to audio.com', connecting: 'Connecting to audio.com…',
	disconnect: 'Disconnect', checkingAccount: 'Checking audio.com account…', connectedAs: 'Connected as {username}',
	connected: 'Connected to audio.com', accountName: 'audio.com account', uploadHeading: 'Upload to audio.com',
	openLinkError: 'The audio.com link could not be opened.',
	uploadDrop: 'Drop audio files here', chooseFiles: 'Choose audio files',
	uploadFileTypes: 'WAV, MP3, FLAC, WavPack, AIFF, OGG and M4A. Maximum 100 MB per file in Soundscaper.',
	uploadQueue: 'Audio upload queue', title: 'Title', description: 'Description', category: 'Category', license: 'License',
	visibility: 'Visibility', listed: 'Listed', unlisted: 'Unlisted',
	unlistedNotice: 'Anyone with the link can listen to unlisted audio. Unlisted audio is not private.',
	downloadable: 'Allow other people to download this audio', publish: 'Publish', publishSettings: 'Publish settings',
	cancel: 'Cancel', retry: 'Retry', remove: 'Remove', openAudio: 'Open on audio.com',
	statusDraft: 'Ready to publish', statusQueued: 'Queued', statusUploading: 'Uploading…',
	statusProcessing: 'Submitted for processing', statusComplete: 'Published', statusError: 'Upload failed', statusCancelled: 'Upload cancelled',
	uploadRights: 'Upload only audio you have the rights to share.',
	uploadRightsConsent: 'I confirm that I have the rights to publish this audio.',
	uploadError: 'The audio could not be added to the upload queue.', publishError: 'The audio.com upload failed.',
	projectApiUnavailable: 'Audacity project upload and retrieval are not available through the public audio.com API.',
	providerServer: 'Connected storage server:', projectArchives: 'Project archives', chooseProjectArchive: 'Upload AUP3 or AUP4',
	projectArchiveNotice: 'Upload a standalone AUP3 or AUP4 export. Close it in Audacity first. Downloads preserve the file; use File → Open to edit it. Native cloud block snapshots are not included.',
	projectArchiveLimit: 'Maximum {size} MB per archive. Each upload creates a separate stored project.',
	projectArchiveSize: '{format} · {size} MB',
	refreshProjects: 'Refresh projects', downloadProject: 'Download project', projectPages: 'Project archive pages',
	projectsLoading: 'Loading project archives…', projectUploading: 'Uploading project archive…', projectDownloading: 'Downloading project archive…',
	projectUploaded: 'Stored {name}.', noProjects: 'No project archives on this page.',
	categoryMusic: 'Music', categoryPodcast: 'Podcast', categoryVoiceOver: 'Voice-over', categorySoundDesign: 'Sound design',
	categoryCover: 'Cover', categoryBeats: 'Beats', categoryAudiobook: 'Audiobook', categoryRecording: 'Recording', categoryOther: 'Other',
	licenseNone: 'No license chosen', licenseArr: 'All rights reserved', licenseCc0: 'CC0', licenseCcBy: 'CC BY',
	licenseCcBySa: 'CC BY-SA', licenseCcByNc: 'CC BY-NC', licenseCcByNcSa: 'CC BY-NC-SA',
	licenseCcByNd: 'CC BY-ND', licenseCcByNcNd: 'CC BY-NC-ND',
});

export type AudiocomCopy = { readonly [Key in keyof typeof ENGLISH]: string };

const GERMAN: AudiocomCopy = Object.freeze({
	panel: 'audio.com', siteName: 'audio.com', searchLabel: 'audio.com durchsuchen',
	searchPlaceholder: 'Audio suchen', search: 'Suchen', searching: 'audio.com wird durchsucht…',
	searchPrompt: 'Verbinde dich mit audio.com, um Audio zu suchen und zu teilen.', noResults: 'Keine Audiodateien entsprechen dieser Suche.',
	results: 'audio.com-Ergebnisse', resultsCount: '{count} Ergebnisse', searchError: 'Die audio.com-Suche ist fehlgeschlagen.',
	page: 'Seite {page} von {pages}', pageNumber: 'Seite {page}', pagination: 'audio.com-Ergebnisseiten',
	previousPage: 'Zurück', nextPage: 'Weiter', byInline: 'von', playPreview: 'Vorschau abspielen', stopPreview: 'Vorschau stoppen',
	resultsProvidedBy: 'Ergebnisse von', connect: 'Mit audio.com verbinden', connecting: 'Verbindung mit audio.com wird hergestellt…',
	disconnect: 'Trennen', checkingAccount: 'audio.com-Konto wird geprüft…', connectedAs: 'Verbunden als {username}',
	connected: 'Mit audio.com verbunden', accountName: 'audio.com-Konto', uploadHeading: 'Auf audio.com hochladen',
	openLinkError: 'Der audio.com-Link konnte nicht geöffnet werden.',
	uploadDrop: 'Audiodateien hier ablegen', chooseFiles: 'Audiodateien auswählen',
	uploadFileTypes: 'WAV, MP3, FLAC, WavPack, AIFF, OGG und M4A. In Soundscaper höchstens 100 MB pro Datei.',
	uploadQueue: 'Audio-Upload-Warteschlange', title: 'Titel', description: 'Beschreibung', category: 'Kategorie', license: 'Lizenz',
	visibility: 'Sichtbarkeit', listed: 'Öffentlich gelistet', unlisted: 'Nicht gelistet',
	unlistedNotice: 'Alle mit dem Link können nicht gelistetes Audio anhören. Nicht gelistetes Audio ist nicht privat.',
	downloadable: 'Anderen den Download dieser Audiodatei erlauben', publish: 'Veröffentlichen', publishSettings: 'Veröffentlichungseinstellungen',
	cancel: 'Abbrechen', retry: 'Erneut versuchen', remove: 'Entfernen', openAudio: 'Auf audio.com öffnen',
	statusDraft: 'Bereit zur Veröffentlichung', statusQueued: 'In Warteschlange', statusUploading: 'Wird hochgeladen…',
	statusProcessing: 'Zur Verarbeitung eingereicht', statusComplete: 'Veröffentlicht', statusError: 'Upload fehlgeschlagen', statusCancelled: 'Upload abgebrochen',
	uploadRights: 'Lade nur Audio hoch, das du teilen darfst.',
	uploadRightsConsent: 'Ich bestätige, dass ich die Rechte zur Veröffentlichung dieses Audios habe.',
	uploadError: 'Das Audio konnte nicht zur Upload-Warteschlange hinzugefügt werden.', publishError: 'Der audio.com-Upload ist fehlgeschlagen.',
	projectApiUnavailable: 'Das Hochladen und Abrufen von Audacity-Projekten ist über die öffentliche audio.com-API nicht verfügbar.',
	providerServer: 'Verbundener Speicherserver:', projectArchives: 'Projektarchive', chooseProjectArchive: 'AUP3 oder AUP4 hochladen',
	projectArchiveNotice: 'Lade einen eigenständigen AUP3- oder AUP4-Export hoch. Schließe das Projekt zuvor in Audacity. Downloads erhalten die Datei; bearbeite sie über Datei → Öffnen. Native Cloud-Blocksnapshots sind nicht enthalten.',
	projectArchiveLimit: 'Höchstens {size} MB pro Archiv. Jeder Upload erstellt ein separates gespeichertes Projekt.',
	projectArchiveSize: '{format} · {size} MB',
	refreshProjects: 'Projekte aktualisieren', downloadProject: 'Projekt herunterladen', projectPages: 'Projektarchivseiten',
	projectsLoading: 'Projektarchive werden geladen…', projectUploading: 'Projektarchiv wird hochgeladen…', projectDownloading: 'Projektarchiv wird heruntergeladen…',
	projectUploaded: '{name} gespeichert.', noProjects: 'Keine Projektarchive auf dieser Seite.',
	categoryMusic: 'Musik', categoryPodcast: 'Podcast', categoryVoiceOver: 'Sprachaufnahme', categorySoundDesign: 'Sounddesign',
	categoryCover: 'Cover', categoryBeats: 'Beats', categoryAudiobook: 'Hörbuch', categoryRecording: 'Aufnahme', categoryOther: 'Sonstiges',
	licenseNone: 'Keine Lizenz ausgewählt', licenseArr: 'Alle Rechte vorbehalten', licenseCc0: 'CC0', licenseCcBy: 'CC BY',
	licenseCcBySa: 'CC BY-SA', licenseCcByNc: 'CC BY-NC', licenseCcByNcSa: 'CC BY-NC-SA',
	licenseCcByNd: 'CC BY-ND', licenseCcByNcNd: 'CC BY-NC-ND',
});

export const AUDIOCOM_COPY_BY_LOCALE = Object.freeze({ en: ENGLISH, de: GERMAN });

/** Panel copy loads with the opt-in panel rather than the initial editor graph. */
export function audiocomCopy(locale: unknown, publishedCopy: Readonly<Record<string, unknown>> = {}): AudiocomCopy {
	const base: AudiocomCopy = String(locale ?? 'en').toLowerCase().startsWith('de') ? GERMAN : ENGLISH;
	return resolveEditorCopyScope('audiocom', base, publishedCopy);
}
