/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	PRODUCT_STAND_IN_ALIASES,
	productStandInAliasesFor,
} from '../scripts/lib/product-aliases.mjs';

/**
 * The product split is a build-time specifier rewrite: a Soundscaper build
 * resolves `../framescaper-finishing-menu.ts` to a Soundscaper stand-in, and a
 * Framescaper build resolves `./soundscaper-workflow-product-runtime.tsx` to a
 * Framescaper one. No compiler sees that substitution — tsconfig `paths` carries
 * only the design-system rows, and dependency-cruiser resolves through the same
 * tsconfig — so a name the stand-in does not export is not a type error, not a
 * lint error and not a cruiser violation. It is `undefined` at runtime in one
 * product's bundle, found by whichever browser spec happens to touch the
 * surface.
 *
 * These tests read the table the build itself resolves through and close that
 * gap statically: every name any source file imports across a substituted seam
 * must exist on both sides of it, and every spelling of a substituted module
 * must actually be substituted.
 */

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = resolve(repositoryRoot, 'src');
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;

const COMPOSITIONS = [
	{ productId: 'soundscaper', desktopCodecComposition: false },
	{ productId: 'soundscaper', desktopCodecComposition: true },
	{ productId: 'framescaper', desktopCodecComposition: false },
	{ productId: 'framescaper', desktopCodecComposition: true },
] as const;

interface ModuleImport {
	readonly specifier: string;
	readonly names: readonly string[];
	/** A namespace or bare import names nothing, so parity cannot be checked. */
	readonly opaque: boolean;
}

interface SourceModule {
	readonly file: string;
	readonly imports: readonly ModuleImport[];
}

const STATIC_IMPORT = /(?:^|[\n;])[ \t]*(?:import|export)\s+((?:type\s+)?[^;'"]*?)\s*from\s*['"]([^'"]+)['"]/gu;
const BARE_IMPORT = /(?:^|[\n;])[ \t]*import\s*['"]([^'"]+)['"]/gu;
const DYNAMIC_IMPORT = /(?:(?:const|let|var)\s*\{([^}]*)\}\s*=\s*)?(?:await\s+)?import\(\s*['"]([^'"]+)['"]\s*\)/gu;

const EXPORT_DECLARATION = /(?:^|\n)export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|abstract\s+class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gu;
const EXPORT_LIST = /(?:^|\n)export\s*\{([^}]*)\}/gu;
const EXPORT_STAR = /(?:^|\n)export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/gu;
const EXPORT_DEFAULT = /(?:^|\n)export\s+default\b/u;

/** Every maintained module under `src/`, which is the whole substitutable graph. */
function sourceFiles(directory: string, collected: string[] = []): string[] {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) sourceFiles(path, collected);
		else if (SOURCE_EXTENSION.test(entry.name)) collected.push(path);
	}
	return collected;
}

function importedNames(clause: string): { names: string[], opaque: boolean } {
	const trimmed = clause.replace(/^type\s+/u, '').trim();
	const names: string[] = [];
	const braced = /\{([\s\S]*)\}/u.exec(trimmed);
	const leading = braced ? trimmed.slice(0, trimmed.indexOf('{')) : trimmed;
	if (/\*\s+as\s+/u.test(leading)) return { names: [], opaque: true };
	if (/^\s*[A-Za-z_$][\w$]*\s*(?:,|$)/u.test(leading)) names.push('default');
	for (const piece of braced?.[1].split(',') ?? []) {
		const named = piece.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0]?.trim();
		if (named) names.push(named);
	}
	return { names, opaque: false };
}

function moduleImports(text: string): ModuleImport[] {
	const imports: ModuleImport[] = [];
	for (const [, clause = '', specifier = ''] of text.matchAll(STATIC_IMPORT)) {
		imports.push({ specifier, ...importedNames(clause) });
	}
	for (const [, specifier = ''] of text.matchAll(BARE_IMPORT)) {
		imports.push({ specifier, names: [], opaque: true });
	}
	for (const [, destructured, specifier = ''] of text.matchAll(DYNAMIC_IMPORT)) {
		if (destructured === undefined) imports.push({ specifier, names: [], opaque: true });
		else imports.push({ specifier, ...importedNames(`{${destructured}}`) });
	}
	return imports;
}

