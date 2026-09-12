/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopLlamaCppNotices } from '../scripts/lib/desktop-assistance-llama-notices.mjs';

function fixtureRead(path) {
	if (path.endsWith('/ops.cpp')) return Promise.resolve('// YaRN algorithm based on upstream implementation\n// MIT licensed. Copyright upstream authors');
	if (path.endsWith('/copyright')) return Promise.resolve('libstdc++ Copyright and GCC Runtime Library Exception');
	if (path.endsWith('/GPL-3')) return Promise.resolve('GNU GENERAL PUBLIC LICENSE complete fixture');
	return Promise.resolve(`Permission is hereby granted: ${path}`);
}

test('llama completion notices preserve upstream licenses and compiler runtime notices', async () => {
	const notices = await desktopLlamaCppNotices({ sourceRoot: '/source', platform: 'linux',
		compiler: { id: 'GNU', version: '13.3.0' }, read: fixtureRead });
	assert.deepEqual(notices.map(({ path }) => path), ['THIRD_PARTY_NOTICES.txt', 'GCC-COPYRIGHT.txt', 'GCC-GPL-3.txt']);
	const text = notices[0].bytes.toString();
	assert.match(text, /LICENSE-jsonhpp/u);
	assert.match(text, /cpp-httplib\/LICENSE/u);
	assert.match(text, /MIT licensed\. Copyright upstream authors/u);
	const windows = await desktopLlamaCppNotices({ sourceRoot: '/source', platform: 'win32',
		compiler: { id: 'Clang', version: '19.1.1' }, read: fixtureRead });
	assert.equal(windows.length, 1);
});

test('llama notices fail closed when pinned notices or static runtime licenses are absent', async () => {
	await assert.rejects(desktopLlamaCppNotices({ sourceRoot: '/source', platform: 'win32',
		compiler: { id: 'MSVC', version: '19.44' }, read: () => Promise.resolve('missing') }), /incomplete/u);
	await assert.rejects(desktopLlamaCppNotices({ sourceRoot: '/source', platform: 'linux',
		compiler: { id: 'Clang', version: '19.1' }, read: fixtureRead }), /GNU/u);
	await assert.rejects(desktopLlamaCppNotices({ sourceRoot: '/source', platform: 'linux',
		compiler: { id: 'GNU', version: '13.3' }, read: (path) => path.endsWith('/copyright')
			? Promise.resolve('incomplete') : fixtureRead(path) }), /incomplete/u);
});
