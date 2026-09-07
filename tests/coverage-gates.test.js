/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	COVERAGE_GATE_CONFIGURATION_URL,
	COVERAGE_SCOPES,
	analyzeCoverageSummary,
	classifyProductionCoveragePath,
	parseCoverageGateConfiguration,
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
		// Generated translation catalogs and their loader index carry no logic,
		// and the test runner's loader rewrites the index's JSON imports, which
		// left every loader counted twice — once covered, once not.
		'src/common/i18n/translations/**',
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
	assert.equal(classifyProductionCoveragePath('src/common/editor/controller/transport.ts'), 'editor-core');
	assert.equal(classifyProductionCoveragePath('src/common/editor/commands/select.ts'), 'editor-core');
	assert.equal(classifyProductionCoveragePath('src/common/editor/engine/mixdown.ts'), 'editor-core');
	assert.equal(classifyProductionCoveragePath('src/common/editor/controllers/legacy.ts'), 'editor');
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

test('the floors the gate enforces are exactly the ones the configuration ratchets', () => {
	// A literal table here would have to be rewritten after every ratchet; the
	// contract is that the gate reads the configuration, whatever it says today.
	const configuration = JSON.parse(readFileSync(COVERAGE_GATE_CONFIGURATION_URL, 'utf8'));
	assert.deepEqual(
		Object.fromEntries(COVERAGE_SCOPES.map(({ id, thresholds }) => [id, thresholds])),
		Object.fromEntries(configuration.scopes.map(({ id, thresholds }) => [id, thresholds])),
	);
	for (const { id, thresholds } of COVERAGE_SCOPES) {
		for (const [metric, floor] of Object.entries(thresholds)) {
			assert.ok(Number.isInteger(floor) && floor >= 0 && floor <= 100, `${id}.${metric} floor ${floor}`);
		}
	}
});

test('the floors are read from the maintained coverage configuration with their reasons', () => {
	const configuration = JSON.parse(readFileSync(COVERAGE_GATE_CONFIGURATION_URL, 'utf8'));
	assert.equal(
		COVERAGE_GATE_CONFIGURATION_URL.pathname.endsWith('/config/coverage-gates.json'),
		true,
	);
	assert.deepEqual(
		configuration.scopes.map(({ id, label, thresholds }) => ({ id, label, thresholds })),
		COVERAGE_SCOPES.map(({ id, label, thresholds }) => ({ id, label, thresholds })),
	);
	for (const { id, reason } of COVERAGE_SCOPES) {
		assert.equal(typeof reason, 'string', id);
		assert.ok(reason.trim().length > 40, id);
	}
});

test('a configuration the classifier cannot fill, or that names no reason, is refused', () => {
	const configuration = JSON.parse(readFileSync(COVERAGE_GATE_CONFIGURATION_URL, 'utf8'));
	assert.throws(() => parseCoverageGateConfiguration({ scopes: [] }), /must list the scopes/u);
	assert.throws(
		() => parseCoverageGateConfiguration({
			scopes: configuration.scopes.filter(({ id }) => id !== 'editor-core'),
		}),
		/no floors for scope editor-core/u,
	);
	assert.throws(
		() => parseCoverageGateConfiguration({
			scopes: [...configuration.scopes, { ...configuration.scopes[0], id: 'lightscaper' }],
		}),
		/unreachable scope: lightscaper/u,
	);
	assert.throws(
		() => parseCoverageGateConfiguration({
			scopes: configuration.scopes.map((scope) => ({ ...scope, reason: ' ' })),
		}),
		/records no reason/u,
	);
	assert.throws(
		() => parseCoverageGateConfiguration({
			scopes: configuration.scopes.map((scope) => ({
				...scope,
				thresholds: { ...scope.thresholds, branches: '80' },
			})),
		}),
		/no valid branches floor/u,
	);
});

test('a strong scope cannot conceal an editor regression', () => {
	const floor = scopeThresholds('editor').lines;
	const summary = passingSummary();
	delete summary[file('src/common/editor/ui/Dialog.tsx')];
	summary[file('src/common/editor/model.ts')] = measured(100, 100);
	summary[file('src/common/editor/model.ts')].lines.covered = floor - 1;

	const result = analyzeCoverageSummary(summary, REPOSITORY_ROOT);

	assert.deepEqual(result.failures, [
		`Editor lines coverage is ${(floor - 1).toFixed(2)}% (${floor - 1}/100), below the ${floor}% threshold.`,
	]);
});

test('the editor core trees are gated apart from the editor tree that steers them', () => {
	const summary = passingSummary();
	const floor = scopeThresholds('editor-core').branches;
	delete summary[file('src/common/editor/commands/select.ts')];
	delete summary[file('src/common/editor/engine/mixdown.ts')];
	summary[file('src/common/editor/controller/transport.ts')].branches.covered = floor - 1;

	const result = analyzeCoverageSummary(summary, REPOSITORY_ROOT);

	assert.deepEqual(result.failures, [
		`Editor core branches coverage is ${(floor - 1).toFixed(2)}% `
		+ `(${floor - 1}/100), below the ${floor}% threshold.`,
	]);
});

for (const { id, label, path } of [
	{ id: 'common-transfer', label: 'Common transfer', path: 'src/common/transfer/session.ts' },
	{ id: 'common-site', label: 'Common site', path: 'src/common/site/route.js' },
	{ id: 'common-i18n', label: 'Common i18n', path: 'src/common/i18n/runtime.js' },
	{ id: 'common-offline', label: 'Common offline', path: 'src/common/offline/application-shell.ts' },
	{ id: 'shared-root', label: 'Shared root', path: 'src/common/url.ts' },
]) {
	test(`${id} coverage cannot be masked by another common area`, () => {
		const threshold = scopeThresholds(id).lines;
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
		[file('src/common/editor/controller/transport.ts')]: measured(100, 100),
		[file('src/common/editor/commands/select.ts')]: measured(100, 100),
		[file('src/common/editor/engine/mixdown.ts')]: measured(100, 100),
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

function scopeThresholds(id) {
	const scope = COVERAGE_SCOPES.find((candidate) => candidate.id === id);
	assert.ok(scope, `no coverage scope ${id}`);
	return scope.thresholds;
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
