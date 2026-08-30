/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The raw `.js` and `.mjs` desktop members are copied into the asar rather than
 * compiled, so nothing type-checks their import graph. When one of them imports
 * a `./project-library-runtime/…` member whose source is absent from
 * `tsconfig.desktop-runtime.json`, the runtime compile happily succeeds, the
 * package builds, and packaged main then dies at startup with
 * `ERR_MODULE_NOT_FOUND` — which is how the nightly lease matrix and every
 * packaged smoke went red on a missing `desktop/native-realtime-broker.js`.
 *
 * These checks pin both halves: every runtime member a raw desktop source names
 * is one the compile actually emits, and staging refuses a tree where that stops
 * being true.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';
import { assertStagedDesktopImportsResolve } from '../scripts/lib/desktop-staged-import-hygiene.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_PREFIX = './project-library-runtime/';
const RELATIVE_SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](\.[^'"]*)['"]/gu;

test('every runtime member a raw desktop source imports is one the compile emits', async () => {
	const shipped = new Set(DESKTOP_EXPECTED_RUNTIME_FILES);
	const desktopRoot = join(ROOT, 'desktop');
	const dangling = [];
	for (const name of await listFilesRecursively(desktopRoot)) {
		if (!/\.[cm]?js$/u.test(name)) continue;
		const source = await readFile(join(desktopRoot, name), 'utf8');
		for (const [, specifier] of source.matchAll(RELATIVE_SPECIFIER)) {
			if (!specifier.startsWith(RUNTIME_PREFIX)) continue;
			const member = specifier.slice(RUNTIME_PREFIX.length);
			if (!shipped.has(member)) dangling.push(`${name} imports ${member}`);
		}
	}
	assert.deepEqual(dangling, [], 'each imported runtime member must be compiled and shipped');
});

test('staging refuses a desktop tree that imports a runtime member staging never produced', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-runtime-member-guard-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const applicationRoot = join(temporaryRoot, 'desktop');
	await mkdir(join(applicationRoot, 'project-library-runtime', 'desktop'), { recursive: true });
	await writeFile(join(applicationRoot, 'project-library-runtime', 'desktop', 'shipped.js'),
		'export const shipped = true;\n');
	await writeFile(join(applicationRoot, 'registration.mjs'),
		"import { shipped } from './project-library-runtime/desktop/shipped.js';\n"
		+ "export const worklet = () => import('./project-library-runtime/desktop/shipped.js?worker&url');\n"
		+ 'export { shipped };\n');
	await assertStagedDesktopImportsResolve(applicationRoot);

	await writeFile(join(applicationRoot, 'registration.mjs'),
		"import { absent } from './project-library-runtime/desktop/absent.js';\nexport { absent };\n");
	await assert.rejects(() => assertStagedDesktopImportsResolve(applicationRoot),
		/desktop staging never produced/u,
		'a dangling runtime member must fail staging rather than reach a package');
});

test('staging refuses bare package imports excluded from the desktop asar', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-asar-package-import-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const applicationRoot = join(temporaryRoot, 'desktop');
	await mkdir(applicationRoot, { recursive: true });
	await writeFile(join(applicationRoot, 'main.mjs'), [
		"import { app } from 'electron';",
		"import { createHash } from 'node:crypto';",
		"import { helper } from '#desktop-runtime/helper-contract';",
		'export const admitted = { app, createHash, helper };',
		'',
	].join('\n'));
	await assertStagedDesktopImportsResolve(applicationRoot);

	await writeFile(join(applicationRoot, 'main.mjs'), [
		"import { sha256 } from '@noble/hashes/sha2.js';",
		'export { sha256 };',
		'',
	].join('\n'));
	await assert.rejects(
		() => assertStagedDesktopImportsResolve(applicationRoot),
		/@noble\/hashes\/sha2\.js/u,
		'a dependency excluded by electron-builder must be bundled before it can reach the asar',
	);
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
