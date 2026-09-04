/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EffectMacroTemplateCopy {
	readonly templates: string;
	readonly restoration: string;
	readonly profileRequired: string;
}

const ENGLISH: EffectMacroTemplateCopy = Object.freeze({
	templates: 'Built-in templates',
	restoration: 'Restoration',
	profileRequired: 'Capture a noise profile in every Noise Reduction step before running this macro.',
});

const GERMAN: EffectMacroTemplateCopy = Object.freeze({
	templates: 'Integrierte Vorlagen',
	restoration: 'Restaurierung',
	profileRequired: 'Ermitteln Sie für jeden Schritt zur Rauschunterdrückung ein Rauschprofil, bevor Sie dieses Makro ausführen.',
});

/** Keep the focused template UI localized without growing the legacy catalog. */
export function resolveEffectMacroTemplateCopy(locale?: string): EffectMacroTemplateCopy {
	return locale?.toLowerCase().startsWith('de') ? GERMAN : ENGLISH;
}
