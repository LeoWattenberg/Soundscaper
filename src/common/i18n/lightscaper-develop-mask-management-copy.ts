/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({
	menu: 'Manage masks…', title: 'Manage masks', mask: 'Mask', empty: 'No masks in this recipe.',
	bindings: 'Adjustments using this mask', bind: 'Use mask', duplicate: 'Duplicate mask', remove: 'Remove mask',
	noEffects: 'Add a global, detail or LUT adjustment to bind a mask.',
	bindingPolicy: 'Selecting an adjustment replaces its existing mask binding. Geometry adjustments cannot be bound. Changes remain local until Apply.',
	showOverlay: 'Show mask overlay', overlayEffect: 'Overlay effect', chooseEffect: 'Choose an adjustment',
	invalid: 'Choose a bound adjustment when showing the selected mask. The mask changes could not be applied.',
	apply: 'Apply changes', close: 'Close',
});
const DE: Readonly<Record<keyof typeof EN, string>> = Object.freeze({
	menu: 'Masken verwalten…', title: 'Masken verwalten', mask: 'Maske', empty: 'Keine Masken in diesem Rezept.',
	bindings: 'Anpassungen mit dieser Maske', bind: 'Maske verwenden', duplicate: 'Maske duplizieren', remove: 'Maske entfernen',
	noEffects: 'Eine globale, Detail- oder LUT-Anpassung hinzufügen, um eine Maske zuzuweisen.',
	bindingPolicy: 'Die Auswahl einer Anpassung ersetzt deren bisherige Maskenzuweisung. Geometrieanpassungen können nicht zugewiesen werden. Änderungen bleiben bis zum Anwenden lokal.',
	showOverlay: 'Maskenüberlagerung anzeigen', overlayEffect: 'Anpassung für die Überlagerung', chooseEffect: 'Anpassung auswählen',
	invalid: 'Für die Anzeige der gewählten Maske eine zugewiesene Anpassung auswählen. Die Maskenänderungen konnten nicht angewendet werden.',
	apply: 'Änderungen anwenden', close: 'Schließen',
});

export function photoDevelopMaskManagementCopy(locale: string): Readonly<Record<keyof typeof EN, string>> {
	return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN;
}
