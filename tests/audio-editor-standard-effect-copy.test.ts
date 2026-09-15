/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { bundledCopyForLocale, ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { canonicalCopyValue, effectCardCopyKey } from '../src/common/i18n/canonical-extras.js';
import { localizedValue } from '../src/common/i18n/locale.js';

// The JavaScript resolver accepts catalog objects; its inferred signature
// describes only the string default. Keep that runtime boundary in this test.
const resolveCanonicalCopy = canonicalCopyValue as unknown as (
	key: string, copyOrLocale?: string | Readonly<Record<string, string>>
) => string;

test('standard effect card titles resolve from bundled catalogs in regional English and German locales', () => {
	for (const [title, german] of [
		['Notch filter', 'Kerbfilter'],
		['Shelf filter', 'Shelving-Filter'],
		['Modulation', 'Modulation'],
		['Carrier', 'Trägersignal'],
		['Vocoder', 'Vocoder'],
	]) {
		const key = effectCardCopyKey(title);
		for (const [locale, expected] of [['en-GB', title], ['de-AT', german]]) {
			const catalog = bundledCopyForLocale(locale) as Readonly<Record<string, string>>;
			assert.equal(catalog[key], expected, `${locale}: ${title}`);
			assert.equal(resolveCanonicalCopy(key, locale), expected, `${locale}: ${title}`);
			assert.equal(resolveCanonicalCopy(key, catalog), expected, 'resolved catalog objects preserve the same card copy');
		}
	}
	const carrierKey = effectCardCopyKey('Carrier');
	assert.equal(resolveCanonicalCopy(carrierKey, { [carrierKey]: 'External carrier' }), 'External carrier',
		'custom catalogs can localize the new carrier card');
});

test('localized control labels prefer a regional translation, then their language, then English', () => {
	const label = {
		en: ENGLISH_COPY.effectParamHighpassFilterFrequency,
		de: GERMAN_COPY.effectParamHighpassFilterFrequency,
		'de-CH': 'Grenzfrequenz (Schweiz)',
	};
	assert.equal(localizedValue(label, 'de_CH'), 'Grenzfrequenz (Schweiz)');
	assert.equal(localizedValue(label, 'de-AT'), 'Grenzfrequenz');
	assert.equal(localizedValue(label, 'en-GB'), 'Cutoff frequency');
	assert.equal(localizedValue(label, 'fr-CA'), 'Cutoff frequency');
	assert.equal(localizedValue(label, 'invalid_locale_tag'), 'Cutoff frequency');
});

test('locale-independent parameter labels and numeric phase values remain readable', () => {
	assert.equal(localizedValue('Q', 'de-DE'), 'Q');
	assert.equal(localizedValue(0, 'de-DE'), '0');
	assert.equal(localizedValue(null, 'de-DE'), '');
	assert.equal(localizedValue(undefined, 'de-DE'), '');
});
