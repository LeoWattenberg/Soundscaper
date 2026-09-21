/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('the helper build workflow produces stageable target-native results for all five targets', () => {
	const workflow = readFileSync(resolve(root, '.github/workflows/native-helper-addon-build.yml'), 'utf8');
	for (const [target, runner] of [
		['linux-x64', 'ubuntu-24.04'],
		['linux-arm64', 'ubuntu-24.04-arm'],
		['mac-arm64', 'macos-15'],
		['win-x64', 'windows-2025'],
		['win-arm64', 'windows-11-arm'],
	]) {
		assert.match(workflow, new RegExp(`target: ${target}[\\s\\S]{0,160}runner: ${runner}`, 'u'));
	}
	assert.match(workflow,
		/node scripts\/provision-milestone-5-native-sources\.mjs[\s\S]*electron-node-api-headers/u);
	assert.match(workflow, /scripts\/build-native-helper-addon-result\.mjs/u);
	assert.match(workflow, /scripts\/stage-native-helper-addon-build-result\.mjs/u);
	assert.match(workflow, /native-helper-addon-build-result-\$\{\{ matrix\.target \}\}/u);
	assert.match(workflow, /architecture: \$\{\{ matrix\.node_arch \}\}/u);
	assert.doesNotMatch(workflow, /package-manager-cache/u);
	assert.doesNotMatch(workflow, /pending-external|sign(?:ed|ature|ing)|approval|reviewer/iu);
});

test('the Windows helper discovers and loads fixture modules through wide-path Win32 APIs', () => {
	const scan = readFileSync(resolve(root,
		'native/soundscaper-helper-addon/src/plugin_scan.c'), 'utf8');
	const host = readFileSync(resolve(root,
		'native/soundscaper-helper-addon/src/plugin_host.c'), 'utf8');
	const conversion = readFileSync(resolve(root,
		'native/common/windows_utf8_path.h'), 'utf8');
	for (const symbol of [
		'FindFirstFileW', 'FindNextFileW',
		'LoadLibraryExW', 'GetProcAddress', 'FreeLibrary',
	]) {
		assert.match(scan, new RegExp(`\\b${symbol}\\b`, 'u'));
	}
	assert.match(scan, /FILE_ATTRIBUTE_REPARSE_POINT/u);
	for (const symbol of ['LoadLibraryExW', 'GetProcAddress', 'FreeLibrary']) {
		assert.match(host, new RegExp(`\\b${symbol}\\b`, 'u'));
	}
	assert.match(conversion, /MultiByteToWideChar\(CP_UTF8, MB_ERR_INVALID_CHARS/u);
	for (const source of [scan, host]) {
		assert.match(source, /soundscaper_windows_wide_path_alloc_nul\(/u);
		assert.doesNotMatch(source, /MultiByteToWideChar\(/u);
	}
	const selfTest = readFileSync(resolve(root,
		'scripts/self-test-native-helper-addon-result.mjs'), 'utf8');
	assert.match(selfTest, /openPluginInstance/u);
	assert.match(selfTest, /processPluginBlock/u);
});
