/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EffectMacroTemplateCopy {
	readonly templates: string;
	readonly restoration: string;
	readonly profileRequired: string;
	readonly replaceTitle: string;
	readonly replaceAction: string;
	readonly replaceDescription: string;
}

const ENGLISH: EffectMacroTemplateCopy = Object.freeze({
	templates: 'Built-in templates',
	restoration: 'Restoration',
	profileRequired: 'Capture a noise profile in every Noise Reduction step before running this macro.',
	replaceTitle: 'Replace macro?',
	replaceAction: 'Replace macro',
	replaceDescription: 'The Restoration template replaces the current macro with Click Removal, Noise Reduction, and Filter Curve EQ.',
});

const GERMAN: EffectMacroTemplateCopy = Object.freeze({
	templates: 'Integrierte Vorlagen',
	restoration: 'Restaurierung',
	profileRequired: 'Ermitteln Sie für jeden Schritt zur Rauschunterdrückung ein Rauschprofil, bevor Sie dieses Makro ausführen.',
	replaceTitle: 'Makro ersetzen?',
	replaceAction: 'Makro ersetzen',
	replaceDescription: 'Die Restaurierungsvorlage ersetzt das aktuelle Makro durch Klickentfernung, Rauschunterdrückung und Filterkurven-EQ.',
});

/** Keep the focused template UI localized without growing the legacy catalog. */
export function resolveEffectMacroTemplateCopy(locale?: string): EffectMacroTemplateCopy {
	return locale?.toLowerCase().startsWith('de') ? GERMAN : ENGLISH;
}
