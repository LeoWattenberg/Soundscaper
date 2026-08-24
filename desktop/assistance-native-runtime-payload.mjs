/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact staging and runtime authentication for the optional sherpa native payload. */

import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import {
	cp, lstat, mkdir, open, readdir, realpath, rm,
} from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_IDS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const SHA256 = /^[a-f\d]{64}$/u;
const PACKAGE_NAME = /^sherpa-onnx-(?:node|linux-(?:x64|arm64)|darwin-arm64|win-x64)$/u;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const MAXIMUM_FILE_BYTES = 512 * 1024 * 1024;

export function assistanceNativeRuntimeTargetId({ platform, arch }) {
	const operatingSystem = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : platform;
	const targetId = `${String(operatingSystem)}-${String(arch)}`;
	if (!TARGET_IDS.includes(targetId)) {
		throw new Error(`The assistance native runtime target ${targetId} is unsupported.`);
	}
	return targetId;
}

export function assistanceNativeRuntimeStageSummary(manifestValue, targetId) {
	const { manifest, target } = validateManifestAndTarget(manifestValue, targetId);
	const manifestSha256 = digest(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
	if (target.status === 'unsupported') {
		return deepFreeze({
			schemaVersion: 1,
			target: targetId,
			status: 'unsupported',
			runtimeId: manifest.runtimeId,
			version: manifest.version,
			manifestSha256,
			payload: null,
			blockedBy: target.blockedBy,
		});
	}
	const packages = [manifest.commonPackage, target.package];
	return deepFreeze({
		schemaVersion: 1,
		target: targetId,
		status: 'built',
		runtimeId: manifest.runtimeId,
		version: manifest.version,
		manifestSha256,
		payload: {
			root: manifest.runtimePrefix,
			files: Object.fromEntries(packages.flatMap((descriptor) => (
				Object.entries(descriptor.files).map(([name, file]) => [
					`node_modules/${descriptor.name}/${name}`,
					{ byteLength: file.byteLength, sha256: file.sha256 },
				])
			))),
			packages: packages.map(({ name, version, integrity, files }) => ({
				name,
				version,
				integrity,
				fileCount: Object.keys(files).length,
				byteLength: Object.values(files).reduce((total, file) => total + file.byteLength, 0),
			})),
			fileCount: packages.reduce((total, value) => total + Object.keys(value.files).length, 0),
			byteLength: packages.reduce((total, value) => total
				+ Object.values(value.files).reduce((subtotal, file) => subtotal + file.byteLength, 0), 0),
		},
		blockedBy: null,
	});
}

export async function stageAssistanceNativeRuntimePayload({
	manifest: manifestValue,
	targetId,
	nodeModulesRoot,
	outputRoot,
}) {
	const { manifest, target } = validateManifestAndTarget(manifestValue, targetId);
	const sourceRoot = absoluteRoot(nodeModulesRoot, 'node_modules root');
	const destinationRoot = absoluteRoot(outputRoot, 'output root');
	const payloadRoot = containedPath(destinationRoot, manifest.runtimePrefix, 'runtime prefix');
	await rm(payloadRoot, { recursive: true, force: true });
	if (target.status === 'unsupported') return assistanceNativeRuntimeStageSummary(manifest, targetId);
	const packages = [manifest.commonPackage, target.package];
	for (const descriptor of packages) {
		await verifyPackageDirectory(containedPath(sourceRoot, descriptor.name, 'source package'), descriptor);
	}
	const destinationModules = resolve(payloadRoot, 'node_modules');
	await mkdir(destinationModules, { recursive: true });
	for (const descriptor of packages) {
		await cp(resolve(sourceRoot, descriptor.name), resolve(destinationModules, descriptor.name), {
			recursive: true,
			errorOnExist: true,
		});
	}
	await verifyAssistanceNativeRuntimePayload({ manifest, targetId, outputRoot: destinationRoot });
	return assistanceNativeRuntimeStageSummary(manifest, targetId);
}

export async function verifyAssistanceNativeRuntimePayload({
	manifest: manifestValue,
	targetId,
	outputRoot,
}) {
	const { manifest, target } = validateManifestAndTarget(manifestValue, targetId);
	const root = absoluteRoot(outputRoot, 'output root');
	const payloadRoot = containedPath(root, manifest.runtimePrefix, 'runtime prefix');
	if (target.status === 'unsupported') {
		const existing = await lstat(payloadRoot).catch((error) => {
			if (error.code === 'ENOENT') return null;
			throw error;
		});
		if (existing !== null) {
			throw new Error(`The unsupported assistance target ${targetId} must not carry a native payload.`);
		}
		return deepFreeze({
			...assistanceNativeRuntimeStageSummary(manifest, targetId),
			modulePath: null,
			moduleSpecifier: null,
			fileCount: 0,
		});
	}
	await regularDirectory(payloadRoot, 'assistance native runtime root');
	const nodeModulesRoot = resolve(payloadRoot, 'node_modules');
	await regularDirectory(nodeModulesRoot, 'assistance native node_modules root');
	const packages = [manifest.commonPackage, target.package];
	const entries = await readdir(nodeModulesRoot, { withFileTypes: true });
	const expectedPackages = packages.map(({ name }) => name).sort();
	const actualPackages = entries.map(({ name }) => name).sort();
	if (JSON.stringify(actualPackages) !== JSON.stringify(expectedPackages)
		|| entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
		throw new Error('The assistance native runtime package inventory is not exact.');
	}
	for (const descriptor of packages) {
		await verifyPackageDirectory(resolve(nodeModulesRoot, descriptor.name), descriptor);
	}
	const entry = resolve(nodeModulesRoot, manifest.commonPackage.name, manifest.commonPackage.entry);
	return deepFreeze({
		...assistanceNativeRuntimeStageSummary(manifest, targetId),
		modulePath: entry,
		moduleSpecifier: pathToFileURL(entry).href,
		fileCount: packages.reduce((total, value) => total + Object.keys(value.files).length, 0),
	});
}

function validateManifestAndTarget(value, targetId) {
	if (!plainRecord(value) || value.schemaVersion !== 1
		|| value.runtimeId !== 'sherpa-onnx-node'
		|| typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(value.version)
		|| typeof value.runtimePrefix !== 'string'
		|| !/^assistance\/sherpa-onnx\/\d+\.\d+\.\d+$/u.test(value.runtimePrefix)
		|| !plainRecord(value.targets)) {
		throw new TypeError('The assistance native runtime manifest is invalid.');
	}
	if (JSON.stringify(Object.keys(value.targets).sort()) !== JSON.stringify([...TARGET_IDS].sort())) {
		throw new TypeError('The assistance native runtime manifest target inventory is not exact.');
	}
	validatePackage(value.commonPackage, value.version, true);
	if (!TARGET_IDS.includes(targetId)) throw new TypeError('The assistance native runtime target is invalid.');
	for (const [id, candidate] of Object.entries(value.targets)) {
		if (!plainRecord(candidate) || (candidate.status !== 'built' && candidate.status !== 'unsupported')) {
			throw new TypeError(`The assistance native runtime target ${id} is invalid.`);
		}
		if (candidate.status === 'built') validatePackage(candidate.package, value.version, false);
		else if (typeof candidate.blockedBy !== 'string' || candidate.blockedBy.trim().length < 16
			|| Object.hasOwn(candidate, 'package')) {
			throw new TypeError(`The unsupported assistance target ${id} is invalid.`);
		}
	}
	return { manifest: value, target: value.targets[targetId] };
}

function validatePackage(value, version, common) {
	if (!plainRecord(value) || !PACKAGE_NAME.test(String(value.name)) || value.version !== version
		|| typeof value.sourceUrl !== 'string' || !value.sourceUrl.startsWith('https://registry.npmjs.org/')
		|| typeof value.integrity !== 'string' || !/^sha512-[A-Za-z\d+/]+={0,2}$/u.test(value.integrity)
		|| !plainRecord(value.files)
		|| (common && (value.name !== 'sherpa-onnx-node' || value.entry !== 'sherpa-onnx.js'))
		|| (!common && value.name === 'sherpa-onnx-node')) {
		throw new TypeError('An assistance native runtime package descriptor is invalid.');
	}
	const names = Object.keys(value.files);
	if (names.length === 0 || names.some((name) => !SAFE_NAME.test(name))) {
		throw new TypeError(`The assistance package ${value.name} file inventory is invalid.`);
	}
	for (const descriptor of Object.values(value.files)) {
		if (!plainRecord(descriptor) || !Number.isSafeInteger(descriptor.byteLength)
			|| descriptor.byteLength < 1 || descriptor.byteLength > MAXIMUM_FILE_BYTES
			|| typeof descriptor.sha256 !== 'string' || !SHA256.test(descriptor.sha256)) {
			throw new TypeError(`The assistance package ${value.name} file descriptor is invalid.`);
		}
	}
}

async function verifyPackageDirectory(packageRoot, descriptor) {
	await regularDirectory(packageRoot, `assistance package ${descriptor.name}`);
	const entries = await readdir(packageRoot, { withFileTypes: true });
	const expected = Object.keys(descriptor.files).sort();
	const actual = entries.map(({ name }) => name).sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`The assistance package ${descriptor.name} file inventory is not exact.`);
	}
	for (const entry of entries) {
		if (!entry.isFile() || entry.isSymbolicLink()) {
			throw new Error(`The assistance package ${descriptor.name}/${entry.name} must be a regular non-symbolic file.`);
		}
		await verifyFile(resolve(packageRoot, entry.name), descriptor.files[entry.name], descriptor.name);
	}
}

