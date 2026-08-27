#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
	renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
	MILESTONE_5_NATIVE_SOURCE_IDS,
	authenticateMilestone5NativeSourceInput,
	readMilestone5NativeSourceAcquisitions,
} from './lib/milestone-5-native-source-acquisitions.mjs';
import { materializeMilestone5SourceArchive } from './lib/milestone-5-source-archive-extraction.mjs';

/**
 * Provision the Milestone 5 native source acquisition cache.
 *
 * `config/milestone-5-native-source-acquisitions.json` pins ten upstream inputs
 * by archive digest and by the portable identity of the tree that archive
 * extracts to, and `auditMilestone5NativeSourceAcquisitions` authenticates a
 * cache against those pins. Until this script existed the register named what a
 * cache must contain but nothing assembled one, so the audit reported 0/10 on
 * every machine and the native machine-admission policy — which requires
 * archive evidence matching the pin exactly — could never clear its source
 * gate.
 *
 * The cache is deliberately outside the repository and outside the product's
 * dependency graph. Nothing provisioned here is committed, bundled, linked, or
 * redistributed. Authenticating a source enables that exact source for build
 * and test use, but grants no redistribution, trademark, patent, signing, or
 * stable-release approval. Payload, platform, containment, consent, quarantine,
 * and capacity remain independent machine gates; human review belongs to
 * Milestone 9.
 *
 * Usage:
 *   node scripts/provision-milestone-5-native-sources.mjs
 *   node scripts/provision-milestone-5-native-sources.mjs --check
 *   node scripts/provision-milestone-5-native-sources.mjs --source juce --source lv2
 *   node scripts/provision-milestone-5-native-sources.mjs --archive-directory ~/m5-archives
 *
 * `--archive-directory` reads each pinned archive from local storage instead of
 * fetching it. Some upstreams — the Steinberg ASIO SDK most of all — are behind
 * terms a person has to read and accept, so acquiring those bytes by hand and
 * pointing this script at them has to stay a first-class path.
 */

const repositoryRoot = resolve(import.meta.dirname, '..');
const DEFAULT_CACHE_DIRECTORY = 'vendor/milestone-5-native-sources';
const DOWNLOAD_TIMEOUT_MS = 300_000;
// Declared before the provisioning run below, which would otherwise reach this
// binding's temporal dead zone on its first download.
let resolvedCurl;

const options = parseArguments(process.argv.slice(2));
const register = readMilestone5NativeSourceAcquisitions(repositoryRoot);
const sources = register.sources.filter(({ id }) => options.sources.size === 0 || options.sources.has(id));
const cacheRoot = prepareCacheRoot(options.root, options.check);

const results = [];
for (const source of sources) {
	results.push(options.check ? inspect(source) : await provision(source));
}
report();

/** A cache entry is only ever reported as authenticated by re-running the auditor's own check. */
function inspect(source) {
	const directory = resolve(cacheRoot, source.id);
	if (!existsSync(directory)) return { id: source.id, status: 'absent', detail: 'no cache entry' };
	try {
		// The auditor accepts an entry only if it holds the archive and its
		// extracted source and nothing else, so a stray download artefact left
		// beside them is a drifted entry here rather than a surprise there.
		const entries = readdirSync(directory, { withFileTypes: true });
		const present = entries.map(({ name }) => name).sort();
		const expected = [source.archive.fileName, 'source'].sort();
		if (JSON.stringify(present) !== JSON.stringify(expected)
			|| entries.some((entry) => entry.isSymbolicLink())) {
			throw new Error(`the cache entry is not the exact archive/source pair: ${present.join(', ')}`);
		}
		const witness = authenticateMilestone5NativeSourceInput({
			repositoryRoot,
			sourceId: source.id,
			archivePath: resolve(directory, source.archive.fileName),
			sourceRoot: resolve(directory, 'source'),
		});
		return {
			id: source.id,
			status: 'authenticated',
			detail: `${witness.extractedTree.fileCount} files, tree ${witness.extractedTree.sha256.slice(0, 12)}`,
		};
	} catch (error) {
		return { id: source.id, status: 'drifted', detail: error.message };
	}
}

