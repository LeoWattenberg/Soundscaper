/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync,
	openSync, readFileSync, readdirSync, readSync, realpathSync, rmSync, writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import {
	EXTRACTED_SOURCE_TREE_ALGORITHM,
	collectExtractedSourceTree,
} from '../../native/framescaper-media-host/build/source-authentication.mjs';
import { authenticateMilestone5SourceArchiveExtraction } from './milestone-5-source-archive-extraction.mjs';
import {
	authenticateMilestone5SourceArchive as authenticateArchive,
	canonicalMilestone5SourceDirectory as canonicalDirectory,
} from './milestone-5-source-filesystem-authority.mjs';
import { milestone5EngineeringScope } from './milestone-5-product-scope.mjs';

export const MILESTONE_5_NATIVE_SOURCE_ACQUISITIONS =
	'config/milestone-5-native-source-acquisitions.json';

export const MILESTONE_5_NATIVE_SOURCE_IDS = Object.freeze([
	'electron-node-api-headers',
	'juce',
	'clap',
	'vst3-sdk',
	'asio-sdk',
	'lv2',
	'x264',
	'x265',
	'libvpx',
	'libopus',
]);

const DELEGATED_SOURCE_IDS = Object.freeze([
	'boost-multiprecision',
	'ffmpeg',
	'ffmpeg-external-libraries',
	'openfx',
	'pipewire-public-headers',
]);
export const MILESTONE_5_NATIVE_DELEGATED_SOURCE_PATHS = Object.freeze([
	'config/boost-multiprecision-source-manifest.json',
	'native/framescaper-media-host/source-manifest.json',
	'native/framescaper-media-host/build/ffmpeg-9.0.1-external-sources.json',
	'native/framescaper-openfx-host/source-manifest.json',
	'vendor/pipewire-headers/UPSTREAM',
]);
const COMMIT_PATTERN = /^[a-f\d]{40}$/u;
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const SAFE_REPOSITORY_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z\d._/-]+$/u;
const SAFE_ARCHIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:tar\.gz|zip)$/u;
const AUDITED_REGISTERS = new WeakSet();
const AUTHENTICATED_SOURCE_INPUTS = new WeakSet();
const SNAPSHOTTED_SOURCE_INPUTS = new WeakSet();
const SOURCE_REGISTER_INPUTS = new WeakMap();

export function readMilestone5NativeSourceAcquisitions(
	repositoryRoot,
	manifestPath = MILESTONE_5_NATIVE_SOURCE_ACQUISITIONS,
	sourceIdsValue = MILESTONE_5_NATIVE_SOURCE_IDS,
) {
	let register;
	let manifestBytes;
	try {
		manifestBytes = readFileSync(resolve(repositoryRoot, manifestPath));
		register = JSON.parse(manifestBytes.toString('utf8'));
	} catch (error) {
		throw new Error(`Unable to read the Milestone 5 native source register: ${error.message}`, { cause: error });
	}
	validateRegister(register);
	const sourceIds = selectedSourceIds(sourceIdsValue);
	const includeDelegatedSources = sourceIds.length === MILESTONE_5_NATIVE_SOURCE_IDS.length;
	const delegatedInputs = includeDelegatedSources
		? validateDelegatedFiles(repositoryRoot, register)
		: { bytes: new Map(), inputDigests: {} };
	if (includeDelegatedSources) validateFramescaperExternalSourceClosure(register, delegatedInputs.bytes);
	const frozen = deepFreeze({
		...register,
		sources: register.sources.filter(({ id }) => sourceIds.includes(id)),
		delegatedSources: includeDelegatedSources ? register.delegatedSources : [],
	});
	SOURCE_REGISTER_INPUTS.set(frozen, deepFreeze({
		[manifestPath]: fileDescriptor(manifestBytes),
		...delegatedInputs.inputDigests,
	}));
	return frozen;
}

/**
 * Audit the exact registered source cache. An absent cache is a truthful pending
 * result; a supplied partial, symbolic, changed, or foreign cache fails closed.
 */
export function auditMilestone5NativeSourceAcquisitions(
	repositoryRoot,
	cacheRootValue = process.env.SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT,
	manifestPath = MILESTONE_5_NATIVE_SOURCE_ACQUISITIONS,
) {
	return auditSelectedMilestone5NativeSourceAcquisitions(
		repositoryRoot, cacheRootValue, manifestPath, MILESTONE_5_NATIVE_SOURCE_IDS,
	);
}

