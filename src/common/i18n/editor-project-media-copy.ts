/* SPDX-License-Identifier: AGPL-3.0-only */

export const PROJECT_MEDIA_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		projectChanged: 'The project changed while its media was being trimmed.',
		archiveStreamed: 'The archive was streamed straight to its destination and never held as readable bytes.',
		archiveUnreadable: 'The written archive could not be read back: {message}',
		noArchive: 'No archive has been written yet.',
	}),
	de: Object.freeze({
		projectChanged: 'Das Projekt wurde geändert, während seine Medien gekürzt wurden.',
		archiveStreamed: 'Das Archiv wurde direkt an seinem Ziel gespeichert und nie als lesbare Daten vorgehalten.',
		archiveUnreadable: 'Das geschriebene Archiv konnte nicht erneut gelesen werden: {message}',
		noArchive: 'Es wurde noch kein Archiv geschrieben.',
	}),
});

export const CROSS_PRODUCT_HANDOFF_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({ savedReport: '{saved}: {fileName}; {accepted} accepted, {omitted} omitted; {reportFileName}.' }),
	de: Object.freeze({ savedReport: '{saved}: {fileName}; {accepted} übernommen, {omitted} ausgelassen; {reportFileName}.' }),
});

export const IMPORT_STATUS_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({ notice: '{notice}' }),
	de: Object.freeze({ notice: '{notice}' }),
});
