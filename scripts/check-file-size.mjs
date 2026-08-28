#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import {
	MAINTAINED_SOURCE_ROOTS,
	isMaintainedSourceFile,
} from './lib/maintained-source-policy.mjs';
import { sourceLineCount } from './lib/source-line-count.mjs';

const root = resolve(import.meta.dirname, '..');
const configPath = join(root, 'config', 'maintainability-allowlist.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const ignoredSegments = new Set(['native', 'node_modules', 'test-results']);
const browserSpecPattern = /^tests\/browser\/.*\.spec\.[cm]?[jt]sx?$/u;

if (config.schemaVersion !== 1
	|| !Number.isSafeInteger(config.defaultMaxLines)
	|| config.defaultMaxLines < 1
	|| !Number.isSafeInteger(config.browserSpecMaxLines)
	|| config.browserSpecMaxLines < 1
	|| !config.allow
	|| typeof config.allow !== 'object'
	|| Array.isArray(config.allow)) {
	throw new Error('Unsupported maintainability allowlist schema.');
}

const files = MAINTAINED_SOURCE_ROOTS.flatMap((directory) => walk(join(root, directory))).sort();
const observed = new Set();
const findings = [];

for (const path of files) {
	const repositoryPath = relative(root, path).split(sep).join('/');
	const lines = sourceLineCount(readFileSync(path, 'utf8'));
	const lineLimit = browserSpecPattern.test(repositoryPath)
		? config.browserSpecMaxLines
		: config.defaultMaxLines;
	const exception = config.allow[repositoryPath];
	if (exception) {
		observed.add(repositoryPath);
		if (!Number.isSafeInteger(exception.maxLines) || !String(exception.reason || '').trim()) {
			findings.push(`${repositoryPath}: allowlist entries require maxLines and a reason.`);
		} else if (lines > exception.maxLines) {
			findings.push(`${repositoryPath}: ${lines} lines exceeds its ratchet of ${exception.maxLines}; extract code or review the allowlist explicitly.`);
		} else if (lines <= lineLimit) {
			findings.push(`${repositoryPath}: now ${lines} lines; remove its obsolete size exception.`);
		} else if (lines < exception.maxLines) {
			findings.push(`${repositoryPath}: now ${lines} lines; lower its ratchet from ${exception.maxLines}.`);
		}
	} else if (lines > lineLimit) {
		findings.push(`${repositoryPath}: ${lines} lines exceeds the ${lineLimit}-line limit.`);
	}
}

for (const repositoryPath of Object.keys(config.allow)) {
	if (!observed.has(repositoryPath)) findings.push(`${repositoryPath}: size exception does not match a checked file.`);
}

if (findings.length) throw new Error(`Maintainability size guard failed:\n${findings.join('\n')}`);
console.log(`Checked ${files.length} maintained source files (${config.defaultMaxLines} lines; ${config.browserSpecMaxLines} for browser specs).`);

function walk(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory() && ignoredSegments.has(entry.name)) return [];
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return walk(path);
		return entry.isFile() && isMaintainedSourceFile(entry.name) ? [path] : [];
	});
}
