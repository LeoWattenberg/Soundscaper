/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { compareText } from './markdown.mjs';

export const GENERATED_REFERENCE_DIRECTORY = 'handbook/src/content/docs/reference/generated';
export const GENERATED_GUIDE_DIRECTORY = 'handbook/src/content/docs/guides';

/**
 * A generated document is named by its path under the output directory. The
 * reference pages sit directly in theirs; the guides are one directory per
 * category, so a name may carry a single kebab-case directory segment. Anything
 * else — an absolute path, a traversal, a deeper nesting — is refused rather
 * than resolved, because these names decide what the sync deletes.
 */
const DOCUMENT_NAME = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;

function validateDocumentMap(documents) {
	if (!(documents instanceof Map) || documents.size === 0) throw new TypeError('Generated reference documents are required.');
	for (const [name, content] of documents) {
		if (typeof name !== 'string' || !DOCUMENT_NAME.test(name)) {
			throw new RangeError(`Unsafe generated reference document name: ${String(name)}.`);
		}
		if (typeof content !== 'string' || !content.endsWith('\n')) {
			throw new TypeError(`Generated reference document ${name} must be newline-terminated text.`);
		}
	}
}

async function readIfPresent(path) {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
}

/** Every generated Markdown file under the output directory, one level deep. */
async function generatedMarkdownNames(directory, prefix = '') {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
	const names = [];
	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith('.md')) names.push(`${prefix}${entry.name}`);
		else if (entry.isDirectory() && prefix === '') {
			names.push(...await generatedMarkdownNames(join(directory, entry.name), `${entry.name}/`));
		}
	}
	return names.sort(compareText);
}

/** Remove a category directory once the sync has emptied it. */
async function pruneEmptyDirectories(outputDirectory) {
	for (const entry of await readdir(outputDirectory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const path = join(outputDirectory, entry.name);
		if ((await readdir(path)).length === 0) await rm(path, { recursive: true });
	}
}

export async function syncReferenceDocuments(
	repositoryRoot,
	documents,
	{ write = true, directory = GENERATED_REFERENCE_DIRECTORY } = {},
) {
	validateDocumentMap(documents);
	const outputDirectory = resolve(repositoryRoot, directory);
	const expectedNames = [...documents.keys()].sort(compareText);
	const actualNames = await generatedMarkdownNames(outputDirectory);
	const unexpectedNames = actualNames.filter((name) => !documents.has(name));
	const staleNames = [...unexpectedNames];

	for (const name of expectedNames) {
		const current = await readIfPresent(join(outputDirectory, name));
		if (current !== documents.get(name)) staleNames.push(name);
	}
	staleNames.sort(compareText);
	if (!write || staleNames.length === 0) return Object.freeze({ stale: Object.freeze(staleNames) });

	for (const name of expectedNames) {
		const path = join(outputDirectory, name);
		if (await readIfPresent(path) === documents.get(name)) continue;
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, documents.get(name), 'utf8');
	}
	for (const name of unexpectedNames) await rm(join(outputDirectory, name));
	await pruneEmptyDirectories(outputDirectory);
	return Object.freeze({ stale: Object.freeze(staleNames) });
}
