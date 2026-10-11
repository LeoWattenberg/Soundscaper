/* SPDX-License-Identifier: AGPL-3.0-only */

export interface PhotoDevelopRepairSpotsCopyV1 {
	readonly menu: string; readonly title: string; readonly original: string;
	readonly spot: string; readonly newSpot: string; readonly mode: string;
	readonly clone: string; readonly heal: string; readonly add: string; readonly remove: string;
	readonly moveUp: string; readonly moveDown: string;
	readonly targetX: string; readonly targetY: string; readonly sourceX: string; readonly sourceY: string;
	readonly radius: string; readonly feather: string; readonly opacity: string; readonly enabled: string;
	readonly tool: string; readonly target: string; readonly source: string;
	readonly visualize: string; readonly threshold: string; readonly edgeHelp: string;
	readonly apply: string; readonly close: string; readonly working: string;
	readonly failed: string; readonly invalid: string; readonly noOriginal: string;
}

const EN: Readonly<PhotoDevelopRepairSpotsCopyV1> = Object.freeze({
	menu: 'Repair spots…', title: 'Repair spots', original: 'Original', spot: 'Spot', newSpot: 'New spot', mode: 'Mode', clone: 'Clone', heal: 'Heal',
	add: 'Add spot', remove: 'Remove spot', moveUp: 'Move up', moveDown: 'Move down', targetX: 'Target X', targetY: 'Target Y', sourceX: 'Source X', sourceY: 'Source Y',
	radius: 'Radius', feather: 'Feather', opacity: 'Opacity', enabled: 'Enabled', tool: 'Move', target: 'Target', source: 'Source',
	visualize: 'Visualize spots', threshold: 'Edge threshold', edgeHelp: 'Original edge contrast aid; this does not detect dust automatically.',
	apply: 'Apply repairs', close: 'Close', working: 'Preparing Original…', failed: 'The repair could not be completed.', invalid: 'Check the repair values.',
	noOriginal: 'The authenticated Original is unavailable.',
});
const DE: Readonly<PhotoDevelopRepairSpotsCopyV1> = Object.freeze({
	menu: 'Flecken reparieren…', title: 'Flecken reparieren', original: 'Original', spot: 'Fleck', newSpot: 'Neuer Fleck', mode: 'Modus', clone: 'Klonen', heal: 'Heilen',
	add: 'Fleck hinzufügen', remove: 'Fleck entfernen', moveUp: 'Nach oben', moveDown: 'Nach unten', targetX: 'Ziel X', targetY: 'Ziel Y', sourceX: 'Quelle X', sourceY: 'Quelle Y',
	radius: 'Radius', feather: 'Weicher Rand', opacity: 'Deckkraft', enabled: 'Aktiviert', tool: 'Bewegen', target: 'Ziel', source: 'Quelle',
	visualize: 'Flecken visualisieren', threshold: 'Kanten-Schwellenwert', edgeHelp: 'Kontrasthilfe für Originalkanten; Staub wird nicht automatisch erkannt.',
	apply: 'Reparaturen anwenden', close: 'Schließen', working: 'Original wird vorbereitet…', failed: 'Die Reparatur konnte nicht abgeschlossen werden.', invalid: 'Reparaturwerte prüfen.',
	noOriginal: 'Das authentifizierte Original ist nicht verfügbar.',
});
export function photoDevelopRepairSpotsCopy(locale: string): Readonly<PhotoDevelopRepairSpotsCopyV1> { return locale === 'de' ? DE : EN; }
