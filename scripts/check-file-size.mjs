#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { collectMaintainedSourceFiles } from './lib/maintained-source-files.mjs';
import {
	MAINTAINED_SOURCE_ROOTS,
} from './lib/maintained-source-policy.mjs';
import {
	assessFile,
	compareMaintainabilityConfigs,
	describeAssessment,
	describeMaintainedFileGrowth,
	FAILING_STATUSES,
	loadMaintainabilityConfig,
	planMaintainabilityTightening,
	tightenMaintainabilityConfig,
	validateMaintainabilityConfig,
} from './lib/maintainability-ceiling.mjs';
import { sourceLineCount } from './lib/source-line-count.mjs';

const root = resolve(import.meta.dirname, '..');
const configPath = join(root, 'config', 'maintainability-allowlist.json');
const config = loadMaintainabilityConfig(root);
const listWarnings = process.argv.includes('--warnings');
const tighten = process.argv.includes('--tighten');
const baseline = loadMaintainabilityBaseline();

const files = MAINTAINED_SOURCE_ROOTS
	.flatMap((directory) => collectMaintainedSourceFiles(join(root, directory)))
	.sort();
const findings = [];
const notes = [];
const warnings = [];
const observed = new Set();
const currentLineCounts = new Map();
const tightenedAllow = new Map();
const tightenedWarningBand = new Map();

const effectiveWarningThreshold = baseline
	? Math.min(config.warnLines, baseline.config.warnLines)
	: config.warnLines;
const baselineLineCounts = new Map();

for (const path of files) {
	const repositoryPath = relative(root, path).split(sep).join('/');
	observed.add(repositoryPath);
	const lines = sourceLineCount(readFileSync(path, 'utf8'));
	currentLineCounts.set(repositoryPath, lines);
	if (baseline && lines >= effectiveWarningThreshold) {
		const previousPath = baseline.previousPathByCurrent.get(repositoryPath) ?? repositoryPath;
		const baselineLines = readBaselineLineCount(baseline.revision, previousPath, baselineLineCounts);
		const growth = describeMaintainedFileGrowth(
			repositoryPath,
			lines,
			baselineLines,
			effectiveWarningThreshold,
		);
		if (growth) findings.push(growth);
	}
	const assessment = assessFile(repositoryPath, lines, config);
	const message = describeAssessment(repositoryPath, assessment);
	if (FAILING_STATUSES.includes(assessment.status)) findings.push(message);
	else if (assessment.status === 'at-warning-ratchet') warnings.push(message);
	else if (message) {
		notes.push(message);
		const tightening = planMaintainabilityTightening(assessment, config);
		if (Object.hasOwn(tightening, 'allow')) tightenedAllow.set(repositoryPath, tightening.allow);
		if (Object.hasOwn(tightening, 'warningBand')) {
			tightenedWarningBand.set(repositoryPath, tightening.warningBand);
		}
	}
}

for (const repositoryPath of Object.keys(config.allow)) {
	if (!observed.has(repositoryPath)) findings.push(`${repositoryPath}: size exception does not match a checked file.`);
}
for (const repositoryPath of Object.keys(config.warningBandRatchets)) {
	if (!observed.has(repositoryPath)) {
		findings.push(`${repositoryPath}: warning-band ratchet does not match a checked file.`);
	}
}

if (baseline) {
	findings.push(...compareMaintainabilityConfigs(
		config,
		baseline.config,
		baseline.previousPathByCurrent,
		currentLineCounts,
	));
}

const tighteningCount = new Set([...tightenedAllow.keys(), ...tightenedWarningBand.keys()]).size;
if (tighten && !findings.length && tighteningCount) {
	const updated = validateMaintainabilityConfig(
		tightenMaintainabilityConfig(config, tightenedAllow, tightenedWarningBand),
	);
	const tightenedFindings = baseline
		? compareMaintainabilityConfigs(
			updated,
			baseline.config,
			baseline.previousPathByCurrent,
			currentLineCounts,
		)
		: [];
	if (tightenedFindings.length) {
		throw new Error(`Maintainability tightening would weaken a size ratchet:\n${tightenedFindings.join('\n')}`);
	}
	writeFileSync(configPath, `${JSON.stringify(updated, null, '\t')}\n`);
	console.log(`Tightened ${tighteningCount} size ratchet(s) to the sizes those files now have.`);
} else if (notes.length) {
	console.log(`${notes.length} size ratchet(s) have room to tighten:`);
	for (const note of notes) console.log(`  ${note}`);
}

if (findings.length) throw new Error(`Maintainability size guard failed:\n${findings.join('\n')}`);

console.log(`Checked ${files.length} maintained source files (${config.defaultMaxLines} lines; ${config.browserSpecMaxLines} for browser specs).`);
if (warnings.length && listWarnings) {
	console.log(`${warnings.length} growth-frozen file(s) in the warning band:`);
	for (const warning of warnings) console.log(`  ${warning}`);
} else if (warnings.length) {
	console.log(`${warnings.length} file(s) are growth-frozen at their warning-band ratchets; run with --warnings to list them.`);
}

function loadMaintainabilityBaseline() {
	const requestedRevision = String(process.env.MAINTAINABILITY_BASE_REVISION || '').trim();
	const explicitRevision = requestedRevision && !/^0+$/u.test(requestedRevision)
		? requestedRevision
		: null;
	const candidate = explicitRevision ?? 'HEAD';
	let revision;
	try {
		revision = git(['rev-parse', '--verify', `${candidate}^{commit}`]).trim();
	} catch (error) {
		throw new Error(`Cannot resolve maintainability base revision ${candidate}.`, { cause: error });
	}
	let serialized;
	try {
		serialized = git(['show', `${revision}:config/maintainability-allowlist.json`]);
	} catch (error) {
		throw new Error(`Cannot read the maintainability policy at base revision ${revision}.`, { cause: error });
	}
	const previous = JSON.parse(serialized);
	return {
		revision,
		config: previous.schemaVersion === 2 ? validateMaintainabilityConfig(previous) : previous,
		previousPathByCurrent: renamedMaintainedPaths(revision),
	};
}

function renamedMaintainedPaths(revision) {
	const fields = git([
		'diff', '--find-renames=50%', '-l0', '--name-status', '-z', revision, '--',
		...MAINTAINED_SOURCE_ROOTS,
	]).split('\0');
	const previousPathByCurrent = new Map();
	for (let index = 0; index < fields.length;) {
		const status = fields[index++];
		if (!status) break;
		const previousPath = fields[index++];
		if (status.startsWith('R') || status.startsWith('C')) {
			const currentPath = fields[index++];
			if (status.startsWith('R')) previousPathByCurrent.set(currentPath, previousPath);
		}
	}
	return previousPathByCurrent;
}

function readBaselineLineCount(revision, repositoryPath, cache) {
	if (cache.has(repositoryPath)) return cache.get(repositoryPath);
	let lines = null;
	try {
		lines = sourceLineCount(git(['show', `${revision}:${repositoryPath}`]));
	} catch {
		// A warning-band file without a predecessor is itself a policy finding.
	}
	cache.set(repositoryPath, lines);
	return lines;
}

function git(arguments_) {
	return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}
