/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureSessionManifestV1 } from '../framescaper-capture-session-manifest.ts';
import type {
	FramescaperCaptureCreationStreamV1,
	FramescaperCaptureSessionCreationV1,
	FramescaperCaptureSessionManifestRepository,
} from '../storage/framescaper-capture-session-manifest-repository.ts';
import {
	FRAMESCAPER_CAPTURE_CREATION_LEASE_MILLISECONDS,
	framescaperCaptureCreationFenceKey,
} from '../storage/framescaper-capture-session-creation-repository.ts';
import type { EncodedCaptureSpoolRecord } from '../storage/encoded-capture-spool-repository.ts';
import type { RawPcmSpoolRecord } from '../storage/raw-pcm-spool-repository.ts';
import {
	createCaptureSpool,
	type DurableCaptureStoragePorts,
	type FramescaperCaptureStreamRegistration,
	type OwnedCaptureSpool,
} from './framescaper-capture-durable-storage.ts';

export type CaptureCreationManifestPort = Pick<FramescaperCaptureSessionManifestRepository,
	'createCreation' | 'listCreations' | 'load' | 'loadCreation' | 'publishCreation'
	| 'removeCreation' | 'replaceCreation'
>;

export interface CaptureCreationPorts extends DurableCaptureStoragePorts {
	readonly manifests: CaptureCreationManifestPort;
}

export interface CaptureCreationRequest {
	readonly sessionId: string;
	readonly generation: number;
	readonly projectFence: FramescaperCaptureSessionManifestV1['projectFence'];
	readonly origin: FramescaperCaptureSessionManifestV1['origin'];
	readonly monotonicOriginMicroseconds: number;
	readonly streams: readonly FramescaperCaptureStreamRegistration[];
}

export function requiredCaptureCreationManifests(
	manifests: Partial<CaptureCreationManifestPort>,
): CaptureCreationManifestPort {
	for (const name of [
		'createCreation', 'listCreations', 'load', 'loadCreation', 'publishCreation',
		'removeCreation', 'replaceCreation',
	] as const) {
		if (typeof manifests[name] !== 'function') {
			throw new TypeError(`Framescaper capture creation repository is missing ${name}.`);
		}
	}
	return manifests as CaptureCreationManifestPort;
}

export function createCaptureCreationMaintenance(
	ports: CaptureCreationPorts,
	now: () => number,
): () => Promise<void> {
	let operation: Promise<void> | null = null;
	return async () => {
		if (operation) return operation;
		const timestamp = now();
		if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
			throw new RangeError('Framescaper capture creation maintenance time must be non-negative.');
		}
		operation = maintainCaptureCreationInventory(ports, timestamp);
		try { await operation; }
		finally { operation = null; }
	};
}

export async function settleFailedCaptureCreation(
	ports: CaptureCreationPorts,
	creation: FramescaperCaptureSessionCreationV1,
): Promise<void> {
	let current = creation;
	try { current = await markCaptureCreationCleanupPending(ports.manifests, current); }
	catch { /* The exact leased journal remains globally discoverable. */ }
	try { await cleanupCaptureCreation(ports, current); }
	catch { /* Creation failure remains primary; global maintenance owns exact retry. */ }
}

export function captureCreationInventory(
	request: CaptureCreationRequest,
	createdAt: number,
	createId: () => string,
): FramescaperCaptureSessionCreationV1 {
	return Object.freeze({
		version: 1,
		kind: 'framescaper-capture-session-creation',
		state: 'creating',
		sessionId: request.sessionId,
		generation: request.generation,
		projectFence: request.projectFence,
		origin: request.origin,
		monotonicOriginMicroseconds: request.monotonicOriginMicroseconds,
		streams: Object.freeze(request.streams.map((stream): FramescaperCaptureCreationStreamV1 => Object.freeze({
			...stream,
			spoolToken: stream.kind === 'encoded-media'
				? `framescaper-capture:${createId()}`
				: `${stream.spoolId}:capture:${createId()}`,
		}))),
		createdAt,
		leaseExpiresAt: exactSum(
			createdAt,
			FRAMESCAPER_CAPTURE_CREATION_LEASE_MILLISECONDS,
			'capture creation lease expiration',
		),
	});
}

export async function createInventoriedCaptureSpools(
	ports: DurableCaptureStoragePorts,
	creation: FramescaperCaptureSessionCreationV1,
): Promise<Map<string, OwnedCaptureSpool>> {
	const created = new Map<string, OwnedCaptureSpool>();
	const creationFence = Object.freeze({
		key: framescaperCaptureCreationFenceKey(creation.projectFence.projectId, creation.sessionId),
		expected: creation,
	});
	for (const stream of creation.streams) {
		created.set(stream.streamId, await createCaptureSpool(ports, {
			sessionId: creation.sessionId,
			projectId: creation.projectFence.projectId,
		}, stream, stream.spoolToken, creationFence));
	}
	return created;
}

