/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperMediaHostVerifier,
	describeFramescaperMediaHostAvailability,
	framescaperMediaHostTargetFor,
} from '../desktop/framescaper-media-host-payload.ts';

const BYTES = Buffer.from('synthetic-framescaper-media-host');
const SHA256 = createHash('sha256').update(BYTES).digest('hex');
const MANIFEST_PATH = '/application/config/framescaper-media-host-payload-manifest.json';
const DEVELOPMENT_PATH =
	'/application/native/framescaper-media-host/prebuilt/linux-x64/framescaper-media-host';

test('the media-host resolver admits only the five exact runtime targets', () => {
	assert.equal(framescaperMediaHostTargetFor('linux', 'x64'), 'linux-x64');
	assert.equal(framescaperMediaHostTargetFor('darwin', 'arm64'), 'mac-arm64');
	assert.equal(framescaperMediaHostTargetFor('win32', 'arm64'), 'win-arm64');
	assert.equal(framescaperMediaHostTargetFor('darwin', 'x64'), null);
	assert.equal(framescaperMediaHostTargetFor('freebsd', 'x64'), null);
});

test('a built current-target payload is selected only after exact byte and identity verification', async () => {
	const reads: string[] = [];
	const availability = await describeFramescaperMediaHostAvailability(location(), {
		readFile: async (path) => {
			reads.push(path);
			return path === MANIFEST_PATH ? Buffer.from(JSON.stringify(manifest())) : BYTES;
		},
		stat: async () => fileStat(BYTES.byteLength),
	});
	assert.equal(availability.status, 'available');
	if (availability.status !== 'available') return;
	assert.deepEqual(availability.descriptor, {
		target: 'linux-x64', runtime: 'linux-x64', path: DEVELOPMENT_PATH,
		byteLength: BYTES.byteLength, sha256: SHA256, hostVersion: '1.0.0',
		ffmpegVersion: '9.0.1', identity: { dev: 7, ino: 19 },
	});
	assert.deepEqual(reads, [MANIFEST_PATH, DEVELOPMENT_PATH]);
});

test('packaged payloads resolve only below the verified runtime prefix', async () => {
	const reads: string[] = [];
	const availability = await describeFramescaperMediaHostAvailability({
		...location(), packaged: true, resourcesPath: '/resources',
	}, {
		readFile: async (path) => {
			reads.push(path);
			return path === MANIFEST_PATH ? Buffer.from(JSON.stringify(manifest())) : BYTES;
		},
		stat: async () => fileStat(BYTES.byteLength),
	});
	assert.equal(availability.status, 'available');
	if (availability.status !== 'available') return;
	assert.equal(
		availability.descriptor.path,
		'/resources/runtime/native/framescaper-media-host/linux-x64/framescaper-media-host',
	);
	assert.equal(reads.at(-1), availability.descriptor.path);
});

test('prepared desktop development resolves only from its staged external runtime', async () => {
	const expected = '/build/runtime/native/framescaper-media-host/linux-x64/framescaper-media-host';
	const reads: string[] = [];
	const availability = await describeFramescaperMediaHostAvailability({
		...location(), externalRuntimeRoot: '/build/runtime',
	}, {
		readFile: async (path) => {
			reads.push(path);
			return path === MANIFEST_PATH ? Buffer.from(JSON.stringify(manifest())) : BYTES;
		},
		stat: async () => fileStat(BYTES.byteLength),
	});
	assert.equal(availability.status, 'available');
	assert.equal(availability.status === 'available' ? availability.descriptor.path : null, expected);
	assert.equal(reads.at(-1), expected);
});

test('pending, missing, altered, and malformed payloads stay explicitly unavailable', async () => {
	const pending = manifest({ built: false });
	const pendingResult = await describeFramescaperMediaHostAvailability(location(), ports(pending));
	assert.equal(pendingResult.status, 'unavailable');
	assert.equal(pendingResult.status === 'unavailable' ? pendingResult.reason : null, 'payload-pending-external');

	for (const [label, alteredManifest, payload, reason] of [
		['missing payload row', { ...manifest(), payloads: [] }, BYTES, 'manifest-unreadable'],
		['duplicate payload row', { ...manifest(), payloads: [manifest().payloads[0], manifest().payloads[0]] }, BYTES,
			'manifest-unreadable'],
		['wrong runtime', manifest({ runtime: 'linux-arm64' }), BYTES, 'manifest-unreadable'],
		['unsafe path', manifest({ path: '../framescaper-media-host' }), BYTES, 'manifest-unreadable'],
		['altered bytes', manifest(), Buffer.from('altered'), 'payload-digest-mismatch'],
	] as const) {
		const result = await describeFramescaperMediaHostAvailability(
			location(), ports(alteredManifest, payload),
		);
		assert.equal(result.status, 'unavailable', label);
		assert.equal(result.status === 'unavailable' ? result.reason : null, reason, label);
	}
});

test('the spawn verifier fails closed and rechecks the payload on every call', async () => {
	let payloadReads = 0;
	const verify = createFramescaperMediaHostVerifier(location(), {
		readFile: async (path) => {
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(manifest()));
			payloadReads += 1;
			return payloadReads === 1 ? BYTES : Buffer.from('changed');
		},
		stat: async () => fileStat(BYTES.byteLength),
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

function manifest(overrides: Readonly<{
	built?: boolean;
	runtime?: string;
	path?: string;
}> = {}) {
	const built = overrides.built ?? true;
	const runtime = overrides.runtime ?? 'linux-x64';
	const path = overrides.path
		?? 'native/framescaper-media-host/prebuilt/linux-x64/framescaper-media-host';
	const payload = { path, byteLength: BYTES.byteLength, sha256: SHA256 };
	const selected = {
		id: 'linux-x64', runtime,
		status: built ? 'built' : 'pending-external',
		blockedBy: built ? null : 'No qualified synthetic payload exists.',
		payload: built ? payload : null,
	};
	const pending = [
		['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
		['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
	].map(([id, targetRuntime]) => ({
		id, runtime: targetRuntime, status: 'pending-external',
		blockedBy: 'No qualified synthetic payload exists.', payload: null,
	}));
	return {
		schemaVersion: 1,
		id: 'framescaper-media-host-1.0.0',
		sourceManifestPath: 'native/framescaper-media-host/source-manifest.json',
		ffmpeg: {
			version: '9.0.1',
			sha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
		},
		runtimePrefix: 'native/framescaper-media-host',
		payloads: built ? [{ id: 'linux-x64', runtime, ...payload }] : [],
		targets: [selected, ...pending],
	};
}

function ports(value: unknown, payload = BYTES) {
	return {
		readFile: async (path: string) => path === MANIFEST_PATH
			? Buffer.from(JSON.stringify(value)) : payload,
		stat: async () => fileStat(payload.byteLength),
	};
}

function fileStat(size: number) {
	return Object.freeze({ isFile: () => true, isSymbolicLink: () => false, size, dev: 7, ino: 19 });
}
