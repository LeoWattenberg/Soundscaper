/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	lstat, mkdir, mkdtemp, readFile, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { MessageChannel, MessagePort } from 'node:worker_threads';

import {
	createFramescaperNativeImageSequenceRegistration,
} from '../desktop/framescaper-native-image-sequence-registration.ts';
import type { HelperDataPlaneBinding } from '../desktop/helper-data-plane.ts';
import {
	receiveHelperDataPlaneFile,
	sendHelperDataPlaneReservedFile,
	type HelperDataPlaneIoPort,
} from '../desktop/helper-data-plane-io.ts';
import type { HelperDataPlaneOutputReservation } from
	'../desktop/helper-data-plane-output-reservation.ts';
import type { HelperMediaImageSequenceDecodeJobGrant } from
	'../desktop/helper-native-job-contract.ts';
import {
	FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_DECODE_CHANNEL,
} from '../desktop/native-image-sequence-decode-main-ipc.ts';
import {
	framescaperNativeImageSequenceAssetPath,
} from '../desktop/native-image-sequence-import-contract.ts';
import {
	FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS,
} from '../desktop/native-image-sequence-import-main-ipc.ts';
import type { NativeMediaHelperPoolJobRequest } from '../desktop/native-media-helper-pool.ts';
import { createNativeMediaCapabilitySnapshotV1 } from
	'../src/common/editor/native-media-capability-snapshot.ts';

const PROJECT_ID = 'sequence-project';
const SOURCE_ID = 'sequence-source';
const REVISION = 8;
const RATE = Object.freeze({ num: 60_000, den: 1_001 });
const PROJECT_IDENTITY = Object.freeze({
	schemaFamily: 'framescaper' as const,
	schemaVersion: 1 as const,
});

test('a failed decode IPC mount rolls the import IPC mount back', async (t) => {
	const fixture = await registrationFixture(t);
	const harness = rendererBridge(new Map(), FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_DECODE_CHANNEL);

	assert.throws(
		() => fixture.registration.registerRendererBridge(harness.bridge),
		/simulated decode IPC mount failure/u,
	);
	assert.deepEqual(harness.mounts, [
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control,
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_DECODE_CHANNEL,
	]);
	assert.deepEqual(harness.listenerMounts, [
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.port,
	]);
	assert.deepEqual(harness.handlerRemovals, [
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control,
	]);
	assert.deepEqual(harness.listenerRemovals, [
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.port,
	]);
	assert.equal(harness.handlers.size, 0);
	assert.equal(harness.listeners.size, 0);

	await fixture.registration.dispose();
	await fixture.registration.dispose();
	assert.equal(harness.handlerRemovals.length, 1, 'rolled-back IPC is removed only once');
	assert.equal(harness.listenerRemovals.length, 1, 'rolled-back listener is removed only once');
});

test('owner revocation fences both services and repeated disposal cleans live resources once', async (t) => {
	const fixture = await registrationFixture(t);
	const firstOwner = Object.freeze({ id: 'first-renderer' });
	const secondOwner = Object.freeze({ id: 'second-renderer' });
	const firstEvent = Object.freeze({ id: 'first-event' });
	const secondEvent = Object.freeze({ id: 'second-event' });
	const harness = rendererBridge(new Map<object, object>([
		[firstEvent, firstOwner], [secondEvent, secondOwner],
	]));
	fixture.registration.registerRendererBridge(harness.bridge);

	const first = await stageOwnedResources(harness, firstEvent, 1);
	assert.equal(await exists(join(fixture.root, 'transactions', first.transactionId)), true);
	assert.equal(await exists(join(fixture.root, 'decoded-claims', `${first.claimId}.rgba-pack`)), true);

	await fixture.registration.revokeOwner(firstOwner);
	assert.equal(await exists(join(fixture.root, 'transactions', first.transactionId)), false);
	assert.equal(await exists(join(fixture.root, 'decoded-claims', `${first.claimId}.rgba-pack`)), false);
	await assert.rejects(async () => harness.invoke(
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control,
		firstEvent,
		{ operation: 'discard', transactionId: first.transactionId },
	), /wrong owner/iu);
	await assert.rejects(async () => harness.invoke(
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_DECODE_CHANNEL,
		firstEvent,
		{ operation: 'read', claimId: first.claimId, offset: 0, length: 1 },
	), /outside this owner claim/iu);

	const second = await stageOwnedResources(harness, secondEvent, 2);
	const secondTransaction = join(fixture.root, 'transactions', second.transactionId);
	const secondClaim = join(fixture.root, 'decoded-claims', `${second.claimId}.rgba-pack`);
	assert.equal(await exists(secondTransaction), true);
	assert.equal(await exists(secondClaim), true);

	await fixture.registration.dispose();
	await fixture.registration.dispose();
	assert.equal(await exists(secondTransaction), false);
	assert.equal(await exists(secondClaim), false);
	assert.equal(fixture.jobs(), 2);
	assert.deepEqual(harness.handlerRemovals, [
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control,
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_DECODE_CHANNEL,
	]);
	assert.deepEqual(harness.listenerRemovals, [
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.port,
	]);
	assert.equal(harness.handlers.size, 0);
	assert.equal(harness.listeners.size, 0);
});

