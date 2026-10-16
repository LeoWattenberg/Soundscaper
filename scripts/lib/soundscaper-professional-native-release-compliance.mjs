/* SPDX-License-Identifier: AGPL-3.0-only */

/** Stable-release notices and corresponding-source archives for the five verified targets. */

import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import sourceRegisterDefault from '../../config/milestone-5-native-source-acquisitions.json' with { type: 'json' };
import {
	SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS,
} from './soundscaper-professional-native-build-result-contract.mjs';
import {
	assertSoundscaperProfessionalNativePackageNoticeSummary,
	readSoundscaperProfessionalNativeNoticeFiles,
	soundscaperProfessionalNativeNoticeSummary,
} from './soundscaper-professional-native-notices.mjs';

export const SOUNDSCAPER_PROFESSIONAL_NATIVE_COMPLIANCE_NAME =
	'Soundscaper-professional-native-compliance.json';

const SOURCE_IDS = Object.freeze([
	'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'vamp-plugin-sdk', 'ara-api', 'ara-library',
	'asio-sdk', 'ladspa-sdk', 'lv2',
]);
const FORBIDDEN_SOURCE_IDS = new Set(['x264', 'x265', 'libvpx', 'libopus', 'zlib']);
const MAXIMUM_ARCHIVE_BYTES = 64 * 1024 * 1024;

export async function stageSoundscaperProfessionalNativeReleaseCompliance(options, dependencies = {}) {
	const productId = options?.productId ?? 'soundscaper';
	if (!['soundscaper', 'framescaper'].includes(productId)) throw new Error('Native compliance product is invalid.');
	const productName = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	const repositoryRoot = requiredPath(options?.repositoryRoot, 'repository root');
	const sourceRoot = requiredPath(options?.sourceRoot, 'professional-native source root');
	const outputRoot = requiredPath(options?.outputRoot, 'release asset root');
	const sourceOutputRoot = requiredPath(options?.sourceOutputRoot ?? outputRoot, 'source archive staging root');
	const evidenceRoot = requiredPath(options?.evidenceRoot ?? outputRoot, 'release compliance evidence root');
	const runtimeManifests = validateRuntimeManifests(options?.runtimeManifests, dependencies, productId);
	const sourceRegister = dependencies.sourceRegister ?? sourceRegisterDefault;
	const selectedSources = sourceRegister.sources.filter(({ id }) => SOURCE_IDS.includes(id));
	if (selectedSources.length !== SOURCE_IDS.length
		|| JSON.stringify(selectedSources.map(({ id }) => id)) !== JSON.stringify(SOURCE_IDS)) {
		throw new Error('Stable professional-native corresponding-source authority is incomplete.');
	}
	await assertExactSourceRoot(sourceRoot);
	const noticeFiles = await readSoundscaperProfessionalNativeNoticeFiles({
		repositoryRoot, sourceRoot, sourceIds: SOURCE_IDS,
	}, dependencies);
	const sources = [];
	for (const source of selectedSources) {
		const archivePath = resolve(sourceRoot, source.id, source.archive.fileName);
		const archiveBytes = await regularArchiveBytes(archivePath, source);
		const name = correspondingSourceName(source, productName);
		await writeFile(resolve(sourceOutputRoot, name), archiveBytes, { flag: 'wx', mode: 0o444 });
		sources.push(Object.freeze({
			id: source.id,
			version: source.version,
			licenseSelection: source.licenseSelection,
			archive: Object.freeze({
				name, bundlePath: `sdk/${source.id}/${source.archive.fileName}`,
				byteLength: archiveBytes.byteLength, sha256: digest(archiveBytes),
			}),
			extractedTree: Object.freeze({ ...source.extractedTree }),
		}));
	}
	const noticeAuthorities = unionNoticeAuthorities(runtimeManifests, dependencies);
	const { noticeDocument, notices } = await stageThirdPartyLicenseDocument({
		repositoryRoot, outputRoot, noticeAuthorities, noticeFiles, sourceRegister,
	});
	const targetBindings = runtimeManifests.map(({ name, value, bytes, target }) => Object.freeze({
		target,
		runtimeManifest: Object.freeze({ name, byteLength: bytes.byteLength, sha256: digest(bytes) }),
		sourceAuthenticationSha256: digest(Buffer.from(stableJson(
			value.soundscaperProfessionalNative.sourceAuthentication,
		))),
		noticeInventorySha256: digest(Buffer.from(stableJson(
			value.desktopNotices.professionalNative,
		))),
	}));
	const compliance = deepFreeze({
		schemaVersion: 2,
		status: 'authenticated',
		kind: `${productId}-professional-native-release-compliance`,
		sources,
		noticeDocument,
		notices,
		targetBindings,
	});
	await writeFile(resolve(evidenceRoot, `${productName}-professional-native-compliance.json`),
		Buffer.from(`${JSON.stringify(compliance, null, 2)}\n`), { flag: 'wx', mode: 0o444 });
	return compliance;
}

