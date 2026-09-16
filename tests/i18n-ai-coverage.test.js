/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { writeTranslationCatalog } from '../scripts/i18n-ai/catalog.mjs';
import { checkLocales, MACHINE_TRANSLATION_EXCLUDED_KEYS } from '../scripts/i18n-ai/workflows.mjs';
import { runCli } from '../scripts/i18n-ai/cli.mjs';

const EXCLUDED = new Set(MACHINE_TRANSLATION_EXCLUDED_KEYS);
const LEGACY_ENTRIES = Object.fromEntries(Object.entries(ENGLISH_COPY)
	.filter(([key]) => !EXCLUDED.has(key))
	.map(([key, source]) => [key, ['human', source, source]]));
const ADDITIONAL_KEYS = Object.keys(EDITOR_ENGLISH_COPY).filter(key => !Object.hasOwn(ENGLISH_COPY, key));

async function fixture(t) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-i18n-coverage-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeTranslationCatalog({ locale: 'fr', entries: LEGACY_ENTRIES }, directory);
	return directory;
}

async function strictCheck(directory, englishCopy) {
	const output = [];
	const previous = process.exitCode;
	process.exitCode = undefined;
	try {
		const reports = await runCli(['check', '--locale', 'fr', '--strict'], {
			directory, englishCopy, stdout: { write: text => output.push(text) }, env: {},
		});
		return { report: reports[0], failed: process.exitCode === 1, output: output.join('') };
	} finally { process.exitCode = previous; }
}

test('catalog coverage separates legacy completeness from newly inventoried English fallback without writing', async t => {
	const directory = await fixture(t);
	const before = await readFile(join(directory, 'fr.json'), 'utf8');
	const { report, failed, output } = await strictCheck(directory);
	assert.equal(failed, false);
	assert.equal(report.missing, ADDITIONAL_KEYS.length);
	assert.deepEqual(report.coverage.legacy, {
		total: Object.keys(ENGLISH_COPY).length, excluded: EXCLUDED.size,
		current: Object.keys(LEGACY_ENTRIES).length, stale: 0, missing: 0,
	});
	assert.deepEqual(report.coverage.additional, {
		total: ADDITIONAL_KEYS.length, excluded: 0, current: 0, stale: 0, missing: ADDITIONAL_KEYS.length,
	});
	assert.match(output, /coverage: legacy .*0 stale, 0 missing; additional .* missing/u);
	assert.equal(await readFile(join(directory, 'fr.json'), 'utf8'), before);
});

test('strict completeness still rejects a missing or stale legacy string', async t => {
	const directory = await fixture(t);
	const key = 'fileMenu';
	for (const state of ['missing', 'stale']) {
		const entries = { ...LEGACY_ENTRIES };
		if (state === 'missing') delete entries[key];
		else entries[key] = ['human', 'Old File', 'Old File'];
		await writeTranslationCatalog({ locale: 'fr', entries }, directory);
		const { report, failed } = await strictCheck(directory);
		assert.equal(failed, true, state);
		assert.equal(report.coverage.legacy[state], 1, state);
		assert.equal(report.coverage.additional.missing, ADDITIONAL_KEYS.length);
	}
});

test('an additional stale entry is reported separately and permitted to fall back to English', async t => {
	const directory = await fixture(t);
	const key = ADDITIONAL_KEYS[0];
	await writeTranslationCatalog({ locale: 'fr', entries: {
		...LEGACY_ENTRIES, [key]: ['human', 'Old wording', 'Old wording'],
	} }, directory);
	const { report, failed } = await strictCheck(directory);
	assert.equal(failed, false);
	assert.equal(report.stale, 1);
	assert.equal(report.coverage.additional.stale, 1);
	assert.equal(report.coverage.additional.missing, ADDITIONAL_KEYS.length - 1);
});

test('explicit English references retain full strict completeness and the existing report shape', async t => {
	const directory = await fixture(t);
	await writeTranslationCatalog({ locale: 'fr', entries: { owned: ['human', 'Owned', 'Owned'] } }, directory);
	const englishCopy = { owned: 'Owned', 'ui.new.missing': 'Missing' };
	const [report] = await checkLocales({ locales: ['fr'], directory, englishCopy });
	assert.equal(report.coverage, undefined);
	assert.equal(report.missing, 1);
	assert.equal((await strictCheck(directory, englishCopy)).failed, true);
});
