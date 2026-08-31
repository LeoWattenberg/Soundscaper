/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which eagerly loaded modules statically import a lazily owned one.
 *
 * This is the machinery behind the chunk-ownership invariant, kept beside the
 * test rather than inside it: a static import across the eager/lazy boundary
 * makes the importer's chunk depend on the lazy chunk, so the whole optional
 * feature is downloaded during startup and the product-ready graph blows its
 * byte budget for code the user never opened.
 *
 * `EAGER_CHUNK_GROUPS` is the list of groups whose chunks the shell loads at
 * startup. A group missing from it is treated as lazy, so adding a group here
 * is a deliberate claim that its chunk is already paid for during boot.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chunkGroupForModulePath } from '../../scripts/lib/build-chunk-groups.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const EAGER_CHUNK_GROUPS: ReadonlySet<string> = new Set([
	'editor-codec-foundations',
	'editor-copy',
	'editor-controller-core',
	'editor-domain',
	'editor-effect-contracts',
	'editor-engine',
	'editor-production-meter',
	'editor-shell',
	'editor-shell-design-components',
	'editor-storage-model',
	'editor-timeline',
	'framescaper-project-foundations',
	// Owned apart from `editor-domain` so the standalone transfer pages can read the
	// identity tuple without loading an editor chunk. These facades have no static
	// editor dependencies, and the shell loads them at startup, so they are eager.
	'project-interchange-foundations',
	'vendor-design-system',
	'vendor-react',
]);

const WORKER_ENTRY_PATTERN = /new Worker\(\s*new URL\(\s*'(\.[^']+)'/gu;
const STATIC_IMPORT_PATTERN = /^import\s+(?!type\b)([\s\S]*?)from\s+'(\.[^']+)'/gmu;

/** Every source module under one directory, recursively. */
export function sourceModules(directory: string): readonly string[] {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(?:[jt]sx?)$/u.test(entry.name))
		.map((entry) => `${entry.parentPath}/${entry.name}`)
		.sort();
}

/** The `importer [group] -> target [group]` crossings found under `roots`. */
export function eagerImportsOfLazyOwners(roots: readonly string[]): readonly string[] {
	const modules = [...new Set(roots.flatMap((root) => sourceModules(root).map((path) => resolve(path))))];
	// A module the runtime hands to `new Worker(new URL(...))` is its own bundle root, so it
	// never joins the page's startup graph and may reach lazily owned code directly.
	const workerEntries = workerEntryModules(modules);
	const crossings: string[] = [];
	for (const absolute of modules) {
		if (workerEntries.has(absolute)) continue;
		const path = relative(REPOSITORY_ROOT, absolute).split(sep).join('/');
		const owner = ownerName(path);
		if (owner === null || !EAGER_CHUNK_GROUPS.has(owner)) continue;
		for (const match of readFileSync(absolute, 'utf8').matchAll(STATIC_IMPORT_PATTERN)) {
			if (importsOnlyTypes(match[1]!)) continue;
			const target = resolveRelativeModule(absolute, match[2]!);
			if (!target) continue;
			const targetPath = relative(REPOSITORY_ROOT, target).split(sep).join('/');
			const targetOwner = ownerName(targetPath);
			if (targetOwner === null || EAGER_CHUNK_GROUPS.has(targetOwner)) continue;
			crossings.push(`${path} [${owner}] -> ${targetPath} [${targetOwner}]`);
		}
	}
	return [...new Set(crossings)].sort();
}

function resolveRelativeModule(fromPath: string, specifier: string): string | null {
	const base = resolve(dirname(fromPath), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

export function importsOnlyTypes(clause: string): boolean {
	const braces = /\{([\s\S]*)\}/u.exec(clause);
	if (!braces) return false;
	if (clause.slice(0, braces.index).trim() !== '') return false;
	const names = braces[1].split(',').map((name) => name.trim()).filter(Boolean);
	return names.length > 0 && names.every((name) => name.startsWith('type '));
}

function workerEntryModules(modules: readonly string[]): ReadonlySet<string> {
	const entries = new Set<string>();
	for (const absolute of modules) {
		for (const match of readFileSync(absolute, 'utf8').matchAll(WORKER_ENTRY_PATTERN)) {
			const target = resolveRelativeModule(absolute, match[1]!);
			if (target) entries.add(target);
		}
	}
	return entries;
}

function ownerName(path: string): string | null {
	const owner = chunkGroupForModulePath(path);
	return typeof owner === 'string' ? owner : null;
}
