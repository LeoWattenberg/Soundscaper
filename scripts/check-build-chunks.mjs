#!/usr/bin/env node

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const buildDirectory = join(root, 'dist');
const javaScriptChunkPattern = /\.(?:c|m)?js$/u;
const fontAssetPattern = /\.(?:otf|ttf|woff2?)$/iu;
const woff2AssetPattern = /\.woff2$/iu;

export const MAX_JAVASCRIPT_CHUNK_BYTES = 500_000;
export const MAX_FONT_ASSET_COUNT = 21;
export const MAX_FONT_ASSET_BYTES = 600_000;

export function findOversizedJavaScriptChunks(records, maximumBytes = MAX_JAVASCRIPT_CHUNK_BYTES) {
	return records
		.filter(({ path, size }) => javaScriptChunkPattern.test(path) && size > maximumBytes)
		.sort((left, right) => right.size - left.size || left.path.localeCompare(right.path));
}

export function findFontInventoryProblems(
	records,
	maximumCount = MAX_FONT_ASSET_COUNT,
	maximumBytes = MAX_FONT_ASSET_BYTES,
) {
	const fontRecords = records.filter(({ path }) => fontAssetPattern.test(path));
	const problems = fontRecords
		.filter(({ path }) => !woff2AssetPattern.test(path))
		.map(({ path }) => `${path}: emitted fonts must be WOFF2`)
		.sort();
	const woff2Records = fontRecords.filter(({ path }) => woff2AssetPattern.test(path));
	const totalBytes = woff2Records.reduce((sum, { size }) => sum + size, 0);
	if (woff2Records.length > maximumCount) {
		problems.push(`font count ${woff2Records.length} exceeds ${maximumCount}`);
	}
	if (totalBytes > maximumBytes) problems.push(`font bytes ${totalBytes} exceed ${maximumBytes}`);
	return problems;
}

export function checkBuildChunks(directory = buildDirectory) {
	const records = collectFiles(directory)
		.map((path) => ({
			path: relative(root, path).split(sep).join('/'),
			size: statSync(path).size,
		}))
		.sort((left, right) => right.size - left.size || left.path.localeCompare(right.path));
	const javaScriptRecords = records.filter(({ path }) => javaScriptChunkPattern.test(path));
	if (javaScriptRecords.length === 0) throw new Error('No built JavaScript chunks were found in dist.');

	const oversized = findOversizedJavaScriptChunks(javaScriptRecords);
	if (oversized.length) {
		throw new Error([
			`Built JavaScript chunks must not exceed ${MAX_JAVASCRIPT_CHUNK_BYTES.toLocaleString('en-US')} bytes:`,
			...oversized.map(({ path, size }) => `${path}: ${size.toLocaleString('en-US')} bytes`),
		].join('\n'));
	}
	const fontProblems = findFontInventoryProblems(records);
	if (fontProblems.length) throw new Error(`Built font inventory failed:\n${fontProblems.join('\n')}`);

	console.log(
		`Checked ${javaScriptRecords.length} built JavaScript chunks; largest is ${javaScriptRecords[0].path} at ${javaScriptRecords[0].size.toLocaleString('en-US')} bytes.`,
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
