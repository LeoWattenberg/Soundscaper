#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { cachedInterchangeWheel, interchangeCacheIdentity } from './lib/interchange-download-cache.mjs';

/**
 * Provision the interchange conformance reference implementations.
 *
 * The 6C-1 profiles are only meaningfully proven against a reader that is not
 * ours, so the conformance suite runs our emitted EDL, OTIO, and FCPXML through
 * the OpenTimelineIO reference implementation and its format adapters.
 *
 * Those are Python native extensions, which is why they are provisioned rather
 * than committed: the core ships as twenty platform wheels and a single vendored
 * binary would work on one machine and no other. What is committed instead is
 * the thing that makes the provisioning reproducible — exact versions, and
 * sha256 digests for every wheel whose bytes are platform-independent.
 *
 * The provisioned tree is deliberately outside the product's dependency graph.
 * Nothing here is bundled or linked; it is executed at conformance time and
 * never distributed, which is why it creates no obligation against the
 * AGPL-3.0-only license the product ships under.
 *
 * Usage:
 *   node scripts/provision-interchange-conformance.mjs           provision
 *   node scripts/provision-interchange-conformance.mjs --check   report status, provision nothing
 */

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(resolve(root, 'config/interchange-conformance-tools.json'), 'utf8'));
const target = resolve(root, 'vendor/interchange-conformance');
const stamp = resolve(target, '.provisioned.json');
const checkOnly = process.argv.includes('--check');
const cacheRoot = resolve(root, '.wrangler/test-download-cache/interchange');
const TRANSIENT_CONNECTION_ERRORS = new Set([
	'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN',
]);

/** The stamp records what was installed, so a version bump re-provisions rather than silently reusing. */
function currentStamp() {
	if (!existsSync(stamp)) return null;
	try {
		return JSON.parse(readFileSync(stamp, 'utf8'));
	} catch {
		return null;
	}
}

function expectedStamp() {
	return {
		packages: config.packages.map((entry) => `${entry.name}==${entry.version}`).sort(),
		abi: pythonAbiTag(),
	};
}

function pythonAbiTag() {
	return runPython([
		'-c',
		'import sys, sysconfig; print(f"{sys.implementation.name}-{sys.version_info.major}.{sys.version_info.minor}-{sysconfig.get_platform()}")',
	]).trim();
}

function runPython(args, pythonPath = null) {
	return execFileSync(pythonExecutable(), args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		...(pythonPath ? { env: { ...process.env, PYTHONPATH: pythonPath } } : {}),
	});
}

let cachedPython = null;
function pythonExecutable() {
	if (cachedPython) return cachedPython;
	for (const candidate of [process.env.SOUNDSCAPER_PYTHON, 'python3', 'python'].filter(Boolean)) {
		try {
			execFileSync(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 9)'], { stdio: 'ignore' });
			cachedPython = candidate;
			return candidate;
		} catch {
			continue;
		}
	}
	throw new Error(
		`No Python ${config.pythonMinimumVersion}+ interpreter was found. `
		+ 'Set SOUNDSCAPER_PYTHON to one, or install Python to run the interchange conformance suite.',
	);
}

export function provisionState() {
	const expected = expectedStampSafe();
	const actual = currentStamp();
	if (!expected) return { ready: false, reason: 'no-python' };
	if (!actual) return { ready: false, reason: 'not-provisioned' };
	if (JSON.stringify(actual) !== JSON.stringify(expected)) return { ready: false, reason: 'stale' };
	return { ready: true, reason: 'ready' };
}

function expectedStampSafe() {
	try {
		return expectedStamp();
	} catch {
		return null;
	}
}

/** Retry a temporary PyPI connection failure; release and wheel identities stay pinned below. */
export async function fetchWithTransientRetry(url, { fetchImpl = fetch, delayImpl = delay } = {}) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await fetchImpl(url);
		} catch (error) {
			const code = error instanceof TypeError ? error.cause?.code : undefined;
			if (attempt >= 2 || !TRANSIENT_CONNECTION_ERRORS.has(code)) throw error;
			await delayImpl(250 * 2 ** attempt);
		}
	}
}

async function download(url) {
	const response = await fetchWithTransientRetry(url);
	if (!response.ok) throw new Error(`Downloading ${url} failed with HTTP ${response.status}.`);
	return Buffer.from(await response.arrayBuffer());
}

