/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { compareText } from './markdown.mjs';

export const GENERATED_REFERENCE_DIRECTORY = 'handbook/src/content/docs/reference/generated';
export const GENERATED_LESSON_DIRECTORY = 'handbook/src/content/docs/lessons';

function validateDocumentMap(documents) {
	if (!(documents instanceof Map) || documents.size === 0) throw new TypeError('Generated reference documents are required.');
	for (const [name, content] of documents) {
		if (basename(name) !== name || !/^[a-z0-9-]+\.md$/u.test(name)) {
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

async function generatedMarkdownNames(directory) {
	try {
		return (await readdir(directory, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
			.map(({ name }) => name)
			.sort(compareText);
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
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

	await mkdir(outputDirectory, { recursive: true });
	for (const name of expectedNames) {
		const path = join(outputDirectory, name);
		if (await readIfPresent(path) !== documents.get(name)) await writeFile(path, documents.get(name), 'utf8');
	}
	for (const name of unexpectedNames) await rm(join(outputDirectory, name));
	return Object.freeze({ stale: Object.freeze(staleNames) });
}
