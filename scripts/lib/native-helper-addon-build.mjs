/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The build and audit primitives for the Soundscaper native helper addon.
 *
 * Two duties live here, deliberately separated. `auditNativeHelperAddon` runs
 * in ordinary CI on every machine: it re-hashes the pinned sources and the
 * checked-in per-target payloads without needing a compiler, so a tampered
 * source file or a swapped binary fails the canonical gate. `buildNativeHelperAddon`
 * needs a toolchain and only ever produces the payload for the host's own
 * target — cross-building the other four claimed targets is external work, and
 * their rows stay `pending-external` with a named blocker rather than being
 * filled in from a convenient local build.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const NATIVE_HELPER_ADDON_ROOT = 'native/soundscaper-helper-addon';
export const NATIVE_HELPER_ADDON_SOURCE_MANIFEST = `${NATIVE_HELPER_ADDON_ROOT}/source-manifest.json`;

/**
 * The five claimed milestone-5A targets, named with electron-builder's
 * platform vocabulary so the manifest, the staged runtime tree and the release
 * artifacts all spell a target the same way. `runtime` is the
 * `${process.platform}-${process.arch}` pair the packaged application matches
 * itself against at spawn time.
 */
export const NATIVE_HELPER_ADDON_TARGETS = Object.freeze([
	Object.freeze({ id: 'linux-x64', runtime: 'linux-x64' }),
	Object.freeze({ id: 'linux-arm64', runtime: 'linux-arm64' }),
	Object.freeze({ id: 'mac-arm64', runtime: 'darwin-arm64' }),
	Object.freeze({ id: 'win-x64', runtime: 'win32-x64' }),
	Object.freeze({ id: 'win-arm64', runtime: 'win32-arm64' }),
]);

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const SOURCE_EXTENSIONS = new Set(['.c', '.h']);

export function nativeHelperAddonTargetForRuntime(platform, architecture) {
	const runtime = `${platform}-${architecture}`;
	return NATIVE_HELPER_ADDON_TARGETS.find((target) => target.runtime === runtime) ?? null;
}

export function readNativeHelperAddonSourceManifest(repositoryRoot) {
	const path = resolve(repositoryRoot, NATIVE_HELPER_ADDON_SOURCE_MANIFEST);
	const manifest = JSON.parse(readFileSync(path, 'utf8'));
	assert(manifest.schemaVersion === 1, 'The native helper addon source manifest schemaVersion must be 1.');
	assert(typeof manifest.addonVersion === 'string' && /^\d+\.\d+\.\d+$/u.test(manifest.addonVersion),
		'The native helper addon version is invalid.');
	assert(Number.isSafeInteger(manifest.napiVersion) && manifest.napiVersion >= 8,
		'The native helper addon must target Node-API 8 or later.');
	/* An empty pin list is readable but never auditable: the audit reports every
	 * on-disk source as unpinned, so a freshly seeded manifest fails closed. */
	assert(Array.isArray(manifest.sourceFiles), 'The native helper addon source manifest must pin its sources.');
	assert(typeof manifest.payloadName === 'string' && /^[a-z\d_]+\.node$/u.test(manifest.payloadName),
		'The native helper addon payload name is invalid.');
	assert(manifest.toolchain && typeof manifest.toolchain === 'object', 'The addon toolchain record is required.');
	assert(Array.isArray(manifest.toolchain.compileFlags), 'The addon toolchain must pin its compile flags.');
	assert(Array.isArray(manifest.toolchain.linkFlags), 'The addon toolchain must pin its link flags.');
	assert(manifest.targets && typeof manifest.targets === 'object' && !Array.isArray(manifest.targets),
		'The native helper addon source manifest must carry its per-target records.');
	const expected = NATIVE_HELPER_ADDON_TARGETS.map(({ id }) => id).sort();
	const present = Object.keys(manifest.targets).sort();
	assert(JSON.stringify(present) === JSON.stringify(expected),
		`The native helper addon must record exactly the targets ${expected.join(', ')}.`);
	return manifest;
}

