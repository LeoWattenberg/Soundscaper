/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	readBoundedRegularFile,
	type BoundedRegularFileHandle,
} from '../desktop/bounded-regular-file.ts';
import {
	normalizeDesktopAudioStreamCommand,
} from '../desktop/desktop-audio-stream-contract.ts';
import {
	nativeChildFileIdentityFromStat,
	canonicalNativeChildFileIdentity,
} from '../desktop/native-child-file-identity.ts';
import {
	describeNativeAddonAvailability,
	type NativeAddonAvailability,
} from '../desktop/native-addon-payload.ts';

const ADDON_BYTES = Buffer.from('authenticated native addon');
const ADDON_SHA256 = createHash('sha256').update(ADDON_BYTES).digest('hex');
const ADDON_LOCATION = Object.freeze({
	applicationRoot: '/application',
	packaged: false,
	resourcesPath: '/resources',
	platform: 'linux',
	arch: 'x64',
});
const OPERATION_ID = `desktop-audio-stream-${'ab'.repeat(16)}`;

function manifest(options: Readonly<{
	addon?: unknown;
	targets?: unknown;
}> = {}): unknown {
	return {
		addon: options.addon ?? {
			version: '1.1.0',
			napiVersion: 8,
			payloadName: 'soundscaper_helper.node',
		},
		targets: options.targets ?? [{
			id: 'linux-x64',
			status: 'built',
			blockedBy: null,
			toolchainIdentity: 'GNU 13.3.0',
			payload: {
				path: 'native/soundscaper-helper-addon/prebuilt/linux-x64/soundscaper_helper.node',
				byteLength: ADDON_BYTES.byteLength,
				sha256: ADDON_SHA256,
			},
		}],
	};
}

async function inspectManifest(
	value: unknown,
	reads: string[] = [],
): Promise<NativeAddonAvailability> {
	return await describeNativeAddonAvailability(ADDON_LOCATION, async (path) => {
		reads.push(path);
		return path.endsWith('native-addon-payload-manifest.json')
			? Buffer.from(JSON.stringify(value))
			: ADDON_BYTES;
	});
}

async function assertManifestUnreadable(value: unknown): Promise<void> {
	const availability = await inspectManifest(value);
	assert.equal(availability.status, 'unavailable');
	assert.equal(availability.reason, 'manifest-unreadable');
}

test('native addon admission rejects an empty addon version', async () => {
	await assertManifestUnreadable(manifest({
		addon: { version: '', napiVersion: 8, payloadName: 'soundscaper_helper.node' },
	}));
});

test('native addon admission rejects a non-positive N-API version', async () => {
	await assertManifestUnreadable(manifest({
		addon: { version: '1.1.0', napiVersion: 0, payloadName: 'soundscaper_helper.node' },
	}));
});

test('native addon admission rejects a payload name containing path traversal', async () => {
	await assertManifestUnreadable(manifest({
		addon: { version: '1.1.0', napiVersion: 8, payloadName: '../soundscaper_helper.node' },
	}));
});

test('native addon admission rejects duplicate target identities', async () => {
	const target = (manifest() as { targets: unknown[] }).targets[0];
	await assertManifestUnreadable(manifest({ targets: [target, target] }));
});

test('native addon admission reports a null target record as an unreadable manifest', async () => {
	await assertManifestUnreadable(manifest({ targets: [null] }));
});

test('native addon admission rejects an unknown target build status', async () => {
	const target = (manifest() as { targets: Record<string, unknown>[] }).targets[0]!;
	await assertManifestUnreadable(manifest({ targets: [{ ...target, status: 'ready' }] }));
});

test('native addon admission rejects a non-text toolchain identity', async () => {
	const target = (manifest() as { targets: Record<string, unknown>[] }).targets[0]!;
	await assertManifestUnreadable(manifest({ targets: [{ ...target, toolchainIdentity: 13 }] }));
});

test('native addon admission refuses a traversing development payload path before reading it', async () => {
	const target = (manifest() as { targets: Record<string, unknown>[] }).targets[0]!;
	const payload = target.payload as Record<string, unknown>;
	const reads: string[] = [];
	const availability = await inspectManifest(manifest({
		targets: [{ ...target, payload: { ...payload, path: '../outside.node' } }],
	}), reads);
	assert.equal(availability.status, 'unavailable');
	assert.equal(availability.reason, 'manifest-unreadable');
	assert.equal(reads.length, 1);
});

test('native addon admission rejects an unsafe payload byte length', async () => {
	const target = (manifest() as { targets: Record<string, unknown>[] }).targets[0]!;
	const payload = target.payload as Record<string, unknown>;
	await assertManifestUnreadable(manifest({
		targets: [{ ...target, payload: { ...payload, byteLength: -1 } }],
	}));
});

test('native addon admission rejects a malformed payload digest', async () => {
	const target = (manifest() as { targets: Record<string, unknown>[] }).targets[0]!;
	const payload = target.payload as Record<string, unknown>;
	await assertManifestUnreadable(manifest({
		targets: [{ ...target, payload: { ...payload, sha256: 'AB'.repeat(32) } }],
	}));
});

test('native child identity admission rejects accessors without invoking them', () => {
	let invoked = false;
	const value = { ino: '2' } as Record<string, unknown>;
	Object.defineProperty(value, 'dev', {
		enumerable: true,
		get() { invoked = true; return '1'; },
	});
	assert.throws(() => canonicalNativeChildFileIdentity(value), /identity is invalid/iu);
	assert.equal(invoked, false);
});

