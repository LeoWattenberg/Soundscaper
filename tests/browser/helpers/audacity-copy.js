/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';

import { ENGLISH_COPY } from '../../../src/common/i18n/catalogs.js';
import { currentAudacityMessages } from '../../../src/common/i18n/audacity-catalog.js';
import { machineCopy } from './machine-copy.js';

const cache = new Map();

/**
 * The full resolved copy a locale shows once Audacity's reviewed strings are
 * laid over the machine layer, over English: `{...machineCopy(locale),
 * ...audacityMessages}`. Reading the catalog file directly keeps a spec
 * truthful whether or not the locale's Audacity catalog has been generated
 * yet.
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
		cache.set(locale, Object.freeze({ ...machineCopy(locale), ...messages }));
	}
	return cache.get(locale);
}
