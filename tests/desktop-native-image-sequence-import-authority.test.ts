/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import {
	FramescaperNativeImageSequenceImportAuthority,
} from '../desktop/native-image-sequence-import-authority.ts';
import {
	assertFramescaperNativeImageSequenceImportRequest,
} from '../desktop/native-image-sequence-import-contract.ts';
import {
	FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS,
	registerFramescaperNativeImageSequenceImportMainIpc,
} from '../desktop/native-image-sequence-import-main-ipc.ts';
import {
	createFramescaperNativeImageSequenceImportPreloadTransport,
} from '../desktop/native-image-sequence-import-preload.ts';
import { imageSequenceStorageSha256 } from '../desktop/native-image-sequence-import-storage.ts';
import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	createNativeMediaImageSequenceInventoryV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import {
	createNativeMediaImageSequenceSourcePackV25,
} from '../src/common/editor/native-media-image-sequence-pack-v25.ts';
import { resolveNativeMediaImageSequence } from '../src/common/editor/native-media-image-sequence.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import {
	createFramescaperImageSequenceProductionPortsProfessionalMedia,
} from '../src/framescaper/editor-native-image-sequence-import-production-ports.ts';
import type {
	FramescaperImageSequenceNativeAdmissionRequest,
} from '../src/framescaper/editor-native-image-sequence-import-production-ports.ts';
import type { NativeMediaHelperPoolJobRequest } from '../desktop/native-media-helper-pool.ts';

const OWNER = Object.freeze({ id: 'candidate-renderer' });
const PROJECT_IDENTITY = Object.freeze({
	schemaFamily: 'framescaper' as const,
	schemaVersion: 1 as const,
});

test('the production baseline ports stream pathless bytes over the negotiated MessagePort', async () => {
	const fixture = await authorityFixture(true);
	const assets = await sequenceAssets(['one', 'two']);
	const handlers = new Map<string, (event: unknown, request: unknown) => unknown>();
	const listeners = new Map<string, (event: unknown, request: unknown) => void>();
	const controlValues: unknown[] = [];
	const registration = registerFramescaperNativeImageSequenceImportMainIpc({
		handle: (channel, handler) => handlers.set(channel, handler),
		removeHandler: (channel) => { handlers.delete(channel); },
		on: (channel, listener) => listeners.set(channel, listener),
		removeListener: (channel) => { listeners.delete(channel); },
		authorizeOwner: () => OWNER,
		authority: fixture.authority,
	});
	await assert.rejects(async () => handlers.get(
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control,
	)!({}, { operation: 'write', transactionId: '0'.repeat(40), asset: 'pack', offset: 0,
		bytes: new Uint8Array([1]) }), /MessagePort data plane/iu);
	const transport = createFramescaperNativeImageSequenceImportPreloadTransport({
		invoke: async (channel, request) => {
			controlValues.push(structuredClone(request));
			return handlers.get(channel)!({}, request);
		},
		postMessage: (channel, request, transfer) => {
			listeners.get(channel)!({ ports: transfer }, request);
		},
		createMessageChannel: () => new MessageChannel() as never,
	});
	const ports = createFramescaperImageSequenceProductionPortsProfessionalMedia({
		bridge: { ...transport, capabilities: async () => capabilitySnapshot(true) },
		projectId: 'candidate-project', projectRevision: 4,
	});
	const writer = await ports.createSourcePackWriter();
	for (let offset = 0; offset < assets.packBytes.byteLength; offset += 3) {
		await writer.write(assets.packBytes.slice(offset, Math.min(offset + 3, assets.packBytes.byteLength)));
	}
	await writer.commit(assets.pack);
	await ports.publishInventory(assets.inventory.bytes, assets.inventory.reference);
	assert.deepEqual(await ports.readCommittedBody({
		asset: 'pack', reference: assets.pack, offset: 0, length: assets.pack.byteLength,
	}), assets.packBytes, 'the renderer can mirror only its own committed transaction body');
	assert.deepEqual(await ports.readCommittedBody({
		asset: 'inventory', reference: assets.inventory.reference,
		offset: 0, length: assets.inventory.reference.byteLength,
	}), assets.inventory.bytes);
	const request = admission('unused', assets);
	const result = await ports.admit(request) as Readonly<{ admitted: boolean }>;
	assert.equal(result.admitted, true);
	fixture.project.revision = 5;
	fixture.project.storageKeys.add(assets.inventory.reference.storageKey);
	fixture.project.storageKeys.add(assets.pack.storageKey);
	await ports.complete!(request);
	assert.equal(fixture.probedFrames, 2);
	assert.equal(controlValues.some((value) => JSON.stringify(value).includes(fixture.root)), false);
	assert.equal(controlValues.some((value) => containsBytes(value)), false,
		'control IPC never carries media bytes');
	const transactionId = String((controlValues.find((value) => (
		(value as { operation?: string }).operation === 'prepare-write'
	)) as { transactionId: string }).transactionId);
	await assert.rejects(() => fixture.authority.request({}, {
		operation: 'read', transactionId,
		asset: 'pack', offset: 0, length: 1,
	}), /owner/iu, 'a caller cannot read another renderer transaction by digest or ID');
	await registration.dispose();
	assert.equal(handlers.has(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control), false);
});

