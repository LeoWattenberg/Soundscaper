/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CapturePacket } from '../framescaper-capture-domain.ts';
import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureOriginV1,
	type FramescaperCapturePauseSpanV1,
	type FramescaperCapturePlayability,
	type FramescaperCaptureProjectFenceV1,
	type FramescaperCaptureSessionManifestV1,
} from '../framescaper-capture-session-manifest.ts';
import type { FramescaperCaptureSessionManifestRepository } from '../storage/framescaper-capture-session-manifest-repository.ts';
import { withCaptureSessionOperationLock } from '../storage/capture-spool-operation-lock.ts';
import { packetTiming, sameManifest, sameManifestEvidence, timestamp } from './framescaper-capture-durable-manifest.ts';
import {
	acknowledgeCaptureAppend,
	assertEncodedCapturePacket,
	assertPcmCapturePacket,
	assertCaptureStreamRegistrations,
	createCaptureStreamManifest,
	deinterleaveCapturePcm,
	inspectCaptureStorage,
	releaseMissingCaptureSpoolReservation,
	requiredCaptureSpool,
	type DurableCaptureStoragePorts,
	type FramescaperCaptureStreamRegistration,
	type OwnedCaptureSpool,
} from './framescaper-capture-durable-storage.ts';
import {
	assertCaptureCreationStorageExact,
	captureCreationInventory,
	createCaptureCreationMaintenance,
	createInventoriedCaptureSpools,
	defaultCaptureCreationId,
	requiredCaptureCreationManifests,
	settleFailedCaptureCreation,
	type CaptureCreationManifestPort,
} from './framescaper-capture-durable-creation.ts';

export type {
	FramescaperCaptureStreamRegistration,
	FramescaperEncodedCaptureStreamRegistration,
	FramescaperRawPcmCaptureStreamRegistration,
} from './framescaper-capture-durable-storage.ts';

type ManifestPort = Pick<FramescaperCaptureSessionManifestRepository,
	'create' | 'load' | 'listProject' | 'replace' | 'remove'
> & Partial<CaptureCreationManifestPort>;

export interface CreateFramescaperCaptureDurableSessionRequest {
	readonly sessionId: string;
	readonly generation: number;
	readonly projectFence: FramescaperCaptureProjectFenceV1;
	readonly origin: FramescaperCaptureOriginV1;
	readonly monotonicOriginMicroseconds: number;
	readonly streams: readonly FramescaperCaptureStreamRegistration[];
}

export interface FramescaperCaptureRecoveryInventoryEntry {
	readonly manifest: FramescaperCaptureSessionManifestV1;
	readonly storageStatus: 'exact' | 'missing' | 'changed';
	readonly affectedStreamIds: readonly string[];
}

export interface FramescaperCaptureDurableSession {
	readonly manifest: FramescaperCaptureSessionManifestV1;
	append(packet: CapturePacket): Promise<FramescaperCaptureSessionManifestV1>;
	addPauseSpan(span: FramescaperCapturePauseSpanV1): Promise<FramescaperCaptureSessionManifestV1>;
	seal(): Promise<FramescaperCaptureSessionManifestV1>;
	setPlayability(
		streamId: string,
		playability: Exclude<FramescaperCapturePlayability, 'unknown'>,
	): Promise<FramescaperCaptureSessionManifestV1>;
	retireCommitted(): Promise<void>;
	delete(): Promise<void>;
}

export interface FramescaperCaptureDurableSessionCoordinator {
	create(request: CreateFramescaperCaptureDurableSessionRequest): Promise<FramescaperCaptureDurableSession>;
	load(projectId: string, sessionId: string): Promise<FramescaperCaptureDurableSession | null>;
	recoveryInventory(projectId: string): Promise<readonly FramescaperCaptureRecoveryInventoryEntry[]>;
}

interface CoordinatorOptions extends DurableCaptureStoragePorts {
	readonly manifests: ManifestPort;
	readonly now?: () => number;
	readonly createId?: () => string;
}

