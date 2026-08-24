/* SPDX-License-Identifier: AGPL-3.0-only */

/** Embedded, re-extractable authority for the installed desktop resource closure. */
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
	assertDesktopCodecPolicy,
	isForbiddenDesktopFfmpegPath,
} from './desktop-codec-policy.mjs';
import { assertProfessionalNativeBuiltClosure } from './desktop-package-professional-closure.mjs';

export const DESKTOP_PACKAGE_CONTENT_MANIFEST_NAME = 'milestone-5-package-content.json';

const PRODUCTS = Object.freeze(['soundscaper', 'framescaper']);
const TARGETS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const SHA256 = /^[a-f\d]{64}$/u;
const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const MAXIMUM_FILES = 100_000;
const MAXIMUM_FILE_BYTES = 8 * 1024 ** 3;
const MAXIMUM_TOTAL_BYTES = 32 * 1024 ** 3;
const MAXIMUM_MANIFEST_BYTES = 32 * 1024 * 1024;
export async function writeDesktopPackageContentManifest({
	resourcesRoot,
	runtimeManifestPath,
	productId,
	targetId,
}) {
	identity(productId, targetId);
	const root = await canonicalDirectory(resourcesRoot, 'desktop packaged resources root');
	const manifestPath = directPath(root, DESKTOP_PACKAGE_CONTENT_MANIFEST_NAME, 'package-content manifest');
	await assertAbsent(manifestPath);
	const runtimeManifestBytes = await boundedRead(runtimeManifestPath, MAXIMUM_MANIFEST_BYTES,
		'desktop runtime manifest');
	const runtimeManifest = canonicalJson(runtimeManifestBytes, 'desktop runtime manifest');
	validateRuntimeManifest(runtimeManifest, productId, targetId);
	const files = await collectClosure(root, DESKTOP_PACKAGE_CONTENT_MANIFEST_NAME);
	assertRuntimePayloadClosure(runtimeManifest, files);
	const closureSha256 = digest(Buffer.from(JSON.stringify(files), 'utf8'));
	const value = {
		schemaVersion: 1,
		status: 'installed-resource-closure-audited',
		productId,
		targetId,
		applicationVersion: runtimeManifest.applicationVersion,
		sourceRevision: runtimeManifest.sourceRevision,
		runtimeManifest: {
			byteLength: runtimeManifestBytes.byteLength,
			sha256: digest(runtimeManifestBytes),
			value: runtimeManifest,
		},
		files,
		fileCount: files.length,
		totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
		closureSha256,
	};
	const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
	if (bytes.byteLength > MAXIMUM_MANIFEST_BYTES) {
		throw new Error('The desktop package-content manifest exceeds its byte limit.');
	}
	await writeFile(manifestPath, bytes, { flag: 'wx' });
	return deepFreeze({
		status: value.status,
		productId,
		targetId,
		sourceRevision: value.sourceRevision,
		fileCount: value.fileCount,
		totalBytes: value.totalBytes,
		closureSha256,
		contentManifestSha256: digest(bytes),
	});
}
export async function auditExtractedDesktopPackageContent({
	extractedRoot,
	runtimeManifestBytes,
	productId,
	targetId,
}) {
	identity(productId, targetId);
	const extraction = await canonicalDirectory(extractedRoot, 'extracted desktop package root');
	const adjacentBytes = boundedBytes(runtimeManifestBytes, MAXIMUM_MANIFEST_BYTES,
		'adjacent desktop runtime manifest');
	const adjacent = canonicalJson(adjacentBytes, 'adjacent desktop runtime manifest');
	validateRuntimeManifest(adjacent, productId, targetId);
	const matches = await findManifest(extraction);
	if (matches.length !== 1) {
		throw new Error(`The extracted package must contain one package-content manifest; found ${matches.length}.`);
	}
	const contentPath = matches[0];
	const resourcesRoot = dirname(contentPath);
	const layout = await validateInstalledLayout({ extraction, resourcesRoot, productId, targetId });
	const contentBytes = await boundedRead(contentPath, MAXIMUM_MANIFEST_BYTES,
		'embedded package-content manifest');
	const content = canonicalJson(contentBytes, 'embedded package-content manifest');
	validateContentManifest(content, productId, targetId);
	if (content.runtimeManifest.byteLength !== adjacentBytes.byteLength
		|| content.runtimeManifest.sha256 !== digest(adjacentBytes)
		|| JSON.stringify(content.runtimeManifest.value) !== JSON.stringify(adjacent)) {
		throw new Error('The embedded and adjacent desktop runtime manifests disagree.');
	}
	const files = await collectClosure(resourcesRoot, DESKTOP_PACKAGE_CONTENT_MANIFEST_NAME);
	assertRuntimePayloadClosure(adjacent, files);
	if (JSON.stringify(files) !== JSON.stringify(content.files)
		|| content.fileCount !== files.length
		|| content.totalBytes !== files.reduce((total, file) => total + file.byteLength, 0)
		|| content.closureSha256 !== digest(Buffer.from(JSON.stringify(files), 'utf8'))) {
		throw new Error('The extracted desktop resource closure disagrees with its embedded manifest.');
	}
	await assertExecutableArchitecture(layout.executable, targetId);
	const installedFiles = await collectInstalledClosure(layout.applicationRoot);
	const installedClosureSha256 = digest(Buffer.from(JSON.stringify(installedFiles), 'utf8'));
	return deepFreeze({
		status: content.status,
		productId,
		targetId,
		applicationVersion: content.applicationVersion,
		sourceRevision: content.sourceRevision,
		resourcesPath: resourcesRoot,
		fileCount: content.fileCount,
		totalBytes: content.totalBytes,
		closureSha256: content.closureSha256,
		contentManifestByteLength: contentBytes.byteLength,
		contentManifestSha256: digest(contentBytes),
		installedFileCount: installedFiles.length,
		installedTotalBytes: installedFiles.reduce((total, file) => total + file.byteLength, 0),
		installedClosureSha256,
	});
}
async function collectInstalledClosure(root) {
	const files = [];
	let totalBytes = 0;
	async function visit(directory, prefix) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			assertPortableSegment(entry.name);
			const path = resolve(directory, entry.name);
			const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			const metadata = await lstat(path);
			if (metadata.isSymbolicLink()) {
				const target = await readlink(path);
				if (isAbsolute(target) || target.includes('\0')
					|| !contained(root, resolve(dirname(path), target))) {
					throw new Error(`The installed application has an unsafe symbolic link ${name}.`);
				}
				const bytes = Buffer.from(target, 'utf8');
				files.push({
					path: name, type: 'symlink', target,
					byteLength: bytes.byteLength, sha256: digest(bytes), mode: metadata.mode & 0o777,
				});
				totalBytes += bytes.byteLength;
			} else if (metadata.isDirectory()) {
				await visit(path, name);
			} else if (metadata.isFile()) {
				const descriptor = await describeFile(path, name);
				files.push({ ...descriptor, type: 'file', mode: metadata.mode & 0o777 });
				totalBytes += descriptor.byteLength;
			} else {
				throw new Error(`The installed application contains special entry ${name}.`);
			}
			if (files.length > MAXIMUM_FILES || totalBytes > MAXIMUM_TOTAL_BYTES) {
				throw new Error('The installed application closure exceeds its admission budget.');
			}
		}
	}
	await visit(root, '');
	return files;
}
function assertRuntimePayloadClosure(runtime, files) {
	const inventory = new Map(files.map((file) => [file.path, file]));
	const expectedByPrefix = new Map();
	const requireFile = (path, descriptor, label, prefix = null) => {
		if (!plainRecord(descriptor) || !Number.isSafeInteger(descriptor.byteLength)
			|| descriptor.byteLength < 1 || typeof descriptor.sha256 !== 'string'
			|| !SHA256.test(descriptor.sha256)) {
			throw new Error(`The desktop runtime manifest has invalid ${label} evidence.`);
		}
		const actual = inventory.get(path);
		if (actual?.byteLength !== descriptor.byteLength || actual.sha256 !== descriptor.sha256) {
			throw new Error(`The installed desktop resource closure does not contain authenticated ${label}.`);
		}
		if (prefix !== null) {
			const names = expectedByPrefix.get(prefix) ?? new Set();
			names.add(path);
			expectedByPrefix.set(prefix, names);
		}
	};

	if (Object.hasOwn(runtime, 'ffmpeg')) {
		throw new Error('The desktop runtime manifest retains a legacy bundled FFmpeg runtime summary.');
	}
	assertDesktopCodecPolicy(runtime.desktopCodecPolicy, 'The desktop runtime manifest codec policy');
	const forbiddenCodecPayloads = files
		.map(({ path }) => path)
		.filter(isForbiddenDesktopFfmpegPath);
	if (forbiddenCodecPayloads.length > 0) {
		throw new Error(`The installed desktop resource closure contains forbidden bundled FFmpeg/libav content: ${forbiddenCodecPayloads.join(', ')}.`);
	}

	const native = runtime.nativeAddons;
	if (!plainRecord(native) || native.target !== `${runtime.target.platform}-${runtime.target.arch}`
		|| !plainRecord(native.payloadManifest)) {
		throw new Error('The desktop runtime manifest has no exact native-addon content authority.');
	}
	const nativePrefix = `runtime/native/${native.target}/`;
	const nativeManifestPath = `${nativePrefix}native-addon-payload-manifest.json`;
	const nativeManifest = inventory.get(nativeManifestPath);
	if (!nativeManifest || nativeManifest.sha256 !== native.payloadManifest.sha256) {
		throw new Error('The installed desktop resource closure has the wrong native-addon manifest.');
	}
	expectedByPrefix.set(nativePrefix, new Set([nativeManifestPath]));
	if (native.status === 'built') {
		requireFile(`${nativePrefix}${native.payload?.name}`, native.payload,
			'native-addon payload', nativePrefix);
	} else if (native.status !== 'pending-external' || native.payload !== null) {
		throw new Error('The desktop runtime manifest has invalid native-addon target state.');
	}

	const professional = runtime.soundscaperProfessionalNative;
	if (runtime.productId === 'soundscaper') {
		if (!plainRecord(professional) || professional.target !== native.target
			|| !plainRecord(professional.payloadManifest)
			|| !plainRecord(professional.reviewPolicy)
			|| !Object.hasOwn(professional, 'productionReadiness')) {
			throw new Error('The desktop runtime manifest has no professional native payload authority.');
		}
		const professionalPrefix = `runtime/native/soundscaper-professional-host/${native.target}/`;
		const professionalManifestPath = `${professionalPrefix}soundscaper-professional-native-payload-manifest.json`;
		requireFile(professionalManifestPath, professional.payloadManifest,
			'professional native payload manifest', professionalPrefix);
		requireFile(`${professionalPrefix}${professional.reviewPolicy.name}`, professional.reviewPolicy,
			'professional native-isolation review policy', professionalPrefix);
		if (professional.status === 'built') {
			requireFile(`${professionalPrefix}${professional.payload?.name}`, professional.payload,
				'professional native payload', professionalPrefix);
			assertProfessionalNativeBuiltClosure({
				professional, target: native.target, prefix: professionalPrefix, requireFile,
			});
			if (professional.productionReadiness !== null) {
				requireFile(`${professionalPrefix}${professional.productionReadiness?.evidence?.name}`,
					professional.productionReadiness?.evidence,
					'professional native production-readiness evidence', professionalPrefix);
			}
		} else if (professional.status !== 'pending-external' || professional.payload !== null) {
			throw new Error('The desktop runtime manifest has invalid professional native target state.');
		}
	} else if (professional !== null && professional !== undefined) {
		throw new Error('The Framescaper runtime manifest carries Soundscaper professional native authority.');
	}

	const assistance = runtime.assistanceNativeRuntime;
	if (!plainRecord(assistance) || assistance.target !== native.target) {
		throw new Error('The desktop runtime manifest has no exact assistance payload authority.');
	}
	if (assistance.status === 'built') {
		const assistancePrefix = `runtime/${assistance.payload?.root}/`;
		if (!plainRecord(assistance.payload?.files)) {
			throw new Error('The assistance runtime manifest has no exact file closure.');
		}
		for (const [name, descriptor] of Object.entries(assistance.payload.files)) {
			requireFile(`${assistancePrefix}${name}`, descriptor,
				`assistance runtime file ${name}`, assistancePrefix);
		}
	} else if (assistance.status !== 'unsupported' || assistance.payload !== null) {
		throw new Error('The desktop runtime manifest has invalid assistance target state.');
	}
	if (runtime.productId === 'framescaper') {
		const hosts = runtime.framescaperNativeHosts;
		if (!plainRecord(hosts) || hosts.target !== native.target) {
			throw new Error('The Framescaper runtime manifest has no native-host content authority.');
		}
		for (const [key, prefix] of [
			['mediaHost', `runtime/native/framescaper-media-host/${native.target}/`],
			['openFxHost', `runtime/native/framescaper-openfx-host/${native.target}/`],
		]) {
			const host = hosts[key];
			const label = key === 'mediaHost' ? 'media-host' : 'OpenFX';
			if (!plainRecord(host) || !Array.isArray(host.payloads)) throw new Error(
				`The Framescaper ${key} content authority is invalid.`);
			if (!Object.hasOwn(host, 'reviewPolicy')
				|| !Object.hasOwn(host, 'productionReadiness')) throw new Error(
				`Framescaper ${key} content authority omits release-readiness evidence.`);
			if (host.status === 'built') {
				if (key === 'mediaHost' && (
					host.productionReadiness === null
					|| host.productionReadiness?.reference?.target !== native.target
					|| host.productionReadiness?.verified?.status !== 'authenticated'
					|| host.productionReadiness?.verified?.evidence?.target !== native.target
				)) throw new Error(
					'Built Framescaper mediaHost requires exact authenticated production-readiness evidence.');
				for (const descriptor of host.payloads) {
					requireFile(`${prefix}${descriptor.name}`, descriptor,
						`Framescaper ${key} payload`, prefix);
				}
				requireFile(`${prefix}${host.reviewPolicy?.name}`, host.reviewPolicy,
					`Framescaper ${label} native-isolation review policy`, prefix);
				if (host.productionReadiness !== null) {
					requireFile(`${prefix}${host.productionReadiness?.evidence?.name}`,
						host.productionReadiness?.evidence,
						`Framescaper ${label} production-readiness evidence`, prefix);
				}
			} else if (host.status !== 'pending-external' || host.payloads.length !== 0) {
				throw new Error(`Invalid Framescaper ${key} content state.`);
			} else if (host.reviewPolicy !== null || host.productionReadiness !== null) throw new Error(
				`Pending Framescaper ${key} carries release-readiness evidence.`);
		}
	} else if (runtime.framescaperNativeHosts !== null
		&& runtime.framescaperNativeHosts !== undefined) {
		throw new Error('The Soundscaper runtime manifest carries Framescaper native-host authority.');
	}

	const translations = runtime.translations;
	if (!plainRecord(translations)) throw new Error('The desktop runtime manifest has no translation authority.');
	for (const [label, descriptor] of [
		['latest', translations.latest], ['manifest', translations.manifest], ['source', translations.source],
	]) {
		if (plainRecord(descriptor) && typeof descriptor.path === 'string') {
			requireFile(`runtime/translations/audacity/4/${descriptor.path}`, descriptor,
				`translation ${label}`);
		}
	}

	for (const [prefix, expected] of expectedByPrefix) {
		const actual = [...inventory.keys()].filter((path) => path.startsWith(prefix));
		if (actual.length !== expected.size || actual.some((path) => !expected.has(path))) {
			throw new Error(`The installed desktop resource closure has unexpected files under ${prefix}.`);
		}
	}
}
async function collectClosure(root, excludedName) {
	const files = [];
	let totalBytes = 0;
	async function visit(directory, prefix) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			if (prefix === '' && entry.name === excludedName) continue;
			assertPortableSegment(entry.name);
			const path = resolve(directory, entry.name);
			const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isSymbolicLink()) {
				throw new Error(`The desktop resource closure contains symbolic entry ${name}.`);
			}
			if (entry.isDirectory()) {
				await visit(path, name);
				continue;
			}
			if (!entry.isFile()) throw new Error(`The desktop resource closure contains special entry ${name}.`);
			const descriptor = await describeFile(path, name);
			files.push(descriptor);
			totalBytes += descriptor.byteLength;
			if (files.length > MAXIMUM_FILES || totalBytes > MAXIMUM_TOTAL_BYTES) {
				throw new Error('The desktop resource closure exceeds its admission budget.');
			}
		}
	}
	await visit(root, '');
	return files;
}
async function describeFile(path, name) {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink()
		|| !Number.isSafeInteger(before.size) || before.size < 1 || before.size > MAXIMUM_FILE_BYTES) {
		throw new Error(`The desktop resource ${name} is not an admitted regular file.`);
	}
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error(`The desktop resource ${name} changed while opening.`);
		}
		const hash = createHash('sha256');
		let byteLength = 0;
		for await (const chunk of handle.createReadStream({ autoClose: false })) {
			byteLength += chunk.byteLength;
			if (byteLength > MAXIMUM_FILE_BYTES) throw new Error(`The desktop resource ${name} is too large.`);
			hash.update(chunk);
		}
		const after = await handle.stat();
		if (byteLength !== before.size || after.size !== opened.size
			|| after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
			throw new Error(`The desktop resource ${name} changed while hashing.`);
		}
		return { path: name, byteLength, sha256: hash.digest('hex') };
	} finally {
		await handle?.close();
	}
}

