import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	HANDBOOK_CHROME_COPY,
	HANDBOOK_CHROME_KEYS,
	assessChromeCatalog,
	chromeLabel,
	chromeRecord,
	readChromeCatalog,
} from '../scripts/lib/handbook-chrome.mjs';
import { translateChrome, validateChromeResponse } from '../scripts/docs-ai/chrome.mjs';
import { SOUNDSCAPER_GUIDE_GROUPS } from '../handbook/guides/soundscaper.mjs';

async function catalogDirectory(context, catalogs = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-handbook-chrome-'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	for (const [name, catalog] of Object.entries(catalogs)) {
		await writeFile(join(directory, `${name}.json`), JSON.stringify(catalog));
	}
	return directory;
}

test('every sidebar heading the site is configured with has a key', () => {
	for (const group of SOUNDSCAPER_GUIDE_GROUPS) {
		assert.equal(HANDBOOK_CHROME_COPY[`sidebar.guides.${group.slug}`], group.title, group.slug);
	}
	assert.ok(HANDBOOK_CHROME_KEYS.includes('site.title'));
	assert.ok(HANDBOOK_CHROME_KEYS.length > 20);
});

/**
 * Starlight looks a sidebar label up by the page's language tag, not by the
 * directory the language lives in, so a catalog keyed by the directory would
 * silently never be found.
 */
test('a heading offers each language what its catalog says, keyed by language tag', async (context) => {
	const directory = await catalogDirectory(context, {
		'pt-br': {
			locale: 'pt-BR',
			provenance: {},
			entries: { 'sidebar.help': ['Help', 'Ajuda'], 'site.title': ['Soundscaper Handbook', 'Manual do Soundscaper'] },
		},
	});

	assert.deepEqual(chromeLabel('sidebar.help', directory), { label: 'Help', translations: { 'pt-BR': 'Ajuda' } });
	assert.deepEqual(chromeRecord('site.title', directory), { en: 'Soundscaper Handbook', 'pt-BR': 'Manual do Soundscaper' });
});

test('a heading whose English has been rewritten falls back to English', async (context) => {
	const directory = await catalogDirectory(context, {
		fr: { locale: 'fr', provenance: {}, entries: { 'sidebar.help': ['Support', 'Assistance'] } },
	});

	assert.deepEqual(chromeLabel('sidebar.help', directory), { label: 'Help' });
	assert.deepEqual(chromeRecord('site.title', directory), { en: 'Soundscaper Handbook' });
});

test('a catalog is measured against the current English copy', async (context) => {
	const directory = await catalogDirectory(context, {
		fr: {
			locale: 'fr',
			provenance: {},
			entries: {
				'sidebar.help': [HANDBOOK_CHROME_COPY['sidebar.help'], 'Aide'],
				'sidebar.start': ['Something else', 'Autre chose'],
				'sidebar.retired': ['Retired', 'Retiré'],
			},
		},
	});

	const assessment = assessChromeCatalog(readChromeCatalog('fr', directory));

	assert.deepEqual(assessment.current, ['sidebar.help']);
	assert.deepEqual(assessment.stale, ['sidebar.start']);
	assert.deepEqual(assessment.orphaned, ['sidebar.retired']);
	assert.equal(assessment.missing.length, HANDBOOK_CHROME_KEYS.length - 2);
	assert.ok(assessment.pending.includes('sidebar.start'));
});

test('a navigation answer must be the requested labels and keep the product names', () => {
	const labels = { 'sidebar.help': 'Help', 'sidebar.framescaper': 'Framescaper' };
	const answer = (translations) => validateChromeResponse({ locale: 'fr', translations }, { targetLocale: 'fr', labels });

	assert.deepEqual(answer({ 'sidebar.help': 'Aide', 'sidebar.framescaper': 'Framescaper' }), {
		'sidebar.help': 'Aide',
		'sidebar.framescaper': 'Framescaper',
	});
	// A trailing ellipsis is a convention of some languages and is removed the
	// way the editor's own catalogs remove one.
	assert.equal(answer({ 'sidebar.help': 'Aide…', 'sidebar.framescaper': 'Framescaper' })['sidebar.help'], 'Aide');
	assert.throws(() => answer({ 'sidebar.help': 'Aide' }), /Missing translations/u);
	assert.throws(() => answer({ 'sidebar.help': 'Aide', 'sidebar.framescaper': 'Cadrescaper' }), /must stay "Framescaper"/u);
	assert.throws(() => answer({ 'sidebar.help': '', 'sidebar.framescaper': 'Framescaper' }), /must not be empty/u);
});

test('a run writes the headings a language owes and drops the ones that were removed', async (context) => {
	const directory = await catalogDirectory(context, {
		fr: { locale: 'fr', provenance: {}, entries: { 'sidebar.retired': ['Retired', 'Retiré'] } },
	});
	const client = {
		async identity() {
			return { model: 'aya-expanse:32b', digest: 'sha256:model' };
		},
		async generateJson({ prompt }) {
			const { labels } = JSON.parse(prompt.split('\n')[0]);
			return {
				locale: 'fr',
				translations: Object.fromEntries(Object.entries(labels).map(([key, label]) => [
					key,
					/^(?:Soundscaper|Framescaper)$/u.test(label) ? label : `Le ${label}`,
				])),
			};
		},
	};

	const summary = await translateChrome({ locale: 'fr', client, directory });

	assert.deepEqual(summary.skipped, []);
	assert.equal(summary.translated, HANDBOOK_CHROME_KEYS.length);
	assert.deepEqual(summary.orphaned, ['sidebar.retired']);
	const catalog = readChromeCatalog('fr', directory);
	assert.equal(catalog.entries['sidebar.help'][1], 'Le Help');
	assert.equal(catalog.entries['sidebar.framescaper'][1], 'Framescaper');
	assert.equal(catalog.entries['sidebar.retired'], undefined);
	assert.equal(catalog.provenance.promptVersion, 'docs-chrome-v1');

	const second = await translateChrome({ locale: 'fr', client, directory });
	assert.equal(second.translated, 0);
	assert.equal(second.current, HANDBOOK_CHROME_KEYS.length);
});
