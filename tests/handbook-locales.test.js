import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	HANDBOOK_SOURCE_LOCALE,
	handbookLocaleDirectory,
	handbookLocaleForPath,
	handbookLocaleRoute,
	handbookLocaleSegment,
	handbookLocales,
	handbookTranslationLocales,
	starlightLocaleConfig,
} from '../scripts/lib/handbook-locales.mjs';

async function contentTree(context, directories) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-handbook-locales-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	for (const directory of directories) await mkdir(join(root, directory), { recursive: true });
	return root;
}

test('a language is published by having a directory, in the editor\'s locale order', async (context) => {
	const root = await contentTree(context, ['guides', 'fr', 'pt-br', 'ja', 'drafts']);

	assert.deepEqual(handbookTranslationLocales(root), ['fr', 'ja', 'pt-BR']);
	assert.deepEqual(handbookLocales(root).map(({ locale }) => locale), ['en', 'fr', 'ja', 'pt-BR']);
	assert.deepEqual(handbookTranslationLocales(join(root, 'nowhere')), []);
});

/**
 * Astro lowercases the slug it derives from a content path, and Starlight
 * decides a page's language from that slug's first segment. A directory named
 * `pt-BR` is therefore read as an English page filed under `pt-br`, which
 * builds a whole duplicate page tree under a language that does not exist, so
 * the directory name has to be the lowercased tag while the canonical tag stays
 * the language the document declares.
 */
test('a locale is a lowercase directory but declares its canonical tag', async (context) => {
	const root = await contentTree(context, ['pt-br', 'zh-cn']);

	assert.equal(handbookLocaleSegment('pt-BR'), 'pt-br');
	assert.equal(handbookLocaleDirectory('pt-BR'), 'pt-br/');
	assert.equal(handbookLocaleDirectory(HANDBOOK_SOURCE_LOCALE), '');
	assert.equal(handbookLocaleRoute('zh-CN'), '/zh-cn/');
	assert.equal(handbookLocaleRoute(HANDBOOK_SOURCE_LOCALE), '/');
	assert.deepEqual(starlightLocaleConfig(root), {
		root: { label: 'English', lang: 'en', dir: 'ltr' },
		'pt-br': { label: 'Português (Brasil)', lang: 'pt-BR', dir: 'ltr' },
		'zh-cn': { label: '简体中文', lang: 'zh-CN', dir: 'ltr' },
	});
});

test('a page belongs to the language its first path segment names', () => {
	assert.equal(handbookLocaleForPath('fr/guides/index.md'), 'fr');
	assert.equal(handbookLocaleForPath('pt-br/index.md'), 'pt-BR');
	assert.equal(handbookLocaleForPath('guides/index.md'), 'en');
	assert.equal(handbookLocaleForPath('index.md'), 'en');
	// A directory that only looks like a locale is an English page, not a language.
	assert.equal(handbookLocaleForPath('sv/index.md'), 'en');
	assert.equal(handbookLocaleForPath('pt-BR/index.md'), 'en');
});

test('a right-to-left language declares its direction to the site', async (context) => {
	const root = await contentTree(context, ['ar']);

	assert.deepEqual(starlightLocaleConfig(root).ar, { label: 'العربية', lang: 'ar', dir: 'rtl' });
});