test('the main-owned authority durably admits exact pathless pack and inventory bytes', async () => {
	const fixture = await authorityFixture(true);
	const assets = await sequenceAssets(['one', 'two']);
	const begun = await fixture.authority.request(OWNER, {
		operation: 'begin', ...PROJECT_IDENTITY,
		projectId: 'candidate-project', projectRevision: 4,
	});
	assert.equal(JSON.stringify(begun).includes(fixture.root), false);
	const transactionId = String((begun as { transactionId: string }).transactionId);
	await publishAssets(fixture.authority, transactionId, assets);

	const admitted = await fixture.authority.request(OWNER, {
		operation: 'admit', transactionId,
		admission: admission(transactionId, assets),
	}) as Readonly<{ result: Readonly<Record<string, unknown>> }>;
	assert.equal(admitted.result.admitted, true);
	assert.equal(admitted.result.inventorySha256, assets.inventory.reference.sha256);
	assert.equal(admitted.result.sourcePackSha256, assets.pack.sha256);
	assert.equal(fixture.probedFrames, 2, 'every frame is checked by native professional admission');
	assert.equal(JSON.stringify(admitted).includes(fixture.root), false);

	fixture.project.revision = 5;
	fixture.project.storageKeys.add(assets.inventory.reference.storageKey);
	fixture.project.storageKeys.add(assets.pack.storageKey);
	assert.deepEqual(await fixture.authority.request(OWNER, {
		operation: 'complete', transactionId, sourceId: 'sequence-source',
		inventorySha256: assets.inventory.reference.sha256,
		sourcePackSha256: assets.pack.sha256,
	}), { operation: 'completed', transactionId });
	assert.deepEqual(await fixture.authority.readProjectBody({
		storageKey: assets.inventory.reference.storageKey, offset: 0,
		length: assets.inventory.reference.byteLength,
	}), assets.inventory.bytes);
	assert.deepEqual(await fixture.authority.readProjectBody({
		storageKey: assets.pack.storageKey, offset: 0, length: assets.pack.byteLength,
	}), assets.packBytes);
	assert.deepEqual(await fixture.authority.recover(), {
		transactionsRemoved: 0, assetsRemoved: 0, assetsRetained: 0,
	});
});

test('tampered durable bytes fail admission and discard removes authenticated assets', async () => {
	const fixture = await authorityFixture(true);
	const assets = await sequenceAssets(['one']);
	const begun = await fixture.authority.request(OWNER, {
		operation: 'begin', ...PROJECT_IDENTITY,
		projectId: 'candidate-project', projectRevision: 4,
	}) as { transactionId: string };
	await publishAssets(fixture.authority, begun.transactionId, assets);
	const packPath = (await filesBelow(fixture.root)).find((path) => path.endsWith('.pack'))!;
	const tampered = new Uint8Array(await readFile(packPath));
	tampered[tampered.length - 1] ^= 0xff;
	await writeFile(packPath, tampered);
	await assert.rejects(() => fixture.authority.request(OWNER, {
		operation: 'admit', transactionId: begun.transactionId,
		admission: admission(begun.transactionId, assets),
	}), /digest|changed|authenticate/iu);
	assert.deepEqual(await fixture.authority.request(OWNER, {
		operation: 'discard', transactionId: begun.transactionId,
	}), { operation: 'discarded', transactionId: begun.transactionId, discarded: true });
	assert.equal((await filesBelow(fixture.root)).some((path) => /\.(pack|inventory)$/u.test(path)), false);
});

