/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Staging hygiene for the desktop sources that ship into the asar as-is.
 *
 * Two failure modes reach packaged main as an unrecoverable startup crash and
 * nothing earlier notices, because the raw `.js` and `.mjs` members are copied
 * rather than compiled, so no type checker ever reads their import graph.
 *
 * The first is a retained TypeScript specifier: the package ships no `src/`
 * tree and no TypeScript loader, so `../src/…/thing.ts` cannot resolve. The
 * second is an import of a compiled runtime member that the runtime compile
 * never produced — `./project-library-runtime/desktop/thing.js` is only real
 * when `tsconfig.desktop-runtime.json` includes its source, and a raw member is
 * not part of the program that pulls sources in transitively. Both refuse
 * staging here so the break is a packaging error rather than a shipped binary
 * whose main process dies on `ERR_MODULE_NOT_FOUND`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const RELATIVE_SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](\.[^'"]*)['"]/gu;

/** Refuses a staged tree whose own members import something staging never produced. */
export async function assertStagedDesktopImportsResolve(applicationRoot) {
	const root = resolve(applicationRoot);
	const staged = await listStagedFiles(root);
	const present = new Set(staged);
	for (const name of staged) {
		if (!/\.[cm]?js$/u.test(name)) continue;
		const source = await readFile(join(root, name), 'utf8');
		assertNoTypeScriptImportSpecifiers(`Staged desktop source ${name}`, source);
		for (const [, specifier] of source.matchAll(RELATIVE_SPECIFIER)) {
			// Bundler-only specifiers carry a `?worker&url`-style query the file
			// system never sees; the module they name is what has to be there.
			const path = specifier.replace(/[?#].*$/u, '');
			const target = relative(root, resolve(root, dirname(name), path)).split(sep).join('/');
			// Specifiers that leave the desktop tree address application members
			// staged by the preparation script; only this tree is ours to answer for.
			if (target.startsWith('..') || present.has(target)) continue;
			throw new Error(
				`Staged desktop source ${name} imports ${specifier}, which desktop staging never produced`,
			);
		}
	}
}

/** Refuses source that would need a TypeScript loader the package does not ship. */
export function assertNoTypeScriptImportSpecifiers(label, source) {
	if (/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"][^'"]*\.[cm]?tsx?['"]/u.test(source)) {
		throw new Error(`${label} retained a TypeScript import`);
	}
}

async function listStagedFiles(root, relativeRoot = '') {
	const entries = await readdir(join(root, relativeRoot), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
		if (entry.isDirectory()) files.push(...await listStagedFiles(root, relativePath));
		else if (entry.isFile()) files.push(relativePath);
	}
	return files.sort();
}
