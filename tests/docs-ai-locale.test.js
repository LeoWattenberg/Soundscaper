import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMITTED_LOCALE_TAGS } from '../src/common/i18n/locales.js';
import { assertDocumentationLocale, assertLocale, expectedScriptPattern } from '../scripts/docs-ai/locale.mjs';

test('a Latin-script locale is held to its own function words', () => {
	assert.doesNotThrow(() => assertLocale(
		'Dies ist eine deutsche Anleitung für das Projekt und die Datei wird lokal gespeichert.',
		'de',
	));
	assert.doesNotThrow(() => assertLocale(
		'Ce guide explique comment le projet est enregistré sur votre appareil et pas sur un serveur.',
		'fr',
	));
	assert.throws(
		() => assertLocale('This is an English guide and the project is stored locally with the file.', 'de'),
		/expected German/u,
	);
	assert.throws(
		() => assertLocale('This is an English guide and the project is stored locally with the file.', 'fr'),
		/expected French/u,
	);
});

/**
 * The failure a local model actually produces for a language it is weak in is
 * an English answer reported as a success, so English prose filed under a
 * non-Latin locale has to be refused even though every structural check on it
 * passes.
 */
test('a locale with a script of its own must answer in that script', () => {
	assert.doesNotThrow(() => assertLocale(
		'このガイドではプロジェクトがローカルに保存される仕組みを説明します。書き出しの手順も含みます。',
		'ja',
	));
	assert.doesNotThrow(() => assertLocale(
		'Это руководство объясняет, как проект сохраняется локально и как его затем экспортировать.',
		'ru',
	));
	for (const locale of ['ja', 'ru', 'ar', 'el', 'he', 'hi', 'hy', 'ko', 'zh-CN', 'zh-TW', 'fa', 'uk']) {
		assert.throws(
			() => assertLocale('This is an English guide and the project is stored locally with the file.', locale),
			/does not appear to use the expected/u,
			`English prose passed as ${locale}`,
		);
	}
});

/** Product names, units and code stay Latin in every language, so a little Latin is normal. */
test('protected structures and product names do not count against a locale', () => {
	assert.doesNotThrow(() => assertLocale(
		'Soundscaper は `file.export` コマンドでプロジェクトを書き出します。詳しくは [ガイド](/guides/) を参照してください。',
		'ja',
	));
});

test('prose too short to judge is accepted for every locale', () => {
	for (const locale of COMMITTED_LOCALE_TAGS) assert.doesNotThrow(() => assertLocale('Soundscaper', locale));
});

test('an English draft that answered in another language is refused', () => {
	assert.doesNotThrow(() => assertLocale('This is an English guide and the project is stored locally.', 'en'));
	assert.throws(
		() => assertLocale('Dies ist eine deutsche Anleitung für das Projekt und die Datei wird gespeichert.', 'en'),
		/expected English/u,
	);
});

test('only a committed route locale may be written or checked', () => {
	assert.equal(assertDocumentationLocale('pt-BR'), 'pt-BR');
	assert.throws(() => assertDocumentationLocale('kl'), /Unsupported locale/u);
	assert.throws(() => assertLocale('Text', 'kl'), /Unsupported locale/u);
});

test('every committed locale declares which of the two checks applies to it', () => {
	for (const locale of COMMITTED_LOCALE_TAGS) {
		if (new Intl.Locale(locale).language === 'en' || expectedScriptPattern(locale)) continue;
		assert.throws(
			() => assertLocale('This is an English guide and the project is stored locally with the file.', locale),
			/does not appear to use the expected/u,
			`${locale} has neither a script of its own nor function words that outvote English`,
		);
	}
});
