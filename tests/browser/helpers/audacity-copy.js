/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';

import { ENGLISH_COPY, GERMAN_COPY } from '../../../src/common/i18n/catalogs.js';
import { currentAudacityMessages } from '../../../src/common/i18n/audacity-catalog.js';
import { localeLanguage } from '../../../src/common/i18n/locale.js';
import { machineCopy } from './machine-copy.js';

const cache = new Map();

/**
 * The copy a locale resolves to, composed the way the runtime composes it:
 * English, the bundled German for German locales, the committed machine
 * catalog, and Audacity's committed reviewed strings on top. Reading the
 * files directly keeps a spec truthful about what the page actually shows.
 */
export function audacityCopy(locale) {
	if (!cache.has(locale)) {
		let messages = {};
		try {
			const catalog = JSON.parse(readFileSync(new URL(`../../../src/common/i18n/audacity/${locale}.json`, import.meta.url), 'utf8'));
			messages = currentAudacityMessages(catalog, ENGLISH_COPY, { locale });
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		const bundled = localeLanguage(locale) === 'de' ? GERMAN_COPY : {};
		cache.set(locale, Object.freeze({ ...machineCopy(locale), ...bundled, ...messages }));
	}
	return cache.get(locale);
}
