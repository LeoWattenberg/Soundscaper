/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const [LAUNCHER_SOURCE, BOOTSTRAP_SOURCE, PROFILE] = await Promise.all([
	readFile(resolve('native/milestone-5-native-isolation-launcher/src/macos_launcher.mm'), 'utf8'),
	readFile(resolve('native/soundscaper-professional-host/src/professional_host_macos_bootstrap.mm'), 'utf8'),
	readFile(resolve('native/milestone-5-native-isolation-launcher/profiles/macos-v1.sb'), 'utf8'),
]);

test('macOS reports bounded pre-attestation launcher and bootstrap stages', () => {
	for (const source of [LAUNCHER_SOURCE, BOOTSTRAP_SOURCE]) {
		assert.match(source, /M5_NATIVE_ISOLATION_FAILURE_V1 macos/u);
	}
	assert.match(LAUNCHER_SOURCE, /posix_spawn\([\s\S]*nativeFailure\("posix-spawn", status\)/u);
	assert.match(BOOTSTRAP_SOURCE, /sandbox_init\([\s\S]*bootstrapFailure\("sandbox-init"/u);
	assert.match(BOOTSTRAP_SOURCE, /exactWrite\(attestationDescriptor[\s\S]*bootstrapFailure\("attestation-write"/u);
});

test('macOS grants transport data only through inherited descriptors', () => {
	assert.match(PROFILE,
		/\(allow file-read-data file-write-data \(subpath "\/dev\/fd"\)\)/u);
	assert.doesNotMatch(PROFILE, /\(allow file-write\* \(subpath "\/dev\/fd"\)\)/u,
		'transport must not gain create, unlink, metadata, or mode authority');
});

test('macOS maps its exact peer descriptor closure before SETEXEC', () => {
	assert.match(LAUNCHER_SOURCE,
		/dup2\(attestationSource, bootstrap::attestationDescriptor\)[\s\S]*dup2\(policySource, bootstrap::policyDescriptor\)/u);
	assert.match(LAUNCHER_SOURCE,
		/makeInheritable\([\s\S]*FD_CLOEXEC[\s\S]*closefrom\(6\)/u);
	assert.match(LAUNCHER_SOURCE,
		/const pid_t verifier = fork\(\)[\s\S]*mapBootstrapDescriptors\([\s\S]*posix_spawn\(nullptr,[\s\S]*nullptr, &attributes/u,
		'the verifier must retain authenticated descriptors before the SETEXEC parent closes its private sources');
	assert.doesNotMatch(LAUNCHER_SOURCE, /posix_spawn_file_actions_/u);
	assert.doesNotMatch(LAUNCHER_SOURCE, /POSIX_SPAWN_CLOEXEC_DEFAULT/u);
});