test('a failed data-plane receive is handled and permits a same-asset retry', async () => {
	const fixture = await authorityFixture(true);
	const begun = await fixture.authority.request(OWNER, {
		operation: 'begin', ...PROJECT_IDENTITY,
		projectId: 'candidate-project', projectRevision: 4,
	}) as { transactionId: string };
	const first = importBinding('a'.repeat(40));
	await fixture.authority.request(OWNER, {
		operation: 'prepare-write', transactionId: begun.transactionId,
		asset: 'pack', offset: 0, binding: first,
	});
	const channel = new MessageChannel();
	const receiving = fixture.authority.receiveChunk(OWNER, {
		transactionId: begun.transactionId, asset: 'pack', offset: 0, binding: first,
	}, channel.port1 as never);
	channel.port2.postMessage({ invalid: true });
	await assert.rejects(receiving, /data-plane|message|record|type/iu);

	const retry = importBinding('b'.repeat(40));
	await fixture.authority.request(OWNER, {
		operation: 'prepare-write', transactionId: begun.transactionId,
		asset: 'pack', offset: 0, binding: retry,
	});
	const awaiting = assert.rejects(fixture.authority.request(OWNER, {
		operation: 'await-write', transactionId: begun.transactionId,
		asset: 'pack', offset: 0, streamId: retry.streamId,
	}), /discarded/iu);
	await fixture.authority.request(OWNER, {
		operation: 'discard', transactionId: begun.transactionId,
	});
	await awaiting;
});

test('restart recovery reclaims unreferenced transactions and retains referenced project bodies', async () => {
	const fixture = await authorityFixture(true);
	const orphan = await sequenceAssets(['orphan']);
	const retained = await sequenceAssets(['retained']);
	for (const assets of [orphan, retained]) {
		const begun = await fixture.authority.request(OWNER, {
			operation: 'begin', ...PROJECT_IDENTITY,
			projectId: 'candidate-project', projectRevision: 4,
		}) as { transactionId: string };
		await publishAssets(fixture.authority, begun.transactionId, assets);
	}
	fixture.project.storageKeys.add(retained.inventory.reference.storageKey);
	fixture.project.storageKeys.add(retained.pack.storageKey);
	const restarted = fixture.createAuthority();
	assert.deepEqual(await restarted.recover(), {
		transactionsRemoved: 2, assetsRemoved: 2, assetsRetained: 2,
	});
	assert.equal((await filesBelow(fixture.root)).some((path) => path.includes(orphan.pack.sha256)), false);
	assert.equal((await filesBelow(fixture.root)).some((path) => path.includes(retained.pack.sha256)), true);
});

test('asset authority persists recovery ownership before publishing an object link', async () => {
	let root = '';
	let persistedReference = false;
	const fixture = await authorityFixture(true, {
		linkAsset: async () => {
			const manifestPath = (await filesBelow(root)).find((path) => path.endsWith('manifest.json'))!;
			const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as
				Readonly<{ pack?: { sha256?: string } | null }>;
			persistedReference = manifest.pack?.sha256 === assets.pack.sha256;
			throw new Error('simulated link interruption');
		},
	});
	root = fixture.root;
	const assets = await sequenceAssets(['orphan']);
	const begun = await fixture.authority.request(OWNER, {
		operation: 'begin', ...PROJECT_IDENTITY,
		projectId: 'candidate-project', projectRevision: 4,
	}) as { transactionId: string };
	await fixture.authority.request(OWNER, {
		operation: 'write', transactionId: begun.transactionId, asset: 'pack', offset: 0,
		bytes: assets.packBytes,
	});
	await assert.rejects(fixture.authority.request(OWNER, {
		operation: 'commit', transactionId: begun.transactionId, asset: 'pack', reference: assets.pack,
	}), /simulated link interruption/u);
	assert.equal(persistedReference, true,
		'recovery authority must be durable before the final object can appear');
});