export function createFramescaperCaptureDurableSessionCoordinator(
	options: CoordinatorOptions,
): FramescaperCaptureDurableSessionCoordinator {
	const now = options.now ?? Date.now;
	const createId = options.createId ?? defaultCaptureCreationId;
	const creationManifests = requiredCaptureCreationManifests(options.manifests);
	const creationPorts = Object.freeze({
		encodedSpools: options.encodedSpools,
		rawPcmSpools: options.rawPcmSpools,
		manifests: creationManifests,
	});
	const maintainCreations = createCaptureCreationMaintenance(creationPorts, now);

	async function create(
		request: CreateFramescaperCaptureDurableSessionRequest,
	): Promise<FramescaperCaptureDurableSession> {
		let creation = null as Awaited<ReturnType<typeof creationManifests.createCreation>> | null;
		let published = false;
		try {
			assertCaptureStreamRegistrations(request.streams);
			await maintainCreations();
			await retireSettledSessions(request.projectFence.projectId);
			const createdAt = timestamp(now(), 'Framescaper capture creation time');
			creation = await creationManifests.createCreation(captureCreationInventory(
				request,
				createdAt,
				createId,
			));
			const created = await createInventoriedCaptureSpools(options, creation);
			const manifest = normalizeFramescaperCaptureSessionManifest({
				version: 1,
				sessionId: request.sessionId,
				generation: request.generation,
				state: 'capturing',
				recoveryDecision: null,
				projectFence: request.projectFence,
				origin: request.origin,
				clock: {
					monotonicOriginMicroseconds: request.monotonicOriginMicroseconds,
					pauseSpans: [],
				},
				streams: request.streams.map((registration) => createCaptureStreamManifest(
					registration,
					requiredCaptureSpool(created, registration.streamId),
				)),
				createdAt,
				updatedAt: createdAt,
			});
			await assertCaptureCreationStorageExact(creationPorts, creation);
			const persisted = await creationManifests.publishCreation(creation, manifest);
			published = true;
			try { await creationManifests.removeCreation(creation); }
			catch { /* The authoritative manifest lets global maintenance retire this journal safely. */ }
			return new DurableSession(options, now, persisted, created);
		} catch (error) {
			if (creation && !published) await settleFailedCaptureCreation(creationPorts, creation);
			throw error;
		}
	}

	async function load(projectId: string, sessionId: string): Promise<FramescaperCaptureDurableSession | null> {
		await maintainCreations();
		return loadInternal(projectId, sessionId);
	}

	async function loadInternal(projectId: string, sessionId: string): Promise<FramescaperCaptureDurableSession | null> {
		const snapshot = await inspectAuthoritativeSession(projectId, sessionId);
		if (!snapshot) return null;
		const { manifest, inspection } = snapshot;
		if (inspection.storageStatus === 'changed'
			|| (inspection.storageStatus === 'missing'
				&& manifest.state !== 'discarded' && manifest.state !== 'committed')) {
			throw new Error(`Framescaper capture storage ownership changed for ${inspection.affectedStreamIds.join(', ')}.`);
		}
		return new DurableSession(options, now, manifest, inspection.spools);
	}

	async function inspectAuthoritativeSession(projectId: string, sessionId: string) {
		return withCaptureSessionOperationLock({ projectId, sessionId }, async () => {
			for (let attempt = 0; attempt < 4; attempt += 1) {
				const manifest = await options.manifests.load(projectId, sessionId);
				if (!manifest) return null;
				let inspection;
				try { inspection = await inspectCaptureStorage(options, manifest); }
				catch (error) {
					const latest = await options.manifests.load(projectId, sessionId);
					if (latest && !sameManifest(latest, manifest)) continue;
					throw error;
				}
				const latest = await options.manifests.load(projectId, sessionId);
				if (latest && sameManifest(latest, manifest)) return Object.freeze({ manifest, inspection });
				if (!latest) return null;
			}
			throw new Error('Framescaper capture manifest changed throughout bounded storage inspection.');
		});
	}

	async function retireSettledSessions(projectId: string): Promise<void> {
		for (const manifest of await options.manifests.listProject(projectId)) {
			if (manifest.state === 'committed' || manifest.state === 'discarded') {
				await retireSettledManifest(manifest);
			}
		}
	}

	async function retireSettledManifest(manifest: FramescaperCaptureSessionManifestV1): Promise<void> {
		const session = await loadInternal(manifest.projectFence.projectId, manifest.sessionId);
		if (!session || !sameManifest(session.manifest, manifest)) return;
		if (session.manifest.state === 'committed') await session.retireCommitted();
		else if (session.manifest.state === 'discarded') await session.delete();
	}

	async function recoveryInventory(
		projectId: string,
	): Promise<readonly FramescaperCaptureRecoveryInventoryEntry[]> {
		await maintainCreations();
		const entries: FramescaperCaptureRecoveryInventoryEntry[] = [];
		for (const listed of await options.manifests.listProject(projectId)) {
			const snapshot = await inspectAuthoritativeSession(projectId, listed.sessionId);
			if (!snapshot) continue;
			if (snapshot.manifest.state === 'committed' || snapshot.manifest.state === 'discarded') {
				await retireSettledManifest(snapshot.manifest);
				continue;
			}
			entries.push(Object.freeze({
				manifest: snapshot.manifest,
				storageStatus: snapshot.inspection.storageStatus,
				affectedStreamIds: snapshot.inspection.affectedStreamIds,
			}));
		}
		return Object.freeze(entries);
	}

	return Object.freeze({ create, load, recoveryInventory });
}

