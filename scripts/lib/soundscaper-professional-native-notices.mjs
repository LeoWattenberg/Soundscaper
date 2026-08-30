/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed notice authority shared by Stable package staging and release assembly. */

import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import noticeRegisterDefault from '../../config/soundscaper-professional-native-notices.json' with { type: 'json' };
import sourceRegisterDefault from '../../config/milestone-5-native-source-acquisitions.json' with { type: 'json' };
import { authenticateMilestone5NativeSourceInput } from './milestone-5-native-source-acquisitions.mjs';
import {
	SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS,
	soundscaperProfessionalNativeSourceIdsForTarget,
} from './soundscaper-professional-native-candidate-contract.mjs';

export const SOUNDSCAPER_PROFESSIONAL_NATIVE_NOTICE_PREFIX = 'licenses/professional-native/';
export const SOUNDSCAPER_PROFESSIONAL_NATIVE_NOTICE_MANIFEST_PATH =
	'config/soundscaper-professional-native-notices.json';

const ALL_SOURCE_IDS = Object.freeze([
	'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2',
]);
const FORBIDDEN_SOURCE_IDS = new Set(['x264', 'x265', 'libvpx', 'libopus']);
const SHA256 = /^[a-f\d]{64}$/u;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const MAXIMUM_NOTICE_BYTES = 2 * 1024 * 1024;

export function soundscaperProfessionalNativeNoticeSummary(input, authorities = {}) {
	const target = targetId(input?.target);
	const sourceRegister = authorities.sourceRegister ?? sourceRegisterDefault;
	const noticeRegister = authorities.noticeRegister ?? noticeRegisterDefault;
	validateAuthorities(sourceRegister, noticeRegister);
	const expectedIds = soundscaperProfessionalNativeSourceIdsForTarget(target);
	const authentication = validateSourceAuthentication(
		input?.sourceAuthentication, target, expectedIds, sourceRegister,
	);
	const sources = expectedIds.map((id) => {
		const registered = one(sourceRegister.sources, id, 'native source');
		const authenticated = one(authentication.sources, id, 'source-authentication receipt');
		return Object.freeze({
			id,
			version: registered.version,
			licenseSelection: registered.licenseSelection,
			archiveEvidence: Object.freeze({ ...authenticated.archiveEvidence }),
			extractedTreeEvidence: Object.freeze({ ...authenticated.extractedTreeEvidence }),
		});
	});
	const notices = [];
	for (const id of expectedIds) {
		const authority = one(noticeRegister.sources, id, 'notice source');
		for (const notice of authority.notices) {
			const existing = notices.find(({ name }) => name === notice.name);
			if (existing) {
				if (existing.byteLength !== notice.byteLength || existing.sha256 !== notice.sha256) {
					throw new Error(`Professional-native notice ${notice.name} has conflicting authority.`);
				}
				continue;
			}
			notices.push(Object.freeze({
				name: notice.name,
				byteLength: notice.byteLength,
				sha256: notice.sha256,
				sourceId: id,
			}));
		}
	}
	return deepFreeze({
		schemaVersion: 1,
		status: 'authenticated',
		target,
		inventoryId: noticeRegister.id,
		legalApproval: null,
		sources,
		notices: notices.sort((left, right) => left.name.localeCompare(right.name, 'en')),
	});
}

export function typedUnavailableSoundscaperProfessionalNativeNotices(targetValue) {
	return deepFreeze({
		schemaVersion: 1,
		status: 'typed-unavailable',
		target: targetId(targetValue),
		inventoryId: null,
		legalApproval: null,
		blockedBy: 'Professional-native installed notices are emitted only by Stable Soundscaper packaging.',
		sources: [],
		notices: [],
	});
}

