/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The packaged application ships no `src/` tree and no TypeScript loader, so a
 * staged desktop source that retains a `.ts` specifier crashes packaged main.
 * These are the WP-5.0.0 acceptance checks for that guard: the staged tree
 * carries no TypeScript specifier, every `#desktop-runtime/*` alias resolves on
 * both sides of staging, and a deliberately reintroduced `.ts` import fails
 * staging rather than reaching a package.
 */

import assert from 'node:assert/strict';
import { access, cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	compileDesktopProjectLibraryRuntime,
	DESKTOP_RUNTIME_PACKAGE_IMPORTS,
	stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPESCRIPT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"][^'"]*\.[cm]?tsx?['"]/u;

test('the staged desktop tree carries no TypeScript specifier and resolves every runtime alias', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-staged-guard-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const runtimeRoot = join(temporaryRoot, 'runtime');
	const applicationDesktopRoot = join(temporaryRoot, 'application', 'desktop');
	await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot: runtimeRoot });
	await stageDesktopApplicationSources({
		desktopSourceRoot: join(ROOT, 'desktop'),
		applicationDesktopRoot,
		runtimeRoot,
	});

	for (const name of await listFilesRecursively(applicationDesktopRoot)) {
		if (!/\.[cm]?js$/u.test(name)) continue;
		const staged = await readFile(join(applicationDesktopRoot, name), 'utf8');
		assert.doesNotMatch(staged, TYPESCRIPT_SPECIFIER, `staged ${name} must not import a TypeScript specifier`);
	}

	const repositoryPackage = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
	assert.deepEqual(
		Object.keys(repositoryPackage.imports),
		Object.keys(DESKTOP_RUNTIME_PACKAGE_IMPORTS),
		'the repository package-imports aliases must mirror the staged desktop aliases exactly',
	);
	for (const [alias, target] of Object.entries(DESKTOP_RUNTIME_PACKAGE_IMPORTS)) {
		assert.match(target, /^\.\/desktop\/project-library-runtime\//u, `${alias} must resolve to a compiled runtime member`);
		await access(join(applicationDesktopRoot, '..', target));
		await access(join(ROOT, repositoryPackage.imports[alias]));
	}
	for (const witness of ['project-library-fallback-role-witnesses.js', 'project-library-source-bearing-smoke.js']) {
		const source = await readFile(join(applicationDesktopRoot, witness), 'utf8');
		assert.match(source, /from '#desktop-runtime\/video-source-characteristics'/u,
			`${witness} must reach video source characteristics through the staged package-imports alias`);
	}

	const reintroducedRoot = join(temporaryRoot, 'desktop-reintroduced');
	await cp(join(ROOT, 'desktop'), reintroducedRoot, { recursive: true });
	await writeFile(join(reintroducedRoot, 'reintroduced-typescript-import.js'),
		"import { createUnreportedVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';\n");
	await assert.rejects(() => stageDesktopApplicationSources({
		desktopSourceRoot: reintroducedRoot,
		applicationDesktopRoot: join(temporaryRoot, 'application-reintroduced', 'desktop'),
		runtimeRoot,
	}), /retained a TypeScript import/u, 'the staging guard must fail on a reintroduced TypeScript import');
});

async function listFilesRecursively(root, relativeRoot = '') {
	const entries = await readdir(join(root, relativeRoot), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
		if (entry.isDirectory()) files.push(...await listFilesRecursively(root, relativePath));
		else if (entry.isFile()) files.push(relativePath);
	}
	return files.sort();
}
