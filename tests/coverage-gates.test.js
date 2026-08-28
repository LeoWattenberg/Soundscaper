/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	COVERAGE_SCOPES,
	analyzeCoverageSummary,
	classifyProductionCoveragePath,
} from '../scripts/lib/coverage-gates.mjs';

const REPOSITORY_ROOT = resolve('/workspace');
const PROJECT_ROOT = resolve(import.meta.dirname, '..');

test('c8 discovers every maintained JavaScript and TypeScript production source', () => {
	const config = JSON.parse(readFileSync(resolve(PROJECT_ROOT, '.c8rc.json'), 'utf8'));
	const extensions = ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts', 'jsx', 'tsx'];

	assert.equal(config.all, true);
	assert.deepEqual(config.extension, extensions.map((extension) => `.${extension}`));
	assert.deepEqual(config.include, [
		...extensions.map((extension) => `desktop/**/*.${extension}`),
		...extensions.map((extension) => `src/**/*.${extension}`),
	]);
	assert.deepEqual(config.exclude, [
		'**/*.d.ts',
		'**/*.d.cts',
		'**/*.d.mts',
		'src/common/editor/**/native/**',
	]);
	for (const metric of ['lines', 'branches', 'functions']) assert.equal(config[metric], undefined);
});

test('the full Node gate records raw coverage before applying the scope-aware checker', () => {
	const { scripts } = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf8'));
	assert.equal(
		scripts['test:coverage'],
		'node scripts/run-node-tests.mjs --coverage-directory=coverage/v8-all '
		+ '&& node scripts/compact-v8-coverage.mjs coverage/v8-all coverage/all/all.json '
		+ '&& node scripts/check-coverage.mjs coverage/all',
	);
});

test('every maintained production tree has its own coverage scope', () => {
	assert.equal(classifyProductionCoveragePath('src/common/editor/domain.ts'), 'editor');
	assert.equal(classifyProductionCoveragePath('src/common/editor/ui/Dialog.tsx'), 'editor');
	assert.equal(classifyProductionCoveragePath('desktop/main.mjs'), 'desktop');
	assert.equal(classifyProductionCoveragePath('src/framescaper/model.ts'), 'framescaper');
	assert.equal(classifyProductionCoveragePath('src/soundscaper/model.ts'), 'soundscaper');
	assert.equal(classifyProductionCoveragePath('src/common/transfer/session.ts'), 'common-transfer');
	assert.equal(classifyProductionCoveragePath('src/common/site/App.jsx'), 'common-site');
	assert.equal(classifyProductionCoveragePath('src/common/i18n/catalogs.js'), 'common-i18n');
	assert.equal(classifyProductionCoveragePath('src/common/offline/application-shell.ts'), 'common-offline');
	assert.equal(classifyProductionCoveragePath('src/common/url.ts'), 'shared-root');
	assert.equal(classifyProductionCoveragePath('src/main.jsx'), 'shared-root');
	assert.equal(classifyProductionCoveragePath('src/unknown-product/model.ts'), null);
});

test('the established editor threshold and conservative new thresholds are explicit', () => {
	assert.deepEqual(
		Object.fromEntries(COVERAGE_SCOPES.map(({ id, thresholds }) => [id, thresholds])),
		{
			editor: { lines: 80, branches: 70, functions: 80 },
			desktop: { lines: 80, branches: 70, functions: 85 },
			framescaper: { lines: 45, branches: 65, functions: 55 },
			soundscaper: { lines: 60, branches: 68, functions: 80 },
			'common-transfer': { lines: 90, branches: 80, functions: 90 },
			'common-site': { lines: 50, branches: 80, functions: 70 },
			'common-i18n': { lines: 95, branches: 75, functions: 85 },
			'common-offline': { lines: 85, branches: 70, functions: 90 },
			'shared-root': { lines: 85, branches: 85, functions: 80 },
		},
	);
});

test('a strong scope cannot conceal an editor regression', () => {
	const summary = passingSummary();
	delete summary[file('src/common/editor/ui/Dialog.tsx')];
	summary[file('src/common/editor/model.ts')] = measured(79, 100);
	summary[file('src/common/editor/model.ts')].functions.covered = 100;

	const result = analyzeCoverageSummary(summary, REPOSITORY_ROOT);

	assert.deepEqual(result.failures, [
		'Editor lines coverage is 79.00% (79/100), below the 80% threshold.',
	]);
});

for (const { id, label, path, threshold } of [
	{ id: 'common-transfer', label: 'Common transfer', path: 'src/common/transfer/session.ts', threshold: 90 },
	{ id: 'common-site', label: 'Common site', path: 'src/common/site/route.js', threshold: 50 },
	{ id: 'common-i18n', label: 'Common i18n', path: 'src/common/i18n/runtime.js', threshold: 95 },
	{ id: 'common-offline', label: 'Common offline', path: 'src/common/offline/application-shell.ts', threshold: 85 },
	{ id: 'shared-root', label: 'Shared root', path: 'src/common/url.ts', threshold: 85 },
]) {
	test(`${id} coverage cannot be masked by another common area`, () => {
		const summary = passingSummary();
		summary[file(path)].lines.covered = threshold - 1;

		const result = analyzeCoverageSummary(summary, REPOSITORY_ROOT);

		assert.deepEqual(result.failures, [
			`${label} lines coverage is ${(threshold - 1).toFixed(2)}% `
			+ `(${threshold - 1}/100), below the ${threshold}% threshold.`,
		]);
	});
}

test('unclassified production files and missing scopes fail closed', () => {
	const summary = passingSummary();
	delete summary[file('src/soundscaper/model.ts')];
	summary[file('src/unknown-product/model.ts')] = measured(100, 100);

	const result = analyzeCoverageSummary(summary, REPOSITORY_ROOT);

	assert.deepEqual(result.failures, [
		'Coverage reported unclassified production files: src/unknown-product/model.ts.',
		'Soundscaper coverage reported no production files.',
	]);
});

function passingSummary() {
	return {
		total: measured(100, 100),
		[file('src/common/editor/model.ts')]: measured(100, 100),
		[file('src/common/editor/ui/Dialog.tsx')]: measured(100, 100),
		[file('desktop/main.mjs')]: measured(100, 100),
		[file('src/framescaper/model.ts')]: measured(100, 100),
		[file('src/soundscaper/model.ts')]: measured(100, 100),
		[file('src/common/transfer/session.ts')]: measured(100, 100),
		[file('src/common/site/route.js')]: measured(100, 100),
		[file('src/common/i18n/runtime.js')]: measured(100, 100),
		[file('src/common/offline/application-shell.ts')]: measured(100, 100),
		[file('src/common/url.ts')]: measured(100, 100),
	};
}

function measured(covered, total) {
	return Object.fromEntries(['lines', 'statements', 'branches', 'functions'].map((metric) => [
		metric,
		{ total, covered, skipped: 0, pct: total === 0 ? 100 : 100 * covered / total },
	]));
}

function file(relativePath) {
	return resolve(REPOSITORY_ROOT, relativePath);
}
