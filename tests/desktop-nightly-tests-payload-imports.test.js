/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import {
	NIGHTLY_TEST_PAYLOAD_INPUTS,
	resolveNightlyTestRuntimePackages,
} from '../scripts/lib/desktop-nightly-tests-staging.mjs';

// Playwright loads every test file before it runs any of them, so one unresolved
// import aborts the whole suite: the packaged runner then reports zero tests and
// a plausible-looking report rather than a visible failure. The staging fixtures
// stage a synthetic repository, so only a sweep of the real tree can prove the
// payload carries everything the shipped specs reach for.
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BROWSER_TESTS = join(REPOSITORY_ROOT, 'tests/browser');
// The `testMatch` of playwright.nightly-tests.config.mjs.
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/u;
const BUILTIN_MODULES = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

test('the nightly test payload satisfies every import its browser specs reach', async () => {
	const entryPoints = [
		...await collectTestFiles(BROWSER_TESTS),
		join(REPOSITORY_ROOT, 'scripts/lib/desktop-nightly-tests-metrics.mjs'),
	];
	assert.ok(entryPoints.length > 0, 'the browser test tree must contain Playwright test files');

	const externals = new Map();
	const result = await build({
		entryPoints,
		bundle: true,
		write: false,
		metafile: true,
		logLevel: 'silent',
		logLimit: 0,
		platform: 'node',
		format: 'esm',
		outdir: join(REPOSITORY_ROOT, '.nightly-test-payload-imports'),
		plugins: [{
			name: 'nightly-test-payload-imports',
			setup(api) {
				// esbuild filters are Go regular expressions, which reject the /u flag.
				api.onResolve({ filter: /.*/ }, ({ path, importer }) => {
					if (!importer || path.startsWith('.') || isAbsolute(path)) return null;
					const specifiers = externals.get(path) ?? new Set();
					specifiers.add(relative(REPOSITORY_ROOT, importer));
					externals.set(path, specifiers);
					return { path, external: true };
				});
			},
		}],
	}).catch((error) => {
		assert.fail(`The browser specs reach modules the payload cannot resolve:\n${describeBuildErrors(error)}`);
	});

	const staged = new Set((await resolveNightlyTestRuntimePackages(REPOSITORY_ROOT)).map(({ name }) => name));
	const packagedFilter = await readPackagedPayloadFilter();
	const reached = Object.keys(result.metafile.inputs)
		.map((input) => relative(REPOSITORY_ROOT, resolve(REPOSITORY_ROOT, input)));
	const failures = [
		...reached
			.filter((input) => !isStagedInput(input))
			.map((input) => `NIGHTLY_TEST_PAYLOAD_INPUTS is missing ${input}`),
		// Staging a file only puts it in .desktop-build; the packaged payload
		// carries whatever electron-builder's filter admits, so a staged file the
		// filter drops is still missing from the artifact the tester runs.
		...reached
			.map((input) => packagedPathOf(input))
			.filter((packaged) => packaged !== null
				&& !packagedFilter.some((pattern) => matchesGlob(packaged, pattern)))
			.map((packaged) => `the nightly-tests extraResources filter drops ${packaged}`),
		...[...externals]
			.filter(([specifier]) => !BUILTIN_MODULES.has(specifier) && !staged.has(packageNameOf(specifier)))
			.map(([specifier, importers]) => (
				`NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS is missing ${packageNameOf(specifier)}`
				+ ` (imported by ${[...importers].sort().join(', ')})`
			)),
	].sort();
	assert.deepEqual(
		failures,
		[],
		`The packaged runner would abort before running a single test:\n  ${failures.join('\n  ')}`,
	);
});

test('the nightly payload stages browser harnesses loaded as dynamic esbuild entry points', async () => {
	const lifecycleSpec = await readFile(
		join(BROWSER_TESTS, 'audio-editor-framescaper-v20-product-lifecycle.spec.js'),
		'utf8',
	);
	const harnessPath = lifecycleSpec.match(
		/const HARNESS_PATH = resolve\(REPOSITORY_ROOT, '([^']+)'\);/u,
	)?.[1];
	assert.ok(harnessPath, 'the V20 lifecycle spec must declare its dynamic harness path');
	assert.ok(
		isStagedInput(harnessPath),
		`NIGHTLY_TEST_PAYLOAD_INPUTS is missing dynamic browser harness ${harnessPath}`,
	);
	const packagedPath = packagedPathOf(harnessPath);
	const packagedFilter = await readPackagedPayloadFilter();
	assert.ok(
		packagedPath !== null && packagedFilter.some((pattern) => matchesGlob(packagedPath, pattern)),
		`the nightly-tests extraResources filter drops dynamic browser harness ${harnessPath}`,
	);
});

function isStagedInput(input) {
	if (input.startsWith('..') || isAbsolute(input)) return false;
	const segments = input.split(sep);
	return NIGHTLY_TEST_PAYLOAD_INPUTS.some((staged) => {
		const stagedSegments = staged.source.split('/');
		if (staged.kind === 'file') return input === stagedSegments.join(sep);
		if (segments.length <= stagedSegments.length) return false;
		if (stagedSegments.some((segment, index) => segments[index] !== segment)) return false;
		return !(staged.exclude ?? new Set()).has(segments[stagedSegments.length]);
	});
}

async function readPackagedPayloadFilter() {
	const { default: config } = await import('../electron-builder.nightly-tests.config.cjs');
	const payload = config.extraResources.find(({ to }) => to === 'nightly-tests');
	assert.ok(payload?.filter, 'the nightly-tests payload must be packaged through a filtered resource');
	return payload.filter;
}

// The packaged path is the staged destination, which the payload contract is
// free to relocate away from the repository-relative source.
function packagedPathOf(input) {
	const segments = input.split(sep);
	for (const staged of NIGHTLY_TEST_PAYLOAD_INPUTS) {
		const stagedSegments = staged.source.split('/');
		if (staged.kind === 'file') {
			if (input === stagedSegments.join(sep)) return staged.destination;
			continue;
		}
		if (segments.length <= stagedSegments.length) continue;
		if (stagedSegments.some((segment, index) => segments[index] !== segment)) continue;
		return [staged.destination, ...segments.slice(stagedSegments.length)].join('/');
	}
	return null;
}

function packageNameOf(specifier) {
	const segments = specifier.split('/');
	return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function describeBuildErrors(error) {
	const errors = error?.errors ?? [];
	if (errors.length === 0) return String(error?.message ?? error);
	return errors
		.map(({ text, location }) => `  ${location ? `${location.file}:${location.line} ` : ''}${text}`)
		.join('\n');
}

async function collectTestFiles(root) {
	const files = [];
	for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
		if (entry.isFile() && TEST_FILE.test(entry.name)) files.push(join(entry.parentPath, entry.name));
	}
	return files.sort();
}
