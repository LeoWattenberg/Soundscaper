/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The desktop payload lists, checked against the repository they name.
 *
 * Staging a desktop payload is a slow test: it copies trees, resolves package
 * closures and reads back what it wrote, so a path that a refactor renamed is
 * found minutes into a packaging run - or, for the nightly launcher's own
 * `files` list, only once electron-builder has produced an artifact that is
 * quietly missing a module. Nothing about "does this path still exist" needs a
 * staged tree, so it is asserted here instead, in one pass over the manifests.
 *
 * The generated roots are the exception: the nightly payload stages verified
 * browser sites out of `.wrangler/`, which exists only after a build. Those
 * entries are still held to their declared kind and to agreeing with every
 * other list that names them; only their existence waits for the staging test.
 */

import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	DESKTOP_5B_TRANSITIVE_RUNTIME_FILES,
	DESKTOP_RUNTIME_BUNDLED_LEAF_FILES,
} from '../scripts/lib/desktop-5b-transitive-runtime-files.mjs';
import {
	NIGHTLY_TEST_PAYLOAD_INPUTS,
} from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

const NIGHTLY_BUILDER_CONFIG = createRequire(import.meta.url)(
	'../electron-builder.nightly-tests.config.cjs',
) as { readonly files: readonly string[]; readonly directories: { readonly app: string } };

/** Roots a build writes, so a checkout that has not built one is not a failure. */
const GENERATED_ROOTS = Object.freeze(['.desktop-build', '.wrangler', 'dist', 'release']);

type PathKind = 'file' | 'directory';

interface ManifestClaim {
	readonly list: string;
	readonly path: string;
	readonly kind: PathKind;
}

const CLAIMS: readonly ManifestClaim[] = Object.freeze([
	...DESKTOP_5B_TRANSITIVE_RUNTIME_FILES.map((path: string) => ({
		list: 'DESKTOP_5B_TRANSITIVE_RUNTIME_FILES', path, kind: 'file' as const,
	})),
	...DESKTOP_RUNTIME_BUNDLED_LEAF_FILES.map((path: string) => ({
		list: 'DESKTOP_RUNTIME_BUNDLED_LEAF_FILES', path, kind: 'file' as const,
	})),
	...NIGHTLY_TEST_PAYLOAD_INPUTS.map((input: { source: string; kind: string }) => ({
		list: 'NIGHTLY_TEST_PAYLOAD_INPUTS', path: input.source, kind: input.kind as PathKind,
	})),
]);

test('every path the desktop payload manifests name is backed by the repository', async () => {
	const checked = CLAIMS.filter(({ path }) => !isGenerated(path));
	assert.ok(checked.length >= CLAIMS.length - 2, 'only the built browser sites may be generated');
	const failures: string[] = [];
	for (const claim of checked) {
		const candidates = repositoryCandidates(claim);
		const kinds = await Promise.all(candidates.map((path) => kindOf(join(REPOSITORY_ROOT, path))));
		if (kinds.includes(claim.kind)) continue;
		failures.push(candidates.length === 1
			? `${claim.list} names ${claim.path}, which is ${kinds[0]} rather than a ${claim.kind}`
			: `${claim.list} names ${claim.path}, and no source under ${candidates.join(' or ')} backs it`);
	}
	assert.deepEqual(failures.sort(), []);
});

test('no desktop payload manifest lists the same path twice', () => {
	const duplicates: string[] = [];
	for (const list of new Set(CLAIMS.map(({ list: name }) => name))) {
		const paths = CLAIMS.filter((claim) => claim.list === list).map(({ path }) => path);
		const seen = new Set<string>();
		for (const path of paths) {
			if (seen.has(path)) duplicates.push(`${list} lists ${path} twice`);
			seen.add(path);
		}
	}
	assert.deepEqual(duplicates.sort(), []);
});

test('two manifests that name one path agree on what it is', () => {
	const kinds = new Map<string, ManifestClaim>();
	const conflicts: string[] = [];
	for (const claim of CLAIMS) {
		const first = kinds.get(claim.path);
		if (first === undefined) kinds.set(claim.path, claim);
		else if (first.kind !== claim.kind) {
			conflicts.push(
				`${first.list} calls ${claim.path} a ${first.kind} and ${claim.list} calls it a ${claim.kind}`,
			);
		}
	}
	assert.deepEqual(conflicts.sort(), []);
});

test('the nightly launcher packages only files the payload manifest stages', () => {
	// `files` is read from the staged application directory, so every literal
	// entry has to be something the stager put there under that exact name.
	assert.equal(NIGHTLY_BUILDER_CONFIG.directories.app, '.desktop-build/nightly-tests');
	const staged = new Set(
		NIGHTLY_TEST_PAYLOAD_INPUTS.map(({ destination }: { destination: string }) => destination),
	);
	// The stager writes the payload's own manifest and package metadata.
	staged.add('package.json');
	const unstaged = NIGHTLY_BUILDER_CONFIG.files
		.filter((pattern) => !pattern.startsWith('!') && !pattern.includes('*'))
		.filter((pattern) => !staged.has(pattern))
		.map((pattern) => `the nightly launcher packages ${pattern}, which nothing stages`);
	assert.deepEqual(unstaged.sort(), []);
});

test('the nightly payload manifest stages every source to a destination of its own', () => {
	const destinations = NIGHTLY_TEST_PAYLOAD_INPUTS.map(
		({ destination }: { destination: string }) => destination,
	);
	assert.equal(new Set(destinations).size, destinations.length);
	const escaping = destinations.filter(
		(destination) => resolve(REPOSITORY_ROOT, destination).startsWith(REPOSITORY_ROOT) === false,
	);
	assert.deepEqual(escaping, []);
});

/**
 * The desktop runtime lists name the modules the staged runtime emits, and the
 * runtime is written in TypeScript: `desktop/native-services-runtime-v3.js` is
 * staged from `desktop/native-services-runtime-v3.ts`. A listed module is
 * therefore backed by whichever of those the repository actually carries.
 */
function repositoryCandidates(claim: ManifestClaim): readonly string[] {
	if (claim.kind !== 'file' || !claim.path.endsWith('.js')) return [claim.path];
	const stem = claim.path.slice(0, -'.js'.length);
	return [claim.path, `${stem}.ts`, `${stem}.tsx`];
}

function isGenerated(path: string): boolean {
	return GENERATED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

async function kindOf(path: string): Promise<string> {
	try {
		const entry = await stat(path);
		if (entry.isFile()) return 'file';
		return entry.isDirectory() ? 'directory' : 'neither a file nor a directory';
	} catch { return 'missing'; }
}