export function auditNativeHelperAddon({ repositoryRoot }) {
	const manifest = readNativeHelperAddonSourceManifest(repositoryRoot);
	const findings = [];
	const sourceRoot = resolve(repositoryRoot, NATIVE_HELPER_ADDON_ROOT, 'src');
	const pinned = new Map(manifest.sourceFiles.map((entry) => [entry.path, entry]));
	for (const path of listSourceFiles(sourceRoot).map((file) => relative(sourceRoot, file).split('\\').join('/'))) {
		if (!pinned.has(path)) findings.push(`Unpinned native helper addon source: ${path}`);
	}
	for (const [path, entry] of pinned) {
		if (!SHA256_PATTERN.test(String(entry.sha256))) {
			findings.push(`Invalid pinned digest for ${path}`);
			continue;
		}
		let bytes;
		try {
			bytes = readFileSync(join(sourceRoot, path));
		} catch {
			findings.push(`Missing pinned native helper addon source: ${path}`);
			continue;
		}
		if (bytes.byteLength !== entry.byteLength) findings.push(`Source byte length mismatch for ${path}`);
		if (sha256(bytes) !== entry.sha256) findings.push(`Source digest mismatch for ${path}`);
	}
	for (const target of NATIVE_HELPER_ADDON_TARGETS) {
		findings.push(...auditTarget(repositoryRoot, manifest, target));
	}
	return Object.freeze({ manifest, findings: Object.freeze(findings) });
}

function auditTarget(repositoryRoot, manifest, target) {
	const record = manifest.targets[target.id];
	const findings = [];
	if (!record || typeof record !== 'object') return [`Missing target record: ${target.id}`];
	if (record.status === 'pending-external') {
		if (record.payload !== null) findings.push(`${target.id}: a pending-external target must not pin a payload.`);
		if (typeof record.blockedBy !== 'string' || record.blockedBy.trim().length < 8) {
			findings.push(`${target.id}: a pending-external target requires a named blocker.`);
		}
		return findings;
	}
	if (record.status !== 'built') return [`${target.id}: unsupported target status ${String(record.status)}`];
	if (record.blockedBy !== null) findings.push(`${target.id}: a built target must not carry a blocker.`);
	const payload = record.payload;
	if (!payload || typeof payload !== 'object') return [`${target.id}: a built target must pin its payload.`];
	if (!SHA256_PATTERN.test(String(payload.sha256))) findings.push(`${target.id}: invalid payload digest.`);
	const path = resolve(repositoryRoot, NATIVE_HELPER_ADDON_ROOT, 'prebuilt', target.id, manifest.payloadName);
	let bytes;
	try {
		bytes = readFileSync(path);
	} catch {
		return [...findings, `${target.id}: the built payload is missing at prebuilt/${target.id}/${manifest.payloadName}`];
	}
	if (bytes.byteLength !== payload.byteLength) findings.push(`${target.id}: payload byte length mismatch.`);
	if (sha256(bytes) !== payload.sha256) findings.push(`${target.id}: payload digest mismatch.`);
	if (typeof record.toolchainIdentity !== 'string' || !record.toolchainIdentity.trim()) {
		findings.push(`${target.id}: a built target must record the toolchain that produced it.`);
	}
	return findings;
}

