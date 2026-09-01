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
