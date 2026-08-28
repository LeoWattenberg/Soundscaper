/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import test from 'node:test';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';
import { DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-baseline-runtime-files.mjs';
import { DESKTOP_SOUNDSCAPER_RUNTIME_FILES } from '../scripts/lib/desktop-soundscaper-runtime-files.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/u, '');
const SCAN_ROOTS = Object.freeze(['src', 'desktop', 'native', 'scripts']);
const VERSION_TOKEN = /(?:^|[^a-z0-9])v[0-9]+(?:[^0-9]|$)/iu;
const RETIRED_PRODUCT_PATH = /(?:^|\/)(?:(?:soundscaper|framescaper)\/(?:[^/]*\/)*[^/]*(?:[-_]v(?:1[89]|2[0-9]|3[0-2])|V(?:1[89]|2[0-9]|3[0-2]))|(?:soundscaper-)?project-library-v(?:10|1[2-9]|20)-)(?:[^0-9]|$)/u;
const RETIRED_IMPORT = /(?:from\s*|import\s*\()(['"])[^'"\n]*(?:soundscaper|framescaper)[^'"\n]*(?:[-_]v(?:1[89]|2[0-9]|3[0-2])|V(?:1[89]|2[0-9]|3[0-2]))[^'"\n]*\1/gu;
const BARE_PRODUCT_INFERENCE = /schemaVersion\s*(?:===|!==|==|!=)\s*(?:1[89]|2[0-9]|3[0-2])\b/u;
const BARE_PROJECT_FEATURE_VERSION_ROUTE = /(?:Number\s*\(\s*)?(?:\b(?:project|snapshot)\??\.schemaVersion|getProject\(\)\.schemaVersion)\s*\)?\s*(?:>=|<=|>|<)\s*(?:\d+|[A-Z][A-Z0-9_]*)/u;
const TEXT_EXTENSIONS = new Set(['.c', '.cc', '.cmake', '.cpp', '.h', '.hpp', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const PRODUCTION_ROOTS = Object.freeze([
	'desktop/project-library-product-runtime.js',
	'scripts/lib/desktop-project-library-runtime.mjs',
	'src/common/site/App.jsx',
	'src/framescaper/editor-project.ts',
	'src/soundscaper/editor-project.ts',
]);
const PACKAGE_PATH_AUTHORITIES = Object.freeze([
	'package.json',
	'tsconfig.desktop-runtime.json',
	'scripts/lib/desktop-nightly-tests-staging.mjs',
	'scripts/lib/desktop-package-assistance-closure.mjs',
	'scripts/lib/desktop-project-library-runtime.mjs',
]);

test('every production/support version-token filename is exactly registered', async () => {
	const registry = JSON.parse(await readFile(join(ROOT, 'config/versioned-boundary-registry.json'), 'utf8'));
	assert.ok(Array.isArray(registry.boundaries));
	const registered = registry.boundaries.map((row) => {
		assert.deepEqual(Object.keys(row).sort(), ['justification', 'kind', 'path']);
		assert.match(row.kind, /^(?:persisted|ipc|native|helper|upstream|external)-contract$/u);
		assert.match(row.justification, /\S/u);
		return row.path;
	});
	assert.equal(new Set(registered).size, registered.length, 'registry paths must be unique');
	assert.deepEqual(registered, await versionedProductionFiles());
});

test('production and packaging closures contain no retired product-generation boundary', async () => {
	const files = await productionDependencyClosure();
	assert.deepEqual(files.filter((path) => RETIRED_PRODUCT_PATH.test(path)), []);
	const packagedPaths = [
		...DESKTOP_EXPECTED_RUNTIME_FILES,
		...DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES,
		...DESKTOP_SOUNDSCAPER_RUNTIME_FILES,
	];
	for (const authority of PACKAGE_PATH_AUTHORITIES) {
		const source = await readFile(join(ROOT, authority), 'utf8');
		packagedPaths.push(...[...source.matchAll(/['"]((?:desktop|src|native|scripts)\/[^'"\n]+)['"]/gu)]
			.map((match) => match[1]));
	}
	assert.deepEqual(packagedPaths.filter((path) => RETIRED_PRODUCT_PATH.test(path)), []);
	const violations = [];
	for (const path of files.filter((candidate) => TEXT_EXTENSIONS.has(extname(candidate)))) {
		const source = await readFile(join(ROOT, path), 'utf8');
		if (RETIRED_IMPORT.test(source)) violations.push(path);
		RETIRED_IMPORT.lastIndex = 0;
	}
	assert.deepEqual(violations, []);
});

test('production does not infer a product from a bare schema number', async () => {
	const violations = [];
	for (const path of (await productionDependencyClosure()).filter((candidate) => TEXT_EXTENSIONS.has(extname(candidate)))) {
		const source = await readFile(join(ROOT, path), 'utf8');
		if (BARE_PRODUCT_INFERENCE.test(source) || BARE_PROJECT_FEATURE_VERSION_ROUTE.test(source)) {
			violations.push(path);
		}
	}
	assert.deepEqual(violations, []);
});

async function versionedProductionFiles() {
	return (await productionFiles()).filter((path) => VERSION_TOKEN.test(path.split('/').at(-1)));
}

async function productionDependencyClosure() {
	const pending = [...PRODUCTION_ROOTS];
	const visited = new Set();
	while (pending.length) {
		const path = pending.pop();
		if (visited.has(path)) continue;
		visited.add(path);
		const source = await readFile(join(ROOT, path), 'utf8');
		for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.{1,2}\/[^'"\n]+)\1/gu)) {
			const imported = resolveRepositoryImport(path, match[2]);
			if (imported) pending.push(imported);
		}
	}
	return [...visited].sort();
}

function resolveRepositoryImport(importer, specifier) {
	const base = join(ROOT, importer, '..', specifier).split('?')[0];
	const extension = extname(base);
	const candidates = extension === '.js'
		? [`${base.slice(0, -3)}.ts`, base]
		: extension ? [base] : [`${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')];
	const resolved = candidates.find((candidate) => existsSync(candidate));
	if (!resolved) return null;
	const repositoryPath = relative(ROOT, resolved).split(sep).join('/');
	return repositoryPath.startsWith('../') ? null : repositoryPath;
}

async function productionFiles() {
	const result = [];
	for (const root of SCAN_ROOTS) await walk(join(ROOT, root), result);
	return result.sort();
}

async function walk(directory, result) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		const repositoryPath = relative(ROOT, path).split(sep).join('/');
		if (entry.isDirectory()) {
			if (entry.name !== 'tests') await walk(path, result);
		} else if (entry.isFile()) result.push(repositoryPath);
	}
}