async function pypiRelease(name, version) {
	const response = await fetchWithTransientRetry(`https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`);
	if (!response.ok) throw new Error(`PyPI has no ${name} ${version} (HTTP ${response.status}).`);
	return response.json();
}

/**
 * The wheel tags this interpreter accepts.
 *
 * Asked of the tooling rather than reimplemented here, because a hand-rolled
 * PEP 425 matcher is a subtle way to install a wheel that imports on the build
 * host and nowhere else. `packaging` is the supported home for this; pip's copy
 * is a private module that has moved before, so it is only the fallback, and a
 * clear failure is better than either one guessing.
 */
function supportedTags() {
	const sources = [
		'import json, packaging.tags; print(json.dumps([str(t) for t in packaging.tags.sys_tags()]))',
		'import json; from pip._vendor.packaging.tags import sys_tags; print(json.dumps([str(t) for t in sys_tags()]))',
		'import json; from pip._internal.utils.compatibility_tags import get_supported;'
		+ ' print(json.dumps([str(t) for t in get_supported()]))',
	];
	for (const source of sources) {
		try {
			return JSON.parse(runPython(['-c', source]));
		} catch {
			continue;
		}
	}
	throw new Error(
		'Could not determine this interpreter\'s wheel tags. Install `packaging` '
		+ '(pip install packaging) so the correct opentimelineio wheel can be selected.',
	);
}

/**
 * Choose the platform wheel matching the running interpreter. A wheel filename
 * carries compressed tag sets (`cp312.cp313-abi3-manylinux…`), so each component
 * is expanded before matching rather than compared whole.
 */
function compatibleWheel(files, tags) {
	const supported = new Set(tags);
	for (const file of files) {
		if (!file.filename.endsWith('.whl')) continue;
		const parts = file.filename.slice(0, -4).split('-');
		const tags = parts.slice(-3);
		for (const python of tags[0].split('.')) {
			for (const abi of tags[1].split('.')) {
				for (const platform of tags[2].split('.')) {
					if (supported.has(`${python}-${abi}-${platform}`)) return file;
				}
			}
		}
	}
	return null;
}

function extract(buffer, name) {
	const wheelPath = resolve(target, `.${name}.whl`);
	writeFileSync(wheelPath, buffer);
	runPython([
		'-c',
		`import zipfile, sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`,
		wheelPath,
		target,
	]);
	rmSync(wheelPath, { force: true });
}

async function provision() {
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	const tags = supportedTags();
	const cacheIdentity = interchangeCacheIdentity(config, pythonAbiTag(), tags);

	for (const entry of config.packages) {
		const { bytes } = await cachedInterchangeWheel(entry, {
			cacheRoot, cacheIdentity, release: pypiRelease, download,
			selectPlatformWheel: files => compatibleWheel(files, tags),
		});
		extract(bytes, entry.name.replaceAll(/[^\w.-]+/gu, '-'));
		process.stdout.write(`provisioned ${entry.name} ${entry.version} (${entry.license})\n`);
	}

	writeFileSync(stamp, `${JSON.stringify(expectedStamp(), null, '\t')}\n`);
	verify();
}

function verify() {
	const adapters = runPython([
		'-c',
		'import opentimelineio as otio, json;'
		+ 'print(json.dumps(sorted(a.name for a in otio.plugins.ActiveManifest().adapters)))',
	], target).trim();
	const names = JSON.parse(adapters);
	for (const required of ['cmx_3600', 'fcpx_xml', 'otio_json']) {
		if (!names.includes(required)) {
			throw new Error(`The ${required} adapter did not register after provisioning; got ${adapters}.`);
		}
	}
	process.stdout.write(`reference adapters ready: ${names.join(', ')}\n`);
}

if (process.argv[1]?.endsWith('provision-interchange-conformance.mjs')) {
	if (process.argv.includes('--cache-key')) {
		process.stdout.write(`key=${interchangeCacheIdentity(config, pythonAbiTag(), supportedTags())}\n`);
		process.exit(0);
	}
	if (checkOnly) {
		const state = provisionState();
		process.stdout.write(`${state.ready ? 'ready' : `not ready (${state.reason})`}\n`);
		process.exit(state.ready ? 0 : 1);
	}
	await provision();
}
