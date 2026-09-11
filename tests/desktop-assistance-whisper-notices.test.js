/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { basename } from 'node:path';
import test from 'node:test';

import { desktopWhisperCppNotices } from '../scripts/lib/desktop-assistance-whisper-notices.mjs';

const SOURCES = {
	LICENSE: 'MIT License\nPermission is hereby granted.\n',
	'miniaudio.h': 'code\n/*\nThis software is available as a choice of the following licenses.\nCopyright 2025 David Reid\nFull miniaudio permission.\n*/\n',
	'stb_vorbis.c': 'code\n/*\nThis software is available under 2 licenses -- choose whichever you prefer.\nCopyright (c) 2017 Sean Barrett\nFull Vorbis permission.\n*/\n',
	'ops.cpp': '// YaRN algorithm based on upstream code\n// MIT licensed. Copyright (c) 2023 Jeffrey Quesnelle and Bowen Peng.\ncode',
	copyright: 'GCC Runtime Library Exception\nlibstdc++\nGNU runtime copyright',
	'GPL-3': 'GNU GENERAL PUBLIC LICENSE\nFull GNU permission.',
};
const read = async (path) => SOURCES[basename(path)];

test('Whisper notices preserve whole vendored license blocks and the extra ggml copyright', async () => {
	const files = await desktopWhisperCppNotices({ sourceRoot: '/source', platform: 'win32',
		compiler: { id: 'MSVC', version: '19.44' }, read });
	assert.equal(files.length, 1);
	const text = files[0].bytes.toString();
	for (const required of ['David Reid', 'Sean Barrett', 'Jeffrey Quesnelle and Bowen Peng',
		'Full miniaudio permission.', 'Full Vorbis permission.', 'Permission is hereby granted.']) {
		assert.ok(text.includes(required));
	}
	assert.deepEqual(files[0].sources, ['examples/miniaudio.h', 'examples/stb_vorbis.c', 'ggml/src/ggml-cpu/ops.cpp', 'LICENSE']);
});

test('Linux Whisper includes the build compiler runtime copyright and GPL license', async () => {
	const files = await desktopWhisperCppNotices({ sourceRoot: '/source', platform: 'linux',
		compiler: { id: 'GNU', version: '13.3.0' }, read });
	assert.deepEqual(files.slice(1).map(({ path }) => path), ['GCC-COPYRIGHT.txt', 'GCC-GPL-3.txt']);
	assert.equal(files[1].sources[0], '/usr/share/doc/gcc-13-base/copyright');
	assert.equal(files[1].bytes.toString(), SOURCES.copyright);
	assert.equal(files[2].bytes.toString(), SOURCES['GPL-3']);
});

test('Whisper notice collection fails closed when dependency or runtime notices disappear', async () => {
	for (const file of ['miniaudio.h', 'stb_vorbis.c', 'ops.cpp', 'copyright', 'GPL-3']) {
		await assert.rejects(desktopWhisperCppNotices({ sourceRoot: '/source', platform: 'linux',
			compiler: { id: 'GNU', version: '13.3.0' }, read: async (path) => basename(path) === file ? '' : read(path) }),
		/notice|license/u);
	}
});