async function stageThirdPartyLicenseDocument({
	repositoryRoot, outputRoot, noticeAuthorities, noticeFiles, sourceRegister,
}) {
	const name = 'THIRD_PARTY_LICENSES.md';
	const parts = [await readFile(resolve(repositoryRoot, name)), Buffer.from(
		'\n\n## Professional-native license texts\n\n'
		+ 'These authenticated upstream notices cover the desktop targets in this release.\n'
		+ 'The professional-native compliance receipts record each text\'s byte offset and SHA-256 digest.\n',
	)];
	let byteOffset = parts.reduce((total, part) => total + part.byteLength, 0);
	const notices = [];
	for (const authority of noticeAuthorities) {
		const file = noticeFiles.get(authority.name);
		if (!file || file.byteLength !== authority.byteLength || file.sha256 !== authority.sha256) {
			throw new Error(`Stable professional-native notice ${authority.name} is not authenticated.`);
		}
		const source = sourceRegister.sources.find(({ id }) => id === authority.sourceId);
		let fenceLength = 3;
		for (const match of file.bytes.toString('utf8').matchAll(/`+/gu)) {
			fenceLength = Math.max(fenceLength, match[0].length + 1);
		}
		const fence = '`'.repeat(fenceLength);
		const prefix = Buffer.from(`\n### ${authority.name}\n\n`
			+ `Source: ${source.id} ${source.version}; selected license: ${source.licenseSelection}.\n\n${fence}text\n`);
		const suffix = Buffer.from(`\n${fence}\n`);
		notices.push({
			installedName: authority.name, sourceId: authority.sourceId,
			byteOffset: byteOffset + prefix.byteLength, byteLength: file.byteLength, sha256: file.sha256,
		});
		parts.push(prefix, file.bytes, suffix);
		byteOffset += prefix.byteLength + file.byteLength + suffix.byteLength;
	}
	const bytes = Buffer.concat(parts);
	const destination = resolve(outputRoot, name);
	try {
		await writeFile(destination, bytes, { flag: 'wx', mode: 0o444 });
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;
		// Both products in a suite share the same five-target notice inventory.
		// Reuse only an exact document previously staged into this release.
		const metadata = await lstat(destination);
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new Error('The release third-party license document is not a regular file.', { cause: error });
		}
		const handle = await open(destination, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		try {
			if (!(await handle.readFile()).equals(bytes)) {
				throw new Error('The release third-party license document disagrees with authenticated notices.', { cause: error });
			}
		} finally {
			await handle.close();
		}
	}
	return { noticeDocument: { name, byteLength: bytes.byteLength, sha256: digest(bytes) }, notices };
}

function validateRuntimeManifests(value, authorities, productId) {
	if (!Array.isArray(value) || value.length !== SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS.length) {
		throw new Error('Stable professional-native compliance requires five runtime manifests.');
	}
	const byTarget = new Map();
	for (const manifest of value) {
		const identity = new RegExp(`^runtime-manifest-${productId}-(linux|mac|win)-(x64|arm64)\\.json$`, 'u').exec(
			String(manifest?.name),
		);
		const target = identity === null ? null : `${identity[1]}-${identity[2]}`;
		if (!SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS.includes(target) || byTarget.has(target)
			|| manifest.value?.productId !== productId
			|| `${manifest.value?.target?.platform}-${manifest.value?.target?.arch}` !== target
			|| (productId === 'framescaper' && manifest.value.soundscaperProfessionalNative?.hostingScope !== 'audio-plugin-host')
			|| manifest.value.soundscaperProfessionalNative?.target !== target
			|| manifest.value.soundscaperProfessionalNative?.status !== 'built') {
			throw new Error(`${String(manifest?.name)} is not an exact Stable Soundscaper runtime manifest.`);
		}
		assertSoundscaperProfessionalNativePackageNoticeSummary({
			summary: manifest.value.desktopNotices?.professionalNative,
			professional: manifest.value.soundscaperProfessionalNative,
			target,
		}, authorities);
		const bytes = manifest.bytes === undefined
			? Buffer.from(`${JSON.stringify(manifest.value, null, 2)}\n`)
			: Buffer.from(manifest.bytes);
		let parsed;
		try { parsed = JSON.parse(bytes.toString('utf8')); }
		catch (error) { throw new Error(`${manifest.name} bytes are not JSON.`, { cause: error }); }
		if (JSON.stringify(parsed) !== JSON.stringify(manifest.value)) {
			throw new Error(`${manifest.name} bytes disagree with the validated runtime manifest.`);
		}
		byTarget.set(target, Object.freeze({ ...manifest, bytes, target }));
	}
	return SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS.map((target) => byTarget.get(target));
}

function unionNoticeAuthorities(runtimeManifests, authorities) {
	const notices = new Map();
	for (const { target, value } of runtimeManifests) {
		const summary = soundscaperProfessionalNativeNoticeSummary({
			target, sourceAuthentication: value.soundscaperProfessionalNative.sourceAuthentication,
		}, authorities);
		for (const notice of summary.notices) {
			const existing = notices.get(notice.name);
			if (existing && JSON.stringify(existing) !== JSON.stringify(notice)) {
				throw new Error(`Stable professional-native notice ${notice.name} has target drift.`);
			}
			notices.set(notice.name, notice);
		}
	}
	return [...notices.values()].sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

async function assertExactSourceRoot(root) {
	const metadata = await lstat(root).catch(() => null);
	if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error('Stable professional-native source root is not a regular directory.');
	}
	const entries = await readdir(root, { withFileTypes: true });
	const names = entries.map(({ name }) => name).sort();
	if (entries.some((entry) => entry.isSymbolicLink() || !entry.isDirectory())
		|| entries.some(({ name }) => FORBIDDEN_SOURCE_IDS.has(name))
		|| JSON.stringify(names) !== JSON.stringify([...SOURCE_IDS].sort())) {
		throw new Error(`Stable professional-native source root has missing or unexpected input: ${names.join(', ')}.`);
	}
}

async function regularArchiveBytes(path, source) {
	const before = await lstat(path).catch(() => null);
	if (!before?.isFile() || before.isSymbolicLink() || before.size < 1
		|| before.size > MAXIMUM_ARCHIVE_BYTES || before.size !== source.archive.byteLength) {
		throw new Error(`Professional-native ${source.id} corresponding-source archive is not a regular file.`);
	}
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size) {
			throw new Error(`Professional-native ${source.id} archive changed while opening.`);
		}
		const bytes = await handle.readFile();
		const after = await handle.stat();
		if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
			|| after.ctimeMs !== opened.ctimeMs || digest(bytes) !== source.archive.sha256) {
			throw new Error(`Professional-native ${source.id} archive failed authentication.`);
		}
		return bytes;
	} finally { await handle?.close(); }
}

function correspondingSourceName(source, productName) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(source.archive.fileName)
		|| !SOURCE_IDS.includes(source.id)) {
		throw new Error('Professional-native corresponding-source filename is invalid.');
	}
	return `${productName}-professional-native-source-${source.id}-${source.archive.fileName}`;
}

function requiredPath(value, label) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required.`);
	return resolve(value);
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.keys(value).sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	return JSON.stringify(value);
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const member of Object.values(value)) deepFreeze(member);
	return Object.freeze(value);
}
