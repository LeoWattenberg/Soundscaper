/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appImageSquashfsOffset } from '../scripts/lib/desktop-package-artifact-extractor.mjs';

test('AppImage extraction derives the payload from ELF structure and ignores decoy magic', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-appimage-offset-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'fixture.AppImage');
	const bytes = appImageBytes();
	bytes.set(Buffer.from('hsqs'), 128);
	await writeFile(path, bytes);
	assert.equal(await appImageSquashfsOffset(path), 4_096);
	assert.equal(await appImageSquashfsOffset(path, 'linux-x64'), 4_096);
	await assert.rejects(
		appImageSquashfsOffset(path, 'linux-arm64'),
		/AppImage runtime.*wrong target architecture/iu,
	);

	bytes.set(Buffer.from('nope'), 4_096);
	await writeFile(path, bytes);
	await assert.rejects(appImageSquashfsOffset(path), /ELF-derived offset.*SquashFS/iu);
});

test('AppImage extraction rejects an ELF section table that leaves the artifact', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-appimage-bounds-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'fixture.AppImage');
	const bytes = appImageBytes();
	bytes.writeBigUInt64LE(8_192n, 40);
	await writeFile(path, bytes);
	await assert.rejects(appImageSquashfsOffset(path), /section table.*bounded payload/iu);
});

function appImageBytes() {
	const bytes = Buffer.alloc(4_096 + 96);
	bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
	bytes.set(Buffer.from('AI\x02', 'latin1'), 8);
	bytes.writeUInt16LE(2, 16);
	bytes.writeUInt16LE(62, 18);
	bytes.writeUInt32LE(1, 20);
	bytes.writeBigUInt64LE(4_032n, 40);
	bytes.writeUInt16LE(64, 52);
	bytes.writeUInt16LE(64, 58);
	bytes.writeUInt16LE(1, 60);
	const offset = 4_096;
	bytes.set(Buffer.from('hsqs'), offset);
	bytes.writeUInt32LE(1, offset + 4);
	bytes.writeUInt32LE(131_072, offset + 12);
	bytes.writeUInt16LE(1, offset + 20);
	bytes.writeUInt16LE(17, offset + 22);
	bytes.writeUInt16LE(1, offset + 26);
	bytes.writeUInt16LE(4, offset + 28);
	bytes.writeUInt16LE(0, offset + 30);
	bytes.writeBigUInt64LE(96n, offset + 40);
	return bytes;
}
