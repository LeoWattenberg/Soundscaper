/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperOpenFxHostVerifier,
	describeFramescaperOpenFxHostAvailability,
	framescaperOpenFxHostTargetFor,
} from '../desktop/framescaper-openfx-host-payload.ts';

const FILES = Object.freeze({
	'framescaper-openfx-host-build-result.json': Buffer.from('synthetic-openfx-build-result'),
	'framescaper-ofx-scanner': Buffer.from('synthetic-openfx-scanner'),
	'framescaper-ofx-runtime-host': Buffer.from('synthetic-openfx-runtime'),
	'milestone5-native-isolation-launcher': Buffer.from('synthetic-openfx-launcher'),
	'milestone5-native-isolation-profile.json': Buffer.from('synthetic-openfx-profile'),
	'milestone5-native-isolation-broker.json': Buffer.from('synthetic-openfx-broker'),
	'ld-linux-x86-64.so.2': Buffer.from('synthetic-openfx-loader'),
});
const MANIFEST_PATH = '/application/config/framescaper-openfx-host-payload-manifest.json';
const SOURCE_PREFIX = 'native/framescaper-openfx-host/prebuilt/linux-x64';
type MutableOpenFxTarget = {
	obsoleteReleaseField?: unknown;
	payload: null | { scannerPayload: { path: string } };
};

test('the OpenFX resolver admits only the five exact runtime targets', () => {
	assert.equal(framescaperOpenFxHostTargetFor('linux', 'x64'), 'linux-x64');
	assert.equal(framescaperOpenFxHostTargetFor('darwin', 'arm64'), 'mac-arm64');
	assert.equal(framescaperOpenFxHostTargetFor('win32', 'arm64'), 'win-arm64');
	assert.equal(framescaperOpenFxHostTargetFor('darwin', 'x64'), null);
	assert.equal(framescaperOpenFxHostTargetFor('freebsd', 'x64'), null);
});

test('a built target exposes only the hash-verified OpenFX and isolation closure', async () => {
	const reads: string[] = [];
	const availability = await describeFramescaperOpenFxHostAvailability(location(), ports(manifest(), reads));
	assert.equal(availability.status, 'available');
	if (availability.status !== 'available') return;
	assert.equal(availability.descriptor.scanner.sha256, digest(FILES['framescaper-ofx-scanner']));
	assert.equal(availability.descriptor.runtimeHost.sha256, digest(FILES['framescaper-ofx-runtime-host']));
	assert.deepEqual(availability.descriptor.supportedGpuBackends, ['opengl', 'opencl', 'cuda']);
	assert.equal(Object.hasOwn(availability.descriptor, 'm9ReleaseReview'), false);
	assert.equal(reads.length, 8);
});

test('packaged and prepared OpenFX payloads stay inside their selected runtime root', async () => {
	for (const [locationValue, prefix] of [
		[{ ...location(), packaged: true, resourcesPath: '/resources' },
			'/resources/runtime/native/framescaper-openfx-host/linux-x64'],
		[{ ...location(), externalRuntimeRoot: '/build/runtime' },
			'/build/runtime/native/framescaper-openfx-host/linux-x64'],
	] as const) {
		const availability = await describeFramescaperOpenFxHostAvailability(locationValue, ports(manifest()));
		assert.equal(availability.status, 'available');
		if (availability.status !== 'available') continue;
		assert.equal(availability.descriptor.scanner.path, `${prefix}/framescaper-ofx-scanner`);
		assert.equal(availability.descriptor.runtimeHost.path, `${prefix}/framescaper-ofx-runtime-host`);
	}
});

test('pending, malformed, wrong-target, and altered OpenFX closures fail closed', async () => {
	const pending = await describeFramescaperOpenFxHostAvailability(location(), ports(manifest(false)));
	assert.equal(pending.status === 'unavailable' ? pending.reason : null, 'payload-not-generated');
	for (const [label, value, alteredName, expected] of [
		['extra target field', mutateManifest((row) => { row.obsoleteReleaseField = null; }), '', 'manifest-unreadable'],
		['missing payload row', { ...manifest(), payloads: [] }, '', 'manifest-unreadable'],
		['unsafe scanner path', mutateManifest((row) => { row.payload!.scannerPayload.path = '../scanner'; }), '',
			'manifest-unreadable'],
		['altered scanner', manifest(), 'framescaper-ofx-scanner', 'payload-digest-mismatch'],
		['altered runtime', manifest(), 'framescaper-ofx-runtime-host', 'payload-digest-mismatch'],
	] as const) {
		const availability = await describeFramescaperOpenFxHostAvailability(
			location(), ports(value, [], alteredName),
		);
		assert.equal(availability.status === 'unavailable' ? availability.reason : null, expected, label);
	}
});

test('the process-spawn verifier reopens both executables on each call', async () => {
	let scannerReads = 0;
	const verify = createFramescaperOpenFxHostVerifier(location(), {
		...ports(manifest()),
		readFile: async (path) => {
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(manifest()));
			if (path.endsWith('/framescaper-ofx-scanner')) {
				scannerReads += 1;
				return scannerReads === 1 ? FILES['framescaper-ofx-scanner'] : Buffer.from('changed');
			}
			return bytesFor(path);
		},
	});
	assert.equal((await verify()).target, 'linux-x64');
	await assert.rejects(verify(), /payload-digest-mismatch/u);
});