export function auditMilestone5NativeSourceAcquisitionsForProducts(
	repositoryRoot,
	productIdsValue,
	cacheRootValue = process.env.SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT,
	manifestPath = MILESTONE_5_NATIVE_SOURCE_ACQUISITIONS,
) {
	const scope = milestone5EngineeringScope(productIdsValue);
	return auditSelectedMilestone5NativeSourceAcquisitions(
		repositoryRoot, cacheRootValue, manifestPath, scope.sourceIds,
	);
}

function auditSelectedMilestone5NativeSourceAcquisitions(
	repositoryRoot,
	cacheRootValue,
	manifestPath,
	sourceIdsValue,
) {
	const sourceIds = selectedSourceIds(sourceIdsValue);
	const register = readMilestone5NativeSourceAcquisitions(repositoryRoot, manifestPath, sourceIds);
	const configured = typeof cacheRootValue === 'string' ? cacheRootValue.trim() : '';
	if (configured === '') return brandedAudit(register, null, register.sources.map((source) => ({
		...source,
		authenticationStatus: 'pending-external',
		authenticationBlockedBy: `No exact archive and extracted source tree were supplied for ${source.id}.`,
		archiveEvidence: null,
		extractedTreeEvidence: null,
	})));
	const cacheRoot = canonicalDirectory(configured, 'Milestone 5 native source cache');
	const entries = readdirSync(cacheRoot, { withFileTypes: true });
	const names = entries.map(({ name }) => name).sort();
	if (JSON.stringify(names) !== JSON.stringify([...sourceIds].sort())
		|| entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
		throw new Error('The Milestone 5 native source cache has missing or unexpected source directories.');
	}
	const witnesses = register.sources.map((source) => {
		const sourceDirectory = resolve(cacheRoot, source.id);
		const sourceEntries = readdirSync(sourceDirectory, { withFileTypes: true });
		const expected = [source.archive.fileName, 'source'].sort();
		if (JSON.stringify(sourceEntries.map(({ name }) => name).sort()) !== JSON.stringify(expected)) {
			throw new Error(`The Milestone 5 ${source.id} cache is not the exact archive/source pair.`);
		}
		return authenticateMilestone5NativeSourceInput({
			repositoryRoot,
			manifestPath,
			sourceIds,
			sourceId: source.id,
			archivePath: resolve(sourceDirectory, source.archive.fileName),
			sourceRoot: resolve(sourceDirectory, 'source'),
		});
	});
	return brandedAudit(register, cacheRoot, witnesses.map((witness) => ({
		...requireMilestone5NativeSource(register, witness.id),
		authenticationStatus: 'authenticated',
		authenticationBlockedBy: null,
		archiveEvidence: { ...witness.archive },
		extractedTreeEvidence: { ...witness.extractedTree },
	})));
}

export function isAuditedMilestone5NativeSourceAcquisitions(value) {
	return Boolean(value) && typeof value === 'object' && AUDITED_REGISTERS.has(value);
}

export function authenticateMilestone5NativeSourceInput({
	repositoryRoot,
	manifestPath = MILESTONE_5_NATIVE_SOURCE_ACQUISITIONS,
	sourceId,
	archivePath,
	sourceRoot,
	sourceIds = MILESTONE_5_NATIVE_SOURCE_IDS,
}) {
	const register = readMilestone5NativeSourceAcquisitions(repositoryRoot, manifestPath, sourceIds);
	const source = requireMilestone5NativeSource(register, sourceId);
	if (basename(String(archivePath)) !== source.archive.fileName) {
		throw new Error(`${source.id}: archive filename does not match its pin.`);
	}
	const authenticatedArchive = authenticateArchive(archivePath, source.archive, source.id);
	const archive = authenticatedArchive.descriptor;
	const archiveExtraction = authenticateMilestone5SourceArchiveExtraction({
		archiveBytes: authenticatedArchive.bytes,
		archiveName: source.archive.fileName,
		expectedTree: source.extractedTree,
	});
	const root = canonicalDirectory(sourceRoot, `${source.id} extracted source root`);
	const extractedTree = collectExtractedSourceTree(root);
	if (extractedTree.algorithm !== source.extractedTree.algorithm
		|| extractedTree.fileCount !== source.extractedTree.fileCount
		|| extractedTree.sha256 !== source.extractedTree.sha256) {
		throw new Error(`${source.id}: extracted source tree drifted from its pin.`);
	}
	const witness = deepFreeze({
		schemaVersion: 1,
		id: source.id,
		archive,
		archiveExtraction,
		extractedTree: {
			root,
			algorithm: extractedTree.algorithm,
			fileCount: extractedTree.fileCount,
			sha256: extractedTree.sha256,
		},
	});
	AUTHENTICATED_SOURCE_INPUTS.add(witness);
	return witness;
}