export function assertSoundscaperProfessionalNativePackageNoticeSummary({
	summary, professional, target, requireFile,
}, authorities = {}) {
	const expected = soundscaperProfessionalNativeNoticeSummary({
		target, sourceAuthentication: professional?.sourceAuthentication,
	}, authorities);
	if (JSON.stringify(summary) !== JSON.stringify(expected)) {
		throw new Error('Stable Soundscaper professional-native installed notice authority is invalid.');
	}
	if (requireFile !== undefined) {
		for (const notice of expected.notices) {
			requireFile(
				`${SOUNDSCAPER_PROFESSIONAL_NATIVE_NOTICE_PREFIX}${notice.name}`,
				{ byteLength: notice.byteLength, sha256: notice.sha256 },
				`professional-native notice ${notice.name}`,
				SOUNDSCAPER_PROFESSIONAL_NATIVE_NOTICE_PREFIX,
			);
		}
	}
	return expected;
}

export function assertTypedUnavailableSoundscaperProfessionalNativePackageNotices(summary, target) {
	const expected = typedUnavailableSoundscaperProfessionalNativeNotices(target);
	if (JSON.stringify(summary) !== JSON.stringify(expected)) {
		throw new Error('Non-Stable Soundscaper professional-native notices must remain typed-unavailable.');
	}
	return expected;
}

export function assertDesktopProfessionalNativeNoticeClosure({
	runtime, professional, target, requireFile, expectedByPrefix,
}, authorities = {}) {
	if (runtime.productId === 'soundscaper') {
		const stable = runtime.applicationVersionChannel === 'stable'
			&& runtime.releaseChannel === 'stable';
		if (stable) {
			return assertSoundscaperProfessionalNativePackageNoticeSummary({
				summary: runtime.desktopNotices?.professionalNative,
				professional, target, requireFile,
			}, authorities);
		}
		const summary = assertTypedUnavailableSoundscaperProfessionalNativePackageNotices(
			runtime.desktopNotices?.professionalNative, target,
		);
		expectedByPrefix.set(SOUNDSCAPER_PROFESSIONAL_NATIVE_NOTICE_PREFIX, new Set());
		return summary;
	}
	if (runtime.desktopNotices?.professionalNative !== null) {
		throw new Error('The Framescaper runtime manifest carries Soundscaper professional-native notices.');
	}
	expectedByPrefix.set(SOUNDSCAPER_PROFESSIONAL_NATIVE_NOTICE_PREFIX, new Set());
	return null;
}

export async function stageSoundscaperProfessionalNativePackageNotices(options, dependencies = {}) {
	const summary = soundscaperProfessionalNativeNoticeSummary(options, dependencies);
	const outputRoot = resolveRequired(options?.outputRoot, 'professional-native notice output root');
	await mkdir(outputRoot, { recursive: true });
	if ((await readdir(outputRoot)).length !== 0) {
		throw new Error('Professional-native notice output must be empty before staging.');
	}
	const files = await readSoundscaperProfessionalNativeNoticeFiles({
		...options, sourceIds: summary.sources.map(({ id }) => id),
	}, dependencies);
	for (const notice of summary.notices) {
		const file = files.get(notice.name);
		if (!file || file.byteLength !== notice.byteLength || file.sha256 !== notice.sha256) {
			throw new Error(`Professional-native notice ${notice.name} did not match its inventory.`);
		}
		await writeFile(resolve(outputRoot, notice.name), file.bytes, { flag: 'wx', mode: 0o444 });
	}
	return summary;
}