class DurableSession implements FramescaperCaptureDurableSession {
	readonly #repositories: CoordinatorOptions;
	readonly #now: () => number;
	readonly #spools: Map<string, OwnedCaptureSpool>;
	#manifest: FramescaperCaptureSessionManifestV1;
	#queue: Promise<void> = Promise.resolve();
	#synchronized = true;
	#deleted = false;

	constructor(
		repositories: CoordinatorOptions,
		now: () => number,
		manifest: FramescaperCaptureSessionManifestV1,
		spools: Map<string, OwnedCaptureSpool>,
	) {
		this.#repositories = repositories;
		this.#now = now;
		this.#manifest = manifest;
		this.#spools = new Map(spools);
	}

	get manifest(): FramescaperCaptureSessionManifestV1 {
		return this.#manifest;
	}

	append(packet: CapturePacket): Promise<FramescaperCaptureSessionManifestV1> {
		return this.#enqueue(() => this.#append(packet));
	}

	addPauseSpan(span: FramescaperCapturePauseSpanV1): Promise<FramescaperCaptureSessionManifestV1> {
		return this.#enqueue(async () => {
			this.#assertWritableCapture();
			const next = normalizeFramescaperCaptureSessionManifest({
				...this.#manifest,
				clock: {
					...this.#manifest.clock,
					pauseSpans: [...this.#manifest.clock.pauseSpans, span],
				},
				updatedAt: this.#updatedAt(),
			});
			return this.#replaceManifest(next);
		});
	}

	seal(): Promise<FramescaperCaptureSessionManifestV1> {
		return this.#enqueue(() => this.#seal());
	}

	setPlayability(
		streamId: string,
		playability: Exclude<FramescaperCapturePlayability, 'unknown'>,
	): Promise<FramescaperCaptureSessionManifestV1> {
		return this.#enqueue(async () => {
			this.#assertSynchronized();
			if (this.#manifest.state !== 'sealed' && this.#manifest.state !== 'finalizing') {
				throw new Error('Framescaper capture playability requires a sealed prefix.');
			}
			if (playability !== 'playable' && playability !== 'invalid') {
				throw new TypeError('Framescaper capture playability must be playable or invalid.');
			}
			const streamIndex = this.#manifest.streams.findIndex((stream) => stream.streamId === streamId);
			if (streamIndex < 0) throw new Error(`Framescaper capture stream ${streamId} does not exist.`);
			const current = this.#manifest.streams[streamIndex]!;
			if (current.playability === playability) return this.#manifest;
			if (current.playability !== 'unknown') {
				throw new Error('Framescaper capture playability cannot move backward or change verdict.');
			}
			const streams = [...this.#manifest.streams];
			streams[streamIndex] = Object.freeze({ ...current, playability });
			const next = normalizeFramescaperCaptureSessionManifest({
				...this.#manifest,
				streams,
				updatedAt: this.#updatedAt(),
			});
			return this.#replaceManifest(next);
		});
	}

	retireCommitted(): Promise<void> {
		return this.#enqueue(async () => {
			if (this.#deleted) return;
			this.#assertSynchronized();
			const current = await this.#repositories.manifests.load(
				this.#manifest.projectFence.projectId,
				this.#manifest.sessionId,
			);
			if (!current) {
				this.#spools.clear();
				this.#deleted = true;
				return;
			}
			if (!sameManifestEvidence(this.#manifest, current)) {
				throw new Error('Framescaper committed capture manifest ownership changed before retirement.');
			}
			if (current.state !== 'committed') {
				throw new Error('Only a durably committed Framescaper capture can retire its spools.');
			}
			this.#manifest = current;
			const inspection = await inspectCaptureStorage(this.#repositories, current);
			if (inspection.storageStatus === 'changed') {
				throw new Error(`Framescaper capture storage ownership changed for ${inspection.affectedStreamIds.join(', ')}.`);
			}
			this.#spools.clear();
			for (const [streamId, spool] of inspection.spools) this.#spools.set(streamId, spool);
			for (const stream of current.streams) {
				const spool = this.#spools.get(stream.streamId);
				if (!spool) { await releaseMissingCaptureSpoolReservation(this.#repositories, current, stream); continue; }
				if (spool.kind === 'encoded-media') {
					if (spool.record.state === 'adopted') {
						await this.#repositories.encodedSpools.releaseAdopted(spool.record);
					} else await this.#repositories.encodedSpools.delete(spool.record);
				} else if (!await this.#repositories.rawPcmSpools.remove(spool.record)) {
					throw new Error(`Framescaper capture storage ownership changed for ${stream.streamId}.`);
				}
				this.#spools.delete(stream.streamId);
			}
			try { await this.#repositories.manifests.remove(current); }
			catch (error) {
				if (await this.#repositories.manifests.load(current.projectFence.projectId, current.sessionId)) throw error;
			}
			this.#deleted = true;
		}, false);
	}

	delete(): Promise<void> {
		return this.#enqueue(async () => {
			if (this.#deleted) return;
			this.#assertSynchronized();
			await this.#refreshStorage(this.#manifest.state === 'discarded');
			if (this.#manifest.state === 'capturing') await this.#seal();
			if (this.#manifest.state === 'sealed') {
				const discarded = normalizeFramescaperCaptureSessionManifest({
					...this.#manifest,
					state: 'discarded',
					recoveryDecision: 'delete',
					updatedAt: this.#updatedAt(),
				});
				await this.#replaceManifest(discarded);
			}
			if (this.#manifest.state !== 'discarded' || this.#manifest.recoveryDecision !== 'delete') {
				throw new Error('Only an undecided sealed capture session can be deleted.');
			}
			await this.#refreshStorage(true);
			for (const stream of this.#manifest.streams) {
				const spool = this.#spools.get(stream.streamId);
				if (!spool) { await releaseMissingCaptureSpoolReservation(this.#repositories, this.#manifest, stream); continue; }
				if (spool.kind === 'encoded-media') {
					if (spool.record.state === 'adopted') {
						throw new Error('Framescaper capture cannot delete adopted immutable media.');
					}
					await this.#repositories.encodedSpools.delete(spool.record);
				} else if (!await this.#repositories.rawPcmSpools.remove(spool.record)) {
					throw new Error(`Framescaper capture storage ownership changed for ${stream.streamId}.`);
				}
				this.#spools.delete(stream.streamId);
			}
			await this.#repositories.manifests.remove(this.#manifest);
			this.#deleted = true;
		});
	}

	async #append(packet: CapturePacket): Promise<FramescaperCaptureSessionManifestV1> {
		this.#assertWritableCapture();
		if (packet.sessionId !== this.#manifest.sessionId) {
			throw new Error('Capture packet session ownership changed.');
		}
		const streamIndex = this.#manifest.streams.findIndex(({ streamId }) => streamId === packet.streamId);
		if (streamIndex < 0) throw new Error(`Capture packet stream ${packet.streamId} is not registered.`);
		const stream = this.#manifest.streams[streamIndex]!;
		const spool = requiredCaptureSpool(this.#spools, stream.streamId);
		const acknowledgedSpool = spool;
		let nextStream = stream;
		if (packet.kind === 'encoded-video' && spool.kind === 'encoded-media'
			&& stream.storage.kind === 'encoded-media') {
			assertEncodedCapturePacket(packet, stream, spool.record);
			const acknowledgement = await this.#repositories.encodedSpools.append(spool.record, {
				sequence: packet.sequence,
				ptsMicroseconds: packet.presentationTimeUs,
				durationMicroseconds: packet.durationUs,
				payload: new Blob([new Uint8Array(packet.bytes)]),
			});
			this.#spools.set(stream.streamId, Object.freeze({
				kind: 'encoded-media', record: acknowledgement.spool,
			}));
			nextStream = Object.freeze({
				...stream,
				timing: packetTiming(stream, packet.presentationTimeUs, packet.durationUs),
				storage: Object.freeze({
					...stream.storage,
					packetCount: acknowledgement.spool.packetCount,
					chunkCount: acknowledgement.spool.chunkCount,
					byteLength: acknowledgement.spool.byteLength,
				}),
			});
		} else if (packet.kind === 'pcm-audio' && spool.kind === 'raw-pcm'
			&& stream.storage.kind === 'raw-pcm') {
			assertPcmCapturePacket(packet, stream, spool.record);
			const record = await this.#repositories.rawPcmSpools.append(
				spool.record,
				deinterleaveCapturePcm(packet.samples, packet.frameCount, packet.channelCount),
				spool.owner,
				{
					presentationTimeMicroseconds: packet.presentationTimeUs,
					durationMicroseconds: packet.durationUs,
					droppedFramesBefore: packet.droppedBefore.value!,
				},
			);
			this.#spools.set(stream.streamId, Object.freeze({ ...spool, record }));
			nextStream = Object.freeze({
				...stream,
				timing: packetTiming(stream, packet.presentationTimeUs, packet.durationUs),
				storage: Object.freeze({
					...stream.storage,
					frameCount: record.frameCount,
					chunkCount: record.chunkCount,
				}),
			});
		} else {
			throw new Error('Capture packet kind does not match its registered stream role.');
		}
		const streams = [...this.#manifest.streams];
		streams[streamIndex] = nextStream;
		const next = normalizeFramescaperCaptureSessionManifest({
			...this.#manifest,
			streams,
			updatedAt: this.#updatedAt(),
		});
		return this.#replaceManifestAfterAppend(next, stream.streamId, acknowledgedSpool, requiredCaptureSpool(
			this.#spools,
			stream.streamId,
		));
	}

	async #seal(): Promise<FramescaperCaptureSessionManifestV1> {
		this.#assertSynchronized();
		if (this.#manifest.state === 'sealed') return this.#manifest;
		if (this.#manifest.state !== 'capturing') {
			throw new Error('Only a capturing Framescaper session can be sealed.');
		}
		await this.#refreshStorage(false);
		for (const stream of this.#manifest.streams) {
			const spool = requiredCaptureSpool(this.#spools, stream.streamId);
			if (spool.kind === 'encoded-media' && spool.record.packetCount > 0
				&& spool.record.state === 'capturing') {
				const record = await this.#repositories.encodedSpools.seal(spool.record);
				this.#spools.set(stream.streamId, Object.freeze({ kind: 'encoded-media', record }));
			} else if (spool.kind === 'raw-pcm' && spool.record.frameCount > 0
				&& spool.record.state === 'capturing') {
				const record = await this.#repositories.rawPcmSpools.seal(spool.record, spool.owner);
				this.#spools.set(stream.streamId, Object.freeze({ ...spool, record }));
			}
		}
		const sealed = normalizeFramescaperCaptureSessionManifest({
			...this.#manifest,
			state: 'sealed',
			updatedAt: this.#updatedAt(),
		});
		return this.#replaceManifest(sealed);
	}

	async #refreshStorage(allowMissing: boolean): Promise<void> {
		const inspection = await inspectCaptureStorage(this.#repositories, this.#manifest);
		if (inspection.storageStatus === 'changed'
			|| (!allowMissing && inspection.storageStatus === 'missing')) {
			throw new Error(`Framescaper capture storage ownership changed for ${inspection.affectedStreamIds.join(', ')}.`);
		}
		this.#spools.clear();
		for (const [streamId, spool] of inspection.spools) this.#spools.set(streamId, spool);
	}

	async #replaceManifest(
		next: FramescaperCaptureSessionManifestV1,
	): Promise<FramescaperCaptureSessionManifestV1> {
		try {
			this.#manifest = await this.#repositories.manifests.replace(this.#manifest, next);
			return this.#manifest;
		} catch (error) {
			this.#synchronized = false;
			throw error;
		}
	}

	async #replaceManifestAfterAppend(
		next: FramescaperCaptureSessionManifestV1,
		streamId: string,
		acknowledged: OwnedCaptureSpool,
		advanced: OwnedCaptureSpool,
	): Promise<FramescaperCaptureSessionManifestV1> {
		try {
			this.#manifest = await this.#repositories.manifests.replace(this.#manifest, next);
			this.#spools.set(streamId, await acknowledgeCaptureAppend(
				this.#repositories, this.#manifest, streamId, advanced,
			));
			return this.#manifest;
		} catch (error) {
			try {
				const observed = await this.#repositories.manifests.load(
					this.#manifest.projectFence.projectId,
					this.#manifest.sessionId,
				);
				if (observed && sameManifest(observed, next)) {
					this.#manifest = observed;
					this.#spools.set(streamId, await acknowledgeCaptureAppend(
						this.#repositories, observed, streamId, advanced,
					));
					return observed;
				}
				if (!observed || !sameManifest(observed, this.#manifest)) {
					throw new Error('Framescaper capture manifest changed during acknowledged-prefix repair.');
				}
				if (acknowledged.kind === 'encoded-media' && advanced.kind === 'encoded-media') {
					await this.#repositories.encodedSpools.restoreAcknowledgedPrefix(
						advanced.record,
						acknowledged.record,
					);
				} else if (acknowledged.kind === 'raw-pcm' && advanced.kind === 'raw-pcm') {
					await this.#repositories.rawPcmSpools.restoreAcknowledgedPrefix(
						advanced.record,
						acknowledged.record,
					);
				} else throw new Error('Framescaper capture spool kind changed during prefix repair.');
				this.#spools.set(streamId, acknowledged);
			} catch (repairError) {
				this.#synchronized = false;
				throw new AggregateError(
					[error, repairError],
					'Framescaper capture manifest acknowledgement and spool-prefix repair both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
	}

	#assertWritableCapture(): void {
		this.#assertSynchronized();
		if (this.#manifest.state !== 'capturing') {
			throw new Error('Only a capturing Framescaper session can accept data.');
		}
	}

	#assertSynchronized(): void {
		if (this.#deleted) throw new Error('Framescaper capture session storage was deleted.');
		if (!this.#synchronized) throw new Error('Framescaper capture durable state lost synchronization.');
	}

	#updatedAt(): number {
		return Math.max(this.#manifest.updatedAt, timestamp(this.#now(), 'Framescaper capture update time'));
	}

	#enqueue<Result>(operation: () => Promise<Result>, verifyManifest = true): Promise<Result> {
		const result = this.#queue.then(() => withCaptureSessionOperationLock({
			projectId: this.#manifest.projectFence.projectId,
			sessionId: this.#manifest.sessionId,
		}, async () => {
			if (verifyManifest && !this.#deleted) {
				const authoritative = await this.#repositories.manifests.load(
					this.#manifest.projectFence.projectId, this.#manifest.sessionId,
				);
				if (!authoritative || !sameManifest(authoritative, this.#manifest)) {
					this.#synchronized = false;
					throw new Error('Framescaper capture manifest changed before its next durable operation.');
				}
			}
			return operation();
		}));
		this.#queue = result.then(() => undefined, () => undefined);
		return result;
	}
}
