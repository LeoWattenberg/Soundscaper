/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact source/content/tree authority for the packaged Electron native smoke. */

import { createHash } from 'node:crypto';
import {
	lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { packagedExecutableCandidates } from './desktop-smoke.mjs';

const MANIFEST_NAME = 'milestone-5-package-content.json';
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_FILES = 100_000;
const MAXIMUM_FILE_BYTES = 8 * 1024 ** 3;
const MAXIMUM_TOTAL_BYTES = 32 * 1024 ** 3;

export function authenticateSoundscaperProfessionalPackagedApp(options) {
	const root = canonicalRoot(options?.packagedAppRoot);
	const sourceRevision = revision(options?.sourceRevision);
	const target = targetId(options?.target);
	const inventory = installedInventory(root);
	const manifests = inventory.filter(({ type, path }) =>
		type === 'file' && path.split('/').at(-1) === MANIFEST_NAME);
	if (manifests.length !== 1) {
		throw new Error(`The packaged Electron app must contain one ${MANIFEST_NAME}.`);
	}
	const contentManifestPath = resolvePortable(root, manifests[0].path);
	const contentManifestBytes = readFileSync(contentManifestPath);
	const contentManifest = parseCanonicalJson(contentManifestBytes, 'packaged Electron content manifest');
	validateContentManifest(contentManifest, sourceRevision, target);
	const resourcesRoot = resolvePortable(root, manifests[0].path.split('/').slice(0, -1).join('/'));
	const resources = resourceInventory(resourcesRoot);
	if (JSON.stringify(resources) !== JSON.stringify(contentManifest.files)
		|| contentManifest.fileCount !== resources.length
		|| contentManifest.totalBytes !== resources.reduce((sum, file) => sum + file.byteLength, 0)
		|| contentManifest.closureSha256 !== sha256(Buffer.from(JSON.stringify(resources), 'utf8'))) {
		throw new Error('The packaged Electron resource closure changed from its content manifest.');
	}
	const executable = executableAuthority(root, target);
	return validateSoundscaperProfessionalPackagedAppAuthority({
		schemaVersion: 1,
		kind: 'soundscaper-professional-packaged-electron-authority',
		target,
		sourceRevision,
		contentManifest: {
			path: manifests[0].path,
			byteLength: contentManifestBytes.byteLength,
			sha256: sha256(contentManifestBytes),
			closureSha256: contentManifest.closureSha256,
		},
		executable,
		rootFileCount: inventory.length,
		rootTotalBytes: inventory.reduce((sum, entry) => sum + entry.byteLength, 0),
		rootClosureSha256: sha256(canonicalJson(inventory)),
	});
}

export function assertSoundscaperProfessionalPackagedAppAuthority(expected, options) {
	validateSoundscaperProfessionalPackagedAppAuthority(expected);
	const observed = authenticateSoundscaperProfessionalPackagedApp(options);
	if (!expected || JSON.stringify(observed) !== JSON.stringify(expected)) {
		throw new Error('The packaged Electron app changed from its authenticated authority.');
	}
	return expected;
}

export function soundscaperProfessionalPackagedAppAuthoritySha256(authority) {
	validateSoundscaperProfessionalPackagedAppAuthority(authority);
	return sha256(canonicalJson(authority));
}

export function validateSoundscaperProfessionalPackagedAppAuthority(value) {
	if (!plainRecord(value) || exactKeys(value) !== [
		'contentManifest', 'executable', 'kind', 'rootClosureSha256', 'rootFileCount',
		'rootTotalBytes', 'schemaVersion', 'sourceRevision', 'target',
	].join(',') || value.schemaVersion !== 1
		|| value.kind !== 'soundscaper-professional-packaged-electron-authority'
		|| !['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(value.target)
		|| !REVISION.test(String(value.sourceRevision))
		|| !validAuthorityFile(value.contentManifest, true)
		|| !validAuthorityFile(value.executable, false)
		|| !Number.isSafeInteger(value.rootFileCount) || value.rootFileCount < 2
		|| value.rootFileCount > MAXIMUM_FILES
		|| !Number.isSafeInteger(value.rootTotalBytes) || value.rootTotalBytes < 1
		|| value.rootTotalBytes > MAXIMUM_TOTAL_BYTES
		|| !SHA256.test(String(value.rootClosureSha256))) {
		throw new TypeError('The packaged Electron authority is invalid.');
	}
	return deepFreeze(value);
}

function validAuthorityFile(value, contentManifest) {
	const fields = contentManifest
		? 'byteLength,closureSha256,path,sha256' : 'byteLength,path,sha256';
	return plainRecord(value) && exactKeys(value) === fields && safeRelativePath(value.path)
		&& Number.isSafeInteger(value.byteLength) && value.byteLength > 0
		&& value.byteLength <= MAXIMUM_FILE_BYTES && SHA256.test(String(value.sha256))
		&& (!contentManifest || SHA256.test(String(value.closureSha256)));
}

function validateContentManifest(value, sourceRevision, target) {
	const [platform, arch] = target.split('-');
	if (!plainRecord(value) || value.schemaVersion !== 1
		|| value.status !== 'installed-resource-closure-audited'
		|| value.productId !== 'soundscaper' || value.targetId !== target
		|| value.sourceRevision !== sourceRevision
		|| typeof value.applicationVersion !== 'string' || value.applicationVersion.length < 1
		|| !plainRecord(value.runtimeManifest) || !plainRecord(value.runtimeManifest.value)
		|| value.runtimeManifest.value.productId !== 'soundscaper'
		|| value.runtimeManifest.value.sourceRevision !== sourceRevision
		|| value.runtimeManifest.value.target?.platform !== platform
		|| value.runtimeManifest.value.target?.arch !== arch
		|| !Array.isArray(value.files) || value.files.length < 1
		|| !Number.isSafeInteger(value.fileCount) || value.fileCount !== value.files.length
		|| !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 1
		|| !SHA256.test(String(value.closureSha256))) {
		throw new Error('The packaged Electron content manifest has the wrong source revision or identity.');
	}
	for (const file of value.files) {
		if (!plainRecord(file) || Object.keys(file).sort().join(',') !== 'byteLength,path,sha256'
			|| !safeRelativePath(file.path) || !Number.isSafeInteger(file.byteLength)
			|| file.byteLength < 1 || file.byteLength > MAXIMUM_FILE_BYTES
			|| !SHA256.test(String(file.sha256))) {
			throw new Error('The packaged Electron content manifest has an invalid file inventory.');
		}
	}
}

function executableAuthority(root, target) {
	const [platformName, arch] = target.split('-');
	const platform = platformName === 'mac' ? 'darwin' : platformName === 'win' ? 'win32' : 'linux';
	const candidates = packagedExecutableCandidates({
		arch, outputRoot: root, platform, productId: 'soundscaper', productName: 'Soundscaper',
	}).filter((path) => {
		try {
			const metadata = lstatSync(path);
			return metadata.isFile() && !metadata.isSymbolicLink() && realpathSync(path) === path;
		} catch { return false; }
	});
	if (candidates.length !== 1) throw new Error('The packaged Electron executable inventory is ambiguous.');
	const bytes = stableFileBytes(candidates[0], 'packaged Electron executable');
	return Object.freeze({
		path: portableRelative(root, candidates[0]),
		byteLength: bytes.byteLength,
		sha256: sha256(bytes),
	});
}

function resourceInventory(root) {
	return installedInventory(root)
		.filter(({ path }) => path !== MANIFEST_NAME)
		.map(({ path, byteLength, sha256: digest }) => ({ path, byteLength, sha256: digest }));
}

function installedInventory(root) {
	const files = [];
	let totalBytes = 0;
	function visit(directory, prefix) {
		const entries = readdirSync(directory, { withFileTypes: true })
			.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			portableSegment(entry.name);
			const path = resolve(directory, entry.name);
			const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			const metadata = lstatSync(path);
			if (metadata.isSymbolicLink()) {
				const target = readlinkSync(path);
				if (isAbsolute(target) || target.includes('\0') || !contained(root, resolve(directory, target))) {
					throw new Error(`The packaged Electron app contains unsafe symbolic link ${name}.`);
				}
				const bytes = Buffer.from(target, 'utf8');
				files.push({ path: name, type: 'symlink', target,
					byteLength: bytes.byteLength, sha256: sha256(bytes) });
				totalBytes += bytes.byteLength;
			} else if (metadata.isDirectory()) visit(path, name);
			else if (metadata.isFile()) {
				const bytes = stableFileBytes(path, `packaged Electron file ${name}`);
				files.push({ path: name, type: 'file',
					byteLength: bytes.byteLength, sha256: sha256(bytes) });
				totalBytes += bytes.byteLength;
			} else throw new Error(`The packaged Electron app contains special file ${name}.`);
			if (files.length > MAXIMUM_FILES || totalBytes > MAXIMUM_TOTAL_BYTES) {
				throw new Error('The packaged Electron app exceeds its closure bound.');
			}
		}
	}
	visit(root, '');
	return files;
}

function stableFileBytes(path, label) {
	const before = lstatSync(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size > MAXIMUM_FILE_BYTES) {
		throw new Error(`The ${label} is not an admitted regular file.`);
	}
	const bytes = readFileSync(path);
	const after = lstatSync(path);
	if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) {
		throw new Error(`The ${label} changed while it was authenticated.`);
	}
	return bytes;
}