function selectedSourceIds(value) {
	if (!Array.isArray(value) || value.length < 1
		|| value.some((id) => !MILESTONE_5_NATIVE_SOURCE_IDS.includes(id))
		|| new Set(value).size !== value.length) {
		throw new TypeError('Milestone 5 source scope must select unique registered source IDs.');
	}
	const selected = MILESTONE_5_NATIVE_SOURCE_IDS.filter((id) => value.includes(id));
	if (JSON.stringify(selected) !== JSON.stringify(value)) {
		throw new TypeError('Milestone 5 source scope must retain canonical source order.');
	}
	return selected;
}

export function verifyMilestone5NativeSourceInput(witness) {
	if (!witness || typeof witness !== 'object' || !AUTHENTICATED_SOURCE_INPUTS.has(witness)) {
		throw new Error('Milestone 5 native source verification requires an authenticated in-process witness.');
	}
	const authenticatedArchive = authenticateArchive(witness.archive.path, witness.archive, witness.id);
	const archive = authenticatedArchive.descriptor;
	const archiveExtraction = authenticateMilestone5SourceArchiveExtraction({
		archiveBytes: authenticatedArchive.bytes,
		archiveName: basename(archive.path),
		expectedTree: witness.extractedTree,
	});
	const tree = collectExtractedSourceTree(witness.extractedTree.root);
	if (tree.algorithm !== witness.extractedTree.algorithm
		|| tree.fileCount !== witness.extractedTree.fileCount
		|| tree.sha256 !== witness.extractedTree.sha256) {
		throw new Error(`${witness.id}: extracted source tree changed after authentication.`);
	}
	return deepFreeze({ archive, archiveExtraction, extractedTree: { ...witness.extractedTree } });
}

/**
 * Copy an authenticated source tree into one exclusive auditor-owned root.
 * CMake consumes this closed copy instead of a mutable acquisition cache.
 */
export function snapshotMilestone5NativeSourceInput(witness, options) {
	if (!witness || typeof witness !== 'object' || !AUTHENTICATED_SOURCE_INPUTS.has(witness)) {
		throw new Error('Milestone 5 source snapshotting requires an authenticated in-process witness.');
	}
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(['snapshotRoot'])) {
		throw new TypeError('Milestone 5 source snapshot options require one exact snapshotRoot.');
	}
	verifyMilestone5NativeSourceInput(witness);
	const sourceTree = collectExtractedSourceTree(witness.extractedTree.root);
	assertTreeIdentity(sourceTree, witness.extractedTree,
		`${witness.id}: source tree changed before snapshotting.`);
	const snapshotRoot = exclusiveSnapshotRoot(options.snapshotRoot, witness.id);
	const directories = [snapshotRoot];
	try {
		for (const file of sourceTree.files) {
			ensureSnapshotDirectories(snapshotRoot, file.path, directories);
			copyAuthenticatedSourceFile(witness.extractedTree.root, snapshotRoot, file, witness.id);
		}
		const snapshotTree = collectExtractedSourceTree(snapshotRoot);
		assertTreeIdentity(snapshotTree, witness.extractedTree,
			`${witness.id}: auditor source snapshot drifted from its pin.`);
		for (const file of snapshotTree.files) {
			chmodSync(resolve(snapshotRoot, ...file.path.split('/')), 0o400);
		}
		for (const directory of directories.toSorted((left, right) => right.length - left.length)) {
			chmodSync(directory, 0o500);
		}
		const snapshot = deepFreeze({
			schemaVersion: 1,
			id: witness.id,
			archive: { ...witness.archive },
			archiveExtraction: { ...witness.archiveExtraction },
			extractedTree: {
				root: snapshotRoot,
				algorithm: snapshotTree.algorithm,
				fileCount: snapshotTree.fileCount,
				sha256: snapshotTree.sha256,
			},
			snapshotOf: witness.extractedTree.root,
		});
		AUTHENTICATED_SOURCE_INPUTS.add(snapshot);
		SNAPSHOTTED_SOURCE_INPUTS.add(snapshot);
		return snapshot;
	} catch (error) {
		for (const directory of directories) {
			try { chmodSync(directory, 0o700); } catch { /* Best-effort cleanup of our exact root. */ }
		}
		rmSync(snapshotRoot, { recursive: true, force: true });
		throw error;
	}
}

