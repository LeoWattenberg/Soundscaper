/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({
	menu: 'Manage masks…', title: 'Manage masks', mask: 'Mask', empty: 'No masks in this recipe.',
	name: 'Mask name', rename: 'Rename mask', nameHelp: 'Leave blank to clear the name.', nameInvalid: 'Use a name of up to 256 characters without control characters.',
	bindings: 'Adjustments using this mask', bind: 'Use mask', duplicate: 'Duplicate mask', remove: 'Remove mask',
	operand: 'Combine with mask', chooseOperand: 'Choose a mask', add: 'Add mask', subtract: 'Subtract mask', intersect: 'Intersect masks',
	compositionHelp: 'Combine the selected mask with another mask. Subtract removes the other mask’s coverage. Changes remain local until Apply.',
	noEffects: 'Add a global, detail or LUT adjustment to bind a mask.',
	bindingPolicy: 'Selecting an adjustment replaces its existing mask binding. Geometry adjustments cannot be bound. Changes remain local until Apply.',
	showOverlay: 'Show mask overlay', overlayEffect: 'Overlay effect', chooseEffect: 'Choose an adjustment',
	displayMode: 'Mask display', color: 'Color overlay', grayscale: 'Grayscale mask',
	invalid: 'Choose a bound adjustment when showing the selected mask. The mask changes could not be applied.',
	apply: 'Apply changes', close: 'Close',
});
const DE: Readonly<Record<keyof typeof EN, string>> = Object.freeze({
	menu: 'Masken verwalten…', title: 'Masken verwalten', mask: 'Maske', empty: 'Keine Masken in diesem Rezept.',
	name: 'Maskenname', rename: 'Maske umbenennen', nameHelp: 'Leer lassen, um den Namen zu entfernen.', nameInvalid: 'Einen Namen mit höchstens 256 Zeichen ohne Steuerzeichen verwenden.',
	bindings: 'Anpassungen mit dieser Maske', bind: 'Maske verwenden', duplicate: 'Maske duplizieren', remove: 'Maske entfernen',
	operand: 'Mit Maske kombinieren', chooseOperand: 'Maske auswählen', add: 'Maske addieren', subtract: 'Maske subtrahieren', intersect: 'Schnittmenge bilden',
	compositionHelp: 'Die ausgewählte Maske mit einer anderen kombinieren. Subtrahieren entfernt die Abdeckung der anderen Maske. Änderungen bleiben bis zum Anwenden lokal.',
	noEffects: 'Eine globale, Detail- oder LUT-Anpassung hinzufügen, um eine Maske zuzuweisen.',
	bindingPolicy: 'Die Auswahl einer Anpassung ersetzt deren bisherige Maskenzuweisung. Geometrieanpassungen können nicht zugewiesen werden. Änderungen bleiben bis zum Anwenden lokal.',
	showOverlay: 'Maskenüberlagerung anzeigen', overlayEffect: 'Anpassung für die Überlagerung', chooseEffect: 'Anpassung auswählen',
	displayMode: 'Maskenanzeige', color: 'Farbüberlagerung', grayscale: 'Graustufenmaske',
	invalid: 'Für die Anzeige der gewählten Maske eine zugewiesene Anpassung auswählen. Die Maskenänderungen konnten nicht angewendet werden.',
	apply: 'Änderungen anwenden', close: 'Schließen',
});

export function photoDevelopMaskManagementCopy(locale: string): Readonly<Record<keyof typeof EN, string>> {
	return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN;
}