async function provision(source) {
	const existing = inspect(source);
	if (existing.status === 'authenticated') return { ...existing, status: 'reused' };
	if (existing.status === 'drifted' && !options.force) {
		return {
			...existing,
			detail: `${existing.detail} Remove ${resolve(cacheRoot, source.id)} or re-run with --force.`,
		};
	}
	const staging = resolve(cacheRoot, '.staging');
	mkdirSync(staging, { recursive: true });
	const entry = mkdtempSync(resolve(staging, `${source.id}-`));
	try {
		const archiveBytes = options.archiveDirectory
			? readLocalArchive(source)
			: await downloadArchive(source, staging);
		authenticateArchiveBytes(source, archiveBytes);
		const evidence = materializeMilestone5SourceArchive({
			archiveBytes,
			archiveName: source.archive.fileName,
			expectedTree: source.extractedTree,
			destinationRoot: resolve(entry, 'source'),
		});
		writeFileSync(resolve(entry, source.archive.fileName), archiveBytes, { flag: 'wx', mode: 0o400 });
		// The auditor demands the exact archive/source pair and nothing else, so
		// the finished entry replaces its destination in one move rather than
		// being assembled in place where a failure would leave a partial pair.
		const directory = resolve(cacheRoot, source.id);
		rmSync(directory, { recursive: true, force: true });
		renameSync(entry, directory);
		const confirmed = inspect(source);
		if (confirmed.status !== 'authenticated') {
			rmSync(directory, { recursive: true, force: true });
			throw new Error(`the provisioned cache entry did not authenticate: ${confirmed.detail}`);
		}
		return {
			id: source.id,
			status: 'provisioned',
			detail: `${evidence.fileCount} files, tree ${evidence.sha256.slice(0, 12)}`,
		};
	} catch (error) {
		return { id: source.id, status: 'failed', detail: error.message };
	} finally {
		rmSync(entry, { recursive: true, force: true });
		rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * Fetch one pinned archive, bounded by its own pinned byte length so a server
 * answering a pinned URL with an endless body is refused while it streams.
 *
 * `curl` is preferred over `fetch` because two of the ten upstreams are behind
 * bot protection that answers Node's TLS client with HTTP 406 while serving the
 * identical request from curl, and because curl honours the proxy environment a
 * build host may require. `fetch` remains the fallback where curl is absent.
 */
async function downloadArchive(source, staging) {
	if (curlExecutable()) return downloadArchiveWithCurl(source, staging);
	return downloadArchiveWithFetch(source);
}

function downloadArchiveWithCurl(source, staging) {
	// Written outside the entry being assembled: whatever curl leaves behind
	// must not travel into a cache entry the auditor requires to hold exactly
	// its archive and its extracted source.
	const path = resolve(mkdtempSync(resolve(staging, 'download-')), 'archive');
	try {
		execFileSync(curlExecutable(), [
			'--fail', '--silent', '--show-error', '--location',
			'--max-time', String(Math.round(DOWNLOAD_TIMEOUT_MS / 1000)),
			'--max-filesize', String(source.archive.byteLength),
			'--output', path, '--', source.archive.url,
		], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
	} catch (error) {
		const detail = String(error.stderr ?? '').trim() || error.message;
		throw new Error(`${source.archive.url} could not be fetched: ${detail}`, { cause: error });
	}
	return readFileSync(path);
}

async function downloadArchiveWithFetch(source) {
	let response;
	try {
		response = await fetch(source.archive.url, {
			redirect: 'follow',
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(
			`${source.archive.url} could not be fetched: ${error.cause?.message ?? error.message}`,
			{ cause: error },
		);
	}
	if (!response.ok) throw new Error(`${source.archive.url} answered HTTP ${response.status}.`);
	const chunks = [];
	let received = 0;
	for await (const chunk of response.body) {
		received += chunk.byteLength;
		if (received > source.archive.byteLength) {
			throw new Error(`${source.archive.url} sent more than its pinned ${source.archive.byteLength} bytes.`);
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

function curlExecutable() {
	if (resolvedCurl === undefined) {
		try {
			execFileSync('curl', ['--version'], { stdio: 'ignore' });
			resolvedCurl = 'curl';
		} catch {
			resolvedCurl = null;
		}
	}
	return resolvedCurl;
}

function readLocalArchive(source) {
	const path = resolve(options.archiveDirectory, source.archive.fileName);
	if (!existsSync(path)) {
		throw new Error(`${source.archive.fileName} is not in ${options.archiveDirectory}; fetch it from ${source.archive.url}.`);
	}
	return readFileSync(path);
}

function authenticateArchiveBytes(source, bytes) {
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	if (bytes.byteLength !== source.archive.byteLength || sha256 !== source.archive.sha256) {
		throw new Error(
			`archive drifted from its pin: got ${bytes.byteLength} bytes / ${sha256}, `
			+ `expected ${source.archive.byteLength} bytes / ${source.archive.sha256}.`,
		);
	}
}

function prepareCacheRoot(root, checkOnly) {
	if (!existsSync(root)) {
		if (checkOnly) return root;
		mkdirSync(root, { recursive: true });
	}
	return realpathSync(root);
}

function parseArguments(argv) {
	const parsed = {
		check: false,
		force: false,
		sources: new Set(),
		archiveDirectory: null,
		root: null,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--check') parsed.check = true;
		else if (argument === '--force') parsed.force = true;
		else if (argument === '--source') parsed.sources.add(requireValue(argv, (index += 1), '--source'));
		else if (argument === '--root') parsed.root = requireValue(argv, (index += 1), '--root');
		else if (argument === '--archive-directory') {
			parsed.archiveDirectory = requireValue(argv, (index += 1), '--archive-directory');
		} else throw new Error(`Unknown argument ${argument}.`);
	}
	for (const id of parsed.sources) {
		if (!MILESTONE_5_NATIVE_SOURCE_IDS.includes(id)) throw new Error(`Unknown Milestone 5 source ${id}.`);
	}
	if (parsed.archiveDirectory) parsed.archiveDirectory = absolute(parsed.archiveDirectory);
	parsed.root = absolute(parsed.root
		|| process.env.SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT?.trim()
		|| resolve(repositoryRoot, DEFAULT_CACHE_DIRECTORY));
	return parsed;
}

function requireValue(argv, index, flag) {
	const value = argv[index];
	if (typeof value !== 'string' || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
	return value;
}

function absolute(value) {
	return isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value);
}

function report() {
	for (const { id, status, detail } of results) console.log(`${status.padEnd(13)} ${id.padEnd(26)} ${detail}`);
	const authenticated = results.filter(({ status }) => (
		status === 'authenticated' || status === 'provisioned' || status === 'reused'
	)).length;
	console.log(
		`${cacheRoot}: ${authenticated}/${results.length} exact archive/extracted-tree inputs authenticated`
		+ `${sources.length === register.sources.length ? '' : ` (of ${register.sources.length} registered)`}.`,
	);
	if (authenticated === register.sources.length) {
		console.log(`Export SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT=${cacheRoot} to let the audit read this cache.`);
		console.log('Exact sources are enabled for build/test; redistribution, signing, and stable-release review remain Milestone 9 inputs.');
	}
	if (authenticated !== results.length) process.exitCode = 1;
}