async function verifyFile(path, descriptor, packageName) {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size !== descriptor.byteLength) {
		throw new Error(`The assistance package ${packageName} file length or type is invalid.`);
	}
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error(`The assistance package ${packageName} file changed while opening.`);
		}
		const hash = createHash('sha256');
		let byteLength = 0;
		for await (const chunk of handle.createReadStream({ autoClose: false })) {
			byteLength += chunk.byteLength;
			if (byteLength > descriptor.byteLength) break;
			hash.update(chunk);
		}
		const after = await handle.stat();
		if (byteLength !== descriptor.byteLength || after.size !== opened.size
			|| after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
			|| hash.digest('hex') !== descriptor.sha256) {
			throw new Error(`The assistance package ${packageName} file digest is invalid.`);
		}
	} finally {
		await handle?.close();
	}
}

async function regularDirectory(path, label) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error(`The ${label} must be a regular non-symbolic directory.`);
	}
	const canonical = await realpath(path);
	if (canonical !== path) throw new Error(`The ${label} must use its canonical path.`);
}

function absoluteRoot(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The assistance native runtime ${label} must be an absolute normalized path.`);
	}
	return value;
}

function containedPath(root, fragment, label) {
	const output = resolve(root, fragment);
	const path = relative(root, output);
	if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
		throw new TypeError(`The assistance native ${label} leaves its root.`);
	}
	return output;
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function plainRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const member of Object.values(value)) deepFreeze(member);
	return Object.freeze(value);
}
