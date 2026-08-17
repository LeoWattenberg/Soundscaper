/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	NATIVE_ADDON_RUNTIME_TARGETS,
	createNativeAddonVerifier,
	describeNativeAddonAvailability,
	nativeAddonTargetFor,
} from '../desktop/native-addon-payload.ts';

const applicationRoot = resolve(import.meta.dirname, '..');
const developmentLocation = Object.freeze({
	applicationRoot,
	packaged: false,
	resourcesPath: '/unused',
	platform: 'linux',
	arch: 'x64',
});

test('every claimed runtime pair maps to its target and macOS x64 does not', () => {
	assert.deepEqual(Object.keys(NATIVE_ADDON_RUNTIME_TARGETS), [
		'linux-x64', 'linux-arm64', 'darwin-arm64', 'win32-x64', 'win32-arm64',
	]);
	assert.equal(nativeAddonTargetFor('darwin', 'arm64'), 'mac-arm64');
	assert.equal(nativeAddonTargetFor('win32', 'x64'), 'win-x64');
	assert.equal(nativeAddonTargetFor('darwin', 'x64'), null);
	assert.equal(nativeAddonTargetFor('linux', 'ia32'), null);
});

test('the built target resolves its payload from the repository in a development run', async () => {
	const availability = await describeNativeAddonAvailability(developmentLocation);
	assert.equal(availability.status, 'available');
	assert.equal(availability.descriptor.target, 'linux-x64');
	assert.equal(availability.descriptor.napiVersion, 8);
	const bytes = await readFile(availability.descriptor.path);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), availability.descriptor.sha256);
});

test('a packaged run resolves the payload from the verified extraResources tree', async () => {
	const reads: string[] = [];
	const availability = await describeNativeAddonAvailability(
		{ ...developmentLocation, packaged: true, resourcesPath: '/opt/soundscaper/resources' },
		async (path) => {
			reads.push(path);
			return readFile(path.startsWith('/opt/soundscaper/resources')
				? join(applicationRoot, 'native/soundscaper-helper-addon/prebuilt/linux-x64/soundscaper_helper.node')
				: path);
		},
	);
	assert.equal(availability.status, 'available');
	assert.equal(availability.descriptor.path, '/opt/soundscaper/resources/runtime/native/linux-x64/soundscaper_helper.node');
	assert.deepEqual(reads, [
		join(applicationRoot, 'config/native-addon-payload-manifest.json'),
		'/opt/soundscaper/resources/runtime/native/linux-x64/soundscaper_helper.node',
	]);
});

test('an unsupported platform reports unavailability instead of failing', async () => {
	const availability = await describeNativeAddonAvailability({ ...developmentLocation, platform: 'darwin', arch: 'x64' });
	assert.equal(availability.status, 'unavailable');
	assert.equal(availability.reason, 'unsupported-platform');
	assert.match(availability.detail, /darwin-x64 is not a claimed native helper target/u);
});

test('a target with no built payload reports its named blocker', async () => {
	const availability = await describeNativeAddonAvailability({ ...developmentLocation, platform: 'win32', arch: 'arm64' });
	assert.equal(availability.status, 'unavailable');
	assert.equal(availability.reason, 'payload-pending-external');
	assert.match(availability.detail, /Windows ARM64 build host/u);
});

test('a missing or altered payload is reported rather than loaded', async () => {
	const manifestPath = join(applicationRoot, 'config/native-addon-payload-manifest.json');
	const missing = await describeNativeAddonAvailability(developmentLocation, async (path) => {
		if (path === manifestPath) return readFile(path);
		throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
	});
	assert.equal(missing.status, 'unavailable');
	assert.equal(missing.reason, 'payload-missing');

	const altered = await describeNativeAddonAvailability(developmentLocation, async (path) => {
		if (path === manifestPath) return readFile(path);
		const bytes = Buffer.from(await readFile(path));
		bytes[0] ^= 0xff;
		return bytes;
	});
	assert.equal(altered.status, 'unavailable');
	assert.equal(altered.reason, 'payload-digest-mismatch');
});

test('an unreadable manifest is reported rather than treated as an absent target', async () => {
	const availability = await describeNativeAddonAvailability(developmentLocation, async () => Buffer.from('not json'));
	assert.equal(availability.status, 'unavailable');
	assert.equal(availability.reason, 'manifest-unreadable');
});

test('a parseable manifest that names no addon is reported, never thrown at the caller', async () => {
	const manifestPath = join(applicationRoot, 'config/native-addon-payload-manifest.json');
	const record = JSON.parse(String(await readFile(manifestPath))) as { addon: unknown; targets: unknown };
	for (const manifest of [
		{ targets: record.targets },
		{ addon: null, targets: record.targets },
		{ addon: { version: '1.0.0' }, targets: record.targets },
		{ addon: record.addon },
	]) {
		const availability = await describeNativeAddonAvailability(
			{ ...developmentLocation, packaged: true, resourcesPath: '/opt/soundscaper/resources' },
			async () => Buffer.from(JSON.stringify(manifest)),
		);
		assert.equal(availability.status, 'unavailable');
		assert.equal(availability.reason, 'manifest-unreadable');
	}
});

test('the spawn-time verifier throws so a supervisor records a binary mismatch', async () => {
	const verify = createNativeAddonVerifier(developmentLocation);
	assert.equal((await verify()).target, 'linux-x64');
	const pending = createNativeAddonVerifier({ ...developmentLocation, platform: 'win32', arch: 'x64' });
	await assert.rejects(pending, /native helper addon is unavailable \(payload-pending-external\)/u);
});
