import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	checkHandbook,
	listHandbookPages,
	listOrphanedTranslations,
	pruneOrphanedTranslations,
	translateHandbook,
} from '../scripts/docs-ai/handbook.mjs';

/**
 * A model that answers in French, except for the page titles named in
 * `refuse`, which it answers in English the way a model weak in a language
 * does.
 */
function frenchClient({ refuse = new Set() } = {}) {
	let page = null;
	return {
		async identity() {
			return { model: 'aya-expanse:32b', digest: 'sha256:model' };
		},
		async generateJson({ prompt }) {
			// A retry appends corrective feedback below the closed request.
			const request = JSON.parse(prompt.split('\n')[0]);
			if (request.title !== undefined) {
				page = request.title;
				return { locale: 'fr', title: `Titre ${request.title}`, description: request.description && `Description ${request.description}` };
			}
			const translated = refuse.has(page)
				? 'This is the page in English and it is not translated at all, and the model reports it as a success.'
				: 'Le contenu de la page est pour les lecteurs et il est dans une langue.';
			return { locale: 'fr', markdown: request.markdown.replace(/Body\./gu, translated) };
		},
	};
}

let cacheDirectory;

const PAGE = (title, extra = '') => [
	'---', `title: ${title}`, 'description: A page.', extra, '---', '', 'Body.', '',
].filter((line) => line !== '').join('\n');

async function tree(context, files) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-handbook-ai-'));
	cacheDirectory = join(root, '.cache');
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	for (const [path, content] of Object.entries(files)) {
		const filePath = join(root, ...path.split('/'));
		await mkdir(join(filePath, '..'), { recursive: true });
		await writeFile(filePath, content);
	}
	return root;
}

test('the English pages are the source and a language directory is not one of them', async (context) => {
	const root = await tree(context, {
		'index.md': PAGE('Home'),
		'guides/index.md': PAGE('Guides'),
		'fr/index.md': PAGE('Accueil'),
		'guides/notes.txt': 'not a page',
	});

	assert.deepEqual(await listHandbookPages(root), ['guides/index.md', 'index.md']);
});

test('a run translates what a language is missing and leaves what it already has', async (context) => {
	const root = await tree(context, { 'index.md': PAGE('Home'), 'guides/index.md': PAGE('Guides') });
	const client = frenchClient();

	const first = await translateHandbook({ locale: 'fr', root, client, cacheDirectory });
	assert.equal(first.translated, 2);
	assert.equal(first.current, 0);
	const translated = await readFile(join(root, 'fr', 'index.md'), 'utf8');
	assert.match(translated, /^---\ntitle: "Titre Home"/u);
	assert.match(translated, /docs-ai-provenance/u);
	assert.match(translated, /Le contenu de la page/u);

	const second = await translateHandbook({ locale: 'fr', root, client, cacheDirectory });
	assert.equal(second.translated, 0);
	assert.equal(second.current, 2);
	assert.equal(await readFile(join(root, 'fr', 'index.md'), 'utf8'), translated);
});

/** A page the model cannot answer acceptably is one page, not a language. */
test('a page the model answers badly is named and the rest of the language still lands', async (context) => {
	const root = await tree(context, { 'index.md': PAGE('Home'), 'guides/index.md': PAGE('Guides') });
	const client = frenchClient({ refuse: new Set(['Home']) });

	const summary = await translateHandbook({ locale: 'fr', root, client, cacheDirectory });

	assert.equal(summary.translated, 1);
	assert.deepEqual(summary.skipped.map(({ page }) => page), ['index.md']);
	assert.match(summary.skipped[0].reason, /French/u);
	await assert.rejects(readFile(join(root, 'fr', 'index.md'), 'utf8'));
});

/**
 * A hero action's link is data a Starlight component reads, which no Markdown
 * transform ever sees, so a translated page carries the language in it itself
 * or the reader leaves the language they are reading the moment they use it.
 */
test('a translated page points its frontmatter links at its own language', async (context) => {
	const hero = ['hero:', '  actions:', '    - text: Read', '      link: /docs/guides/'].join('\n');
	const root = await tree(context, { 'index.md': PAGE('Home', hero), 'guides/index.md': PAGE('Guides') });

	await translateHandbook({ locale: 'fr', root, client: frenchClient(), cacheDirectory });

	const translated = await readFile(join(root, 'fr', 'index.md'), 'utf8');
	assert.match(translated, /link: \/docs\/fr\/guides\//u);
	// The translation stays current on a second look, so the language it added
	// is not read back as a change to the page.
	const [report] = await checkHandbook({ locales: ['fr'], root });
	assert.equal(report.current, 2);
});

test('a page whose English has changed is owed again', async (context) => {
	const root = await tree(context, { 'index.md': PAGE('Home') });
	await translateHandbook({ locale: 'fr', root, client: frenchClient(), cacheDirectory });
	await writeFile(join(root, 'index.md'), PAGE('Home').replace('Body.', 'Body. And more.'));

	const [report] = await checkHandbook({ locales: ['fr'], root });

	assert.deepEqual(
		{ current: report.current, stale: report.stale, missing: report.missing },
		{ current: 0, stale: 1, missing: 0 },
	);
});

test('a translation of a page that no longer exists is reported and pruned on request', async (context) => {
	const root = await tree(context, {
		'index.md': PAGE('Home'),
		'fr/index.md': PAGE('Accueil'),
		'fr/retired/index.md': PAGE('Retiré'),
	});

	assert.deepEqual(await listOrphanedTranslations('fr', root), ['retired/index.md']);
	const summary = await translateHandbook({ locale: 'fr', root, client: frenchClient(), cacheDirectory });
	assert.deepEqual(summary.orphaned, ['retired/index.md']);

	assert.deepEqual(await pruneOrphanedTranslations('fr', root), ['retired/index.md']);
	assert.deepEqual(await listOrphanedTranslations('fr', root), []);
	await assert.rejects(readFile(join(root, 'fr', 'retired', 'index.md'), 'utf8'));
});

test('English is the source and cannot be a translation target', async (context) => {
	const root = await tree(context, { 'index.md': PAGE('Home') });

	await assert.rejects(
		translateHandbook({ locale: 'en', root, client: frenchClient(), cacheDirectory }),
		/English pages are the source/u,
	);
});
