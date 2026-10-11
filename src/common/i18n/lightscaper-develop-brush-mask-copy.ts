/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ menu: 'Brush mask…', title: 'Brush mask', mask: 'Brush mask', newMask: 'New brush mask',
	grid: 'Mask coverage grid', coordinates: 'Paint coverage in this grid, from zero on the left/top to one on the right/bottom. The grid maps to the image entering each selected adjustment. Apply to see the result on your photo; the mask overlay follows later crop and rotation.',
	local: 'Brush masks are stored in this browser library. Editable backup and project handoff are unavailable while a photo retains a brush mask.',
	width: 'Grid width', height: 'Grid height', create: 'Create grid', mode: 'Brush mode', paint: 'Paint', erase: 'Erase',
	radius: 'Brush radius', hardness: 'Brush hardness', opacity: 'Brush opacity', x: 'Stamp X', y: 'Stamp Y', stamp: 'Add stroke',
	undo: 'Undo stroke', redo: 'Redo stroke', strokes: 'Strokes', working: 'Preparing brush mask…',
	bindings: 'Adjustments', bind: 'Bind mask', effectEnabled: 'Enabled', noEffects: 'Add an adjustment before binding a mask.',
	showOverlay: 'Show mask overlay', overlayEffect: 'Overlay effect', chooseEffect: 'Choose an effect',
	apply: 'Apply brush mask', remove: 'Remove brush mask', close: 'Close',
	invalid: 'Check the grid, brush values and selected adjustments. An overlay needs an explicit selected adjustment.',
	failed: 'The brush mask action failed. Your saved photo is unchanged.', cleanup: 'The mask was stored, but cleanup reported a failure.' });
const DE: Readonly<Record<keyof typeof EN, string>> = Object.freeze({ menu: 'Pinselmaske…', title: 'Pinselmaske', mask: 'Pinselmaske', newMask: 'Neue Pinselmaske',
	grid: 'Maskenraster', coordinates: 'Male die Abdeckung in diesem Raster, von null links/oben bis eins rechts/unten. Das Raster bezieht sich auf das Bild am Eingang jeder gewählten Anpassung. Wende die Maske an, um das Ergebnis im Foto zu sehen; die Maskenüberlagerung folgt anschließendem Zuschnitt und Drehen.',
	local: 'Pinselmasken werden in dieser Browser-Bibliothek gespeichert. Bearbeitbare Sicherung und Projektübergabe sind nicht verfügbar, solange ein Foto eine Pinselmaske behält.',
	width: 'Rasterbreite', height: 'Rasterhöhe', create: 'Raster erstellen', mode: 'Pinselmodus', paint: 'Malen', erase: 'Radieren',
	radius: 'Pinselradius', hardness: 'Pinselhärte', opacity: 'Pinseldeckkraft', x: 'Stempel X', y: 'Stempel Y', stamp: 'Strich hinzufügen',
	undo: 'Strich rückgängig', redo: 'Strich wiederholen', strokes: 'Striche', working: 'Pinselmaske wird vorbereitet…',
	bindings: 'Anpassungen', bind: 'Maske zuweisen', effectEnabled: 'Aktiviert', noEffects: 'Füge eine Anpassung hinzu, bevor du eine Maske zuweist.',
	showOverlay: 'Maskenüberlagerung anzeigen', overlayEffect: 'Überlagerte Anpassung', chooseEffect: 'Anpassung wählen',
	apply: 'Pinselmaske anwenden', remove: 'Pinselmaske entfernen', close: 'Schließen',
	invalid: 'Prüfe Raster, Pinselwerte und gewählte Anpassungen. Eine Überlagerung benötigt eine ausdrücklich gewählte Anpassung.',
	failed: 'Die Pinselaktion ist fehlgeschlagen. Das gespeicherte Foto bleibt unverändert.', cleanup: 'Die Maske wurde gespeichert, aber bei der Bereinigung ist ein Fehler aufgetreten.' });
export function photoDevelopBrushMaskCopy(locale: string) { return locale === 'de' ? DE : EN; }
