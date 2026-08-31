/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('Framescaper mac packages declare capture usage and hardened helper entitlements', async () => {
	const config = await loadConfiguration('framescaper');
	assert.equal(config.mac.hardenedRuntime, true);
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

async function loadConfiguration(productId) {
	const script = "process.stdout.write(JSON.stringify(require('./electron-builder.config.cjs')))";
	const { stdout } = await execFileAsync(process.execPath, ['-e', script], {
		cwd: new URL('..', import.meta.url),
		env: { ...process.env, SCAPE_PRODUCT: productId },
	});
	return JSON.parse(stdout);
}
