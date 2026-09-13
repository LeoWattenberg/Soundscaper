/* SPDX-License-Identifier: AGPL-3.0-only */

/** Stage one authenticated helper-and-fixture result with caught-failure rollback. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
	NATIVE_HELPER_ADDON_STAGED_BUILD_RESULT,
	deriveNativeHelperAddonBuildPolicy,
	verifyNativeHelperAddonBuildResult,
} from './native-helper-addon-build-result.mjs';
import { NATIVE_HELPER_ADDON_ROOT } from './native-helper-addon-build.mjs';
import {
	NATIVE_ADDON_PAYLOAD_MANIFEST_PATH,
	deriveNativeAddonPayloadManifest,
	serializeNativeAddonPayloadManifest,
	verifyNativeAddonPayloadManifest,
} from './native-addon-payload-manifest.mjs';
import { FIXTURE_PLUGIN_ROOT } from './native-fixture-plugins.mjs';

const MAXIMUM_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAXIMUM_FIXTURE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_RECEIPT_BYTES = 256 * 1024;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;

export async function stageNativeHelperAddonBuildResult({ buildResultRoot, repositoryRoot }) {
	const verified = await verifyNativeHelperAddonBuildResult({ buildResultRoot });
	const root = await canonicalDirectory(repositoryRoot, 'repository root');
	assert(checkoutRevision(root) === verified.receipt.sourceRevision,
		'The native helper build-result source revision does not match the staging checkout HEAD.');
	const currentPolicy = deriveNativeHelperAddonBuildPolicy({
		repositoryRoot: root, target: verified.receipt.target,
	});
	assert(sameJson(currentPolicy, verified.receipt.buildPolicy),
		'The native helper build result does not match this checkout build policy.');
	const sourceManifestPath = resolve(root, `${NATIVE_HELPER_ADDON_ROOT}/source-manifest.json`);
	const shippedManifestPath = resolve(root, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH);
	const sourceBytes = await regularFile(sourceManifestPath, 'native helper source manifest', MAXIMUM_RECEIPT_BYTES);
	const shippedBytes = await regularFile(shippedManifestPath, 'native helper payload manifest', MAXIMUM_RECEIPT_BYTES);
	const source = parseJson(sourceBytes, 'native helper source manifest');
	const current = source.targets?.[verified.receipt.target];
	const currentFixtures = source.fixturePlugins?.targets?.[verified.receipt.target];
	assert(current && typeof current === 'object', 'The native helper source manifest has no build-result target.');
	assert(currentFixtures && typeof currentFixtures === 'object',
		'The native helper source manifest has no fixture build-result target.');

	const receiptName = NATIVE_HELPER_ADDON_STAGED_BUILD_RESULT;
	const payloadDescriptor = manifestDescriptor(verified.receipt.payload);
	const fixtureDescriptors = verified.receipt.fixturePlugins.files.map(manifestDescriptor);
	const receiptDescriptor = {
		name: receiptName,
		byteLength: verified.receiptBytes.byteLength,
		sha256: verified.receiptSha256,
	};
	if (current.status === 'built' && sameJson(current.payload, payloadDescriptor)
		&& sameJson(current.buildResult, receiptDescriptor)) {
		assert(currentFixtures.status === 'built'
			&& sameJson(currentFixtures.files, fixtureDescriptors),
		'The native helper target fixtures disagree with its staged build result.');
		await verifyAlreadyStaged(root, verified, receiptName);
		return deepFreeze({ status: 'already-staged', target: verified.receipt.target });
	}

	const legacyAddon = await authenticateCurrentAddon(root, current, verified);
	const legacyFixtures = await authenticateCurrentFixtures(root, currentFixtures, verified);
	assert((legacyAddon === null) === (legacyFixtures === null),
		'The native helper addon and fixture target materialization states disagree.');
	const addonRoot = resolve(root, NATIVE_HELPER_ADDON_ROOT, 'prebuilt', verified.receipt.target);
	const fixtureRoot = resolve(root, FIXTURE_PLUGIN_ROOT, 'prebuilt', verified.receipt.target);
	if (legacyAddon === null) {
		await mkdir(dirname(addonRoot), { recursive: true, mode: 0o700 });
		await mkdir(addonRoot, { mode: 0o700 });
		await mkdir(dirname(fixtureRoot), { recursive: true, mode: 0o700 });
		await mkdir(fixtureRoot, { mode: 0o700 });
	}

	let published = false;
	let sourcePublished = false;
	let shippedPublished = false;
	const temporarySource = `${sourceManifestPath}.build-result-${process.pid}`;
	const temporaryShipped = `${shippedManifestPath}.build-result-${process.pid}`;
	try {
		await writeFile(resolve(addonRoot, payloadDescriptor.name), verified.payloadBytes,
			{ flag: legacyAddon === null ? 'wx' : 'w', mode: 0o555 });
		await writeFile(resolve(addonRoot, receiptName), verified.receiptBytes,
			{ flag: 'wx', mode: 0o444 });
		for (const descriptor of verified.receipt.fixturePlugins.files) {
			await writeFile(resolve(fixtureRoot, descriptor.name), verified.fixtureBytes.get(descriptor.name),
				{ flag: legacyFixtures === null ? 'wx' : 'w', mode: 0o555 });
		}

		const updated = structuredClone(source);
		updated.targets[verified.receipt.target] = {
			status: 'built',
			blockedBy: null,
			toolchainIdentity: toolchainIdentity(verified.receipt.toolchain),
			payload: payloadDescriptor,
			buildResult: receiptDescriptor,
		};
		updated.fixturePlugins.targets[verified.receipt.target] = {
			status: 'built', files: fixtureDescriptors,
		};
		const updatedSourceBytes = Buffer.from(`${JSON.stringify(updated, null, '\t')}\n`);
		const updatedShippedBytes = Buffer.from(serializeNativeAddonPayloadManifest(
			deriveNativeAddonPayloadManifest(updated),
		));
		assert((await readFile(sourceManifestPath)).equals(sourceBytes)
			&& (await readFile(shippedManifestPath)).equals(shippedBytes),
		'The native helper manifests changed while build-result staging was prepared.');
		await writeFile(temporarySource, updatedSourceBytes, { flag: 'wx', mode: 0o644 });
		await writeFile(temporaryShipped, updatedShippedBytes, { flag: 'wx', mode: 0o644 });
		await rename(temporarySource, sourceManifestPath);
		sourcePublished = true;
		await rename(temporaryShipped, shippedManifestPath);
		shippedPublished = true;
		await verifyNativeAddonPayloadManifest({
			repositoryRoot: root, target: verified.receipt.target, targetSource: 'declared',
		});
		await verifyAlreadyStaged(root, verified, receiptName);
		published = true;
		return deepFreeze({ status: 'staged', target: verified.receipt.target });
	} finally {
		await rm(temporarySource, { force: true });
		await rm(temporaryShipped, { force: true });
		if (!published) {
			if (sourcePublished) await writeFile(sourceManifestPath, sourceBytes);
			if (shippedPublished) await writeFile(shippedManifestPath, shippedBytes);
			if (legacyAddon === null) {
				await rm(addonRoot, { recursive: true, force: true });
				await rm(fixtureRoot, { recursive: true, force: true });
			} else {
				await writeFile(resolve(addonRoot, payloadDescriptor.name), legacyAddon, { mode: 0o555 });
				await rm(resolve(addonRoot, receiptName), { force: true });
				await restoreFixtureBytes(fixtureRoot, legacyFixtures);
			}
		}
	}
}

async function authenticateCurrentAddon(root, current, verified) {
	if (current.status === 'ci-generated') {
		assert(current.payload === null && current.toolchainIdentity === null && current.buildResult === null,
			'Only one exact CI-generated native helper target can be staged.');
		return null;
	}
	assert(current.status === 'built' && current.buildResult === null
		&& current.payload?.name === verified.receipt.payload.name,
	'The native helper target is already staged from a different build result.');
	const rootPath = resolve(root, NATIVE_HELPER_ADDON_ROOT, 'prebuilt', verified.receipt.target);
	const entries = await readdir(rootPath, { withFileTypes: true });
	assert(entries.length === 1 && entries[0].isFile() && !entries[0].isSymbolicLink()
		&& entries[0].name === current.payload.name,
	'The legacy native helper target has an unexpected inventory.');
	const bytes = await regularFile(resolve(rootPath, current.payload.name),
		'legacy native helper payload', MAXIMUM_PAYLOAD_BYTES);
	verifyDescriptor(bytes, current.payload, 'legacy native helper payload');
	return bytes;
}

async function authenticateCurrentFixtures(root, current, verified) {
	if (current.status === 'ci-generated') {
		assert(Array.isArray(current.files) && current.files.length === 0,
			'A CI-generated native helper fixture target must pin no output.');
		return null;
	}
	assert(current.status === 'built' && Array.isArray(current.files),
		'The native helper fixture target has an unsupported state.');
	const expectedNames = verified.receipt.fixturePlugins.files.map(({ name }) => name).sort();
	assert(sameJson(current.files.map(({ name }) => name).sort(), expectedNames),
		'The legacy native helper fixture target has an unexpected inventory.');
	const fixtureRoot = resolve(root, FIXTURE_PLUGIN_ROOT, 'prebuilt', verified.receipt.target);
	const entries = await readdir(fixtureRoot, { withFileTypes: true });
	assert(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink())
		&& sameJson(entries.map(({ name }) => name).sort(), expectedNames),
	'The legacy native helper fixture directory has an unexpected inventory.');
	const bytes = new Map();
	for (const descriptor of current.files) {
		const value = await regularFile(resolve(fixtureRoot, descriptor.name),
			`legacy native helper fixture ${descriptor.name}`, MAXIMUM_FIXTURE_BYTES);
		verifyDescriptor(value, descriptor, `legacy native helper fixture ${descriptor.name}`);
		bytes.set(descriptor.name, value);
	}
	return bytes;
}

async function verifyAlreadyStaged(root, verified, receiptName) {
	const addonRoot = resolve(root, NATIVE_HELPER_ADDON_ROOT, 'prebuilt', verified.receipt.target);
	const payload = await regularFile(resolve(addonRoot, verified.receipt.payload.name),
		'staged native helper payload', MAXIMUM_PAYLOAD_BYTES);
	const receipt = await regularFile(resolve(addonRoot, receiptName),
		'staged native helper build-result receipt', MAXIMUM_RECEIPT_BYTES);
	assert(payload.equals(verified.payloadBytes) && receipt.equals(verified.receiptBytes),
		'The staged native helper build-result bytes changed.');
	const fixtureRoot = resolve(root, FIXTURE_PLUGIN_ROOT, 'prebuilt', verified.receipt.target);
	const entries = await readdir(fixtureRoot, { withFileTypes: true });
	assert(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink())
		&& sameJson(entries.map(({ name }) => name).sort(),
			verified.receipt.fixturePlugins.files.map(({ name }) => name).sort()),
	'The staged native helper fixture inventory changed.');
	for (const descriptor of verified.receipt.fixturePlugins.files) {
		const bytes = await regularFile(resolve(fixtureRoot, descriptor.name),
			`staged native helper fixture ${descriptor.name}`, MAXIMUM_FIXTURE_BYTES);
		assert(bytes.equals(verified.fixtureBytes.get(descriptor.name)),
			`The staged native helper fixture ${descriptor.name} changed.`);
	}
}

async function restoreFixtureBytes(root, bytes) {
	for (const [name, value] of bytes) await writeFile(resolve(root, name), value, { mode: 0o555 });
}

function manifestDescriptor(descriptor) {
	return { name: descriptor.name, byteLength: descriptor.byteLength, sha256: descriptor.sha256 };
}

function toolchainIdentity(receipt) {
	return `${receipt.compilerId} ${receipt.compilerVersion} (${receipt.generator}; ${receipt.systemName} ${receipt.systemProcessor})`;
}

async function regularFile(path, label, maximum) {
	const metadata = await lstat(path);
	assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0 && metadata.size <= maximum,
		`The ${label} is not one bounded regular file.`);
	return readFile(path);
}

async function canonicalDirectory(path, label) {
	const absolute = resolve(path);
	assert(typeof path === 'string' && path.length > 0 && absolute === path && !path.includes('\0'),
		`The ${label} must be an absolute normalized path.`);
	const metadata = await lstat(absolute);
	assert(metadata.isDirectory() && !metadata.isSymbolicLink() && await realpath(absolute) === absolute,
		`The ${label} is not a canonical directory.`);
	return absolute;
}

function checkoutRevision(root) {
	const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
		cwd: root, encoding: 'utf8', shell: false,
	});
	const revision = String(result.stdout ?? '').trim();
	assert(result.status === 0 && result.signal === null && !result.error && REVISION.test(revision),
		'The native helper staging checkout HEAD could not be resolved.');
	return revision;
}

function verifyDescriptor(bytes, descriptor, label) {
	assert(bytes.byteLength === descriptor.byteLength, `${label} byte length mismatch.`);
	assert(sha256(bytes) === descriptor.sha256, `${label} digest mismatch.`);
}

function parseJson(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`The ${label} is invalid JSON: ${error.message}`, { cause: error }); }
}

function canonicalJson(value) {
	return Buffer.from(`${JSON.stringify(sortJson(value), null, '\t')}\n`);
}

function sortJson(value) {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function sameJson(left, right) {
	return canonicalJson(left).equals(canonicalJson(right));
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
