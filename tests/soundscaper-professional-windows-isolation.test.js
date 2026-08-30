/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const SOURCE = await readFile(resolve(
	'native/milestone-5-native-isolation-launcher/src/windows_launcher.cpp',
), 'utf8');

test('Windows registers the exact AppContainer profile before creating its process', () => {
	assert.match(SOURCE,
		/CreateAppContainerProfile\([\s\S]*HRESULT_FROM_WIN32\(ERROR_ALREADY_EXISTS\)[\s\S]*DeriveAppContainerSidFromAppContainerName/u);
	assert.match(SOURCE, /substr\(separator \+ 1u, 40u\)/u,
		'the persistent profile SID must remain bound to the full admitted digest prefix');
	assert.doesNotMatch(SOURCE, /DeleteAppContainerProfile/u,
		'per-launch deletion can race another process using the same exact profile');
});

test('Windows constructs the inherited CRT handle table without unaligned stores', () => {
	assert.match(SOURCE, /handleOffset[\s\S]*std::memcpy\(/u);
	assert.doesNotMatch(SOURCE, /reinterpret_cast<intptr_t \*>\(flags \+ count\)/u,
		'ARM64 cannot admit a pointer aligned only after the variable byte flags');
});

test('Windows reports a bounded pre-attestation API stage without merging guards', () => {
	assert.match(SOURCE, /M5_NATIVE_ISOLATION_FAILURE_V1/u);
	assert.match(SOURCE, /if \(!CreateProcessW\([\s\S]*nativeFailure\("create-process"/u);
	assert.match(SOURCE, /if \(!AssignProcessToJobObject\([\s\S]*nativeFailure\("assign-job"/u);
	assert.match(SOURCE,
		/if \(!AssignProcessToJobObject\([\s\S]*TerminateProcess\([\s\S]*nativeFailure\("assign-job"/u,
		'the unassigned suspended child must be terminated before the launcher exits');
});