export function buildNativeHelperAddon({
	repositoryRoot,
	compiler = process.env.CC || 'cc',
	target,
	includeDirectories,
	run = spawnSync,
}) {
	const manifest = readNativeHelperAddonSourceManifest(repositoryRoot);
	const selected = target ?? nativeHelperAddonTargetForRuntime(process.platform, process.arch);
	assert(selected, `The build host ${process.platform}-${process.arch} is not a claimed native helper target.`);
	assert(selected.runtime === `${process.platform}-${process.arch}`,
		'The native helper addon is built only for the host target; cross-building is external work.');
	const identity = toolchainIdentity(compiler, run);
	const sourceRoot = resolve(repositoryRoot, NATIVE_HELPER_ADDON_ROOT, 'src');
	const outputRoot = resolve(repositoryRoot, NATIVE_HELPER_ADDON_ROOT, 'prebuilt', selected.id);
	mkdirSync(outputRoot, { recursive: true });
	const outputPath = join(outputRoot, manifest.payloadName);
	/* Translation units come from the source tree, not the pin list, so a
	 * freshly seeded manifest can be built and repinned in one pass. The audit
	 * is what proves the shipped bytes came from exactly the pinned sources. */
	const compiled = listSourceFiles(sourceRoot).filter((path) => path.endsWith('.c')).sort();
	assert(compiled.length > 0, 'The native helper addon has no C translation units.');
	const argv = [
		...manifest.toolchain.compileFlags,
		`-DSOUNDSCAPER_ADDON_VERSION="${manifest.addonVersion}"`,
		`-DSOUNDSCAPER_ADDON_BUILD_ID="${manifest.addonVersion}+${selected.id}"`,
		`-DNAPI_VERSION=${manifest.napiVersion}`,
		/* Vendored header roots are repository-relative; system roots are absolute. */
		...(includeDirectories ?? manifest.toolchain.includeDirectories)
			.map((directory) => `-I${directory.startsWith('/') ? directory : resolve(repositoryRoot, directory)}`),
		...manifest.toolchain.linkFlags,
		'-o', outputPath,
		...compiled,
	];
	const result = run(compiler, argv, {
		encoding: 'utf8',
		env: { ...process.env, SOURCE_DATE_EPOCH: String(manifest.toolchain.sourceDateEpoch), TZ: 'UTC', LC_ALL: 'C' },
	});
	assert(result.status === 0, `The native helper addon build failed: ${result.stderr || result.stdout || 'unknown error'}`);
	const bytes = readFileSync(outputPath);
	return Object.freeze({
		manifest,
		target: selected,
		outputPath,
		toolchainIdentity: identity,
		payload: Object.freeze({ byteLength: bytes.byteLength, sha256: sha256(bytes) }),
	});
}

export function repinNativeHelperAddonSources({ repositoryRoot, build = null, fixtures = null }) {
	const path = resolve(repositoryRoot, NATIVE_HELPER_ADDON_SOURCE_MANIFEST);
	const manifest = readNativeHelperAddonSourceManifest(repositoryRoot);
	const sourceRoot = resolve(repositoryRoot, NATIVE_HELPER_ADDON_ROOT, 'src');
	const sourceFiles = listSourceFiles(sourceRoot)
		.map((file) => relative(sourceRoot, file).split('\\').join('/'))
		.sort()
		.map((relativePath) => {
			const bytes = readFileSync(join(sourceRoot, relativePath));
			return { path: relativePath, byteLength: bytes.byteLength, sha256: sha256(bytes) };
		});
	const targets = { ...manifest.targets };
	if (build) {
		targets[build.target.id] = {
			status: 'built',
			blockedBy: null,
			toolchainIdentity: build.toolchainIdentity,
			payload: { name: manifest.payloadName, ...build.payload },
		};
	}
	const fixturePlugins = { ...manifest.fixturePlugins };
	if (fixtures) {
		fixturePlugins.sourceFiles = fixtures.sourceFiles;
		fixturePlugins.targets = {
			...(fixturePlugins.targets ?? {}),
			[fixtures.targetId]: { status: 'built', files: fixtures.files },
		};
	}
	const updated = { ...manifest, sourceFiles, targets, fixturePlugins };
	writeFileSync(path, `${JSON.stringify(updated, null, '\t')}\n`);
	return updated;
}

function toolchainIdentity(compiler, run) {
	const result = run(compiler, ['--version'], { encoding: 'utf8' });
	assert(result.status === 0, `The native helper addon compiler ${compiler} is unavailable.`);
	return String(result.stdout).split('\n')[0].trim();
}

function listSourceFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return listSourceFiles(path);
		if (!entry.isFile()) return [];
		const extension = entry.name.slice(entry.name.lastIndexOf('.'));
		return SOURCE_EXTENSIONS.has(extension) ? [path] : [];
	});
}

export function nativeHelperAddonPayloadPath(repositoryRoot, manifest, targetId) {
	const path = resolve(repositoryRoot, NATIVE_HELPER_ADDON_ROOT, 'prebuilt', targetId, manifest.payloadName);
	const metadata = statSync(path);
	assert(metadata.isFile(), `The native helper addon payload for ${targetId} is not a regular file.`);
	return path;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