/** Every name a module makes importable, following `export * from` re-exports. */
function moduleExports(file: string, seen = new Set<string>()): Set<string> {
	const names = new Set<string>();
	if (seen.has(file) || !existsSync(file)) return names;
	seen.add(file);
	const text = readFileSync(file, 'utf8');
	for (const [, declared] of text.matchAll(EXPORT_DECLARATION)) if (declared) names.add(declared);
	for (const [, list = ''] of text.matchAll(EXPORT_LIST)) {
		for (const piece of list.split(',')) {
			const parts = piece.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u);
			const exported = (parts[1] ?? parts[0])?.trim();
			if (exported) names.add(exported);
		}
	}
	if (EXPORT_DEFAULT.test(text)) names.add('default');
	for (const [, alias, specifier = ''] of text.matchAll(EXPORT_STAR)) {
		if (alias) names.add(alias);
		else for (const name of moduleExports(resolve(dirname(file), specifier), seen)) names.add(name);
	}
	return names;
}

const modules: readonly SourceModule[] = sourceFiles(sourceRoot).map((file) => ({
	file,
	imports: moduleImports(readFileSync(file, 'utf8')),
}));

const standInExports = new Map<string, Set<string>>();
for (const row of PRODUCT_STAND_IN_ALIASES) {
	standInExports.set(row.standIn, moduleExports(resolve(repositoryRoot, row.standIn)));
}

test('every stand-in exports the names its substituted seam is imported by', () => {
	const holes: string[] = [];
	for (const composition of COMPOSITIONS) {
		for (const row of productStandInAliasesFor(composition)) {
			const available = standInExports.get(row.standIn) ?? new Set<string>();
			for (const { file, imports } of modules) {
				for (const entry of imports) {
					if (entry.opaque || !row.find.test(entry.specifier)) continue;
					const missing = entry.names.filter((name) => !available.has(name));
					if (!missing.length) continue;
					holes.push(
						`${composition.productId} resolves '${entry.specifier}' from `
						+ `${relative(repositoryRoot, file)} to ${row.standIn}, which does not export `
						+ missing.join(', '),
					);
				}
			}
		}
	}
	assert.deepEqual(holes, [], holes.join('\n'));
});

test('the alias table substitutes every spelling of a substituted module', () => {
	const uncovered: string[] = [];
	for (const composition of COMPOSITIONS) {
		const rows = productStandInAliasesFor(composition);
		const substituted = new Set<string>();
		for (const { file, imports } of modules) {
			for (const entry of imports) {
				if (!rows.some((row) => row.find.test(entry.specifier))) continue;
				substituted.add(resolve(dirname(file), entry.specifier));
			}
		}
		for (const { file, imports } of modules) {
			for (const entry of imports) {
				if (!entry.specifier.startsWith('.')) continue;
				const target = resolve(dirname(file), entry.specifier);
				if (!substituted.has(target) || rows.some((row) => row.find.test(entry.specifier))) continue;
				uncovered.push(
					`${composition.productId} substitutes ${relative(repositoryRoot, target)} for other `
					+ `importers but leaves '${entry.specifier}' in ${relative(repositoryRoot, file)} alone`,
				);
			}
		}
	}
	assert.deepEqual(uncovered, [], uncovered.join('\n'));
});

test('no substitution row could have been mirrored in tsconfig paths instead', () => {
	// TypeScript consults `paths` for non-relative specifiers only, so a row keyed
	// on the specifier an importer wrote relative to itself can never be mirrored
	// there — which is why tsc analyses every substituted module by its default
	// target and why the parity tests above exist. A row that ever stops being
	// relative is one tsc could see, and should be mirrored rather than guarded.
	const relativePrefixes = ['^(?:\\.\\/|\\.\\.\\/)', '^\\.\\/', '^\\.\\.\\/'];
	const nonRelative = PRODUCT_STAND_IN_ALIASES
		.filter((row) => !relativePrefixes.some((prefix) => row.find.source.startsWith(prefix)))
		.map((row) => row.find.source);
	assert.deepEqual(nonRelative, [], nonRelative.join('\n'));

	const tsconfig = JSON.parse(
		readFileSync(resolve(repositoryRoot, 'tsconfig.base.json'), 'utf8'),
	) as { compilerOptions: { paths: Record<string, unknown> } };
	assert.deepEqual(
		Object.keys(tsconfig.compilerOptions.paths).filter((key) => key.startsWith('.')),
		[],
		'tsconfig paths never matches a relative specifier, so it must not claim to',
	);
});

test('every alias row substitutes a module some source file actually imports', () => {
	const unused = PRODUCT_STAND_IN_ALIASES.filter((row) => !modules.some(
		({ imports }) => imports.some((entry) => row.find.test(entry.specifier)),
	)).map((row) => `${row.find.source} -> ${row.standIn}`);
	assert.deepEqual(unused, [], `alias rows no importer reaches:\n${unused.join('\n')}`);
});
