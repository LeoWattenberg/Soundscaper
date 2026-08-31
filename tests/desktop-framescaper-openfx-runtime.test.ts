/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { startFramescaperOpenFxRuntime } from '../desktop/framescaper-openfx-runtime.ts';

const SCANNER = Buffer.from('synthetic-ofx-scanner');
const RUNTIME = Buffer.from('synthetic-ofx-runtime');
const LAUNCHER = Buffer.from('synthetic-native-isolation-launcher');
const PROFILE = Buffer.from('synthetic-isolation-profile');
const BROKER = Buffer.from('synthetic-isolation-broker');
const LOADER = Buffer.from('synthetic-runtime-loader');

test('an empty pending-external manifest creates no OpenFX manager or child authority', async () => {
	const runtime = await startFramescaperOpenFxRuntime({
		location: location(), payloadPorts: ports(manifest(false)),
	});
	assert.equal(runtime.available(), false);
	assert.equal(runtime.manager, null);
	assert.match(runtime.reason ?? '', /pending-external/iu);
	assert.equal(runtime.dispose(), true);
});

test('a built payload reaches the genuine machine-isolation gate', async () => {
	const runtime = await startFramescaperOpenFxRuntime({
		location: location(), payloadPorts: ports(manifest(true)),
	});
	assert.equal(runtime.available(), false);
	assert.equal(runtime.selfTestPassed(), false);
	assert.equal(runtime.manager, null);
	assert.match(runtime.reason ?? '', /isolation-launcher-unavailable/iu);
});

test('caller-described bytes remain disabled without their actual reopened launcher artifacts', async () => {
	const runtime = await startFramescaperOpenFxRuntime({
		location: location(), payloadPorts: ports(manifest(true)),
	});
	assert.equal(runtime.available(), false);
	assert.equal(runtime.manager, null);
	assert.match(runtime.reason ?? '', /isolation-launcher-unavailable/iu);
	assert.match(runtime.reason ?? '', /launcher artifact|no such file|ENOENT/iu);
});

test('caller-authored outer helper launchers cannot enter production composition', async () => {
	let called = 0;
	const runtime = await startFramescaperOpenFxRuntime({
		location: location(), payloadPorts: ports(manifest(true)),
		productionLauncher: {
			verify: async () => { called += 1; return {}; },
			spawnHelper: () => { called += 1; throw new Error('unreachable'); },
		},
	} as never);
	assert.equal(runtime.available(), false);
	assert.equal(runtime.manager, null);
	assert.equal(called, 0);
});

function location() {
	return Object.freeze({
		applicationRoot: '/application', packaged: false, resourcesPath: '/unused',
		platform: 'linux', arch: 'x64',
	});
}

function ports(value: unknown) {
	return Object.freeze({
		readFile: async (path: string) => {
			if (path.endsWith('manifest.json')) return Buffer.from(JSON.stringify(value));
			return payloadBytes(path);
		},
		stat: async (path: string) => {
			const bytes = payloadBytes(path);
			return {
				isFile: () => true, isSymbolicLink: () => false, size: bytes.byteLength,
				dev: 7, ino: 10 + payloadOrdinal(path),
			};
		},
	});
}

function manifest(built: boolean) {
	const scannerPayload = payload(
		'native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-scanner', SCANNER,
	);
	const runtimeHostPayload = payload(
		'native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-runtime-host', RUNTIME,
	);
	const isolationPayload = {
		launcherPayload: payload(
			'native/framescaper-openfx-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-launcher',
			LAUNCHER,
		),
		sandboxProfilePayload: payload(
			'native/framescaper-openfx-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-profile.json',
			PROFILE,
		),
		brokerPolicyPayload: payload(
			'native/framescaper-openfx-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-broker.json',
			BROKER,
		),
		runtimeLibraryPayloads: [payload(
			'native/framescaper-openfx-host/prebuilt/linux-x64/lib/ld-linux-x86-64.so.2', LOADER,
		)],
	};
	const pair = { scannerPayload, runtimeHostPayload, isolationPayload };
	const targets = [
		['linux-x64', 'linux-x64'], ['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
		['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
	].map(([id, runtime], index) => ({
		id, runtime, status: index === 0 && built ? 'built' : 'pending-external',
		blockedBy: index === 0 && built ? null : 'No verified synthetic OpenFX payload exists.',
		payload: index === 0 && built ? pair : null,
	}));
	return {
		schemaVersion: 1, id: 'framescaper-openfx-host-1.0.0',
		sourceManifestPath: 'native/framescaper-openfx-host/source-manifest.json',
		openfx: {
			version: '1.5.1', commit: 'ab77951',
			sha256: '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5',
		},
		runtimePrefix: 'native/framescaper-openfx-host',
		payloads: built ? [{ id: 'linux-x64', runtime: 'linux-x64', ...pair }] : [],
		targets,
	};
}

function payload(path: string, bytes: Uint8Array) {
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes) };
}

function payloadBytes(path: string): Buffer {
	if (path.includes('scanner')) return SCANNER;
	if (path.includes('runtime-host')) return RUNTIME;
	if (path.includes('isolation-launcher')) return LAUNCHER;
	if (path.includes('isolation-profile')) return PROFILE;
	if (path.includes('isolation-broker')) return BROKER;
	if (path.includes('ld-linux-x86-64.so.2')) return LOADER;
	throw new Error(`Unexpected fixture path: ${path}`);
}

function payloadOrdinal(path: string): number {
	return path.includes('scanner') ? 1 : path.includes('runtime-host') ? 2
		: path.includes('launcher') ? 3 : path.includes('profile') ? 4
			: path.includes('broker') ? 5 : 6;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
