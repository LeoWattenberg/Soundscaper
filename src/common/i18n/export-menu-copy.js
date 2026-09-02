/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for the File > Export menu family.
 *
 * The export submenu is where the delivery and interchange work of milestone 6
 * surfaces, so it grows a format at a time: labels, then EDL, then the OTIO and
 * FCPXML profiles behind it. The main catalog sits at a maintainability
 * ceiling, and a menu that gains an entry per profile belongs behind its own
 * seam rather than pushing that ceiling up once per format.
 */
const EXPORT_MENU_COPY_ENTRIES = Object.freeze([
	['exportAudio', 'Export audio', 'Audio exportieren'],
	['exportVideo', 'Export video', 'Video exportieren'],
	['exportOther', 'Export other', 'Weitere Exporte'],
	['exportLabels', 'Export labels', 'Beschriftungen exportieren'],
	['exportEdl', 'Export edit list (EDL)', 'Schnittliste (EDL) exportieren'],
	['exportOtio', 'Export OpenTimelineIO', 'OpenTimelineIO exportieren'],
	['exportFcpxml', 'Export FCPXML', 'FCPXML exportieren'],
	['consolidateMedia', 'Consolidate media', 'Medien zusammenführen'],
	['consolidatingMedia', 'Consolidating media', 'Medien werden zusammengeführt'],
	['consolidatedMedia', 'Media consolidated', 'Medien zusammengeführt'],
	[
		'consolidatedMediaIncomplete',
		'Some media could not be consolidated',
		'Einige Medien konnten nicht zusammengeführt werden',
	],
	['trimMedia', 'Trim media to what is used', 'Medien auf Verwendetes kürzen'],
	['trimmingMedia', 'Trimming media', 'Medien werden gekürzt'],
	['trimmedMedia', 'Media trimmed', 'Medien gekürzt'],
	[
		'trimmedMediaIncomplete',
		'Some media could not be trimmed',
		'Einige Medien konnten nicht gekürzt werden',
	],
	['saveArchiveManifest', 'Save archive checksums', 'Archiv-Prüfsummen speichern'],
	['archiveManifestSaved', 'Archive checksums saved', 'Archiv-Prüfsummen gespeichert'],
]);

export const EXPORT_MENU_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(EXPORT_MENU_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(EXPORT_MENU_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
