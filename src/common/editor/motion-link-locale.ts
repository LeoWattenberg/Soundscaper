/* SPDX-License-Identifier: AGPL-3.0-only */
import { localeLanguage, normalizeBcp47Locale } from '../i18n/locale.js';
import { TRANSLATION_CATALOG_LOCALES } from '../i18n/translations/index.js';

const languages = new Set<string>(['en', 'de', ...TRANSLATION_CATALOG_LOCALES]);

/** A language selects committed copy; it confers no bridge or file authority. */
export function assertMotionLinkLocale(value: unknown): string {
	if (typeof value !== 'string' || value.length > 64 || !languages.has(value)) throw new Error('Motion bridge language is unavailable.');
	return value;
}

/** Preserve a selected catalog's full tag; untranslated editor locales keep the human fallback. */
export function motionLinkLocaleForEditor(value: string): string {
	const locale = normalizeBcp47Locale(value);
	return languages.has(locale) ? locale : localeLanguage(locale) === 'de' ? 'de' : 'en';
}