async function findManifest(root) {
	const matches = [];
	let visited = 0;
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			visited += 1;
			if (visited > MAXIMUM_FILES) throw new Error('The extracted package inventory exceeds its limit.');
			const path = resolve(directory, entry.name);
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile() && entry.name === DESKTOP_PACKAGE_CONTENT_MANIFEST_NAME) matches.push(path);
		}
	}
	await visit(root);
	return matches;
}

async function validateInstalledLayout({ extraction, resourcesRoot, productId, targetId }) {
	const productName = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	let executable;
	let applicationRoot;
	if (targetId.startsWith('linux-')) {
		if (basename(resourcesRoot) !== 'resources') throw new Error('The Linux package resource layout is invalid.');
		applicationRoot = dirname(resourcesRoot);
		const relativeRoot = portableRelative(extraction, applicationRoot);
		if (relativeRoot !== `usr/lib/${productId}` && relativeRoot !== `opt/${productName}`) {
			throw new Error('The Linux package application layout is invalid.');
		}
		executable = resolve(applicationRoot, productId);
	} else if (targetId.startsWith('win-')) {
		if (basename(resourcesRoot) !== 'resources') throw new Error('The Windows package resource layout is invalid.');
		applicationRoot = dirname(resourcesRoot);
		const relativeRoot = portableRelative(extraction, applicationRoot);
		if (relativeRoot !== '' && relativeRoot !== productName) {
			throw new Error('The Windows package application layout is invalid.');
		}
		executable = resolve(applicationRoot, `${productName}.exe`);
	} else {
		const contents = dirname(resourcesRoot);
		applicationRoot = dirname(contents);
		if (basename(resourcesRoot) !== 'Resources' || basename(contents) !== 'Contents'
			|| basename(dirname(contents)) !== `${productName}.app`
			|| portableRelative(extraction, resourcesRoot) !== `${productName}.app/Contents/Resources`) {
			throw new Error('The macOS package resource layout is invalid.');
		}
		executable = resolve(contents, 'MacOS', productName);
	}
	const metadata = await lstat(executable).catch(() => null);
	if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
		throw new Error('The extracted package does not bind the resource closure to its product executable.');
	}
	return { applicationRoot, executable };
}

