/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('Framescaper mac packages declare capture usage and Electron helper entitlements', async () => {
	const config = await loadConfiguration('framescaper');
	assert.deepEqual(config.mac.extendInfo, {
		NSCameraUsageDescription: 'Framescaper accesses the camera only when you choose a camera capture source.',
		NSMicrophoneUsageDescription: 'Framescaper records microphone audio only when you choose a microphone capture source.',
		NSAudioCaptureUsageDescription: 'Framescaper records system audio only when you explicitly include it with a screen capture.',
	});
	assert.equal(config.mac.entitlements, 'desktop/framescaper-entitlements.mac.plist');
	assert.equal(config.mac.entitlementsInherit, 'desktop/framescaper-entitlements.mac.plist');
	const entitlements = await readFile(new URL('../desktop/framescaper-entitlements.mac.plist', import.meta.url), 'utf8');
	assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/u);
	assert.match(entitlements, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/u);
	assert.match(entitlements, /com\.apple\.security\.device\.camera/u);
	assert.match(entitlements, /com\.apple\.security\.device\.audio-input/u);
});

test('Soundscaper retains its microphone-only package policy without a camera entitlement', async () => {
	const config = await loadConfiguration('soundscaper');
	assert.deepEqual(config.mac.extendInfo, {
		NSMicrophoneUsageDescription: 'Soundscaper records audio only when you start recording.',
	});
	assert.equal(config.mac.entitlements, 'desktop/soundscaper-entitlements.mac.plist');
	assert.equal(config.mac.entitlementsInherit, 'desktop/soundscaper-entitlements.mac.plist');
	const entitlements = await readFile(new URL('../desktop/soundscaper-entitlements.mac.plist', import.meta.url), 'utf8');
	assert.match(entitlements, /com\.apple\.security\.device\.audio-input/u);
	assert.doesNotMatch(entitlements, /com\.apple\.security\.device\.camera/u);
});

test('ad-hoc mac packages avoid the library validation that rejects the Electron framework at launch', async () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const config = await loadConfiguration(productId);
		assert.equal(config.mac.identity, '-');
		assert.equal(config.mac.hardenedRuntime, false);
		assert.equal(config.mac.notarize, false);
		assert.equal(config.forceCodeSigning, false);
	}
});

test('Developer ID mac packages retain hardened runtime and required notarization', async () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const config = await loadConfiguration(productId, true);
		assert.equal(config.mac.identity, 'Example (TEAM)');
		assert.equal(config.mac.hardenedRuntime, true);
		assert.equal(config.mac.notarize, true);
		assert.equal(config.forceCodeSigning, true);
		const entitlements = await readFile(new URL(`../${config.mac.entitlements}`, import.meta.url), 'utf8');
		assert.doesNotMatch(entitlements, /com\.apple\.security\.cs\.disable-library-validation/u);
	}
});

async function loadConfiguration(productId, signed = false) {
	const script = "Object.defineProperty(process, 'platform', { value: 'darwin' });"
		+ "process.stdout.write(JSON.stringify(require('./electron-builder.config.cjs')))";
	const { stdout } = await execFileAsync(process.execPath, ['-e', script], {
		cwd: new URL('..', import.meta.url),
		env: {
			...process.env, SCAPE_PRODUCT: productId, SCAPE_MAC_SIGNING: String(signed),
			CSC_NAME: 'Developer ID Application: Example (TEAM)', CSC_KEYCHAIN: '/tmp/keychain',
			APPLE_ID: 'account', APPLE_APP_SPECIFIC_PASSWORD: 'test-password', APPLE_TEAM_ID: 'TEAM',
		},
	});
	return JSON.parse(stdout);
}
