/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
	nativeChildEnforcementFailure,
	waitForNativeChildEnforcement,
} from '../desktop/native-child-enforcement-handshake.ts';

test('the native enforcement pipe admits only the exact success frame', async () => {
	const stream = new PassThrough();
	const result = waitForNativeChildEnforcement(stream, 100);
	stream.end('M5_NATIVE_ISOLATION_ENFORCED_V1\n');
	await result;
});

test('the native enforcement pipe rejects malformed and stalled frames', async () => {
	const malformed = new PassThrough();
	const malformedResult = waitForNativeChildEnforcement(malformed, 100);
	malformed.end('M5_NATIVE_ISOLATION_ENFORCED_V1\nextra');
	await assert.rejects(malformedResult, /malformed/iu);
	await assert.rejects(waitForNativeChildEnforcement(new PassThrough(), 10), /timed out/iu);
});

test('pre-attestation native failure retains only bounded trusted diagnostics', () => {
	const cause = new Error('The enforcement handshake ended early.');
	for (const [platform, stage, code] of [
		['windows', 'create-process', '2'],
		['macos', 'sandbox-init', '1'],
	] as const) {
		const failure = nativeChildEnforcementFailure(cause, {
			exitCode: 125, signal: null, stdout: 'untrusted output',
			stderr: `M5_NATIVE_ISOLATION_FAILURE_V1 ${platform} ${stage} ${code}\nsecret`,
		});
		assert.match(failure.message, new RegExp(`exit=125.*${platform} ${stage} ${code}`, 'iu'));
		assert.doesNotMatch(failure.message, /secret|untrusted/iu);
		assert.equal(failure.cause, cause);
	}
	assert.equal(nativeChildEnforcementFailure(cause, null), cause);
});
