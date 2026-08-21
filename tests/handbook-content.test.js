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