function parseCanonicalJson(bytes, label) {
	let value;
	try { value = JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`The ${label} is not JSON.`, { cause: error }); }
	if (!bytes.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))) {
		throw new Error(`The ${label} is not canonical JSON.`);
	}
	return value;
}

function canonicalRoot(value) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0') || realpathSync(value) !== value || !lstatSync(value).isDirectory()) {
		throw new TypeError('The packaged Electron root must be one canonical absolute directory.');
	}
	return value;
}

function targetId(value) {
	if (!['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(value)) {
		throw new TypeError('The packaged Electron target is unsupported.');
	}
	return value;
}

function revision(value) {
	if (typeof value !== 'string' || !REVISION.test(value)) {
		throw new TypeError('The packaged Electron source revision is invalid.');
	}
	return value;
}

function resolvePortable(root, path) {
	if (path === '') return root;
	if (!safeRelativePath(path)) throw new TypeError('A packaged Electron relative path is invalid.');
	const output = resolve(root, ...path.split('/'));
	if (!contained(root, output)) throw new TypeError('A packaged Electron path escaped its root.');
	return output;
}

function portableRelative(root, path) { return relative(root, path).split(sep).join('/'); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`, 'utf8'); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function plainRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value) { return Object.keys(value).sort().join(','); }
function contained(root, path) {
	const relation = relative(root, path);
	return relation !== '' && relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}
function safeRelativePath(value) {
	return typeof value === 'string' && value.length > 0 && value.length <= 4_096
		&& !value.startsWith('/') && !value.includes('\\')
		&& value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.includes('\0'));
}
function portableSegment(value) {
	if (value === '.' || value === '..' || value.includes('/') || value.includes('\\')
		|| value.includes('\0') || Buffer.byteLength(value) > 255) {
		throw new Error('The packaged Electron app has an unsafe path segment.');
	}
}
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