export async function readSoundscaperProfessionalNativeNoticeFiles(options, dependencies = {}) {
	const repositoryRoot = resolveRequired(options?.repositoryRoot, 'repository root');
	const sourceRoot = resolveRequired(options?.sourceRoot, 'professional-native source root');
	const sourceIds = selectedSourceIds(options?.sourceIds);
	const sourceRegister = dependencies.sourceRegister ?? sourceRegisterDefault;
	const noticeRegister = dependencies.noticeRegister ?? noticeRegisterDefault;
	validateAuthorities(sourceRegister, noticeRegister);
	const authenticateSourceInput = dependencies.authenticateSourceInput
		?? authenticateMilestone5NativeSourceInput;
	const files = new Map();
	for (const id of sourceIds) {
		const source = one(sourceRegister.sources, id, 'native source');
		const sourceDirectory = resolve(sourceRoot, id);
		await exactSourceEntry(sourceDirectory, source);
		const witness = authenticateSourceInput({
			repositoryRoot,
			sourceId: id,
			archivePath: resolve(sourceDirectory, source.archive.fileName),
			sourceRoot: resolve(sourceDirectory, 'source'),
			sourceIds,
		});
		if (witness?.id !== id
			|| witness.archive?.byteLength !== source.archive.byteLength
			|| witness.archive?.sha256 !== source.archive.sha256
			|| witness.extractedTree?.algorithm !== source.extractedTree.algorithm
			|| witness.extractedTree?.fileCount !== source.extractedTree.fileCount
			|| witness.extractedTree?.sha256 !== source.extractedTree.sha256) {
			throw new Error(`Professional-native source ${id} did not authenticate to its register.`);
		}
		const noticeAuthority = one(noticeRegister.sources, id, 'notice source');
		for (const notice of noticeAuthority.notices) {
			const base = notice.origin === 'authenticated-source'
				? resolve(sourceDirectory, 'source') : repositoryRoot;
			const path = resolveContained(base, notice.path, `${id} notice`);
			const bytes = await regularBytes(base, path, `${id} notice ${notice.name}`);
			if (bytes.byteLength !== notice.byteLength || digest(bytes) !== notice.sha256) {
				throw new Error(`Professional-native notice ${notice.name} failed authentication.`);
			}
			const existing = files.get(notice.name);
			if (existing && (existing.byteLength !== bytes.byteLength
				|| existing.sha256 !== notice.sha256 || !existing.bytes.equals(bytes))) {
				throw new Error(`Professional-native notice ${notice.name} has conflicting bytes.`);
			}
			files.set(notice.name, Object.freeze({
				name: notice.name, byteLength: bytes.byteLength,
				sha256: notice.sha256, bytes,
			}));
		}
	}
	return files;
}

function validateAuthorities(sourceRegister, noticeRegister) {
	if (sourceRegister?.schemaVersion !== 1 || !Array.isArray(sourceRegister.sources)) {
		throw new Error('The professional-native source register is invalid.');
	}
	if (noticeRegister?.schemaVersion !== 1 || noticeRegister.legalApproval !== null
		|| typeof noticeRegister.id !== 'string' || !SAFE_NAME.test(noticeRegister.id)
		|| !Array.isArray(noticeRegister.sources)
		|| JSON.stringify(noticeRegister.sources.map(({ id }) => id).sort())
			!== JSON.stringify([...ALL_SOURCE_IDS].sort())) {
		throw new Error('The professional-native notice inventory is invalid.');
	}
	for (const authority of noticeRegister.sources) {
		if (FORBIDDEN_SOURCE_IDS.has(authority.id)
			|| JSON.stringify([...authority.targets].sort()) !== JSON.stringify(
				SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS.filter((target) =>
					soundscaperProfessionalNativeSourceIdsForTarget(target).includes(authority.id)).sort(),
			)
			|| !Array.isArray(authority.notices) || authority.notices.length < 1) {
			throw new Error(`Professional-native notice source ${authority.id} has invalid scope.`);
		}
		for (const notice of authority.notices) validateNotice(notice, authority.id);
	}
}

