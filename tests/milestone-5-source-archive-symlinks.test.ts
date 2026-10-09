/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { collectExtractedSourceTree } from '../native/framescaper-media-host/build/source-authentication.mjs';
import { authenticateMilestone5SourceArchiveExtraction } from '../scripts/lib/milestone-5-source-archive-extraction.mjs';

const contents = Buffer.from('authenticated LADSPA header\n');

for (const fixture of [
	{ platform: 'win32', rendering: 'separators', accepted: true },
	{ platform: 'linux', rendering: 'separators', accepted: false },
	{ platform: 'win32', rendering: 'foreign', accepted: false },
] as const) {
	test(`source symlink authentication preserves pinned bytes with ${fixture.platform} ${fixture.rendering} rendering`, (context) => {
		const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'm5-source-symlink-')));
		context.after(() => fs.rmSync(root, { recursive: true, force: true }));
		for (const path of ['src', 'doc']) fs.mkdirSync(join(root, path));
		fs.writeFileSync(join(root, 'src/ladspa.h'), contents);
		fs.writeFileSync(join(root, 'doc/ladspa.h.txt'), contents);
		const expectedTree = collectExtractedSourceTree(root);
		const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
		assert.ok(platformDescriptor);
		const originalReadlink = fs.readlinkSync;
		context.mock.method(fs, 'readlinkSync', (path: fs.PathLike) => {
			const actual = originalReadlink(path);
			return fixture.rendering === 'foreign' ? '..\\src\\foreign.h' : actual.replaceAll('/', '\\');
		});
		syncBuiltinESMExports();
		Object.defineProperty(process, 'platform', { ...platformDescriptor, value: fixture.platform });
		try {
			const authenticate = () => authenticateMilestone5SourceArchiveExtraction({
				archiveBytes: archive('../src/ladspa.h'), archiveName: 'ladspa-fixture.tar.gz', expectedTree,
			});
			if (fixture.accepted) {
				const evidence = authenticate();
				assert.equal(evidence.sha256, expectedTree.sha256);
				assert.equal(evidence.fileCount, 2);
			} else {
				assert.throws(authenticate, /symlink doc\/ladspa.h.txt drifted during extraction/u);
			}
		} finally {
			Object.defineProperty(process, 'platform', platformDescriptor);
			context.mock.restoreAll();
			syncBuiltinESMExports();
		}
	});
}

test('source symlink authentication rejects an escaping archive target before extraction', (context) => {
	const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'm5-source-symlink-escape-')));
	context.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.writeFileSync(join(root, 'safe.h'), contents);
	assert.throws(() => authenticateMilestone5SourceArchiveExtraction({
		archiveBytes: archive('../../outside.h'), archiveName: 'unsafe.tar.gz',
		expectedTree: collectExtractedSourceTree(root),
	}), /safe portable relative path/u);
});

function archive(target: string): Buffer {
	const file = header('fixture/src/ladspa.h', '0', contents.length);
	const link = header('fixture/doc/ladspa.h.txt', '2', 0, target);
	return gzipSync(Buffer.concat([file, contents, Buffer.alloc(512 - contents.length), link, Buffer.alloc(1024)]));
}

function header(path: string, type: string, size: number, target = ''): Buffer {
	const block = Buffer.alloc(512);
	block.write(path, 0, 100);
	for (const [offset, length, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, size], [136, 12, 0]]) {
		assert.ok(offset !== undefined && length !== undefined && value !== undefined);
		block.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length);
	}
	block.fill(' ', 148, 156);
	block.write(type, 156, 1);
	block.write(target, 157, 100);
	block.write('ustar\0', 257, 6);
	block.write('00', 263, 2);
	const checksum = block.reduce((sum, byte) => sum + byte, 0);
	block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
	return block;
}
