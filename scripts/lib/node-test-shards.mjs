/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

// Soundscaper and Framescaper own `src/<product>/`, `desktop/<product>-*` and
// `native/<product>-*`; everything both products share lives under `src/common`.
// A Node test therefore belongs to a product shard when it reaches into that
// product's own tree, and to the shared `common` shard otherwise. A test that
// reaches into both products is a cross-product test and belongs to `common`
// too: neither product owns it, and it has to keep passing for both.
export const NODE_TEST_SHARD_IDS = Object.freeze(['common', 'framescaper', 'soundscaper']);

const TEST_FILE_PATTERN = /\.test\.(?:[cm]?[jt]s|[jt]sx)$/u;
const RELATIVE_SPECIFIER = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]*)['"]/gu;
const HELPER_EXTENSIONS = [
	'', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
	'/index.ts', '/index.tsx', '/index.js', '/index.mjs',
];

const productReferencePattern = (product) =>
	new RegExp(String.raw`(?:^|[^\w./-])(?:\.{1,2}/)*(?:src|desktop|native)/${product}[/-]`, 'u');

const PRODUCTS = Object.freeze([
	{ id: 'framescaper', reference: productReferencePattern('framescaper'), name: /framescaper/u },
	{ id: 'soundscaper', reference: productReferencePattern('soundscaper'), name: /soundscaper/u },
]);

export function listNodeTestFiles(repositoryRoot) {
	const testDirectory = resolve(repositoryRoot, 'tests');
	return readdirSync(testDirectory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && TEST_FILE_PATTERN.test(entry.name))
		.map((entry) => resolve(testDirectory, entry.name))
		.sort();
}

// The shard of a test is decided from the test's own source plus the sources of
// the helpers it pulls in from `tests/`, so a test that only reaches a product
// through a shared fixture is still shelved with that product. The closure stops
// at the `tests/` boundary on purpose: `src/common` imports both products, so
// following it would collapse every shard into one.
export function classifyNodeTestFile(repositoryRoot, testFile) {
	const text = `${localTestClosure(repositoryRoot, testFile)}\n${basename(testFile)}`;
	const owners = PRODUCTS.filter(
		(product) => product.reference.test(text) || product.name.test(basename(testFile)),
	);
	return owners.length === 1 ? owners[0].id : 'common';
}

export function classifyNodeTestFiles(repositoryRoot, testFiles = listNodeTestFiles(repositoryRoot)) {
	const shards = new Map(NODE_TEST_SHARD_IDS.map((shard) => [shard, []]));
	for (const testFile of testFiles) shards.get(classifyNodeTestFile(repositoryRoot, testFile)).push(testFile);
	return shards;
}

export function selectNodeTestFiles(repositoryRoot, { shard = null } = {}) {
	return shard === null
		? listNodeTestFiles(repositoryRoot)
		: (classifyNodeTestFiles(repositoryRoot).get(shard) ?? []);
}

export function parseNodeTestSelection(argv) {
	let shard = null;
	for (const argument of argv) {
		const shardMatch = /^--shard=(.+)$/u.exec(argument);
		if (shardMatch === null) throw new Error(`Unknown test selection argument "${argument}".`);
		shard = shardMatch[1];
		if (!NODE_TEST_SHARD_IDS.includes(shard)) {
			throw new Error(`Unknown test shard "${shard}"; expected one of ${NODE_TEST_SHARD_IDS.join(', ')}.`);
		}
	}
	return { shard };
}

export function describeNodeTestSelection({ shard }) {
	return shard === null ? 'every shard' : `the ${shard} shard`;
}

function localTestClosure(repositoryRoot, testFile) {
	const testDirectory = resolve(repositoryRoot, 'tests');
	const visited = new Set([testFile]);
	const pending = [testFile];
	const sources = [];
	while (pending.length > 0) {
		const file = pending.pop();
		const source = readSource(file);
		sources.push(source);
		for (const [, specifier] of source.matchAll(RELATIVE_SPECIFIER)) {
			const resolved = resolve(dirname(file), specifier);
			if (!resolved.startsWith(`${testDirectory}/`)) continue;
			const helper = HELPER_EXTENSIONS
				.map((extension) => `${resolved}${extension}`)
				.find((candidate) => !visited.has(candidate) && existsSync(candidate));
			if (helper === undefined) continue;
			visited.add(helper);
			pending.push(helper);
		}
	}
	return sources.join('\n');
}

function readSource(file) {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return '';
	}
}