/** Remove only an exact source snapshot created and branded in this process. */
export function removeMilestone5NativeSourceSnapshot(snapshot) {
	if (!snapshot || typeof snapshot !== 'object' || !SNAPSHOTTED_SOURCE_INPUTS.has(snapshot)) {
		throw new Error('Milestone 5 source snapshot removal requires an auditor-owned snapshot witness.');
	}
	makeSnapshotDirectoriesWritable(snapshot.extractedTree.root);
	rmSync(snapshot.extractedTree.root, { recursive: true, force: true });
	SNAPSHOTTED_SOURCE_INPUTS.delete(snapshot);
	AUTHENTICATED_SOURCE_INPUTS.delete(snapshot);
}

function makeSnapshotDirectoriesWritable(root) {
	const metadata = lstatSync(root);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) return;
	chmodSync(root, 0o700);
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.isDirectory() && !entry.isSymbolicLink()) {
			makeSnapshotDirectoriesWritable(resolve(root, entry.name));
		}
	}
}

function exclusiveSnapshotRoot(value, sourceId) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`${sourceId}: auditor source snapshot root must be absolute and normalized.`);
	}
	canonicalDirectory(dirname(value), `${sourceId} source snapshot parent`);
	mkdirSync(value, { mode: 0o700 });
	return canonicalDirectory(value, `${sourceId} source snapshot root`);
}

function ensureSnapshotDirectories(root, sourcePath, directories) {
	let current = root;
	for (const segment of sourcePath.split('/').slice(0, -1)) {
		current = resolve(current, segment);
		if (directories.includes(current)) continue;
		mkdirSync(current, { mode: 0o700 });
		canonicalDirectory(current, 'auditor source snapshot directory');
		directories.push(current);
	}
}

function copyAuthenticatedSourceFile(sourceRoot, snapshotRoot, expected, sourceId) {
	const sourcePath = resolve(sourceRoot, ...expected.path.split('/'));
	const targetPath = resolve(snapshotRoot, ...expected.path.split('/'));
	const before = lstatSync(sourcePath);
	if (!before.isFile() || before.isSymbolicLink() || realpathSync(sourcePath) !== sourcePath) {
		throw new Error(`${sourceId}: source snapshot input ${expected.path} is not canonical.`);
	}
	const sourceHandle = openSync(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	let targetHandle;
	try {
		targetHandle = openSync(targetPath,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
			0o400);
		const opened = fstatSync(sourceHandle);
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error(`${sourceId}: source snapshot input ${expected.path} changed while opening.`);
		}
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		let byteLength = 0;
		for (;;) {
			const bytesRead = readSync(sourceHandle, buffer, 0, buffer.byteLength, null);
			if (bytesRead === 0) break;
			byteLength += bytesRead;
			hash.update(buffer.subarray(0, bytesRead));
			writeAllSync(targetHandle, buffer.subarray(0, bytesRead));
		}
		fsyncSync(targetHandle);
		const after = fstatSync(sourceHandle);
		const target = fstatSync(targetHandle);
		if (byteLength !== expected.byteLength || hash.digest('hex') !== expected.sha256
			|| after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
			|| after.ctimeMs !== opened.ctimeMs || !target.isFile() || target.size !== byteLength) {
			throw new Error(`${sourceId}: source snapshot input ${expected.path} changed while copying.`);
		}
	} finally {
		if (targetHandle !== undefined) closeSync(targetHandle);
		closeSync(sourceHandle);
	}
}

function writeAllSync(handle, bytes) {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const written = writeSync(handle, bytes, offset, bytes.byteLength - offset, null);
		if (written < 1) throw new Error('Milestone 5 source snapshot write made no progress.');
		offset += written;
	}
}

