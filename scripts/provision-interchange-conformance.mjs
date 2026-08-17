#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

export function provisionedRoot() {
	return target;
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

async function download(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Downloading ${url} failed with HTTP ${response.status}.`);
	return Buffer.from(await response.arrayBuffer());
}

async function pypiRelease(name, version) {
	const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`);
	if (!response.ok) throw new Error(`PyPI has no ${name} ${version} (HTTP ${response.status}).`);
	return response.json();
}

/**
 * Choose the platform wheel matching the running interpreter, by asking pip
 * rather than reimplementing PEP 425 tag matching here — pip already knows which
 * tags this interpreter accepts, and a hand-rolled matcher is a subtle way to
 * install a wheel that imports on one machine and not another.
 */
function compatibleWheel(files) {
	const supported = new Set(JSON.parse(runPython([
		'-c',
		'import json;'
		+ 'from pip._internal.utils.compatibility_tags import get_supported;'
		+ 'print(json.dumps([str(t) for t in get_supported()]))',
	])));
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

	for (const entry of config.packages) {
		const release = await pypiRelease(entry.name, entry.version);
		let file;
		if (entry.wheel === 'platform') {
			file = compatibleWheel(release.urls);
			if (!file) {
				throw new Error(
					`No ${entry.name} ${entry.version} wheel matches this interpreter `
					+ `(${pythonAbiTag()}). The conformance suite needs a platform this project publishes for.`,
				);
			}
		} else {
			file = release.urls.find((candidate) => candidate.filename === entry.wheel);
			if (!file) throw new Error(`PyPI no longer publishes ${entry.wheel}.`);
		}

		const bytes = await download(file.url);
		const digest = createHash('sha256').update(bytes).digest('hex');
		// A pinned digest is authoritative; where the wheel is platform-specific
		// the published digest is what we can verify against, and the version is
		// what is actually pinned.
		const expected = entry.sha256 ?? file.digests?.sha256;
		if (!expected || digest !== expected) {
			throw new Error(
				`${file.filename} failed its integrity check.\n  expected ${expected}\n  received ${digest}`,
			);
		}
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
	if (checkOnly) {
		const state = provisionState();
		process.stdout.write(`${state.ready ? 'ready' : `not ready (${state.reason})`}\n`);
		process.exit(state.ready ? 0 : 1);
	}
	await provision();
}
