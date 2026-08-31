#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRODUCTS = Object.freeze({
	soundscaper: 'Soundscaper',
	framescaper: 'Framescaper',
});
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const RESULT_ROW = /^\| [A-Z]+-\d{2} \| .+? \| (?<result>[^|]+?) \|.*\|$/u;

export async function createQaRun({ repositoryRoot = REPOSITORY_ROOT, product, now = new Date() }) {
	if (!Object.hasOwn(PRODUCTS, product)) {
		throw new Error('Choose soundscaper or framescaper.');
	}
	if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
		throw new TypeError('QA run time must be a valid Date.');
	}
	const root = resolve(repositoryRoot);
	const outputDirectory = join(root, 'qa-runs');
	await ensurePrivateOutputDirectory(outputDirectory);
	const templatePath = join(root, 'docs', 'qa', `${product}.md`);
	const template = await readFile(templatePath, 'utf8');
	validateTemplate(template, templatePath);
	const timestamp = now.toISOString();
	const filenameTimestamp = timestamp.replaceAll('-', '').replaceAll(':', '').replace('.', '');
	const outputPath = join(outputDirectory, `${product}-${filenameTimestamp}.md`);
	const markdown = template
		.replace('{{PRODUCT}}', PRODUCTS[product])
		.replace('{{UTC_TIMESTAMP}}', timestamp);
	try {
		await writeFile(outputPath, markdown, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
	} catch (error) {
		if (error?.code === 'EEXIST') {
			throw new Error(`QA run already exists: ${outputPath}`, { cause: error });
		}
		throw error;
	}
	return outputPath;
}

async function ensurePrivateOutputDirectory(outputDirectory) {
	try {
		const entry = await lstat(outputDirectory);
		if (entry.isSymbolicLink()) throw new Error('QA output directory must not be a symbolic link.');
		if (!entry.isDirectory()) throw new Error('QA output path must be a directory.');
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
		await mkdir(outputDirectory, { mode: 0o700 });
	}
}

function validateTemplate(markdown, path) {
	for (const placeholder of ['{{PRODUCT}}', '{{UTC_TIMESTAMP}}']) {
		if (markdown.split(placeholder).length !== 2) {
			throw new Error(`${path} must contain ${placeholder} exactly once.`);
		}
	}
	const results = markdown.split('\n').flatMap((line) => {
		const match = RESULT_ROW.exec(line);
		return match ? [match.groups.result.trim()] : [];
	});
	if (results.length === 0 || results.some((result) => result !== 'not-run')) {
		throw new Error(`${path} must contain only not-run QA rows.`);
	}
}

function isMainModule() {
	return process.argv[1] !== undefined
		&& pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	try {
		const product = process.argv[2];
		if (process.argv.length !== 3) throw new Error('Usage: npm run qa:new -- <soundscaper|framescaper>');
		const outputPath = await createQaRun({ product });
		process.stdout.write(`Created ${relative(REPOSITORY_ROOT, outputPath)}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
