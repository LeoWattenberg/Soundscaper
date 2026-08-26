/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { collectExtractedSourceTree } from '../native/framescaper-media-host/build/source-authentication.mjs';
import { authenticateMilestone5SourceArchiveExtraction } from '../scripts/lib/milestone-5-source-archive-extraction.mjs';

test('ZIP source authentication safely extracts UTF-8 vendor paths into the pinned tree', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'm5-source-zip-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const sourceRoot = join(root, 'source');
	const files = {
		'common/api.h': Buffer.from('authenticated api\n'),
		'Steinberg ASIO ®.txt': Buffer.from('authenticated notice\n'),
	};
	for (const [path, bytes] of Object.entries(files)) {
		await mkdir(dirname(join(sourceRoot, path)), { recursive: true });
		await writeFile(join(sourceRoot, path), bytes);
	}
	const expectedTree = collectExtractedSourceTree(sourceRoot);
	const archivePath = join(root, 'ASIO-SDK-fixture.zip');
	const archive = zipStore(Object.fromEntries(Object.entries(files).map(([path, bytes]) => (
		[`ASIOSDK/${path}`, bytes]
	))));
	await writeFile(archivePath, archive);
	const audit = authenticateMilestone5SourceArchiveExtraction({
		archiveBytes: archive,
		archiveName: 'ASIO-SDK-fixture.zip',
		expectedTree,
	});
	assert.equal(audit.fileCount, 2);
	assert.equal(audit.sha256, expectedTree.sha256);

	const changed = Buffer.from(archive);
	const bodyOffset = changed.readUInt16LE(26) + changed.readUInt16LE(28) + 30;
	changed[bodyOffset] ^= 1;
	await writeFile(archivePath, changed);
	assert.throws(
		() => authenticateMilestone5SourceArchiveExtraction({
			archiveBytes: changed,
			archiveName: 'ASIO-SDK-fixture.zip',
			expectedTree,
		}),
		/content is invalid/iu,
	);
});

test('source authentication works where the temporary directory is reached through a link', async (context) => {
	// macOS reports a temporary directory under /var, which is a symbolic link to
	// /private/var. Every path derived from it then fails the canonical-directory
	// rule the extracted tree is authenticated by, so the macOS codec host build
	// stopped before it configured anything. Point TMPDIR through a link to
	// reproduce that shape from any platform.
	const root = await mkdtemp(join(tmpdir(), 'm5-source-linked-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const real = join(root, 'real-temporary');
	const linked = join(root, 'linked-temporary');
	await mkdir(real);
	await symlink(real, linked);

	const sourceRoot = join(root, 'source');
	await mkdir(sourceRoot, { recursive: true });
	await writeFile(join(sourceRoot, 'api.h'), 'authenticated api\n');
	const expectedTree = collectExtractedSourceTree(sourceRoot);
	const archive = zipStore({ 'SDK/api.h': Buffer.from('authenticated api\n') });

	const previous = process.env.TMPDIR;
	process.env.TMPDIR = linked;
	context.after(() => {
		if (previous === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = previous;
	});
	assert.equal(tmpdir(), linked, 'the fixture must actually move the temporary directory');

	const audit = authenticateMilestone5SourceArchiveExtraction({
		archiveBytes: archive, archiveName: 'SDK-fixture.zip', expectedTree,
	});
	assert.equal(audit.fileCount, 1);
	assert.equal(audit.sha256, expectedTree.sha256);
});

test('ZIP source authentication rejects traversal before writing archive entries', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'm5-source-zip-traversal-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const sourceRoot = join(root, 'source');
	await mkdir(sourceRoot);
	await writeFile(join(sourceRoot, 'safe.txt'), 'safe\n');
	const expectedTree = collectExtractedSourceTree(sourceRoot);
	const archivePath = join(root, 'unsafe.zip');
	const archive = zipStore({ '../outside.txt': Buffer.from('escape') });
	await writeFile(archivePath, archive);
	assert.throws(
		() => authenticateMilestone5SourceArchiveExtraction({
			archiveBytes: archive,
			archiveName: 'unsafe.zip',
			expectedTree,
		}),
		/safe portable relative path/iu,
	);
});

function zipStore(files) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const [path, bytes] of Object.entries(files)) {
		const name = Buffer.from(path, 'utf8');
		const crc = crc32(bytes);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x800, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(bytes.byteLength, 18);
		local.writeUInt32LE(bytes.byteLength, 22);
		local.writeUInt16LE(name.byteLength, 26);
		locals.push(local, name, bytes);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE((3 << 8) | 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(bytes.byteLength, 20);
		central.writeUInt32LE(bytes.byteLength, 24);
		central.writeUInt16LE(name.byteLength, 28);
		central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);
		offset += local.byteLength + name.byteLength + bytes.byteLength;
	}
	const centralBytes = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(Object.keys(files).length, 8);
	eocd.writeUInt16LE(Object.keys(files).length, 10);
	eocd.writeUInt32LE(centralBytes.byteLength, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, centralBytes, eocd]);
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