async function assertExecutableArchitecture(path, targetId) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const header = Buffer.alloc(4_096);
		const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
		const bytes = header.subarray(0, bytesRead);
		let architecture = null;
		if (bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
			const machine = bytes[5] === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
			architecture = machine === 62 ? 'x64' : machine === 183 ? 'arm64' : null;
		} else if (bytes.length >= 64 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
			const peOffset = bytes.readUInt32LE(0x3c);
			const pe = Buffer.alloc(6);
			const read = await handle.read(pe, 0, pe.length, peOffset);
			if (read.bytesRead === pe.length && pe.subarray(0, 4).toString('ascii') === 'PE\0\0') {
				const machine = pe.readUInt16LE(4);
				architecture = machine === 0x8664 ? 'x64' : machine === 0xaa64 ? 'arm64' : null;
			}
		} else if (bytes.length >= 8) {
			const magic = bytes.readUInt32LE(0);
			if (magic === 0xfeedfacf || magic === 0xcffaedfe) {
				const cpu = magic === 0xfeedfacf ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4);
				architecture = cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : null;
			}
		}
		if (architecture !== targetId.split('-')[1]) {
			throw new Error(`The installed product executable does not authenticate ${targetId} architecture.`);
		}
	} finally {
		await handle?.close();
	}
}