test('default-off capability and wrong owner fail before durable or native work', async () => {
	const blocked = await authorityFixture(false);
	await assert.rejects(() => blocked.authority.request(OWNER, {
		operation: 'begin', ...PROJECT_IDENTITY,
		projectId: 'candidate-project', projectRevision: 4,
	}), /disabled|unavailable|policy/iu);
	assert.equal(blocked.probedFrames, 0);
	assert.deepEqual(await filesBelow(blocked.root), []);

	const usable = await authorityFixture(true);
	const begun = await usable.authority.request(OWNER, {
		operation: 'begin', ...PROJECT_IDENTITY,
		projectId: 'candidate-project', projectRevision: 4,
	}) as { transactionId: string };
	await assert.rejects(() => usable.authority.request({}, {
		operation: 'discard', transactionId: begun.transactionId,
	}), /owner/iu);
});

test('hostile control envelopes fail without invoking accessors or traversing deep values', () => {
	let getterCalls = 0;
	const accessor = {};
	Object.defineProperty(accessor, 'operation', {
		enumerable: true,
		get: () => { getterCalls += 1; return 'discard'; },
	});
	Object.defineProperty(accessor, 'transactionId', {
		enumerable: true, value: '0'.repeat(40),
	});
	assert.throws(() => assertFramescaperNativeImageSequenceImportRequest(
		accessor, { allowDirectWrite: false, controlEnvelope: true },
	), /data|malformed|record/iu);
	assert.equal(getterCalls, 0);

	let nested: unknown = null;
	for (let depth = 0; depth < 66; depth += 1) nested = { value: nested };
	assert.throws(() => assertFramescaperNativeImageSequenceImportRequest({
		operation: 'admit', transactionId: '0'.repeat(40), admission: nested,
	}, { allowDirectWrite: false, controlEnvelope: true }), /nesting|depth/iu);
});

test('recovery refuses a re-authenticated manifest with a traversal asset identity', async () => {
	const fixture = await authorityFixture(true);
	const assets = await sequenceAssets(['one']);
	const begun = await fixture.authority.request(OWNER, {
		operation: 'begin', ...PROJECT_IDENTITY,
		projectId: 'candidate-project', projectRevision: 4,
	}) as { transactionId: string };
	await publishAssets(fixture.authority, begun.transactionId, assets);
	const victim = join(fixture.root, 'victim.pack');
	await writeFile(victim, 'must survive', 'utf8');
	const manifestPath = (await filesBelow(fixture.root)).find((path) => path.endsWith('manifest.json'))!;
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
	const { authenticator: _ignored, ...body } = manifest;
	body.pack = { ...(body.pack as Record<string, unknown>), sha256: '../victim' };
	await writeFile(manifestPath, JSON.stringify({
		...body,
		authenticator: imageSequenceStorageSha256(JSON.stringify(body)),
	}), 'utf8');
	assert.deepEqual(await fixture.createAuthority().recover(), {
		transactionsRemoved: 1, assetsRemoved: 0, assetsRetained: 0,
	});
	assert.equal(await readFile(victim, 'utf8'), 'must survive');
});

async function authorityFixture(usable: boolean, options: Readonly<{
	linkAsset?: (source: string, destination: string) => PromiseLike<void> | void;
}> = {}) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-sequence-import-'));
	const project = { revision: 4, storageKeys: new Set<string>() };
	let id = 0;
	let probedFrames = 0;
	const createAuthority = () => new FramescaperNativeImageSequenceImportAuthority({
		root,
		linkAsset: options.linkAsset,
		mintOpaqueId: () => `${(++id).toString(16).padStart(40, '0')}`,
		capabilities: () => capabilitySnapshot(usable),
		runtimeAvailable: () => usable,
		projectState: (projectId: string) => projectId === 'candidate-project'
			? { ...PROJECT_IDENTITY, open: true, writable: true, revision: project.revision }
			: null,
		projectContainsImageSequence: ({ inventoryStorageKey, sourcePackStorageKey }) => (
			project.storageKeys.has(inventoryStorageKey)
			&& project.storageKeys.has(sourcePackStorageKey)
		),
		assetReferenced: (storageKey: string) => project.storageKeys.has(storageKey),
		mediaRuntime: {
			available: () => usable,
			runJob: async (request: NativeMediaHelperPoolJobRequest) => {
				probedFrames += 1;
				const grant = request.grant as Readonly<{ mediaPath: string; mediaBytes: number }>;
				assert.equal((await readFile(grant.mediaPath)).byteLength, grant.mediaBytes);
				return {
					timingAsset: new Uint8Array(32), nominalRate: { num: 24, den: 1 },
					characteristics: characteristics(),
				};
			},
		},
	});
	const authority = createAuthority();
	return {
		root, project, authority, createAuthority,
		get probedFrames() { return probedFrames; },
	};
}