test('image-sequence decode reclaims and uses its separate cache directory', async (t) => {
	const fixture = await registrationFixture(t, true);
	assert.equal(await exists(join(fixture.cacheScratchRoot, 'stale')), false);
	const owner = {}, event = {};
	const harness = rendererBridge(new Map([[event, owner]]));
	fixture.registration.registerRendererBridge(harness.bridge);
	await stageOwnedResources(harness, event, 1);
	assert.equal(await exists(fixture.cacheScratchRoot), true);
	assert.equal(await exists(join(fixture.userDataPath, 'framescaper-native-image-sequence-decode-helper')), false);
});

type Handler = (event: unknown, request?: unknown) => unknown;
type Listener = (event: unknown, request?: unknown) => void;

function rendererBridge(
	owners: ReadonlyMap<object, object>,
	failingChannel?: string,
) {
	const handlers = new Map<string, Handler>();
	const listeners = new Map<string, Listener>();
	const mounts: string[] = [];
	const listenerMounts: string[] = [];
	const handlerRemovals: string[] = [];
	const listenerRemovals: string[] = [];
	const bridge = {
		handle(channel: string, handler: Handler): void {
			mounts.push(channel);
			if (channel === failingChannel) throw new Error('simulated decode IPC mount failure');
			assert.equal(handlers.has(channel), false);
			handlers.set(channel, handler);
		},
		removeHandler(channel: string): void {
			handlerRemovals.push(channel);
			handlers.delete(channel);
		},
		on(channel: string, listener: Listener): void {
			listenerMounts.push(channel);
			assert.equal(listeners.has(channel), false);
			listeners.set(channel, listener);
		},
		removeListener(channel: string, listener: Listener): void {
			listenerRemovals.push(channel);
			assert.equal(listeners.get(channel), listener);
			listeners.delete(channel);
		},
		ownerFor(event: unknown): object | null {
			return event && typeof event === 'object' ? owners.get(event) ?? null : null;
		},
	};
	return Object.freeze({
		bridge, handlers, listeners, mounts, listenerMounts, handlerRemovals, listenerRemovals,
		invoke(channel: string, event: object, request: unknown): unknown {
			const handler = handlers.get(channel);
			assert.ok(handler, `missing IPC handler ${channel}`);
			return handler(event, request);
		},
	});
}

async function stageOwnedResources(
	harness: ReturnType<typeof rendererBridge>,
	event: object,
	requestOrdinal: number,
): Promise<Readonly<{ transactionId: string; claimId: string }>> {
	const begun = await harness.invoke(
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control,
		event,
		{
			operation: 'begin', ...PROJECT_IDENTITY,
			projectId: PROJECT_ID, projectRevision: REVISION,
		},
	);
	const claim = await harness.invoke(
		FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_DECODE_CHANNEL,
		event,
		{
			operation: 'decode', ...PROJECT_IDENTITY,
			requestId: opaque(100 + requestOrdinal), projectId: PROJECT_ID,
			projectRevision: REVISION, sourceId: SOURCE_ID,
		},
	);
	return Object.freeze({
		transactionId: stringField(begun, 'transactionId'),
		claimId: stringField(claim, 'claimId'),
	});
}