function validateContentManifest(value, productId, targetId) {
	if (!plainRecord(value) || value.schemaVersion !== 1 || value.status !== 'installed-resource-closure-audited'
		|| value.productId !== productId || value.targetId !== targetId
		|| typeof value.applicationVersion !== 'string' || value.applicationVersion.length < 1
		|| (value.sourceRevision !== null && !SOURCE_REVISION.test(String(value.sourceRevision)))
		|| !plainRecord(value.runtimeManifest) || !Array.isArray(value.files)
		|| !Number.isSafeInteger(value.fileCount) || value.fileCount < 1 || value.fileCount > MAXIMUM_FILES
		|| !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 1 || value.totalBytes > MAXIMUM_TOTAL_BYTES
		|| typeof value.closureSha256 !== 'string' || !SHA256.test(value.closureSha256)) {
		throw new Error('The embedded package-content manifest has an invalid shape.');
	}
	if (value.files.length !== value.fileCount || value.files.some((file) => (
		!plainRecord(file) || typeof file.path !== 'string' || !safeRelativePath(file.path)
		|| !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > MAXIMUM_FILE_BYTES
		|| typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)
	))) throw new Error('The embedded package-content file inventory is invalid.');
}

function validateRuntimeManifest(value, productId, targetId) {
	const [platform, arch] = targetId.split('-');
	if (!plainRecord(value) || value.schemaVersion !== 1 || value.productId !== productId
		|| value.target?.platform !== platform || value.target?.arch !== arch
		|| typeof value.applicationVersion !== 'string' || value.applicationVersion.length < 1
		|| (value.sourceRevision !== null && !SOURCE_REVISION.test(String(value.sourceRevision)))) {
		throw new Error('The desktop runtime manifest has invalid package identity.');
	}
}

