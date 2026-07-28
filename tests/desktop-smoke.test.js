import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	assertDesktopSmokePayload,
	packagedExecutableCandidates,
	resolveSmokeArchitecture,
} from '../scripts/lib/desktop-smoke.mjs';

const EXPECTED_BRIDGE = Object.freeze(['chooseFiles', 'getEnvironment']);

test('desktop smoke resolves an explicit package architecture independently of the Node host', () => {
	assert.equal(resolveSmokeArchitecture('arm64', 'x64'), 'arm64');
	assert.equal(resolveSmokeArchitecture(undefined, 'arm64'), 'arm64');
	assert.throws(() => resolveSmokeArchitecture('', 'x64'), /Unsupported desktop smoke architecture/u);
	assert.throws(() => resolveSmokeArchitecture('ia32', 'x64'), /Unsupported desktop smoke architecture: ia32/u);

	const candidates = packagedExecutableCandidates({
		arch: 'arm64',
		outputRoot: '/release/desktop',
		platform: 'win32',
		productId: 'soundscaper',
		productName: 'Soundscaper',
	});
	assert.deepEqual(candidates, [
		resolve('/release/desktop', 'win-arm64-unpacked', 'Soundscaper.exe'),
		resolve('/release/desktop', 'win-unpacked', 'Soundscaper.exe'),
	]);
});

test('desktop smoke selects the platform-specific unpacked executable convention', () => {
	const base = {
		arch: 'arm64',
		outputRoot: '/release/desktop',
		productId: 'framescaper',
		productName: 'Framescaper',
	};
	assert.deepEqual(packagedExecutableCandidates({ ...base, platform: 'darwin' }), [
		resolve('/release/desktop', 'mac-arm64', 'Framescaper.app', 'Contents', 'MacOS', 'Framescaper'),
		resolve('/release/desktop', 'mac', 'Framescaper.app', 'Contents', 'MacOS', 'Framescaper'),
	]);
	assert.deepEqual(packagedExecutableCandidates({ ...base, platform: 'linux' }), [
		resolve('/release/desktop', 'linux-arm64-unpacked', 'framescaper'),
		resolve('/release/desktop', 'linux-unpacked', 'framescaper'),
	]);
	assert.throws(
		() => packagedExecutableCandidates({ ...base, platform: 'freebsd' }),
		/Unsupported desktop smoke platform: freebsd/u,
	);
});

test('desktop smoke validates the application-reported platform and target architecture', () => {
	const expected = {
		arch: 'arm64',
		bridge: EXPECTED_BRIDGE,
		platform: 'win32',
		title: 'Soundscaper',
		url: 'soundscaper-app://bundle/',
	};
	const payload = {
		bridge: [...EXPECTED_BRIDGE],
		environment: { arch: 'arm64', platform: 'win32', version: '1.0.0' },
		hasEditor: true,
		nodeExposed: false,
		title: 'Soundscaper',
		url: 'soundscaper-app://bundle/',
	};
	assert.doesNotThrow(() => assertDesktopSmokePayload(payload, expected));
	assert.throws(
		() => assertDesktopSmokePayload({ ...payload, environment: undefined }, expected),
		/target platform/u,
	);
	assert.throws(
		() => assertDesktopSmokePayload({ ...payload, environment: { ...payload.environment, arch: 'x64' } }, expected),
		/target architecture/u,
	);
	assert.throws(
		() => assertDesktopSmokePayload({ ...payload, environment: { ...payload.environment, platform: 'linux' } }, expected),
		/target platform/u,
	);
});