function validateSourceAuthentication(value, target, expectedIds, register) {
	if (value?.schemaVersion !== 1 || value.status !== 'authenticated'
		|| !Array.isArray(value.sources) || value.sources.length !== expectedIds.length
		|| JSON.stringify(value.sources.map(({ id }) => id)) !== JSON.stringify(expectedIds)) {
		throw new Error(`Professional-native ${target} source authentication has invalid scope.`);
	}
	for (const receipt of value.sources) {
		const source = one(register.sources, receipt.id, 'native source');
		if (receipt.authenticationStatus !== 'authenticated'
			|| receipt.archiveEvidence?.byteLength !== source.archive?.byteLength
			|| receipt.archiveEvidence?.sha256 !== source.archive?.sha256
			|| JSON.stringify(receipt.extractedTreeEvidence) !== JSON.stringify(source.extractedTree)) {
			throw new Error(`Professional-native ${receipt.id} source authentication disagrees with its archive register.`);
		}
	}
	return value;
}

function validateNotice(notice, sourceId) {
	if (!notice || !SAFE_NAME.test(String(notice.name))
		|| !['authenticated-source', 'repository', 'repository-dependency'].includes(notice.origin)
		|| !safeRelativePath(notice.path)
		|| !Number.isSafeInteger(notice.byteLength) || notice.byteLength < 1
		|| notice.byteLength > MAXIMUM_NOTICE_BYTES || !SHA256.test(String(notice.sha256))) {
		throw new Error(`Professional-native ${sourceId} notice authority is invalid.`);
	}
}

async function exactSourceEntry(directory, source) {
	const metadata = await lstat(directory).catch(() => null);
	if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error(`Professional-native source ${source.id} is not a regular directory.`);
	}
	const entries = await readdir(directory, { withFileTypes: true });
	const expected = [source.archive.fileName, 'source'].sort();
	if (entries.some((entry) => entry.isSymbolicLink())
		|| JSON.stringify(entries.map(({ name }) => name).sort()) !== JSON.stringify(expected)
		|| !entries.find(({ name }) => name === source.archive.fileName)?.isFile()
		|| !entries.find(({ name }) => name === 'source')?.isDirectory()) {
		throw new Error(`Professional-native source ${source.id} is not the exact archive/source pair.`);
	}
}

async function regularBytes(root, path, label) {
	await assertNoSymbolicSegments(root, path, label);
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1
		|| before.size > MAXIMUM_NOTICE_BYTES) throw new Error(`${label} is not a regular file.`);
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size) throw new Error(`${label} changed while opening.`);
		const bytes = await handle.readFile();
		const after = await handle.stat();
		if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
			|| after.ctimeMs !== opened.ctimeMs) throw new Error(`${label} changed while reading.`);
		return bytes;
	} finally { await handle?.close(); }
}

async function assertNoSymbolicSegments(root, path, label) {
	const canonicalRoot = await realpath(root);
	const rel = relative(canonicalRoot, path);
	if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`${label} escaped its root.`);
	let cursor = canonicalRoot;
	for (const segment of rel.split(sep)) {
		cursor = resolve(cursor, segment);
		if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`${label} contains a symbolic path.`);
	}
}

function resolveContained(root, path, label) {
	if (!safeRelativePath(path)) throw new Error(`${label} path is invalid.`);
	const value = resolve(root, path);
	const rel = relative(root, value);
	if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`${label} escaped its root.`);
	return value;
}

function selectedSourceIds(value) {
	if (!Array.isArray(value) || value.length < 1 || new Set(value).size !== value.length
		|| value.some((id) => !ALL_SOURCE_IDS.includes(id))) {
		throw new Error('Professional-native notice source scope is invalid.');
	}
	return value;
}

function targetId(value) {
	if (!SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS.includes(value)) {
		throw new Error('Professional-native notice target is invalid.');
	}
	return value;
}

function one(rows, id, label) {
	const matches = rows.filter((entry) => entry?.id === id);
	if (matches.length !== 1) throw new Error(`The ${label} inventory has no exact ${id} row.`);
	return matches[0];
}

function safeRelativePath(value) {
	return typeof value === 'string' && value.length > 0 && !value.includes('\\')
		&& !value.startsWith('/') && !value.split('/').includes('..');
}

function resolveRequired(value, label) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required.`);
	return resolve(value);
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const member of Object.values(value)) deepFreeze(member);
	return Object.freeze(value);
}