test('the OpenFX host refuses symlink, size, missing, and inspection-time identity failures', async () => {
	for (const [label, mutate, expected] of [
		['symlink', (details: FileObservation) => ({ ...details, isSymbolicLink: () => true }),
			'payload-digest-mismatch'],
		['size', (details: FileObservation) => ({ ...details, size: details.size + 1 }),
			'payload-digest-mismatch'],
		['TOCTOU', (details: FileObservation, inspection: number) => ({
			...details, ino: details.ino + (inspection > 1 ? 1 : 0),
		}), 'payload-digest-mismatch'],
	] as const) {
		const base = ports(manifest());
		const inspections = new Map<string, number>();
		const availability = await describeFramescaperOpenFxHostAvailability(location(), {
			readFile: base.readFile,
			stat: async (path) => {
				const inspection = (inspections.get(path) ?? 0) + 1;
				inspections.set(path, inspection);
				return mutate(await base.stat(path), inspection);
			},
		});
		assert.equal(availability.status === 'unavailable' ? availability.reason : null, expected, label);
	}
	const base = ports(manifest());
	const missing = await describeFramescaperOpenFxHostAvailability(location(), {
		...base,
		readFile: async (path) => {
			if (path.endsWith('/framescaper-ofx-scanner')) {
				throw Object.assign(new Error('gone'), { code: 'ENOENT' });
			}
			return base.readFile(path);
		},
	});
	assert.equal(missing.status === 'unavailable' ? missing.reason : null, 'payload-missing');
});

function location() {
	return Object.freeze({
		applicationRoot: '/application', packaged: false, resourcesPath: '/unused',
		platform: 'linux', arch: 'x64',
	});
}

function manifest(built = true) {
	const buildResult = descriptor(`${SOURCE_PREFIX}/framescaper-openfx-host-build-result.json`,
		FILES['framescaper-openfx-host-build-result.json']);
	const scannerPayload = descriptor(`${SOURCE_PREFIX}/bin/framescaper-ofx-scanner`,
		FILES['framescaper-ofx-scanner']);
	const runtimeHostPayload = descriptor(`${SOURCE_PREFIX}/bin/framescaper-ofx-runtime-host`,
		FILES['framescaper-ofx-runtime-host']);
	const isolationPayload = {
		launcherPayload: descriptor(`${SOURCE_PREFIX}/isolation/milestone5-native-isolation-launcher`,
			FILES['milestone5-native-isolation-launcher']),
		sandboxProfilePayload: descriptor(`${SOURCE_PREFIX}/isolation/milestone5-native-isolation-profile.json`,
			FILES['milestone5-native-isolation-profile.json']),
		brokerPolicyPayload: descriptor(`${SOURCE_PREFIX}/isolation/milestone5-native-isolation-broker.json`,
			FILES['milestone5-native-isolation-broker.json']),
		runtimeLibraryPayloads: [descriptor(`${SOURCE_PREFIX}/lib/ld-linux-x86-64.so.2`,
			FILES['ld-linux-x86-64.so.2'])],
	};
	const payload = { buildResult, scannerPayload, runtimeHostPayload, isolationPayload };
	const targets = [
		{
			id: 'linux-x64', runtime: 'linux-x64', status: built ? 'built' : 'ci-generated',
			blockedBy: null,
			payload: built ? payload : null,
		},
		...[
			['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
			['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
		].map(([id, runtime]) => ({
			id, runtime, status: 'ci-generated',
			blockedBy: null, payload: null,
		})),
	];
	return {
		schemaVersion: 1, id: 'framescaper-openfx-host-1.0.0',
		sourceManifestPath: 'native/framescaper-openfx-host/source-manifest.json',
		openfx: {
			version: '1.5.1', commit: 'ab77951',
			sha256: '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5',
		},
		runtimePrefix: 'native/framescaper-openfx-host',
		payloads: built ? [{ id: 'linux-x64', runtime: 'linux-x64', ...payload }] : [],
		targets,
	};
}

function mutateManifest(mutate: (row: MutableOpenFxTarget) => void) {
	const value = structuredClone(manifest());
	mutate(value.targets[0]);
	return value;
}

function ports(value: unknown, reads: string[] = [], alteredName = '') {
	return {
		readFile: async (path: string) => {
			reads.push(path);
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(value));
			return path.endsWith(`/${alteredName}`) && alteredName !== '' ? Buffer.from('altered') : bytesFor(path);
		},
		stat: async (path: string) => ({
			isFile: () => true, isSymbolicLink: () => false,
			size: bytesFor(path).byteLength, dev: 7, ino: path.length,
		}),
	};
}

function bytesFor(path: string): Buffer {
	const name = path.split('/').at(-1) as keyof typeof FILES;
	const bytes = FILES[name];
	if (bytes === undefined) throw new Error(`Unknown fixture path ${path}.`);
	return bytes;
}

function descriptor(path: string, bytes: Buffer) {
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes) };
}

function digest(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

type FileObservation = Awaited<ReturnType<ReturnType<typeof ports>['stat']>>;
