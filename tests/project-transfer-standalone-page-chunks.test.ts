/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

/**
 * The transfer documents must stay standalone in the emitted chunk graph.
 *
 * `scripts/generate-static-routes.mjs` preloads whatever the build manifest
 * records as the transfer chunk's static imports, so the page's weight is
 * decided here, by which chunk owns each module the page eagerly reaches.
 * Chunks load whole: one static import of a module an editor chunk owns puts
 * that whole chunk - and everything it imports - into the transfer document's
 * preload set. That is not hypothetical. A single call to
 * `isFramescaperSequenceProjectSchema` from `transfer-project-selection.ts`
 * reached `project-schema-identity.ts` while `editor-domain` claimed it, and both
 * generated transfer documents carried 62 modulepreloads totalling 5,546,304
 * bytes, 49 of them editor chunks, onto a page that mounts no editor.
 *
 * So the first half of this file asserts the rule rather than a byte count:
 * every module the page reaches through a *static* import either belongs to the
 * transfer world or is owned by a chunk group that is not an editor chunk. The
 * archive runtime is deliberately out of scope - it is reached through a dynamic
 * import, and it may load the real editor exporter, because by then the visitor
 * has asked for a transfer and the page is already mounted.
 *
 * That half models the closure from the *source*, and it is blind in one way
 * that matters: it can only follow relative specifiers between files that exist
 * on disk. The chunk graph has edges that no source file declares. The largest
 * one here is `vite/preload-helper`, which rolldown injects into any chunk that
 * performs a dynamic import - the transfer page does, for its archive runtime -
 * and which the `$initial`-tagged `site-entry` group owns, together with
 * react-dom. Nothing in the source closure can see that edge, so the second half
 * of this file measures the built documents instead: the preload set actually
 * emitted into each `dist/transfer/<role>/index.html`, by chunk group and byte.
 *
 * Those tests need a build. In CI they get one from the `quality` job, which
 * runs this file straight after `npm run check:static` has built `dist/` and
 * before that build is uploaded as an artifact, with
 * `SOUNDSCAPER_TRANSFER_BUILD_REQUIRED=1` set so a missing build fails there
 * instead of standing the guard down. The Node test shards run the same file
 * over an unbuilt checkout: the source-closure half executes, and the built half
 * says there is no build rather than passing quietly.
 */

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TRANSFER_PAGE_ENTRY = fileURLToPath(new URL('../src/common/transfer/transfer-page-entry.ts', import.meta.url));
const TRANSFER_DIRECTORY = 'src/common/transfer/';
const SCHEMA_IDENTITY_MODULE = 'src/common/editor/project-schema-identity.ts';
const HANDOFF_INTENT_MODULE = 'src/common/cross-product-handoff-intent.ts';

/**
 * Modules outside the transfer world that the mounted page statically reaches.
 *
 * Every entry is a chunk the transfer documents pay for on load, so growing this
 * list is a deliberate claim - and the module named has to have an owner that no
 * editor chunk shares.
 */
const EXPECTED_SHARED_MODULES = [HANDOFF_INTENT_MODULE, SCHEMA_IDENTITY_MODULE];

test('the transfer page statically reaches only the transfer world and named shared modules', () => {
	const shared = [...staticImportClosure(TRANSFER_PAGE_ENTRY)]
		.filter((path) => !path.startsWith(TRANSFER_DIRECTORY))
		.sort();
	assert.deepEqual(shared, EXPECTED_SHARED_MODULES);
});

test('no editor chunk owns a module the transfer page statically reaches', () => {
	const editorOwned = [...staticImportClosure(TRANSFER_PAGE_ENTRY)]
		.map((path) => [path, chunkOwner(path)] as const)
		.filter(([path, owner]) => (
			!path.startsWith(TRANSFER_DIRECTORY)
			&& (owner === null || owner.startsWith('editor-'))
		))
		.map(([path, owner]) => `${path} -> ${owner ?? 'no owner, placed by reachability'}`)
		.sort();
	assert.deepEqual(editorOwned, [], 'these modules put a whole editor chunk in the transfer preload set');
});

test('the project identity and handoff intent form one dependency-closed chunk', () => {
	assert.equal(chunkOwner(SCHEMA_IDENTITY_MODULE), 'project-schema-identity');
	assert.equal(chunkOwner(HANDOFF_INTENT_MODULE), 'project-schema-identity');
	const group = chunkGroups.find((candidate) => candidate.name === 'project-schema-identity');
	assert.ok(group, 'project-schema-identity must exist');
	assert.equal(group.minSize, 0, 'a shared leaf must not be merged back into a larger chunk');
	assert.equal(group.includeDependenciesRecursively, false);
	const domain = chunkGroups.find((candidate) => candidate.name === 'editor-domain');
	assert.ok(domain);
	assert.ok(
		Number(group.priority) > Number(domain.priority),
		'editor-domain matches every flat editor module, so the leaf group must outrank it',
	);
	assert.deepEqual(
		staticImports(resolve(REPOSITORY_ROOT, SCHEMA_IDENTITY_MODULE)),
		[],
		'the schema vocabulary must stay dependency-free, or its chunk stops being small',
	);
	assert.deepEqual(
		staticImports(resolve(REPOSITORY_ROOT, HANDOFF_INTENT_MODULE)),
		[resolve(REPOSITORY_ROOT, SCHEMA_IDENTITY_MODULE)],
		'the launch intent may depend only on the identity vocabulary in its own chunk',
	);
});

