/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperMediaHostVerifier,
	describeFramescaperMediaHostAvailability,
	framescaperMediaHostTargetFor,
} from '../desktop/framescaper-media-host-payload.ts';

const FILES = Object.freeze({
	'framescaper-media-host': Buffer.from('synthetic-framescaper-media-host'),
	'milestone5-native-isolation-launcher': Buffer.from('synthetic-media-launcher'),
	'milestone5-native-isolation-profile.json': Buffer.from('synthetic-media-profile'),
	'milestone5-native-isolation-broker.json': Buffer.from('synthetic-media-broker'),
	'libframescaper-media.so': Buffer.from('synthetic-media-library'),
});
const MANIFEST_PATH = '/application/config/framescaper-media-host-payload-manifest.json';
const SOURCE_PREFIX = 'native/framescaper-media-host/prebuilt/linux-x64';
type MutableMediaTarget = {
	productionReadiness?: unknown;
	runtime: string;
	payload: null | { path: string };
};

test('the media-host resolver admits only the five exact runtime targets', () => {
	assert.equal(framescaperMediaHostTargetFor('linux', 'x64'), 'linux-x64');
	assert.equal(framescaperMediaHostTargetFor('darwin', 'arm64'), 'mac-arm64');
	assert.equal(framescaperMediaHostTargetFor('win32', 'arm64'), 'win-arm64');
	assert.equal(framescaperMediaHostTargetFor('darwin', 'x64'), null);
	assert.equal(framescaperMediaHostTargetFor('freebsd', 'x64'), null);
});

test('a built target exposes only the hash-verified media and isolation closure', async () => {
	const reads: string[] = [];
	const availability = await describeFramescaperMediaHostAvailability(location(), ports(manifest(), reads));
	assert.equal(availability.status, 'available');
	if (availability.status !== 'available') return;
	assert.equal(availability.descriptor.path, `/application/${SOURCE_PREFIX}/framescaper-media-host`);
	assert.equal(availability.descriptor.sha256, digest(FILES['framescaper-media-host']));
	assert.equal(availability.descriptor.isolation.runtimeLibraries.length, 1);
	assert.equal(Object.hasOwn(availability.descriptor, 'm9ReleaseReview'), false);
	assert.equal(reads.length, 6);
});

test('packaged and prepared payloads stay inside their selected runtime root', async () => {
	for (const [locationValue, expected] of [
		[{ ...location(), packaged: true, resourcesPath: '/resources' },
			'/resources/runtime/native/framescaper-media-host/linux-x64/framescaper-media-host'],
		[{ ...location(), externalRuntimeRoot: '/build/runtime' },
			'/build/runtime/native/framescaper-media-host/linux-x64/framescaper-media-host'],
	] as const) {
		const availability = await describeFramescaperMediaHostAvailability(locationValue, ports(manifest()));
		assert.equal(availability.status, 'available');
		assert.equal(availability.status === 'available' ? availability.descriptor.path : null, expected);
	}
});

test('pending, malformed, wrong-target, and altered media closures fail closed', async () => {
	const pending = await describeFramescaperMediaHostAvailability(location(), ports(manifest(false)));
	assert.equal(pending.status === 'unavailable' ? pending.reason : null, 'payload-pending-external');
	for (const [label, value, alteredName, expected] of [
		['extra target field', mutateManifest((row) => { row.productionReadiness = null; }), '', 'manifest-unreadable'],
		['missing payload row', { ...manifest(), payloads: [] }, '', 'manifest-unreadable'],
		['wrong target runtime', mutateManifest((row) => { row.runtime = 'linux-arm64'; }), '', 'manifest-unreadable'],
		['unsafe payload path', mutateManifest((row) => { row.payload!.path = '../host'; }), '', 'manifest-unreadable'],
		['altered bytes', manifest(), 'framescaper-media-host', 'payload-digest-mismatch'],
	] as const) {
		const availability = await describeFramescaperMediaHostAvailability(
			location(), ports(value, [], alteredName),
		);
		assert.equal(availability.status === 'unavailable' ? availability.reason : null, expected, label);
	}
});

test('the process-spawn verifier reopens every payload byte on each call', async () => {
	let hostReads = 0;
	const verify = createFramescaperMediaHostVerifier(location(), {
		...ports(manifest()),
		readFile: async (path) => {
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(manifest()));
			if (path.endsWith('/framescaper-media-host')) {
				hostReads += 1;
				return hostReads === 1 ? FILES['framescaper-media-host'] : Buffer.from('changed');
			}
			return bytesFor(path);
		},
	});
	assert.equal((await verify()).target, 'linux-x64');
	await assert.rejects(verify(), /payload-digest-mismatch/u);
});

function location() {
	return Object.freeze({
		applicationRoot: '/application', packaged: false, resourcesPath: '/unused',
		platform: 'linux', arch: 'x64',
	});
}

function manifest(built = true) {
	const payload = descriptor(`${SOURCE_PREFIX}/framescaper-media-host`, FILES['framescaper-media-host']);
	const isolationPayload = {
		launcherPayload: descriptor(`${SOURCE_PREFIX}/isolation/milestone5-native-isolation-launcher`,
			FILES['milestone5-native-isolation-launcher']),
		sandboxProfilePayload: descriptor(`${SOURCE_PREFIX}/isolation/milestone5-native-isolation-profile.json`,
			FILES['milestone5-native-isolation-profile.json']),
		brokerPolicyPayload: descriptor(`${SOURCE_PREFIX}/isolation/milestone5-native-isolation-broker.json`,
			FILES['milestone5-native-isolation-broker.json']),
		runtimeLibraryPayloads: [descriptor(`${SOURCE_PREFIX}/lib/libframescaper-media.so`,
			FILES['libframescaper-media.so'])],
	};
	const targets = [
		{
			id: 'linux-x64', runtime: 'linux-x64', status: built ? 'built' : 'pending-external',
			blockedBy: built ? null : 'No verified synthetic media payload exists.',
			payload: built ? payload : null, isolationPayload: built ? isolationPayload : null,
		},
		...[
			['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
			['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
		].map(([id, runtime]) => ({
			id, runtime, status: 'pending-external',
			blockedBy: 'No verified synthetic media payload exists.', payload: null, isolationPayload: null,
		})),
	];
	return {
		schemaVersion: 1, id: 'framescaper-media-host-1.0.0',
		sourceManifestPath: 'native/framescaper-media-host/source-manifest.json',
		ffmpeg: {
			version: '9.0.1',
			sha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
		},
		runtimePrefix: 'native/framescaper-media-host',
		payloads: built ? [{ id: 'linux-x64', runtime: 'linux-x64', ...payload, isolationPayload }] : [],
		targets,
	};
}

function mutateManifest(mutate: (row: MutableMediaTarget) => void) {
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
