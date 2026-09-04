/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EffectMacroTemplateCopy {
	readonly templates: string;
	readonly restoration: string;
	/** One label per built-in template, keyed by its id. */
	readonly names: Readonly<Record<string, string>>;
	readonly profileRequired: string;
}

const ENGLISH: EffectMacroTemplateCopy = Object.freeze({
	templates: 'Built-in templates',
	restoration: 'Restoration',
	names: Object.freeze({ restoration: 'Restoration', 'fade-ends': 'Fade ends' }),
	profileRequired: 'Capture a noise profile in every Noise Reduction step before running this macro.',
});

const GERMAN: EffectMacroTemplateCopy = Object.freeze({
	templates: 'Integrierte Vorlagen',
	restoration: 'Restaurierung',
	names: Object.freeze({ restoration: 'Restaurierung', 'fade-ends': 'Enden ausblenden' }),
	profileRequired: 'Ermitteln Sie für jeden Schritt zur Rauschunterdrückung ein Rauschprofil, bevor Sie dieses Makro ausführen.',
});

/** Keep the focused template UI localized without growing the legacy catalog. */
export function resolveEffectMacroTemplateCopy(locale?: string): EffectMacroTemplateCopy {
	return locale?.toLowerCase().startsWith('de') ? GERMAN : ENGLISH;
}
