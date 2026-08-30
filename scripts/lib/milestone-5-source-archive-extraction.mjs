/* SPDX-License-Identifier: AGPL-3.0-only */

/** Safe, non-executing source-archive extraction and portable tree identity. */

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import {
	existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
	realpathSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

import { extract as extractTar, list as listTar } from 'tar';

import { collectExtractedSourceTree } from '../../native/framescaper-media-host/build/source-authentication.mjs';
import { claimPathExclusively } from './exclusive-rename.mjs';

const MAXIMUM_ENTRIES = 100_000;
const MAXIMUM_FILE_BYTES = 512 * 1024 * 1024;
const MAXIMUM_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
const MAXIMUM_ZIP_BYTES = 512 * 1024 * 1024;

export function authenticateMilestone5SourceArchiveExtraction(request) {
	// Resolved once: macOS reports a temporary directory under /var, which is a
	// symbolic link to /private/var, and every path derived from it would then
	// fail the canonical-directory rule the extracted tree is authenticated by.
	const staging = realpathSync(mkdtempSync(resolve(tmpdir(), 'm5-source-archive-')));
	try {
		return extractAuthenticatedSourceArchive(request, staging).evidence;
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * Authenticate one archive and leave its verified tree at `destinationRoot`.
 *
 * Provisioning a source cache needs the extracted bytes the auditor later
 * re-reads, and the auditor accepts nothing it did not verify itself, so the
 * tree is built in a staging directory beside its destination and renamed into
 * place only after it matches its pin. The rename is therefore one atomic
 * same-filesystem move: a cache never holds a half-written tree, and an
 * existing destination is never overwritten.
 */
export async function materializeMilestone5SourceArchive(
	{ destinationRoot: destinationValue, ...request },
	{ claim = claimPathExclusively } = {},
) {
	if (typeof destinationValue !== 'string' || !isAbsolute(destinationValue)) {
		throw new TypeError('Milestone 5 source materialization requires one absolute destination root.');
	}
	const destinationRoot = resolve(destinationValue);
	const parent = dirname(destinationRoot);
	const parentMetadata = lstatSync(parent);
	if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || realpathSync(parent) !== parent) {
		throw new Error(`The Milestone 5 source destination parent ${parent} must be one canonical directory.`);
	}
	if (existsSync(destinationRoot)) {
		throw new Error(`The Milestone 5 source destination ${destinationRoot} already exists.`);
	}
	const staging = mkdtempSync(`${destinationRoot}.staging-`);
	try {
		const { evidence, extractionRoot } = extractAuthenticatedSourceArchive(request, staging);
		await claim(extractionRoot, destinationRoot, 'Milestone 5 source destination');
		const tree = collectExtractedSourceTree(destinationRoot);
		if (tree.algorithm !== evidence.algorithm || tree.fileCount !== evidence.fileCount
			|| tree.sha256 !== evidence.sha256) {
			rmSync(destinationRoot, { recursive: true, force: true });
			throw new Error('The materialized Milestone 5 source tree drifted from its authenticated identity.');
		}
		return evidence;
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * Extract one archive inside a caller-owned staging directory and authenticate
 * the result against its pinned portable tree identity. The single extraction
 * implementation both callers above share, so a materialized cache carries the
 * exact bytes the audit path verified.
 */
function extractAuthenticatedSourceArchive({
	archiveBytes: archiveBytesValue,
	archiveName,
	expectedTree,
}, staging) {
	validateExpectedTree(expectedTree);
	if (!Buffer.isBuffer(archiveBytesValue) || archiveBytesValue.byteLength < 1
		|| archiveBytesValue.byteLength > MAXIMUM_ZIP_BYTES) {
		throw new TypeError('Milestone 5 source extraction requires bounded authenticated archive bytes.');
	}
	if (typeof archiveName !== 'string' || basename(archiveName) !== archiveName
		|| (!archiveName.endsWith('.tar.gz') && extname(archiveName).toLowerCase() !== '.zip')) {
		throw new TypeError('Milestone 5 source extraction requires one safe .tar.gz or .zip archive name.');
	}
	// Copy caller-owned storage once. Every parser below consumes the same
	// auditor-owned snapshot, so a mutable source pathname cannot swap the bytes
	// between archive hashing, inventory, and extraction.
	const archiveBytes = Buffer.from(archiveBytesValue);
	const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');
	const archivePath = resolve(staging, archiveName);
	writeFileSync(archivePath, archiveBytes, { flag: 'wx', mode: 0o400 });
	const extractionRoot = resolve(staging, 'source');
	mkdirSync(extractionRoot);
	const inventory = archivePath.endsWith('.tar.gz')
		? extractTarGzip(archivePath, extractionRoot)
		: extname(archivePath).toLowerCase() === '.zip'
			? extractZip(archivePath, extractionRoot)
			: (() => { throw new Error('Milestone 5 source archives must be .tar.gz or .zip.'); })();
	const tree = collectExtractedSourceTree(extractionRoot);
	const actualPaths = tree.files.map(({ path }) => path);
	if (JSON.stringify(actualPaths) !== JSON.stringify(inventory.filePaths)
		|| tree.algorithm !== expectedTree.algorithm
		|| tree.fileCount !== expectedTree.fileCount
		|| tree.sha256 !== expectedTree.sha256) {
		throw new Error('The source archive extraction drifted from its pinned portable tree identity.');
	}
	const snapshotMetadata = lstatSync(archivePath);
	const snapshotBytes = readFileSync(archivePath);
	if (!snapshotMetadata.isFile() || snapshotMetadata.isSymbolicLink()
		|| realpathSync(archivePath) !== archivePath
		|| snapshotBytes.byteLength !== archiveBytes.byteLength
		|| createHash('sha256').update(snapshotBytes).digest('hex') !== archiveSha256) {
		throw new Error('The authenticated source archive snapshot changed during extraction.');
	}
	return {
		extractionRoot,
		evidence: Object.freeze({
			archiveByteLength: archiveBytes.byteLength,
			archiveSha256,
			algorithm: tree.algorithm,
			fileCount: tree.fileCount,
			sha256: tree.sha256,
			archiveEntryCount: inventory.entryCount,
			expandedByteLength: inventory.expandedByteLength,
		}),
	};
}

function extractTarGzip(archivePath, extractionRoot) {
	const entries = [];
	listTar({
		file: archivePath,
		sync: true,
		strict: true,
		onentry(entry) {
			entries.push({
				path: archivePathValue(entry.path),
				type: entry.type,
				size: entry.size,
				linkpath: entry.linkpath,
			});
		},
	});
	const inventory = normalizeInventory(entries);
	extractTar({
		file: archivePath,
		cwd: extractionRoot,
		sync: true,
		strict: true,
		preservePaths: false,
		strip: inventory.strip,
	});
	materializeTarSymlinks(extractionRoot, inventory.symlinks);
	return inventory;
}

function normalizeInventory(entries) {
	if (entries.length < 1 || entries.length > MAXIMUM_ENTRIES) {
		throw new Error('The source archive entry count is outside its admission budget.');
	}
	for (const entry of entries) {
		if (!['File', 'Directory', 'SymbolicLink'].includes(entry.type)) {
			throw new Error(`The source archive contains unsupported ${entry.type} entry ${entry.path}.`);
		}
		if (!Number.isSafeInteger(entry.size) || entry.size < 0
			|| entry.size > MAXIMUM_FILE_BYTES) {
			throw new Error(`The source archive entry ${entry.path} has an invalid expanded size.`);
		}
	}
	const payloads = entries.filter(({ type }) => type !== 'Directory');
	const topLevels = new Set(payloads.map(({ path }) => path.split('/')[0]));
	const strip = topLevels.size === 1 && payloads.every(({ path }) => path.includes('/')) ? 1 : 0;
	const files = [];
	const symlinks = [];
	let expandedByteLength = 0;
	for (const entry of payloads) {
		const path = strip === 1 ? entry.path.slice(entry.path.indexOf('/') + 1) : entry.path;
		assertSafeRelativePath(path, 'source archive entry');
		if (entry.type === 'SymbolicLink') {
			const target = String(entry.linkpath ?? '');
			assertSafeSymlink(path, target);
			symlinks.push({ path, target });
		} else {
			files.push(path);
			expandedByteLength += entry.size;
		}
	}
	const materializedPaths = [...files, ...symlinks.map(({ path }) => path)].sort(compareStrings);
	assertPortableUniquePaths(materializedPaths);
	if (expandedByteLength > MAXIMUM_EXPANDED_BYTES) {
		throw new Error('The source archive expanded-byte budget is exceeded.');
	}
	return {
		entryCount: entries.length,
		expandedByteLength,
		filePaths: materializedPaths,
		strip,
		symlinks,
	};
}

function materializeTarSymlinks(root, links) {
	for (const { path, target } of links) {
		const link = containedPath(root, path);
		const metadata = lstatSync(link);
		if (!metadata.isSymbolicLink() || readlinkSync(link) !== target) {
			throw new Error(`The extracted source symlink ${path} drifted during extraction.`);
		}
		const targetPath = containedPath(root, posix.normalize(posix.join(posix.dirname(path), target)));
		const targetMetadata = lstatSync(targetPath);
		if (!targetMetadata.isFile() || targetMetadata.isSymbolicLink()
			|| !contained(root, realpathSync(targetPath))) {
			throw new Error(`The extracted source symlink ${path} has no safe regular target.`);
		}
		const bytes = readFileSync(targetPath);
		unlinkSync(link);
		writeFileSync(link, bytes);
	}
}

function extractZip(archivePath, extractionRoot) {
	const bytes = readFileSync(archivePath);
	if (bytes.byteLength < 22 || bytes.byteLength > MAXIMUM_ZIP_BYTES) {
		throw new Error('The ZIP source archive byte length is outside its admission budget.');
	}
	const entries = zipCentralDirectory(bytes);
	const inventory = normalizeZipInventory(entries);
	for (const entry of entries) {
		if (entry.directory) continue;
		const normalized = inventory.strip === 1
			? entry.path.slice(entry.path.indexOf('/') + 1) : entry.path;
		const output = containedPath(extractionRoot, normalized);
		mkdirSync(dirname(output), { recursive: true });
		const body = inflateZipEntry(bytes, entry);
		writeFileSync(output, body);
	}
	return inventory;
}

function zipCentralDirectory(bytes) {
	const lowerBound = Math.max(0, bytes.byteLength - 65_557);
	let eocd = -1;
	for (let offset = bytes.byteLength - 22; offset >= lowerBound; offset -= 1) {
		if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
	}
	if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0
		|| bytes.readUInt16LE(eocd + 8) !== bytes.readUInt16LE(eocd + 10)) {
		throw new Error('The ZIP source archive has unsupported spanning or directory metadata.');
	}
	const count = bytes.readUInt16LE(eocd + 10);
	const size = bytes.readUInt32LE(eocd + 12);
	const start = bytes.readUInt32LE(eocd + 16);
	if (count < 1 || count > MAXIMUM_ENTRIES || start + size > eocd) {
		throw new Error('The ZIP source archive central directory is outside its admission budget.');
	}
	const entries = [];
	let cursor = start;
	for (let index = 0; index < count; index += 1) {
		if (cursor + 46 > start + size || bytes.readUInt32LE(cursor) !== 0x02014b50) {
			throw new Error('The ZIP source archive central directory is malformed.');
		}
		const flags = bytes.readUInt16LE(cursor + 8);
		const method = bytes.readUInt16LE(cursor + 10);
		const compressedSize = bytes.readUInt32LE(cursor + 20);
		const size_ = bytes.readUInt32LE(cursor + 24);
		const nameLength = bytes.readUInt16LE(cursor + 28);
		const extraLength = bytes.readUInt16LE(cursor + 30);
		const commentLength = bytes.readUInt16LE(cursor + 32);
		const external = bytes.readUInt32LE(cursor + 38);
		const localOffset = bytes.readUInt32LE(cursor + 42);
		const end = cursor + 46 + nameLength + extraLength + commentLength;
		if ((flags & 1) !== 0 || ![0, 8].includes(method) || size_ > MAXIMUM_FILE_BYTES
			|| compressedSize === 0xffffffff || size_ === 0xffffffff || end > start + size) {
			throw new Error('The ZIP source archive contains an unsupported entry.');
		}
		const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
		const rawPath = decodeZipName(nameBytes, flags);
		const directory = rawPath.endsWith('/');
		const path = archivePathValue(rawPath);
		const unixType = (external >>> 16) & 0o170000;
		if (unixType === 0o120000) throw new Error(`The ZIP source archive contains symbolic entry ${path}.`);
		entries.push({
			path,
			directory,
			flags,
			method,
			crc32: bytes.readUInt32LE(cursor + 16),
			compressedSize,
			byteLength: size_,
			localOffset,
		});
		cursor = end;
	}
	if (cursor !== start + size) throw new Error('The ZIP source archive directory has trailing records.');
	return entries;
}

function normalizeZipInventory(entries) {
	const files = entries.filter(({ directory }) => !directory);
	const topLevels = new Set(files.map(({ path }) => path.split('/')[0]));
	const strip = topLevels.size === 1 && files.every(({ path }) => path.includes('/')) ? 1 : 0;
	let expandedByteLength = 0;
	const filePaths = files.map((entry) => {
		const path = strip === 1 ? entry.path.slice(entry.path.indexOf('/') + 1) : entry.path;
		assertSafeRelativePath(path, 'ZIP source entry');
		expandedByteLength += entry.byteLength;
		return path;
	}).sort(compareStrings);
	assertPortableUniquePaths(filePaths);
	if (expandedByteLength > MAXIMUM_EXPANDED_BYTES) {
		throw new Error('The ZIP source archive expanded-byte budget is exceeded.');
	}
	return { entryCount: entries.length, expandedByteLength, filePaths, strip, symlinks: [] };
}

function inflateZipEntry(archive, entry) {
	const offset = entry.localOffset;
	if (offset + 30 > archive.byteLength || archive.readUInt32LE(offset) !== 0x04034b50) {
		throw new Error(`The ZIP source entry ${entry.path} has no valid local header.`);
	}
	const nameLength = archive.readUInt16LE(offset + 26);
	const extraLength = archive.readUInt16LE(offset + 28);
	const name = decodeZipName(
		archive.subarray(offset + 30, offset + 30 + nameLength),
		entry.flags,
	);
	const start = offset + 30 + nameLength + extraLength;
	const end = start + entry.compressedSize;
	if (name !== entry.path || end > archive.byteLength) {
		throw new Error(`The ZIP source entry ${entry.path} local identity drifted.`);
	}
	const compressed = archive.subarray(start, end);
	const body = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, {
		maxOutputLength: entry.byteLength,
	});
	if (body.byteLength !== entry.byteLength || crc32(body) !== entry.crc32) {
		throw new Error(`The ZIP source entry ${entry.path} content is invalid.`);
	}
	return body;
}

function decodeZipName(bytes, flags) {
	if ((flags & 0x800) === 0) {
		if ([...bytes].some((value) => value < 0x20 || value > 0x7e)) {
			throw new Error('The ZIP source archive contains an unsupported legacy filename encoding.');
		}
		return bytes.toString('ascii');
	}
	const value = bytes.toString('utf8');
	if (!Buffer.from(value, 'utf8').equals(bytes) || value.normalize('NFC') !== value) {
		throw new Error('The ZIP source archive contains invalid noncanonical UTF-8 filenames.');
	}
	return value;
}

function archivePathValue(value) {
	const path = String(value).replace(/\/+$/u, '');
	assertSafeRelativePath(path, 'source archive path');
	return path;
}

function assertSafeRelativePath(value, label) {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096
		|| value.startsWith('/') || value.includes('\\') || value.includes('\0')
		|| value.normalize('NFC') !== value
		|| value.split('/').some((part) => part === '' || part === '.' || part === '..'
			|| hasControlCharacter(part))) {
		throw new Error(`The ${label} is not one safe portable relative path.`);
	}
}

function hasControlCharacter(value) {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint <= 0x1f || codePoint === 0x7f;
	});
}

