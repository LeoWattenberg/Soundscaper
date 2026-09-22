/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const NYQUIST_ARCHIVE_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		getEffects: 'Get effects',
		description: 'Browse the archived Audacity Nyquist catalog. These third-party plug-ins may need Audacity features unavailable in the browser. Installed source stays in this browser; run it later from a Nyquist menu.',
		searchEffects: 'Search effects',
		effectCount: '{count} effects',
		installEffect: 'Install',
		removeEffect: 'Remove',
	}),
	de: Object.freeze({
		getEffects: 'Effekte herunterladen',
		description: 'Durchsuche das archivierte Audacity-Nyquist-Verzeichnis. Diese Plug-ins stammen von Dritten und können Audacity-Funktionen benötigen, die im Browser fehlen. Installierte Quellen bleiben in diesem Browser; du startest sie anschließend über das Nyquist-Menü.',
		searchEffects: 'Effekte suchen',
		effectCount: '{count} Effekte',
		installEffect: 'Installieren',
		removeEffect: 'Entfernen',
	}),
});

export function resolveNyquistArchiveCopy(copy = {}) {
	return resolveEditorCopyScope('nyquistArchive', NYQUIST_ARCHIVE_COPY_BY_LOCALE.en, copy);
}