function assertTreeIdentity(actual, expected, message) {
	if (actual.algorithm !== expected.algorithm || actual.fileCount !== expected.fileCount
		|| actual.sha256 !== expected.sha256) throw new Error(message);
}

function brandedAudit(register, cacheRoot, sources) {
	const audit = deepFreeze({
		schemaVersion: 1,
		status: sources.every(({ authenticationStatus }) => authenticationStatus === 'authenticated')
			? 'authenticated' : 'pending-external',
		cacheRoot,
		groundedAt: register.groundedAt,
		purpose: register.purpose,
		sources,
		delegatedSources: register.delegatedSources.map((source) => ({ ...source })),
		inputDigests: SOURCE_REGISTER_INPUTS.get(register),
	});
	AUDITED_REGISTERS.add(audit);
	return audit;
}

function validateDelegatedFiles(repositoryRoot, register) {
	const bytes = new Map();
	const inputDigests = {};
	for (const delegated of register.delegatedSources) {
		const path = resolve(repositoryRoot, delegated.manifestPath);
		let metadata;
		try {
			metadata = lstatSync(path);
		} catch (error) {
			throw new Error(`Unable to inspect delegated native source ${delegated.id}: ${error.message}`, { cause: error });
		}
		assert(metadata.isFile() && !metadata.isSymbolicLink(),
			`Delegated native source ${delegated.id} must be a regular non-symbolic file.`);
		const value = readFileSync(path);
		bytes.set(delegated.manifestPath, value);
		inputDigests[delegated.manifestPath] = fileDescriptor(value);
	}
	return { bytes, inputDigests };
}

export function requireMilestone5NativeSource(register, sourceId) {
	const source = register.sources.find(({ id }) => id === sourceId);
	if (!source) throw new Error(`Milestone 5 native source ${sourceId} is not pinned.`);
	return source;
}

function validateRegister(register) {
	assertPlainObject(register, 'The Milestone 5 native source register');
	assert(register.schemaVersion === 1, 'The Milestone 5 native source schemaVersion must be 1.');
	assert(/^\d{4}-\d{2}-\d{2}$/u.test(register.groundedAt), 'The native source groundedAt date is invalid.');
	assert(typeof register.purpose === 'string' && register.purpose.length > 0,
		'The native source register purpose is required.');
	assertExactIds(register.sources, MILESTONE_5_NATIVE_SOURCE_IDS, 'native source');
	for (const source of register.sources) validateSource(source);
	assert(new Set(register.sources.map(({ archive }) => archive.fileName)).size === register.sources.length,
		'The native source archive filenames must be unique.');
	assertExactIds(register.delegatedSources, DELEGATED_SOURCE_IDS, 'delegated source');
	assert(JSON.stringify(register.delegatedSources.map(({ manifestPath }) => manifestPath))
		=== JSON.stringify(MILESTONE_5_NATIVE_DELEGATED_SOURCE_PATHS),
	'The delegated native source manifest paths are incomplete or reordered.');
	for (const delegated of register.delegatedSources) {
		assert(SAFE_REPOSITORY_PATH.test(delegated.manifestPath),
			`${delegated.id}: delegated manifestPath must be a repository-relative path.`);
	}
}