/** Globally retries only failed or expired creation leases, independent of project inventory. */
export async function maintainCaptureCreationInventory(
	ports: CaptureCreationPorts,
	now: number,
): Promise<void> {
	for (let creation of await ports.manifests.listCreations()) {
		const manifest = await ports.manifests.load(creation.projectFence.projectId, creation.sessionId);
		if (manifest) {
			assertPublishedCreation(creation, manifest);
			await removeCreationIfCurrent(ports.manifests, creation);
			continue;
		}
		if (creation.state === 'creating' && creation.leaseExpiresAt > now) continue;
		if (creation.state === 'creating') {
			try { creation = await markCaptureCreationCleanupPending(ports.manifests, creation); }
			catch (error) {
				const published = await ports.manifests.load(
					creation.projectFence.projectId, creation.sessionId,
				);
				if (published) {
					assertPublishedCreation(creation, published);
					await removeCreationIfCurrent(ports.manifests, creation);
					continue;
				}
				throw error;
			}
		}
		await cleanupCaptureCreation(ports, creation);
	}
}

export async function assertCaptureCreationStorageExact(
	ports: DurableCaptureStoragePorts,
	creation: FramescaperCaptureSessionCreationV1,
): Promise<void> {
	for (const stream of creation.streams) {
		if (stream.kind === 'encoded-media') {
			const record = await ports.encodedSpools.load(creation.projectFence.projectId, stream.spoolId);
			if (!record) throw new Error(`Framescaper capture creation storage is missing for ${stream.streamId}.`);
			assertExactEncodedCreationSpool(creation, stream, record);
		} else {
			const record = await ports.rawPcmSpools.load(creation.projectFence.projectId, stream.spoolId);
			if (!record) throw new Error(`Framescaper capture creation storage is missing for ${stream.streamId}.`);
			assertExactRawCreationSpool(creation, stream, record);
		}
	}
}

export async function markCaptureCreationCleanupPending(
	manifests: CaptureCreationManifestPort,
	creation: FramescaperCaptureSessionCreationV1,
): Promise<FramescaperCaptureSessionCreationV1> {
	if (creation.state === 'cleanup-pending') return creation;
	const pending = Object.freeze({ ...creation, state: 'cleanup-pending' as const });
	try {
		return await manifests.replaceCreation(creation, pending);
	} catch (error) {
		const current = await manifests.loadCreation(creation.projectFence.projectId, creation.sessionId);
		if (current && sameCreation(current, pending)) return current;
		throw error;
	}
}