/* ---------------------------------------------------------------------- */
/* The built documents: what the visitor actually downloads.              */
/* ---------------------------------------------------------------------- */

const BUILT_TRANSFER_DOCUMENTS = ['dist/transfer/send/index.html', 'dist/transfer/receive/index.html'];

/** Which of the built documents this checkout is actually holding. */
const MISSING_TRANSFER_DOCUMENTS = BUILT_TRANSFER_DOCUMENTS
	.filter((document) => !existsSync(resolve(REPOSITORY_ROOT, document)));

/**
 * Set by whichever job ran the build, to turn a missing `dist/` into a failure.
 *
 * A guard that decides for itself whether to run is not a guard. The Node test
 * shards check the repository out and never build, so on a skip-if-absent rule
 * alone these three tests have never once executed in CI - they reported as
 * skipped, the pipeline went green, and the regression they exist to catch
 * (react-dom reaching the standalone page through `vite/preload-helper`) would
 * have landed unremarked. `.github/workflows/quality.yml` now runs this file in
 * the `quality` job, which has just built `dist/`, with this variable set: there
 * the absence of a build is not a reason to stand down, it is the failure.
 */
const BUILD_REQUIRED = process.env.SOUNDSCAPER_TRANSFER_BUILD_REQUIRED === '1';

/**
 * These tests read `dist/`, so they are only meaningful after a build.
 *
 * They are skipped with this reason rather than quietly passing, because the
 * source-closure tests above cannot stand in for them: the edge that costs this
 * page the most - the injected `vite/preload-helper`, and the site-entry chunk
 * that owns it - exists only in the built graph. The skip is for a developer
 * running the suite over an unbuilt tree; a job that promised a build never
 * takes it.
 */
const NO_BUILD_OUTPUT = MISSING_TRANSFER_DOCUMENTS.length === 0 || BUILD_REQUIRED
	? false
	: `${MISSING_TRANSFER_DOCUMENTS[0]} is absent; run \`npm run build\` to measure the shipped preload set.`;

/** Fail closed where the build was promised, rather than measuring nothing. */
function requireBuiltTransferDocuments(): void {
	if (MISSING_TRANSFER_DOCUMENTS.length === 0) return;
	throw new Error(
		'SOUNDSCAPER_TRANSFER_BUILD_REQUIRED is set, so this job undertook to measure the built'
		+ ` transfer documents, but ${MISSING_TRANSFER_DOCUMENTS.join(' and ')} is absent.`
		+ ' Run `npm run build` before this file, or stop setting the variable - skipping here'
		+ ' would leave the shipped preload set unmeasured while the pipeline reported green.',
	);
}

/**
 * Chunk groups the transfer documents may preload, and nothing else.
 *
 * Chunk file names carry their group, so this is the built-output counterpart of
 * the ownership rule above: an editor group appearing here is the 5 MB
 * regression that this whole file exists to catch.
 */
const ADMITTED_PRELOAD_GROUPS = [
	'cross-product-handoff-report-sidecar',
	'cross-product-handoff-root-contract',
	'project-schema-identity',
	'rolldown-runtime',
	'site-entry',
	'transfer-manual-refusal',
	'vendor',
];

/**
 * The most the transfer documents may preload, in bytes.
 *
 * Above what they cost today (nine chunks, about 302,000 bytes) and far
 * below what one editor chunk would add, so this bounds the cost without
 * re-recording it on every rebuild.
 */
const PRELOAD_BYTE_CEILING = 360_000;

/** Strings only the React runtime or its DOM renderer leaves in a built chunk. */
const REACT_RUNTIME_MARK = /Minified React error|react\.transitional\.element|react-dom/u;

test('the built transfer documents preload no editor chunk', { skip: NO_BUILD_OUTPUT }, () => {
	requireBuiltTransferDocuments();
	for (const document of BUILT_TRANSFER_DOCUMENTS) {
		const groups = [...new Set(preloadedChunks(document).map((chunk) => chunk.group))].sort();
		assert.deepEqual(groups, ADMITTED_PRELOAD_GROUPS, `${document} preloads an unadmitted chunk group`);
	}
	const [send, receive] = BUILT_TRANSFER_DOCUMENTS.map((document) => (
		preloadedChunks(document).map((chunk) => chunk.href).sort()
	));
	assert.deepEqual(send, receive, 'both transfer documents are the same page and must cost the same');
});

