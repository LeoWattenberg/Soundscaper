/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ menu: 'Linear gradient…', title: 'Linear gradient', gradient: 'Gradient', newGradient: 'New gradient',
	startX: 'Start X', startY: 'Start Y', endX: 'End X', endY: 'End Y', bindings: 'Adjustments using this gradient', bind: 'Use gradient', effectEnabled: 'Enabled',
	centerX: 'Center X', centerY: 'Center Y', radiusX: 'Radius X', radiusY: 'Radius Y', innerFraction: 'Inner full-coverage fraction',
	coordinates: 'Coordinates are normalized to the image entering each selected adjustment. The gradient rises from zero at Start to full coverage at End.',
	bindingPolicy: 'Selecting an adjustment replaces its existing mask binding. Crop, rotation and other geometry adjustments cannot be bound.',
	noEffects: 'Add a global, detail or LUT adjustment before creating a gradient.', showOverlay: 'Show mask overlay', overlayEffect: 'Overlay effect',
	chooseEffect: 'Choose an adjustment', maskOverlay: 'Mask coverage', overlayFailed: 'The mask overlay could not be displayed.',
	invalid: 'Choose at least one adjustment and two distinct finite endpoints. Choose an overlay adjustment when showing the mask.',
	apply: 'Apply gradient', remove: 'Remove gradient', close: 'Close',
});
const DE: Record<keyof typeof EN, string> = Object.freeze({ menu: 'Linearer Verlauf…', title: 'Linearer Verlauf', gradient: 'Verlauf', newGradient: 'Neuer Verlauf',
	startX: 'Start X', startY: 'Start Y', endX: 'Ende X', endY: 'Ende Y', bindings: 'Anpassungen mit diesem Verlauf', bind: 'Verlauf verwenden', effectEnabled: 'Aktiviert',
	centerX: 'Zentrum X', centerY: 'Zentrum Y', radiusX: 'Radius X', radiusY: 'Radius Y', innerFraction: 'Innerer Anteil mit voller Abdeckung',
	coordinates: 'Die Koordinaten beziehen sich auf das Bild am Eingang der gewählten Anpassung. Der Verlauf steigt von null am Start bis zur vollständigen Abdeckung am Ende.',
	bindingPolicy: 'Die Auswahl einer Anpassung ersetzt deren bisherige Maskenzuweisung. Zuschnitt, Drehung und andere Geometrieanpassungen können nicht zugewiesen werden.',
	noEffects: 'Vor dem Erstellen eines Verlaufs eine globale, Detail- oder LUT-Anpassung hinzufügen.', showOverlay: 'Maskenüberlagerung anzeigen', overlayEffect: 'Anpassung für die Überlagerung',
	chooseEffect: 'Anpassung auswählen', maskOverlay: 'Maskenabdeckung', overlayFailed: 'Die Maskenüberlagerung konnte nicht angezeigt werden.',
	invalid: 'Mindestens eine Anpassung und zwei verschiedene endliche Endpunkte wählen. Für die Maskenanzeige auch eine Anpassung auswählen.',
	apply: 'Verlauf anwenden', remove: 'Verlauf entfernen', close: 'Schließen',
});
const EN_RADIAL = Object.freeze({ ...EN, menu: 'Radial gradient…', title: 'Radial gradient',
	coordinates: 'Center and radii are normalized to the image entering each selected adjustment. Coverage is full inside the inner fraction and falls to zero at the outer ellipse. The inner fraction must be at least zero and less than one.',
	invalid: 'Choose at least one adjustment, a finite center, positive finite radii and an inner fraction from zero to less than one. Choose an overlay adjustment when showing the mask.',
});
const DE_RADIAL = Object.freeze({ ...DE, menu: 'Radialer Verlauf…', title: 'Radialer Verlauf',
	coordinates: 'Zentrum und Radien beziehen sich auf das Bild am Eingang der gewählten Anpassung. Innerhalb des inneren Anteils gilt die volle Abdeckung; sie fällt bis zur äußeren Ellipse auf null. Der innere Anteil muss mindestens null und kleiner als eins sein.',
	invalid: 'Mindestens eine Anpassung, ein endliches Zentrum, positive endliche Radien und einen inneren Anteil ab null und unter eins wählen. Für die Maskenanzeige auch eine Anpassung auswählen.',
});
export function photoDevelopLocalAdjustmentsCopy(locale: string, kind: 'linear-gradient' | 'radial-gradient' = 'linear-gradient'): Readonly<Record<keyof typeof EN, string>> {
	const german = locale.toLowerCase().split('-')[0] === 'de';
	if (kind === 'radial-gradient') return german ? DE_RADIAL : EN_RADIAL;
	return german ? DE : EN;
}
