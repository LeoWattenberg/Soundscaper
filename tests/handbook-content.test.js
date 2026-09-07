import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditHandbookContent } from '../scripts/lib/handbook-content-check.mjs';

test('the committed handbook has complete frontmatter and resolvable internal links', async () => {
	const report = await auditHandbookContent('handbook/src/content/docs');
	assert.deepEqual(report.errors, []);
	assert.ok(report.pages >= 15);
});

test('the handbook audit reports missing frontmatter and broken local routes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-handbook-check-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	await mkdir(join(root, 'guide'), { recursive: true });
	await writeFile(join(root, 'index.md'), [
		'---',
		'title: Demo',
		'description: A demo page.',
		'---',
		'',
		'[Missing](/guide/missing/)',
		'',
	].join('\n'));
	await writeFile(join(root, 'guide', 'untitled.md'), '## Missing frontmatter\n');

	const report = await auditHandbookContent(root);
	assert.ok(report.errors.some((error) => error.includes('guide/untitled.md: missing frontmatter')));
	assert.ok(report.errors.some((error) => error.includes('index.md: unresolved route /guide/missing/')));
});

/**
 * The handbook is served under a base path, and a page's two kinds of link
 * reach it by opposite routes: a Markdown body link is rebased at build time by
 * `handbook/src/plugins/rehype-handbook-base.mjs`, while a frontmatter link is
 * data a Starlight component reads and no transform ever sees. Writing a base
 * into the first doubles it; leaving it out of the second lands the reader on
 * the editor's routes. Neither shows up in the page's own build output.
 */
test('the handbook audit holds body and frontmatter links to opposite base rules', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-handbook-base-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	await mkdir(join(root, 'guide'), { recursive: true });
	await writeFile(join(root, 'guide', 'index.md'), [
		'---', 'title: Guide', 'description: A guide.', '---', '', 'Body.', '',
	].join('\n'));
	await writeFile(join(root, 'index.md'), [
		'---',
		'title: Demo',
		'description: A demo page.',
		'hero:',
		'  actions:',
		'    - text: Read the guide',
		'      link: /guide/',
		'    - text: Open the editor',
		'      link: https://soundscaper.org/en/',
		'---',
		'',
		'[Doubled](/docs/guide/)',
		'',
	].join('\n'));

	const report = await auditHandbookContent(root);
	assert.deepEqual(report.errors, [
		'index.md: body link /docs/guide/ must omit the /docs base',
		'index.md: frontmatter link /guide/ must carry the /docs base',
	]);
});

test('a frontmatter link that carries the base still has to name a page that exists', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-handbook-base-route-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	await writeFile(join(root, 'index.md'), [
		'---',
		'title: Demo',
		'description: A demo page.',
		'hero:',
		'  actions:',
		'    - text: Read the guide',
		'      link: /docs/guide/',
		'---',
		'',
		'Body.',
		'',
	].join('\n'));

	const report = await auditHandbookContent(root);
	assert.deepEqual(report.errors, ['index.md: unresolved route /docs/guide/']);
});

/**
 * A translated page is the English page's links in another language. Its body
 * links stay base-free and language-free, because the build transform supplies
 * both from the page's own path; its frontmatter links are data no transform
 * ever sees, so they have to carry the language as well as the base or a hero
 * action drops the reader back into English.
 */
test('a translation carries the language in its frontmatter links and not in its body links', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-handbook-locale-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	await mkdir(join(root, 'fr', 'guides'), { recursive: true });
	await mkdir(join(root, 'guides'), { recursive: true });
	const page = (title, links) => [
		'---', `title: ${title}`, 'description: A page.', 'hero:', '  actions:',
		'    - text: Read', `      link: ${links.hero}`, '---', '', `[Guide](${links.body})`, '',
	].join('\n');
	await writeFile(join(root, 'guides', 'index.md'), page('Guides', { hero: '/docs/', body: '/' }));
	await writeFile(join(root, 'index.md'), page('Home', { hero: '/docs/guides/', body: '/guides/' }));
	await writeFile(join(root, 'fr', 'guides', 'index.md'), page('Guides', { hero: '/docs/fr/', body: '/' }));
	await writeFile(join(root, 'fr', 'index.md'), page('Accueil', { hero: '/docs/guides/', body: '/docs/fr/guides/' }));

	const report = await auditHandbookContent(root);

	assert.deepEqual(report.locales, ['en', 'fr']);
	assert.deepEqual(report.errors, [
		'fr/index.md: body link /docs/fr/guides/ must omit the /docs base',
		'fr/index.md: frontmatter link /docs/guides/ must carry the /docs/fr base',
	]);
});

test('a translation of a page that no longer exists in English is reported', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-handbook-orphan-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	await mkdir(join(root, 'fr'), { recursive: true });
	const page = ['---', 'title: Page', 'description: A page.', '---', '', 'Body.', ''].join('\n');
	await writeFile(join(root, 'index.md'), page);
	await writeFile(join(root, 'fr', 'index.md'), page);
	await writeFile(join(root, 'fr', 'retired.md'), page);

	const report = await auditHandbookContent(root);

	assert.deepEqual(report.errors, ['fr/retired.md: translates a page that no longer exists in English']);
});

/**
 * Astro derives a heading's id from its text, and a translated heading has
 * different text. A link's destination is protected during translation and
 * keeps the English id, so an anchor into a translated heading names an id
 * that no longer exists. Writing the id out is what survives the translation,
 * so an anchor may only name a heading that does.
 */
test('an anchor may only name a heading whose id is written out', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-handbook-anchor-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	await mkdir(join(root, 'fr'), { recursive: true });
	await writeFile(join(root, 'reference.md'), [
		'---', 'title: Reference', 'description: A page.', '---', '',
		'## Parameters {#parameters}', '', 'Text.', '', '## Limits', '', 'Text.', '',
	].join('\n'));
	await writeFile(join(root, 'index.md'), [
		'---', 'title: Home', 'description: A page.', '---', '',
		'[Parameters](/reference/#parameters)', '', '[Limits](/reference/#limits)', '',
		'[Missing](/reference/#nothing)', '',
	].join('\n'));
	await writeFile(join(root, 'fr', 'reference.md'), [
		'---', 'title: Référence', 'description: Une page.', '---', '',
		'## Paramètres {#parameters}', '', 'Texte.', '',
	].join('\n'));
	await writeFile(join(root, 'fr', 'index.md'), [
		'---', 'title: Accueil', 'description: Une page.', '---', '',
		'[Paramètres](/reference/#parameters)', '',
	].join('\n'));

	const report = await auditHandbookContent(root);

	assert.deepEqual(report.errors, [
		'index.md: anchor /reference/#limits names a heading whose id comes from its text; write it out as {#limits}',
		'index.md: unresolved anchor /reference/#nothing',
	]);
});
