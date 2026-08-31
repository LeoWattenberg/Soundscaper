/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const SOURCE = await readFile(resolve(
	'native/soundscaper-professional-host/src/direct_clap_adapter.cpp',
), 'utf8');

test('Windows loads the authenticated CLAP with a closed dependency search', () => {
	const windowsBranch = /bool open\(const std::string &path\)[\s\S]*?#if defined\(_WIN32\)([\s\S]*?)#else/u
		.exec(SOURCE)?.[1] ?? '';
	assert.match(windowsBranch,
		/LoadLibraryExW\([\s\S]*LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR\s*\|\s*LOAD_LIBRARY_SEARCH_SYSTEM32/u);
	assert.doesNotMatch(windowsBranch, /LOAD_LIBRARY_SEARCH_(?:APPLICATION_DIR|DEFAULT_DIRS|USER_DIRS)/u);
	assert.doesNotMatch(windowsBranch, /juce::DynamicLibrary|library\.open/u,
		'the Windows branch must not fall back to JUCE bare LoadLibraryW');
});

test('the Windows module handle has one explicit owner', () => {
	assert.match(SOURCE, /PluginLibrary\(const PluginLibrary &\) = delete/u);
	assert.match(SOURCE, /PluginLibrary &operator=\(const PluginLibrary &\) = delete/u);
	assert.match(SOURCE, /FreeLibrary\(handle\)/u);
});

test('JUCE symbol lookup uses its mutable DynamicLibrary API', () => {
	assert.match(SOURCE, /void \*function\(const char \*name\)\s*\{/u);
	assert.doesNotMatch(SOURCE, /void \*function\(const char \*name\) const/u);
});
