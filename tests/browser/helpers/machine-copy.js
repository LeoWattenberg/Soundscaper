/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';

import { ENGLISH_COPY } from '../../../src/common/i18n/catalogs.js';
import { currentMachineEntries } from '../../../src/common/i18n/machine-catalog.js';

const cache = new Map();

/**
 * The copy a locale shows for keys Audacity's pack does not carry: the
 * committed machine translations that are current against the English copy,
 * over English. Reading the file directly keeps a spec truthful whether or not
 * the locale's catalog has been generated yet.
 */
export function machineCopy(locale) {
	if (!cache.has(locale)) {
		let entries = {};
		try {
			const catalog = JSON.parse(readFileSync(new URL(`../../../src/common/i18n/machine/${locale}.json`, import.meta.url), 'utf8'));
			entries = currentMachineEntries(catalog, ENGLISH_COPY, { locale });
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		cache.set(locale, Object.freeze({ ...ENGLISH_COPY, ...entries }));
	}
	return cache.get(locale);
}