test('native child identity admission rejects symbol-keyed authority', () => {
	assert.throws(() => canonicalNativeChildFileIdentity({
		dev: '1', ino: '2', [Symbol('hidden')]: 'authority',
	}), /identity is invalid/iu);
});

test('native child identity admission rejects hidden non-enumerable fields', () => {
	const value = { dev: '1', ino: '2' } as Record<string, unknown>;
	Object.defineProperty(value, 'hidden', { value: true });
	assert.throws(() => canonicalNativeChildFileIdentity(value), /identity is invalid/iu);
});

test('native child identity admission requires enumerable data components', () => {
	const value = { ino: '2' } as Record<string, unknown>;
	Object.defineProperty(value, 'dev', { value: '1', enumerable: false });
	assert.throws(() => canonicalNativeChildFileIdentity(value), /identity is invalid/iu);
});

test('native child stat conversion returns an immutable unsigned snapshot', () => {
	const identity = nativeChildFileIdentityFromStat({ dev: -1n, ino: 2n });
	assert.deepEqual(identity, { dev: '18446744073709551615', ino: '2' });
	assert.equal(Object.isFrozen(identity), true);
	assert.throws(() => Object.assign(identity, { dev: '0' }), TypeError);
});

function fileHandle(options: Readonly<{
	size: number;
	isFile?: boolean;
	overflowBytesRead?: number;
	statError?: Error;
}>): BoundedRegularFileHandle & { closed: boolean; reads: number } {
	let statCount = 0;
	return {
		closed: false,
		reads: 0,
		async stat() {
			statCount += 1;
			if (options.statError) throw options.statError;
			return { size: options.size, isFile: () => options.isFile ?? true };
		},
		async read(buffer, offset, length) {
			this.reads += 1;
			if (statCount > 0 && this.reads === 1 && length > 0) {
				buffer.fill(7, offset, offset + length);
				return { bytesRead: length };
			}
			return { bytesRead: options.overflowBytesRead ?? 0 };
		},
		async close() { this.closed = true; },
	};
}

test('bounded regular-file admission rejects a negative stat size before allocation', async () => {
	const handle = fileHandle({ size: -1 });
	assert.deepEqual(await readBoundedRegularFile('/output', 8, { openFile: async () => handle }), {
		status: 'unavailable', reason: 'invalid',
	});
	assert.equal(handle.reads, 0);
});

test('bounded regular-file admission rejects a fractional stat size before allocation', async () => {
	const handle = fileHandle({ size: 1.5 });
	assert.deepEqual(await readBoundedRegularFile('/output', 8, { openFile: async () => handle }), {
		status: 'unavailable', reason: 'invalid',
	});
	assert.equal(handle.reads, 0);
});

test('bounded regular-file admission closes a handle when its initial stat fails', async () => {
	const handle = fileHandle({ size: 1, statError: new Error('device detached') });
	assert.deepEqual(await readBoundedRegularFile('/output', 8, { openFile: async () => handle }), {
		status: 'unavailable', reason: 'invalid',
	});
	assert.equal(handle.closed, true);
});

test('bounded regular-file admission rejects a negative overflow-probe count', async () => {
	const handle = fileHandle({ size: 1, overflowBytesRead: -1 });
	assert.deepEqual(await readBoundedRegularFile('/output', 8, { openFile: async () => handle }), {
		status: 'unavailable', reason: 'invalid',
	});
});

test('bounded regular-file admission rejects an overflow-probe count beyond its buffer', async () => {
	const handle = fileHandle({ size: 1, overflowBytesRead: 2 });
	assert.deepEqual(await readBoundedRegularFile('/output', 8, { openFile: async () => handle }), {
		status: 'unavailable', reason: 'invalid',
	});
});

function writeCommand(bytes: Uint8Array): unknown {
	return { type: 'write', operationId: OPERATION_ID, offset: 0, bytes };
}

test('desktop audio stream admission rejects Node Buffer packets', () => {
	assert.throws(() => normalizeDesktopAudioStreamCommand(writeCommand(Buffer.from([1]))),
		/ordinary Uint8Array/iu);
});

test('desktop audio stream admission rejects Uint8Array subclass packets', () => {
	class DerivedBytes extends Uint8Array {}
	assert.throws(() => normalizeDesktopAudioStreamCommand(writeCommand(new DerivedBytes([1]))),
		/ordinary Uint8Array/iu);
});

test('desktop audio stream admission rejects shared-memory packets', () => {
	const bytes = new Uint8Array(new SharedArrayBuffer(1));
	assert.throws(() => normalizeDesktopAudioStreamCommand(writeCommand(bytes)), /shared/iu);
});

test('desktop audio stream admission rejects packet views with loose backing storage', () => {
	const bytes = new Uint8Array(new ArrayBuffer(8), 2, 1);
	assert.throws(() => normalizeDesktopAudioStreamCommand(writeCommand(bytes)), /tightly cover/iu);
});

test('desktop audio stream admission owns packet bytes against caller mutation', () => {
	const source = Uint8Array.of(1, 2, 3);
	const command = normalizeDesktopAudioStreamCommand(writeCommand(source));
	assert.equal(command.type, 'write');
	if (command.type !== 'write') return;
	source.fill(9);
	assert.deepEqual(command.bytes, Uint8Array.of(1, 2, 3));
	assert.notEqual(command.bytes, source);
});
