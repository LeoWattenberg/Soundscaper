/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const REVISION_PATTERN = /^[0-9a-f]{40}$/u;

export function e2eExecutableCoverageKey({ sha256, sourceMapSha256, sources }) {
	if (!SHA256_PATTERN.test(sha256) || (sourceMapSha256 !== null
		&& !SHA256_PATTERN.test(sourceMapSha256)) || !Array.isArray(sources)
		|| sources.length === 0 || sources.some((source) => typeof source !== 'string')) {
		throw new TypeError('An executable coverage key needs exact script, map and source identities.');
	}
	return digest(stableJson({ sha256, sourceMapSha256, sources: [...sources].sort() }));
}

export function validateE2EExecutableObservation(observedUrls, scripts) {
	const observed = new Set(observedUrls);
	const classes = new Map();
	for (const script of scripts) {
		const values = classes.get(script.coverageKey) ?? [];
		values.push(script);
		classes.set(script.coverageKey, values);
	}
	const failures = [];
	for (const [coverageKey, members] of classes) {
		if (members.some(({ coverageUrl }) => observed.has(coverageUrl))) continue;
		failures.push(
			`E2E raw V8 coverage did not execute executable equivalence ${coverageKey}: `
			+ members.map(({ id }) => id).sort().join(', '),
		);
	}
	return failures;
}

export function revisionSourceBytes(repositoryRoot, sourceRevision, path) {
	if (!REVISION_PATTERN.test(sourceRevision)) {
		throw new TypeError('Revision-bound coverage needs a full Git source revision.');
	}
	if (!safeRelativePath(path)) throw new TypeError(`Revision-bound source path ${path} is unsafe.`);
	const outcome = spawnSync('git', ['show', `${sourceRevision}:${path}`], {
		cwd: repositoryRoot,
		encoding: null,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (outcome.error) throw outcome.error;
	if (outcome.status !== 0) {
		throw new Error(
			`Repository source ${path} does not exist at revision ${sourceRevision}: `
			+ Buffer.from(outcome.stderr ?? '').toString('utf8').trim(),
		);
	}
	return Buffer.from(outcome.stdout);
}

export function repositoryRevision(repositoryRoot) {
	const outcome = spawnSync('git', ['rev-parse', 'HEAD'], {
		cwd: repositoryRoot,
		encoding: 'utf8',
	});
	if (outcome.error) throw outcome.error;
	if (outcome.status !== 0) {
		throw new Error(`Could not read the repository revision: ${outcome.stderr.trim()}`);
	}
	const revision = outcome.stdout.trim();
	if (!REVISION_PATTERN.test(revision)) throw new Error('Git returned an invalid repository revision.');
	return revision;
}

export function revisionBoundSource(repositoryRoot, sourceRevision, path) {
	const committed = revisionSourceBytes(repositoryRoot, sourceRevision, path);
	const workingPath = resolveInside(repositoryRoot, path);
	let working;
	try { working = readFileSync(workingPath); }
	catch (error) {
		throw new Error(`Repository source ${path} is unavailable in the checkout.`, { cause: error });
	}
	if (!working.equals(committed)) {
		throw new Error(`Repository source ${path} differs from declared revision ${sourceRevision}.`);
	}
	return Object.freeze({
		bytes: committed,
		sha256: digest(committed),
		text: committed.toString('utf8'),
	});
}

export function validateE2EInventoryFiles(inventory, repositoryRoot, artifactRoot) {
	const failures = [];
	for (const source of inventory.sources) {
		if (source.origin === 'repository') {
			try {
				const committed = revisionBoundSource(repositoryRoot, inventory.sourceRevision, source.path);
				if (committed.sha256 !== source.sha256) failures.push(
					`Executable source ${source.path} is stale: its committed bytes do not match the inventory SHA-256.`,
				);
			} catch (error) {
				failures.push(`Executable source ${source.path} is unavailable: ${errorMessage(error)}`);
			}
		} else {
			validateFileHash(
				resolveInside(artifactRoot, source.artifactPath), source.sha256,
				`Executable source ${source.path}`, failures,
			);
		}
	}
	for (const script of inventory.scripts) validateFileHash(
		resolveInside(artifactRoot, script.artifactPath), script.sha256,
		`Executable script ${script.id}`, failures,
	);
	return failures;
}

export function sha256Digest(value) {
	return digest(value);
}

export function coverageFileRecords(directory, current = directory) {
	const records = [];
	for (const entry of readdirSync(current, { withFileTypes: true })) {
		const path = resolve(current, entry.name);
		if (entry.isDirectory()) records.push(...coverageFileRecords(directory, path));
		else if (entry.isFile()) {
			const bytes = readFileSync(path);
			records.push({
				path: relative(directory, path).split(sep).join('/'),
				byteLength: bytes.byteLength,
				sha256: digest(bytes),
			});
		} else throw new Error(`Coverage evidence contains a non-file entry: ${path}.`);
	}
	return records.sort((left, right) => left.path.localeCompare(right.path));
}

export function validateCoverageFileRecords(directory, expected, label) {
	try {
		const actual = coverageFileRecords(directory);
		return stableJson(actual) === stableJson(expected)
			? [] : [`${label} coverage-file inventory or bytes do not match its manifest.`];
	} catch (error) {
		return [`${label} coverage files are unavailable: ${errorMessage(error)}`];
	}
}

export function stableSha256Digest(value) {
	return digest(stableJson(value));
}

function resolveInside(root, path) {
	const absoluteRoot = resolve(root);
	const candidate = resolve(absoluteRoot, path);
	const child = relative(absoluteRoot, candidate);
	if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new Error(`Repository source path ${path} escapes the checkout.`);
	}
	return candidate;
}

function validateFileHash(path, expected, label, failures) {
	try {
		if (digest(readFileSync(path)) !== expected) {
			failures.push(`${label} is stale: its bytes do not match the inventory SHA-256.`);
		}
	} catch (error) {
		failures.push(`${label} is unavailable: ${errorMessage(error)}`);
	}
}

function safeRelativePath(value) {
	return typeof value === 'string' && value !== '' && !isAbsolute(value) && !value.includes('\\')
		&& !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function digest(value) {
	return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => (
			`${JSON.stringify(key)}:${stableJson(value[key])}`
		)).join(',')}}`;
	}
	return JSON.stringify(value);
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
