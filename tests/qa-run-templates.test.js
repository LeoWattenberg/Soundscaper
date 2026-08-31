/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createQaRun } from '../scripts/create-qa-run.mjs';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
const PRODUCTS = Object.freeze(['soundscaper', 'framescaper']);
const EXPECTED_IDS = Object.freeze({
	soundscaper: Array.from({ length: 23 }, (_, index) => `SQA-${String(index + 1).padStart(2, '0')}`),
	framescaper: Array.from({ length: 23 }, (_, index) => `FQA-${String(index + 1).padStart(2, '0')}`),
});
const ROW = /^\| (?<id>[A-Z]+-\d{2}) \| (?<check>.+?) \| (?<result>not-run|pass|fail|n\/a) \| (?<notes>.*?)\|$/u;

for (const product of PRODUCTS) {
	test(`${product} has an evergreen owner QA template`, async () => {
		const markdown = await readFile(new URL(`docs/qa/${product}.md`, REPOSITORY_ROOT), 'utf8');
		const rows = markdown.split('\n').flatMap((line) => {
			if (!line.startsWith('| ') || line.startsWith('| ID ') || line.startsWith('| --- ')) return [];
			const match = ROW.exec(line);
			assert.ok(match, `Malformed QA row in ${product}: ${line}`);
			return [match.groups];
		});
		assert.deepEqual(rows.map(({ id }) => id), EXPECTED_IDS[product]);
		assert.equal(new Set(rows.map(({ id }) => id)).size, rows.length, 'QA IDs must be unique');
		assert.ok(rows.every(({ result }) => result === 'not-run'), 'Committed QA results stay not-run');
		assert.ok(rows.every(({ notes }) => notes.length === 0), 'Committed QA notes stay empty');
		assert.match(markdown, /Only record\s+what you personally observed/iu);
		assert.match(markdown, /`n\/a`\s+requires a reason/iu);
		assert.match(markdown, /known data-loss, security, or primary-workflow failure/iu);
		assert.doesNotMatch(markdown, /admission|attestation|qualif(?:y|ied|ication)|sign[- ]?off|evidence root|run id/iu);
		assert.equal((markdown.match(/\{\{PRODUCT\}\}/gu) ?? []).length, 1);
		assert.equal((markdown.match(/\{\{UTC_TIMESTAMP\}\}/gu) ?? []).length, 1);
	});
}

test('the QA generator creates a private all-not-run copy with only run metadata filled', async (context) => {
	const root = await fixtureRepository(context);
	const now = new Date('2026-08-31T17:42:03.456Z');
	const output = await createQaRun({ repositoryRoot: root, product: 'soundscaper', now });
	assert.equal(output, join(root, 'qa-runs', 'soundscaper-20260831T174203456Z.md'));
	const generated = await readFile(output, 'utf8');
	assert.match(generated, /Product: Soundscaper/u);
	assert.match(generated, /Started \(UTC\): 2026-08-31T17:42:03\.456Z/u);
	assert.doesNotMatch(generated, /\{\{(?:PRODUCT|UTC_TIMESTAMP)\}\}/u);
	assert.doesNotMatch(generated, /\| (?:pass|fail|n\/a) \|/u);
	assert.equal((await lstat(join(root, 'qa-runs'))).isDirectory(), true);
});

test('the QA generator rejects unknown products and refuses to overwrite a run', async (context) => {
	const root = await fixtureRepository(context);
	const now = new Date('2026-08-31T17:42:03.456Z');
	await assert.rejects(
		createQaRun({ repositoryRoot: root, product: '../soundscaper', now }),
		/choose soundscaper or framescaper/iu,
	);
	await createQaRun({ repositoryRoot: root, product: 'framescaper', now });
	await assert.rejects(
		createQaRun({ repositoryRoot: root, product: 'framescaper', now }),
		/already exists/iu,
	);
});

test('the QA generator refuses a symlinked output directory', async (context) => {
	const root = await fixtureRepository(context);
	const outside = await mkdtemp(join(tmpdir(), 'soundscaper-qa-outside-'));
	context.after(() => rm(outside, { recursive: true, force: true }));
	await symlink(outside, join(root, 'qa-runs'), 'dir');
	await assert.rejects(
		createQaRun({
			repositoryRoot: root,
			product: 'soundscaper',
			now: new Date('2026-08-31T17:42:03.456Z'),
		}),
		/symbolic link/iu,
	);
});

async function fixtureRepository(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-qa-run-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'docs', 'qa'), { recursive: true });
	for (const product of PRODUCTS) {
		await writeFile(
			join(root, 'docs', 'qa', `${product}.md`),
			`# QA\n\nProduct: {{PRODUCT}}\nStarted (UTC): {{UTC_TIMESTAMP}}\n\n| ID | Check | Result | Notes |\n| --- | --- | --- | --- |\n| QA-01 | Check it. | not-run | |\n`,
		);
	}
	return root;
}
