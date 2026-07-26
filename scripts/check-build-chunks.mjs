#!/usr/bin/env node

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const buildDirectory = join(root, 'dist');
const javaScriptChunkPattern = /\.(?:c|m)?js$/u;

export const MAX_JAVASCRIPT_CHUNK_BYTES = 500_000;

export function findOversizedJavaScriptChunks(records, maximumBytes = MAX_JAVASCRIPT_CHUNK_BYTES) {
	return records
		.filter(({ path, size }) => javaScriptChunkPattern.test(path) && size > maximumBytes)
		.sort((left, right) => right.size - left.size || left.path.localeCompare(right.path));
}

export function checkBuildChunks(directory = buildDirectory) {
	const records = collectFiles(directory)
		.map((path) => ({
			path: relative(root, path).split(sep).join('/'),
			size: statSync(path).size,
		}))
		.filter(({ path }) => javaScriptChunkPattern.test(path))
		.sort((left, right) => right.size - left.size || left.path.localeCompare(right.path));
	if (records.length === 0) throw new Error('No built JavaScript chunks were found in dist.');

	const oversized = findOversizedJavaScriptChunks(records);
	if (oversized.length) {
		throw new Error([
			`Built JavaScript chunks must not exceed ${MAX_JAVASCRIPT_CHUNK_BYTES.toLocaleString('en-US')} bytes:`,
			...oversized.map(({ path, size }) => `${path}: ${size.toLocaleString('en-US')} bytes`),
		].join('\n'));
	}

	console.log(
		`Checked ${records.length} built JavaScript chunks; largest is ${records[0].path} at ${records[0].size.toLocaleString('en-US')} bytes.`,
	);
}

function collectFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return collectFiles(path);
		return entry.isFile() ? [path] : [];
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkBuildChunks();