async function registrationFixture(t: TestContext, separateCacheDirectory = false) {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-sequence-registration-'));
	const userDataPath = join(directory, 'user-data');
	const cacheDataPath = separateCacheDirectory ? join(directory, 'cache') : undefined;
	const cacheScratchRoot = join(cacheDataPath ?? userDataPath, 'framescaper-native-image-sequence-decode-helper');
	await mkdir(cacheScratchRoot, { recursive: true });
	await writeFile(join(cacheScratchRoot, 'stale'), 'stale');
	const root = join(userDataPath, 'framescaper-native-image-sequence-import-v1');
	const packBytes = Uint8Array.of(1, 2, 3);
	const inventoryBytes = new TextEncoder().encode('{"schemaVersion":1}');
	const packSha256 = digest(packBytes);
	const inventorySha256 = digest(inventoryBytes);
	const pack = Object.freeze({
		kind: 'image-sequence-source-pack' as const,
		storageKey: `image-sequence-pack-sha256:${packSha256}`,
		sha256: packSha256, byteLength: packBytes.byteLength,
	});
	const inventory = Object.freeze({
		kind: 'image-sequence-inventory' as const, version: 1 as const,
		storageKey: `image-sequence-inventory-sha256:${inventorySha256}`,
		sha256: inventorySha256, byteLength: inventoryBytes.byteLength,
		frameCount: 1, firstFrameNumber: 1, lastFrameNumber: 1,
	});
	const source = Object.freeze({
		kind: 'video' as const, sourceType: 'image-sequence' as const, version: 1 as const,
		id: SOURCE_ID, name: 'Sequence', stem: 'shot.', extension: 'png', frameNumberWidth: 4,
		firstFrameNumber: 1, lastFrameNumber: 1, frameCount: 1, frameRate: RATE,
		inventory, sourcePack: pack,
		characteristics: Object.freeze({
			backend: 'framescaper-media-host', codedWidth: 2, codedHeight: 2,
			hasAlpha: false, videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgb24',
			chromaFormat: '4:4:4', alphaMode: null, alphaInterpretation: null,
			colour: Object.freeze({
				primaries: 'srgb', transfer: 'iec61966-2-1', matrix: 'rgb', range: 'full',
			}),
		}),
	});
	const document = Object.freeze({
		...PROJECT_IDENTITY, id: PROJECT_ID, revision: REVISION,
		sources: Object.freeze([Object.freeze({
			kind: 'video', id: SOURCE_ID, storageKey: pack.storageKey,
			contentSha256: pack.sha256, imageSequence: source,
		})]),
	});
	const bodies = Object.freeze([
		Object.freeze({
			kind: pack.kind, storageKey: pack.storageKey,
			byteLength: pack.byteLength, sha256: pack.sha256,
		}),
		Object.freeze({
			kind: inventory.kind, storageKey: inventory.storageKey,
			byteLength: inventory.byteLength, sha256: inventory.sha256,
		}),
	]);
	const bundle = Object.freeze({
		project: Object.freeze({ ...PROJECT_IDENTITY, projectRevision: REVISION }),
		document: JSON.stringify(document), bodies,
	});
	const executablePath = join(directory, 'media-host');
	const executableBytes = new TextEncoder().encode('fixture executable');
	await writeFile(executablePath, executableBytes, { mode: 0o700 });
	const executableStat = await lstat(executablePath);
	const decoded = decodedPack();
	let opaqueId = 0;
	let jobCount = 0;
	const registration = await createFramescaperNativeImageSequenceRegistration({
		userDataPath,
		...(cacheDataPath === undefined ? {} : { cacheDataPath }),
		route: Object.freeze({
			...PROJECT_IDENTITY,
			projectMutationSurface: 'image-sequence-import' as const,
			professionalCharacteristicsContract: 'video-source-characteristics-v25' as const,
			isRouted: () => true,
		}),
		project: Object.freeze({
			...PROJECT_IDENTITY,
			projectState: (projectId: string) => Object.freeze({
				...PROJECT_IDENTITY, open: projectId === PROJECT_ID, writable: projectId === PROJECT_ID,
			}),
			projectRecord: (projectId: string) => projectId === PROJECT_ID ? Object.freeze({
				...PROJECT_IDENTITY, projectId: PROJECT_ID, projectRevision: REVISION,
				projectSha256: digest(new TextEncoder().encode(bundle.document)), bodies,
			}) : null,
			readProjectBundle: async (projectId: string) => {
				if (projectId !== PROJECT_ID) throw new Error('unknown fixture project');
				return bundle;
			},
		}),
		controller: Object.freeze({ capabilities: capabilitySnapshot }),
		mediaRuntime: Object.freeze({
			available: () => true,
			async runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown> {
				jobCount += 1;
				return runDecodeJob(directory, decoded, request, jobCount);
			},
		}),
		executable: () => Object.freeze({
			path: executablePath, byteLength: executableBytes.byteLength,
			sha256: digest(executableBytes),
			identity: Object.freeze({ dev: executableStat.dev, ino: executableStat.ino }),
		}),
		createMessageChannel: () => {
			const channel = new MessageChannel();
			return Object.freeze({ hostPort: channel.port1, helperPort: channel.port2 }) as never;
		},
		mintOpaqueId: () => opaque(++opaqueId),
		runtimeAvailable: () => true,
	});
	await mkdir(join(root, 'objects'), { recursive: true });
	await Promise.all([
		writeFile(framescaperNativeImageSequenceAssetPath(root, pack), packBytes),
		writeFile(framescaperNativeImageSequenceAssetPath(root, inventory), inventoryBytes),
	]);
	t.after(async () => {
		await registration.dispose().catch(() => undefined);
		await rm(directory, { recursive: true, force: true });
	});
	return Object.freeze({ registration, root, userDataPath, cacheScratchRoot, jobs: () => jobCount });
}

