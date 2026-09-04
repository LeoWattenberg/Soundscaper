#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { collectMaintainedSourceFiles } from './lib/maintained-source-files.mjs';
import {
	MAINTAINED_SOURCE_ROOTS,
} from './lib/maintained-source-policy.mjs';
import {
	assessFile,
	describeAssessment,
	FAILING_STATUSES,
	loadMaintainabilityConfig,
} from './lib/maintainability-ceiling.mjs';
import { sourceLineCount } from './lib/source-line-count.mjs';

const root = resolve(import.meta.dirname, '..');
const configPath = join(root, 'config', 'maintainability-allowlist.json');
const config = loadMaintainabilityConfig(root);
const listWarnings = process.argv.includes('--warnings');
const tighten = process.argv.includes('--tighten');

const files = MAINTAINED_SOURCE_ROOTS
	.flatMap((directory) => collectMaintainedSourceFiles(join(root, directory)))
	.sort();
const observed = new Set();
const findings = [];
const notes = [];
const warnings = [];
const tightened = new Map();

for (const path of files) {
	const repositoryPath = relative(root, path).split(sep).join('/');
	const lines = sourceLineCount(readFileSync(path, 'utf8'));
	const assessment = assessFile(repositoryPath, lines, config);
	if (assessment.ratchet !== null) observed.add(repositoryPath);
	const message = describeAssessment(repositoryPath, assessment);
	if (FAILING_STATUSES.includes(assessment.status)) findings.push(message);
	else if (assessment.status === 'near-ceiling') warnings.push(message);
	else if (message) {
		notes.push(message);
		tightened.set(repositoryPath, assessment.status === 'exception-obsolete' ? null : lines);
	}
}

for (const repositoryPath of Object.keys(config.allow)) {
	if (!observed.has(repositoryPath)) findings.push(`${repositoryPath}: size exception does not match a checked file.`);
}

if (tighten && !findings.length && tightened.size) {
	const updated = { ...config, allow: { ...config.allow } };
	for (const [repositoryPath, maxLines] of tightened) {
		if (maxLines === null) delete updated.allow[repositoryPath];
		else updated.allow[repositoryPath] = { ...updated.allow[repositoryPath], maxLines };
	}
	writeFileSync(configPath, `${JSON.stringify(updated, null, '\t')}\n`);
	console.log(`Tightened ${tightened.size} size exception(s) to the sizes those files now have.`);
} else if (notes.length) {
	console.log(`${notes.length} size exception(s) have room to tighten:`);
	for (const note of notes) console.log(`  ${note}`);
}

if (findings.length) throw new Error(`Maintainability size guard failed:\n${findings.join('\n')}`);

console.log(`Checked ${files.length} maintained source files (${config.defaultMaxLines} lines; ${config.browserSpecMaxLines} for browser specs).`);
if (warnings.length && listWarnings) {
	console.log(`${warnings.length} file(s) within ${config.defaultMaxLines - config.warnLines} lines of their ceiling:`);
	for (const warning of warnings) console.log(`  ${warning}`);
} else if (warnings.length) {
	console.log(`${warnings.length} file(s) are at or past ${config.warnLines} lines and have little room left; run with --warnings to list them.`);
}