function assertSafeSymlink(path, target) {
	if (target.length < 1 || target.includes('\\') || target.includes('\0') || isAbsolute(target)) {
		throw new Error(`The source archive symlink ${path} has an unsafe target.`);
	}
	const normalized = posix.normalize(posix.join(posix.dirname(path), target));
	assertSafeRelativePath(normalized, `source archive symlink ${path} target`);
}

function assertPortableUniquePaths(paths) {
	const exact = new Set();
	const folded = new Set();
	for (const path of paths) {
		if (exact.has(path) || folded.has(path.toLowerCase())) {
			throw new Error(`The source archive path ${path} is duplicate or case-colliding.`);
		}
		exact.add(path);
		folded.add(path.toLowerCase());
	}
}

function containedPath(root, fragment) {
	const output = resolve(root, ...String(fragment).split('/'));
	if (!contained(root, output)) throw new Error('A source archive path left its extraction root.');
	return output;
}

function contained(root, candidate) {
	const path = relative(root, candidate);
	return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function validateExpectedTree(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| value.algorithm !== 'framescaper-portable-source-tree-sha256-v1'
		|| !Number.isSafeInteger(value.fileCount) || value.fileCount < 1
		|| !/^[a-f\d]{64}$/u.test(String(value.sha256))) {
		throw new TypeError('The source archive needs one exact portable extracted-tree pin.');
	}
}

let CRC32_TABLE;
function crc32(bytes) {
	CRC32_TABLE ??= Array.from({ length: 256 }, (_, index) => {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0
			? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		return value >>> 0;
	});
	let value = 0xffffffff;
	for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
	return (value ^ 0xffffffff) >>> 0;
}

function compareStrings(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