async function runDecodeJob(
	directory: string,
	decoded: Uint8Array,
	request: NativeMediaHelperPoolJobRequest,
	ordinal: number,
): Promise<unknown> {
	assert.equal(request.kind, 'media-decode');
	const grant = request.grant as HelperMediaImageSequenceDecodeJobGrant;
	assert.ok(grant.imageSequence);
	const transfers = request.dataPlaneTransfers ?? [];
	const planPort = transfers.find(({ streamId }) => streamId === grant.plan.streamId)?.port;
	const outputPort = transfers.find(({ streamId }) => streamId === grant.output.streamId)?.port;
	assert.ok(planPort instanceof MessagePort, 'decode plan uses the injected real MessagePort');
	assert.ok(outputPort instanceof MessagePort, 'decoded output uses the injected real MessagePort');
	const planPath = join(directory, `helper-plan-${String(ordinal)}.json`);
	const outputPath = join(directory, `helper-output-${String(ordinal)}.rgba-pack`);
	try {
		await receiveHelperDataPlaneFile({
			binding: grant.plan as HelperDataPlaneBinding,
			port: planPort as unknown as HelperDataPlaneIoPort,
			path: planPath,
			...(request.signal ? { signal: request.signal } : {}),
		});
		assert.ok((await readFile(planPath)).byteLength > 0);
		await writeFile(outputPath, decoded);
		const output = completion(grant.output, decoded);
		await sendHelperDataPlaneReservedFile({
			reservation: grant.output,
			port: outputPort as unknown as HelperDataPlaneIoPort,
			path: outputPath,
			completion: output,
			...(request.signal ? { signal: request.signal } : {}),
		});
		return Object.freeze({ output });
	} finally {
		await Promise.all([
			rm(planPath, { force: true }), rm(outputPath, { force: true }),
		]);
	}
}

function capabilitySnapshot() {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: [{
			domain: 'operation', id: 'image-sequence-import',
			buildSupported: true, probeSucceeded: true, selfTestPassed: true,
			userEnabled: true,
		}],
	});
}

function completion(reservation: HelperDataPlaneOutputReservation, bytes: Uint8Array) {
	return Object.freeze({
		streamId: reservation.streamId, byteLength: bytes.byteLength, sha256: digest(bytes),
	});
}

function decodedPack(): Uint8Array {
	const bytes = new Uint8Array(107);
	bytes.set(new TextEncoder().encode('framescaper-rgba-frame-pack-v1\n'));
	const view = new DataView(bytes.buffer);
	view.setUint32(31, 1, true);
	view.setUint32(35, 2, true);
	view.setUint32(39, 2, true);
	view.setBigUint64(43, 1n, true);
	view.setUint32(51, RATE.den, true);
	view.setUint32(55, RATE.num, true);
	view.setBigUint64(59, 0n, true);
	view.setBigInt64(67, 0n, true);
	view.setBigInt64(75, 1n, true);
	view.setBigUint64(83, 16n, true);
	bytes.set([
		11, 22, 33, 255, 44, 55, 66, 255,
		77, 88, 99, 255, 111, 122, 133, 255,
	], 91);
	return bytes;
}

function stringField(value: unknown, field: string): string {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	const result = (value as Readonly<Record<string, unknown>>)[field];
	if (typeof result !== 'string') assert.fail(`${field} is not a string`);
	return result;
}

async function exists(path: string): Promise<boolean> {
	try { await lstat(path); return true; }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function opaque(value: number): string {
	return value.toString(16).padStart(40, '0');
}
