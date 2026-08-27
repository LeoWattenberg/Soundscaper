/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeChildWindowsAuthorityProfile,
	type NativeChildWindowsAuthorityProfileInput,
} from '../desktop/native-child-windows-authority.ts';

const DIGEST = '12'.repeat(32);

test('Windows AppContainer authority is bound to the exact current grant set', () => {
	const base = input({
		readOnly: [grant(11, 'file'), grant(12, 'directory')],
	});
	const profile = createNativeChildWindowsAuthorityProfile(base);
	assert.equal(profile, createNativeChildWindowsAuthorityProfile(input({
		readOnly: [grant(12, 'directory'), grant(11, 'file')],
	})), 'grant ordering does not mint a different authority');
	assert.notEqual(profile, createNativeChildWindowsAuthorityProfile(input({
		readOnly: [grant(11, 'file'), grant(13, 'directory')],
	})), 'a different filesystem object cannot inherit an earlier grant');
	assert.notEqual(profile, createNativeChildWindowsAuthorityProfile(input({
		writeOnly: [grant(11, 'file'), grant(12, 'directory')],
	})), 'a prior read authority cannot be reused as a write authority');
	assert.notEqual(profile, createNativeChildWindowsAuthorityProfile(input({
		readOnly: [grant(11, 'file'), grant(12, 'directory')],
		runtimeClosure: [artifact(22, DIGEST)],
	})), 'the exact dynamic runtime closure participates in the authority');
});

function input(overrides: Partial<NativeChildWindowsAuthorityProfileInput> = {}): NativeChildWindowsAuthorityProfileInput {
	return Object.freeze({
		brand: 'soundscaper-professional', target: 'win-x64', launcherId: 'fixture-launcher',
		launcherSha256: '21'.repeat(32), sandboxProfileSha256: '22'.repeat(32),
		brokerPolicySha256: '23'.repeat(32), executable: artifact(1, '31'.repeat(32)),
		workloadPayload: artifact(2, '32'.repeat(32)), runtimeClosure: Object.freeze([]),
		readOnly: Object.freeze([]), readExecute: Object.freeze([]), writeOnly: Object.freeze([]),
		...overrides,
	});
}

function artifact(ino: number, sha256: string) {
	return Object.freeze({ sha256, identity: Object.freeze({ dev: 7, ino }) });
}

function grant(ino: number, kind: 'file' | 'directory') {
	return Object.freeze({ kind, identity: Object.freeze({ dev: 7, ino }) });
}