export async function cleanupCaptureCreation(
	ports: CaptureCreationPorts,
	creation: FramescaperCaptureSessionCreationV1,
): Promise<void> {
	const published = await ports.manifests.load(creation.projectFence.projectId, creation.sessionId);
	if (published) {
		assertPublishedCreation(creation, published);
		await removeCreationIfCurrent(ports.manifests, creation);
		return;
	}
	const failures: unknown[] = [];
	for (const stream of [...creation.streams].reverse()) {
		try {
			if (stream.kind === 'encoded-media') {
				const record = await ports.encodedSpools.load(creation.projectFence.projectId, stream.spoolId);
				if (!record) continue;
				assertExactEncodedCreationSpool(creation, stream, record);
				await ports.encodedSpools.delete(record);
			} else {
				const record = await ports.rawPcmSpools.load(creation.projectFence.projectId, stream.spoolId);
				if (!record) {
					const release = ports.rawPcmSpools.releaseReservation;
					if (typeof release !== 'function' || !await release.call(ports.rawPcmSpools, {
						projectId: creation.projectFence.projectId,
						spoolId: stream.spoolId,
						spoolToken: stream.spoolToken,
					})) throw new Error(`Framescaper capture creation storage ownership changed for ${stream.streamId}.`);
					continue;
				}
				assertExactRawCreationSpool(creation, stream, record);
				if (!await ports.rawPcmSpools.remove(record)) {
					throw new Error(`Framescaper capture creation storage ownership changed for ${stream.streamId}.`);
				}
			}
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) {
		throw new AggregateError(failures, 'Framescaper capture creation cleanup did not complete.');
	}
	await removeCreationIfCurrent(ports.manifests, creation);
}

export function defaultCaptureCreationId(): string {
	return globalThis.crypto?.randomUUID?.()
		?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function assertPublishedCreation(
	creation: FramescaperCaptureSessionCreationV1,
	manifest: FramescaperCaptureSessionManifestV1,
): void {
	const contract = {
		sessionId: creation.sessionId,
		generation: creation.generation,
		projectFence: creation.projectFence,
		origin: creation.origin,
		monotonicOriginMicroseconds: creation.monotonicOriginMicroseconds,
		createdAt: creation.createdAt,
		streams: creation.streams.map(creationStreamContract),
	};
	const observed = {
		sessionId: manifest.sessionId,
		generation: manifest.generation,
		projectFence: manifest.projectFence,
		origin: manifest.origin,
		monotonicOriginMicroseconds: manifest.clock.monotonicOriginMicroseconds,
		createdAt: manifest.createdAt,
		streams: manifest.streams.map((stream) => creationStreamContract({
			...stream,
			...stream.storage,
			...(stream.storage.kind === 'raw-pcm' ? {
				chunkFrames: creation.streams.find(({ streamId }) => streamId === stream.streamId)?.kind === 'raw-pcm'
					? (creation.streams.find(({ streamId }) => streamId === stream.streamId) as Extract<
						FramescaperCaptureCreationStreamV1, { readonly kind: 'raw-pcm' }
					>).chunkFrames
					: null,
			} : {}),
		} as FramescaperCaptureCreationStreamV1)),
	};
	if (JSON.stringify(contract) !== JSON.stringify(observed)) {
		throw new Error('Framescaper capture creation manifest ownership changed.');
	}
}

function creationStreamContract(stream: FramescaperCaptureCreationStreamV1): unknown {
	return stream.kind === 'encoded-media' ? {
		kind: stream.kind, role: stream.role, required: stream.required,
		streamId: stream.streamId, spoolId: stream.spoolId, spoolToken: stream.spoolToken,
		sourceId: stream.sourceId, mimeType: stream.mimeType,
	} : {
		kind: stream.kind, role: stream.role, required: stream.required,
		streamId: stream.streamId, spoolId: stream.spoolId, spoolToken: stream.spoolToken,
		sourceId: stream.sourceId, sampleRate: stream.sampleRate,
		channelCount: stream.channelCount, chunkFrames: stream.chunkFrames,
	};
}

function assertExactEncodedCreationSpool(
	creation: FramescaperCaptureSessionCreationV1,
	stream: Extract<FramescaperCaptureCreationStreamV1, { readonly kind: 'encoded-media' }>,
	record: EncodedCaptureSpoolRecord,
): void {
	if (record.projectId !== creation.projectFence.projectId || record.sessionId !== creation.sessionId
		|| record.streamId !== stream.streamId || record.spoolId !== stream.spoolId
		|| record.spoolToken !== stream.spoolToken || record.sourceId !== stream.sourceId
		|| record.mimeType !== stream.mimeType || (record.state !== 'capturing' && record.state !== 'deleting')
		|| record.packetCount !== 0 || record.chunkCount !== 0 || record.byteLength !== 0
		|| record.firstPtsMicroseconds !== null || record.lastPtsEndMicroseconds !== null
		|| record.adoptedMediaId !== null) {
		throw new Error(`Framescaper capture creation storage ownership changed for ${stream.streamId}.`);
	}
}

function assertExactRawCreationSpool(
	creation: FramescaperCaptureSessionCreationV1,
	stream: Extract<FramescaperCaptureCreationStreamV1, { readonly kind: 'raw-pcm' }>,
	record: RawPcmSpoolRecord,
): void {
	const owner = {
		version: 1, kind: 'framescaper-capture-raw-pcm', sessionId: creation.sessionId,
		streamId: stream.streamId, sourceId: stream.sourceId, role: stream.role,
	};
	if (record.projectId !== creation.projectFence.projectId || record.spoolId !== stream.spoolId
		|| record.spoolToken !== stream.spoolToken || (record.state !== 'capturing' && record.state !== 'deleting')
		|| record.sampleRate !== stream.sampleRate || record.channelCount !== stream.channelCount
		|| record.chunkFrames !== stream.chunkFrames || record.frameCount !== 0 || record.chunkCount !== 0
		|| record.appendProtocol !== 'framescaper-manifest-v1'
		|| JSON.stringify(record.data) !== JSON.stringify(owner)) {
		throw new Error(`Framescaper capture creation storage ownership changed for ${stream.streamId}.`);
	}
}

async function removeCreationIfCurrent(
	manifests: CaptureCreationManifestPort,
	creation: FramescaperCaptureSessionCreationV1,
): Promise<void> {
	try {
		await manifests.removeCreation(creation);
	} catch (error) {
		if (await manifests.loadCreation(creation.projectFence.projectId, creation.sessionId)) throw error;
	}
}

function sameCreation(
	left: FramescaperCaptureSessionCreationV1,
	right: FramescaperCaptureSessionCreationV1,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function exactSum(left: number, right: number, name: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return value;
}