function importBinding(streamId: string) {
	const bytes = Uint8Array.of(1);
	return Object.freeze({
		dataPlaneVersion: 1 as const, transport: 'message-port' as const, streamId,
		direction: 'host-to-helper' as const, byteLength: bytes.byteLength,
		sha256: imageSequenceStorageSha256(String.fromCharCode(...bytes)),
		maximumChunkBytes: 4 * 1024 * 1024, maximumInFlightChunks: 1,
	});
}

async function sequenceAssets(contents: readonly string[]) {
	const files = contents.map((content, index) => ({
		name: `shot.${String(index + 1).padStart(4, '0')}.png`,
		bytes: new TextEncoder().encode(content),
	}));
	const resolved = resolveNativeMediaImageSequence({
		fileNames: files.map(({ name }) => name), frameRate: { num: 24, den: 1 },
	});
	const { sha256 } = await import('@noble/hashes/sha2.js');
	const { bytesToHex } = await import('@noble/hashes/utils.js');
	const entries = files.map(({ name, bytes }, index) => ({
		fileName: name, frameNumber: index + 1, byteLength: bytes.byteLength,
		sha256: bytesToHex(sha256(bytes)),
	}));
	const inventory = createNativeMediaImageSequenceInventoryV25(resolved, entries);
	const chunks: Uint8Array[] = [];
	const pack = await createNativeMediaImageSequenceSourcePackV25({
		inventory: inventory.reference, entries, frameRate: resolved.frameRate,
		frameChunks: (index) => [files[index]!.bytes],
		write: (chunk) => { chunks.push(chunk.slice()); },
	});
	const packBytes = concatenate(chunks);
	return { inventory, entries, pack, packBytes };
}

async function publishAssets(
	authority: FramescaperNativeImageSequenceImportAuthority,
	transactionId: string,
	assets: Awaited<ReturnType<typeof sequenceAssets>>,
) {
	for (const [asset, bytes] of [
		['pack', assets.packBytes], ['inventory', assets.inventory.bytes],
	] as const) {
		for (let offset = 0; offset < bytes.byteLength;) {
			const chunk = bytes.slice(offset, Math.min(offset + 3, bytes.byteLength));
			await authority.request(OWNER, {
				operation: 'write', transactionId, asset, offset, bytes: chunk,
			});
			offset += chunk.byteLength;
		}
		await authority.request(OWNER, {
			operation: 'commit', transactionId, asset,
			reference: asset === 'pack' ? assets.pack : assets.inventory.reference,
		});
	}
}

function admission(
	_transactionId: string,
	assets: Awaited<ReturnType<typeof sequenceAssets>>,
): FramescaperImageSequenceNativeAdmissionRequest {
	return {
		kind: 'framescaper-image-sequence-admission-v1', ...PROJECT_IDENTITY,
		projectId: 'candidate-project', projectRevision: 4, sourceId: 'sequence-source',
		profileId: 'decode-png-sequence', frameRate: { num: 24, den: 1 },
		frameCount: assets.entries.length, inventory: assets.inventory.reference,
		sourcePack: assets.pack,
	};
}

function capabilitySnapshot(usable: boolean) {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: usable,
		entries: [{
			domain: 'operation', id: 'image-sequence-import',
			buildSupported: usable, probeSucceeded: usable, selfTestPassed: usable,
			userEnabled: usable,
		}],
	});
}

function characteristics() {
	return normalizeVideoSourceCharacteristicsV25({
		backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
		hasAlpha: false, videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgb24',
		chromaFormat: '4:4:4', alphaMode: null, alphaInterpretation: null,
		colour: { primaries: 'srgb', transfer: 'iec61966-2-1', matrix: 'rgb', range: 'full' },
	});
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}

function containsBytes(value: unknown): boolean {
	if (value instanceof Uint8Array || value instanceof ArrayBuffer) return true;
	if (!value || typeof value !== 'object') return false;
	return Object.values(value as Record<string, unknown>).some(containsBytes);
}

async function filesBelow(root: string): Promise<string[]> {
	const results: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		let entries;
		try { entries = await readdir(directory, { withFileTypes: true }); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
			throw error;
		}
		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else results.push(path);
		}
	};
	await visit(root);
	return results.sort();
}