test('the built transfer preload set stays under its byte ceiling', { skip: NO_BUILD_OUTPUT }, () => {
	requireBuiltTransferDocuments();
	for (const document of BUILT_TRANSFER_DOCUMENTS) {
		const chunks = preloadedChunks(document);
		const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
		assert.ok(
			byteLength <= PRELOAD_BYTE_CEILING,
			`${document} preloads ${chunks.length} chunks totalling ${byteLength} bytes,`
			+ ` over the ${PRELOAD_BYTE_CEILING} byte ceiling: ${chunks.map((chunk) => chunk.href).join(', ')}`,
		);
	}
});

test('React reaches the built pages through the site-entry group', { skip: NO_BUILD_OUTPUT }, () => {
	// Recorded, not endorsed. `transfer-page-entry.ts` imports its archive
	// runtime dynamically, rolldown answers that with `vite/preload-helper`, and
	// the `$initial`-tagged site-entry group owns the helper and react-dom alike -
	// so the standalone page preloads the React renderer it never calls. The
	// docblock in `scripts/generate-static-routes.mjs` says so too, and this is
	// what keeps the two honest: when the helper gets an owner of its own, this
	// expectation goes empty and that docblock has to be rewritten with it.
	requireBuiltTransferDocuments();
	for (const document of BUILT_TRANSFER_DOCUMENTS) {
		const carrying = preloadedChunks(document)
			.filter((chunk) => REACT_RUNTIME_MARK.test(chunk.text))
			.map((chunk) => chunk.group)
			.sort();
		assert.deepEqual(carrying, ['site-entry', 'site-entry'], document);
	}
});

/**
 * Every chunk one built transfer document preloads, with its group and weight.
 *
 * The document is the measurement: the build manifest the generator read is
 * deleted by the offline-shell step that runs after it, so the emitted
 * `<link rel="modulepreload">` set is the only surviving record of what the page
 * asks the browser to fetch before it runs.
 */
function preloadedChunks(document: string): readonly {
	href: string;
	group: string;
	byteLength: number;
	text: string;
}[] {
	const html = readFileSync(resolve(REPOSITORY_ROOT, document), 'utf8');
	const root = resolve(REPOSITORY_ROOT, dirname(document), '../..');
	const chunks = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/gu)].map(([, href]) => {
		assert.match(href, /^\/assets\/[^/]+\.js$/u, `${document} preloads ${href}, which is not a built chunk`);
		const file = resolve(root, `.${href}`);
		const text = readFileSync(file, 'utf8');
		return { href, group: chunkGroupName(href), byteLength: statSync(file).size, text };
	});
	assert.ok(chunks.length > 0, `${document} preloads nothing, so this file is measuring the wrong document`);
	return chunks;
}

/** The group name a hashed chunk file carries, which is how a chunk is identified. */
function chunkGroupName(href: string): string {
	const match = /^\/assets\/(.+)-[A-Za-z\d_-]{8}\.js$/u.exec(href);
	assert.ok(match, `${href} is not a hashed chunk file name`);
	return match[1];
}

/**
 * The name of the group that claims one module, or null when nothing does.
 *
 * A group may name its chunks with a function instead of a string. None here
 * does, and one that did could not be checked against a name, so it is reported
 * the same way an unowned module is: as a module whose chunk is not accounted for.
 */
function chunkOwner(path: string): string | null {
	const owner = chunkGroupForModulePath(path);
	return typeof owner === 'string' ? owner : null;
}

/** Every repository-relative module reachable from `entry` through value imports. */
function staticImportClosure(entry: string): Set<string> {
	const seen = new Set<string>();
	const pending = [entry];
	while (pending.length) {
		const file = pending.pop() as string;
		const modulePath = relative(REPOSITORY_ROOT, file).replaceAll('\\', '/');
		if (seen.has(modulePath)) continue;
		seen.add(modulePath);
		pending.push(...staticImports(file));
	}
	return seen;
}

/**
 * Absolute paths of the value imports one module declares.
 *
 * Type-only imports are erased before the bundler sees them, and dynamic
 * imports get their own chunk, so neither one costs the mounted page anything.
 */
function staticImports(file: string): string[] {
	const source = readFileSync(file, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//gu, '');
	const imports: string[] = [];
	const pattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;=`]*?\sfrom\s*)?['"]([^'"]+)['"]/gu;
	for (const [, typeOnly, specifier] of source.matchAll(pattern)) {
		if (typeOnly || !specifier.startsWith('.')) continue;
		imports.push(resolveModule(file, specifier));
	}
	return imports;
}

function resolveModule(importer: string, specifier: string): string {
	const target = resolve(dirname(importer), specifier);
	const candidates = [target, target.replace(/\.js$/u, '.ts'), `${target}.ts`, `${target}.js`];
	const resolved = candidates.find((candidate) => existsSync(candidate));
	if (!resolved) {
		throw new Error(`${relative(REPOSITORY_ROOT, importer)} imports unresolvable ${specifier}.`);
	}
	return resolved;
}
