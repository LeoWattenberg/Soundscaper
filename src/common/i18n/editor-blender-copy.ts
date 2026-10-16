/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const BLENDER_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		exportTracks: 'Export track list for Blender',
		startSync: 'Start live Blender sync',
		stopSync: 'Stop live Blender sync',
		exportReady: 'The Blender bundle is ready. In Blender Preferences, install soundscaper_blender.py from the bundle folder as an add-on. Then choose File > Import > Soundscaper track list (.json) and open soundscaper.json.',
		syncReady: 'Live Blender sync is running. In Blender Preferences, install soundscaper_blender.py from the bundle folder as an add-on. In Blender’s Sequencer, choose Add > Start Soundscaper live sync and open soundscaper.json. Edits will update Blender after the audio finishes rendering.',
	}),
	de: Object.freeze({
		exportTracks: 'Spurliste für Blender exportieren',
		startSync: 'Live-Synchronisierung mit Blender starten',
		stopSync: 'Live-Synchronisierung mit Blender beenden',
		exportReady: 'Das Blender-Paket ist bereit. Installieren Sie soundscaper_blender.py aus dem Paketordner in Blenders Einstellungen als Add-on. Wählen Sie dann Datei > Importieren > Soundscaper track list (.json) und öffnen Sie soundscaper.json.',
		syncReady: 'Die Live-Synchronisierung mit Blender läuft. Installieren Sie soundscaper_blender.py aus dem Paketordner in Blenders Einstellungen als Add-on. Wählen Sie in Blenders Sequencer Add > Start Soundscaper live sync und öffnen Sie soundscaper.json. Änderungen erscheinen in Blender, sobald das Audio gerendert wurde.',
	}),
});

export function resolveBlenderCopy(copy: Readonly<Record<string, unknown>> = {}) {
	return resolveEditorCopyScope('blender', BLENDER_COPY_BY_LOCALE.en, copy);
}