function canonicalJson(bytes, label) {
	let value;
	try { value = JSON.parse(bytes.toString('utf8')); } catch (error) {
		throw new Error(`The ${label} is not valid JSON.`, { cause: error });
	}
	if (!bytes.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))) {
		throw new Error(`The ${label} is not canonical JSON.`);
	}
	return value;
}

async function canonicalDirectory(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The ${label} must be an absolute normalized path.`);
	}
	const metadata = await lstat(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(value) !== value) {
		throw new Error(`The ${label} must be a canonical regular directory.`);
	}
	return value;
}

async function boundedRead(path, maximum, label) {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximum) {
		throw new Error(`The ${label} is not an admitted regular file.`);
	}
	return readFile(path);
}

function boundedBytes(value, maximum, label) {
	const bytes = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : null;
	if (bytes === null || bytes.byteLength < 1 || bytes.byteLength > maximum) {
		throw new TypeError(`The ${label} bytes are invalid.`);
	}
	return bytes;
}

function directPath(root, name, label) {
	const path = resolve(root, name);
	if (dirname(path) !== root || basename(path) !== name) throw new TypeError(`The ${label} path is invalid.`);
	return path;
}

async function assertAbsent(path) {
	try { await lstat(path); } catch (error) {
		if (error.code === 'ENOENT') return;
		throw error;
	}
	throw new Error('The desktop package-content manifest already exists.');
}

function identity(productId, targetId) {
	if (!PRODUCTS.includes(productId) || !TARGETS.includes(targetId)) {
		throw new TypeError('The desktop package-content identity is invalid.');
	}
}

function portableRelative(root, path) { return relative(root, path).split(sep).join('/'); }
function contained(root, candidate) {
	const path = relative(root, candidate);
	return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
function assertPortableSegment(value) {
	if (value === '.' || value === '..' || value.includes('/') || value.includes('\\')
		|| hasControlCharacter(value) || Buffer.byteLength(value, 'utf8') > 255) {
		throw new Error('The desktop resource closure contains an unsafe path segment.');
	}
}
function safeRelativePath(value) {
	return value.length > 0 && value.length <= 4_096 && !value.startsWith('/') && !value.includes('\\')
		&& value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'
			&& !hasControlCharacter(segment));
}
function hasControlCharacter(value) {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint <= 0x1f || codePoint === 0x7f;
	});
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function plainRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const member of Object.values(value)) deepFreeze(member);
	return Object.freeze(value);
}