function validateSource(source) {
	assertPlainObject(source, 'A native source record');
	assert(typeof source.version === 'string' && source.version.length > 0, `${source.id}: version is required.`);
	assertPlainObject(source.git, `${source.id}: git`);
	assert(source.git.tag === null || (typeof source.git.tag === 'string' && source.git.tag.length > 0),
		`${source.id}: git tag must be a non-empty string or null for an untagged revision.`);
	assert(['asio-sdk', 'electron-node-api-headers'].includes(source.id)
		? source.git.commit === null && (source.id !== 'asio-sdk' || source.git.tag === null)
		: COMMIT_PATTERN.test(source.git.commit),
	`${source.id}: git provenance must be one honest full SHA-1 or an explicitly admitted vendor artifact.`);
	assertPlainObject(source.archive, `${source.id}: archive`);
	assert(/^https:\/\//u.test(source.archive.url), `${source.id}: archive URL must use HTTPS.`);
	assert(SAFE_ARCHIVE_NAME.test(source.archive.fileName), `${source.id}: archive filename is invalid.`);
	assert(Number.isSafeInteger(source.archive.byteLength) && source.archive.byteLength > 0,
		`${source.id}: archive byteLength is invalid.`);
	assert(SHA256_PATTERN.test(source.archive.sha256), `${source.id}: archive SHA-256 is invalid.`);
	assertPlainObject(source.extractedTree, `${source.id}: extractedTree`);
	assert(source.extractedTree.algorithm === EXTRACTED_SOURCE_TREE_ALGORITHM,
		`${source.id}: extracted-tree algorithm is invalid.`);
	assert(Number.isSafeInteger(source.extractedTree.fileCount) && source.extractedTree.fileCount > 0,
		`${source.id}: extracted-tree fileCount is invalid.`);
	assert(SHA256_PATTERN.test(source.extractedTree.sha256),
		`${source.id}: extracted-tree SHA-256 is invalid.`);
	assert(typeof source.license === 'string' && source.license.length > 0, `${source.id}: license is required.`);
	assert(typeof source.licenseSelection === 'string' && source.licenseSelection.length > 0,
		`${source.id}: license selection is required.`);
	assert(source.authenticationStatus === 'pinned-metadata',
		`${source.id}: checked-in metadata cannot claim runtime source authentication.`);
	assert(['blocked', 'accepted'].includes(source.activationStatus),
		`${source.id}: activation status is unsupported.`);
	assert(source.activationStatus === 'blocked'
		? typeof source.blockedBy === 'string' && source.blockedBy.length > 0
		: source.blockedBy === null,
		`${source.id}: activation status and blocker disagree.`);
	assert(Array.isArray(source.uses) && source.uses.length > 0, `${source.id}: at least one use is required.`);
}

function validateFramescaperExternalSourceClosure(register, delegatedBytes) {
	const delegated = register.delegatedSources.find(({ id }) => id === 'ffmpeg-external-libraries');
	let manifest;
	try {
		manifest = JSON.parse(delegatedBytes.get(delegated.manifestPath).toString('utf8'));
	} catch (error) {
		throw new Error(`Unable to read the delegated FFmpeg external-source manifest: ${error.message}`, { cause: error });
	}
	assert(manifest.schemaVersion === 1, 'The FFmpeg external-source schemaVersion must be 1.');
	assert(manifest.activation === 'test-enabled',
		'FFmpeg external-source activation must stay enabled for authenticated build/test use.');
	const expectedIds = ['x264', 'x265', 'libvpx', 'libopus'];
	assertExactIds(manifest.libraries, expectedIds, 'FFmpeg external library');
	for (const library of manifest.libraries) {
		const source = requireMilestone5NativeSource(register, library.id);
		assert(library.version === source.version, `${library.id}: delegated version does not match.`);
		assert(library.revision === source.git.commit, `${library.id}: delegated revision does not match.`);
		assert(library.url === source.archive.url, `${library.id}: delegated archive URL does not match.`);
		assert(library.byteLength === source.archive.byteLength,
			`${library.id}: delegated archive byteLength does not match.`);
		assert(library.sha256 === source.archive.sha256, `${library.id}: delegated archive SHA-256 does not match.`);
		assert(library.extractedTree?.algorithm === 'framescaper-portable-source-tree-sha256-v1',
			`${library.id}: extracted-tree algorithm is invalid.`);
		assert(Number.isSafeInteger(library.extractedTree.fileCount) && library.extractedTree.fileCount > 0,
			`${library.id}: extracted-tree fileCount is invalid.`);
		assert(SHA256_PATTERN.test(library.extractedTree.sha256),
			`${library.id}: extracted-tree SHA-256 is invalid.`);
		assert(library.extractedTree.algorithm === source.extractedTree.algorithm
			&& library.extractedTree.fileCount === source.extractedTree.fileCount
			&& library.extractedTree.sha256 === source.extractedTree.sha256,
		`${library.id}: delegated extracted-tree identity does not match.`);
	}
}

function fileDescriptor(bytes) {
	return {
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}

function assertExactIds(records, expectedIds, label) {
	assert(Array.isArray(records), `The ${label} records must be an array.`);
	const actual = records.map((record) => record?.id);
	assert(new Set(actual).size === actual.length, `The ${label} IDs must be unique.`);
	assert(JSON.stringify(actual) === JSON.stringify(expectedIds),
		`The ${label} IDs must be exactly ${expectedIds.join(', ')}.`);
}

function assertPlainObject(value, label) {
	assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
