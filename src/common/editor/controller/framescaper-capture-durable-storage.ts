/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CapturePacket } from '../framescaper-capture-domain.ts';
import type {
	FramescaperCaptureSessionManifestV1,
	FramescaperCaptureStreamManifestV1,
} from '../framescaper-capture-session-manifest.ts';
import type {
	EncodedCaptureSpoolRecord,
	EncodedCaptureSpoolRepository,
} from '../storage/encoded-capture-spool-repository.ts';
import type {
	RawPcmSpoolRecord,
	RawPcmSpoolRepository,
} from '../storage/raw-pcm-spool-repository.ts';
import { FRAMESCAPER_CAPTURE_PCM_MAXIMUM_GAP_FRAMES } from '../storage/raw-pcm-spool-chunk-timing.ts';
import type { CaptureSpoolCreationFence } from '../storage/capture-spool-creation-fence.ts';

interface CaptureStreamRegistrationBase {
	readonly streamId: string;
	readonly spoolId: string;
	readonly sourceId: string;
	readonly required: boolean;
}

export interface FramescaperEncodedCaptureStreamRegistration extends CaptureStreamRegistrationBase {
	readonly kind: 'encoded-media';
	readonly role: 'camera' | 'display';
	readonly mimeType: string;
}

export interface FramescaperRawPcmCaptureStreamRegistration extends CaptureStreamRegistrationBase {
	readonly kind: 'raw-pcm';
	readonly role: 'microphone' | 'system-audio';
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
}

export type FramescaperCaptureStreamRegistration =
	FramescaperEncodedCaptureStreamRegistration | FramescaperRawPcmCaptureStreamRegistration;

export type EncodedSpoolPort = Pick<EncodedCaptureSpoolRepository,
	'create' | 'load' | 'append' | 'seal' | 'delete' | 'releaseAdopted' | 'restoreAcknowledgedPrefix'
> & Partial<Pick<EncodedCaptureSpoolRepository, 'reconcileAppend'>>;
export type RawPcmSpoolPort = Pick<RawPcmSpoolRepository,
	'create' | 'load' | 'append' | 'seal' | 'remove' | 'restoreAcknowledgedPrefix'
> & Partial<Pick<RawPcmSpoolRepository, 'releaseReservation' | 'reconcileAppend'>>;
type FramescaperRawPcmSpoolPort = RawPcmSpoolPort & Partial<Pick<RawPcmSpoolRepository, 'createFramescaper'>>;

export interface DurableCaptureStoragePorts {
	readonly encodedSpools: EncodedSpoolPort;
	readonly rawPcmSpools: FramescaperRawPcmSpoolPort;
}

interface RawPcmOwnerV1 {
	readonly version: 1;
	readonly kind: 'framescaper-capture-raw-pcm';
	readonly sessionId: string;
	readonly streamId: string;
	readonly sourceId: string;
	readonly role: 'microphone' | 'system-audio';
}

export type OwnedCaptureSpool =
	| Readonly<{ readonly kind: 'encoded-media'; readonly record: EncodedCaptureSpoolRecord }>
	| Readonly<{
		readonly kind: 'raw-pcm';
		readonly record: RawPcmSpoolRecord;
		readonly owner: RawPcmOwnerV1;
	}>;

export interface CaptureStorageInspection {
	readonly storageStatus: 'exact' | 'missing' | 'changed';
	readonly affectedStreamIds: readonly string[];
	readonly spools: Map<string, OwnedCaptureSpool>;
}

export function assertCaptureStreamRegistrations(
	registrations: readonly FramescaperCaptureStreamRegistration[],
): void {
	if (!Array.isArray(registrations) || Object.getPrototypeOf(registrations) !== Array.prototype
		|| registrations.length < 1 || registrations.length > 4) {
		throw new TypeError('Framescaper capture requires one to four standard stream registrations.');
	}
	for (let index = 0; index < registrations.length; index += 1) {
		if (!Object.hasOwn(registrations, index)) {
			throw new TypeError('Framescaper capture stream registrations must be dense.');
		}
		const registration = registrations[index]!;
		if (typeof registration?.required !== 'boolean'
			|| (registration.kind === 'encoded-media'
				&& registration.role !== 'camera' && registration.role !== 'display')
			|| (registration.kind === 'raw-pcm'
				&& registration.role !== 'microphone' && registration.role !== 'system-audio')
			|| (registration.kind !== 'encoded-media' && registration.kind !== 'raw-pcm')) {
			throw new TypeError('Framescaper capture stream registration kind or role is invalid.');
		}
	}
	for (const [name, values] of [
		['stream IDs', registrations.map(({ streamId }) => streamId)],
		['spool IDs', registrations.map(({ spoolId }) => spoolId)],
		['source IDs', registrations.map(({ sourceId }) => sourceId)],
		['roles', registrations.map(({ role }) => role)],
	] as const) {
		if (new Set(values).size !== values.length) {
			throw new Error(`Framescaper capture ${name} must be unique.`);
		}
	}
	if (registrations.some(({ role }) => role === 'system-audio')
		&& !registrations.some(({ role }) => role === 'display')) {
		throw new Error('Framescaper system audio requires a display stream.');
	}
}

export async function createCaptureSpool(
	repositories: DurableCaptureStoragePorts,
	identity: Readonly<{ readonly sessionId: string; readonly projectId: string }>,
	registration: FramescaperCaptureStreamRegistration,
	spoolToken?: string,
	creationFence?: CaptureSpoolCreationFence,
): Promise<OwnedCaptureSpool> {
	if (registration.kind === 'encoded-media') {
		const record = await repositories.encodedSpools.create({
			projectId: identity.projectId,
			sessionId: identity.sessionId,
			streamId: registration.streamId,
			spoolId: registration.spoolId,
			...(spoolToken === undefined ? {} : { spoolToken }),
			...(creationFence === undefined ? {} : { creationFence }),
			sourceId: registration.sourceId,
			mimeType: registration.mimeType,
		});
		return Object.freeze({ kind: 'encoded-media', record });
	}
	const owner = rawPcmOwner(identity.sessionId, registration);
	const createFramescaper = repositories.rawPcmSpools.createFramescaper;
	if (typeof createFramescaper !== 'function') {
		throw new Error('Framescaper raw PCM manifest append fencing is unavailable.');
	}
	const record = await createFramescaper.call(repositories.rawPcmSpools, {
		projectId: identity.projectId,
		spoolId: registration.spoolId,
		...(spoolToken === undefined ? {} : { spoolToken }),
		...(creationFence === undefined ? {} : { creationFence }),
		sampleRate: registration.sampleRate,
		channelCount: registration.channelCount,
		chunkFrames: registration.chunkFrames,
		data: owner,
	});
	return Object.freeze({ kind: 'raw-pcm', record, owner });
}

export function createCaptureStreamManifest(
	registration: FramescaperCaptureStreamRegistration,
	spool: OwnedCaptureSpool,
): FramescaperCaptureStreamManifestV1 {
	if (registration.kind === 'encoded-media' && spool.kind === 'encoded-media') {
		return Object.freeze({
			streamId: registration.streamId,
			role: registration.role,
			required: registration.required,
			playability: 'unknown',
			timing: Object.freeze({ firstPresentationMicroseconds: null, lastPresentationEndMicroseconds: null }),
			storage: Object.freeze({
				kind: 'encoded-media',
				spoolId: spool.record.spoolId,
				spoolToken: spool.record.spoolToken,
				sourceId: spool.record.sourceId,
				mimeType: spool.record.mimeType,
				packetCount: 0,
				chunkCount: 0,
				byteLength: 0,
			}),
		});
	}
	if (registration.kind === 'raw-pcm' && spool.kind === 'raw-pcm') {
		return Object.freeze({
			streamId: registration.streamId,
			role: registration.role,
			required: registration.required,
			playability: 'unknown',
			timing: Object.freeze({ firstPresentationMicroseconds: null, lastPresentationEndMicroseconds: null }),
			storage: Object.freeze({
				kind: 'raw-pcm',
				spoolId: spool.record.spoolId,
				spoolToken: spool.record.spoolToken,
				sourceId: registration.sourceId,
				sampleRate: spool.record.sampleRate,
				channelCount: spool.record.channelCount,
				frameCount: 0,
				chunkCount: 0,
			}),
		});
	}
	throw new Error('Framescaper capture registration does not match its durable spool.');
}

export async function inspectCaptureStorage(
	repositories: DurableCaptureStoragePorts,
	manifest: FramescaperCaptureSessionManifestV1,
): Promise<CaptureStorageInspection> {
	const spools = new Map<string, OwnedCaptureSpool>();
	const missing: string[] = [];
	const changed: string[] = [];
	for (const stream of manifest.streams) {
		if (stream.storage.kind === 'encoded-media') {
			const storage = stream.storage;
			const loaded = await repositories.encodedSpools.load(
				manifest.projectFence.projectId,
				storage.spoolId,
			);
			const record = loaded && await requiredEncodedAppendReconciliation(repositories)(loaded, {
				packetCount: storage.packetCount,
				chunkCount: storage.chunkCount,
				byteLength: storage.byteLength,
				firstPtsMicroseconds: stream.timing.firstPresentationMicroseconds,
				lastPtsEndMicroseconds: stream.timing.lastPresentationEndMicroseconds,
			});
			if (!record) missing.push(stream.streamId);
			else if (!encodedStorageMatches(manifest, stream, storage, record)) changed.push(stream.streamId);
			else spools.set(stream.streamId, Object.freeze({ kind: 'encoded-media', record }));
		} else {
			const storage = stream.storage;
			const loaded = await repositories.rawPcmSpools.load(
				manifest.projectFence.projectId,
				storage.spoolId,
			);
			const record = loaded && await requiredRawPcmAppendReconciliation(repositories)(loaded, {
				frameCount: storage.frameCount,
				chunkCount: storage.chunkCount,
			});
			const owner = rawPcmOwnerFromManifest(manifest, stream, storage);
			if (!record) missing.push(stream.streamId);
			else if (!rawPcmStorageMatches(manifest, storage, record, owner)) changed.push(stream.streamId);
			else spools.set(stream.streamId, Object.freeze({ kind: 'raw-pcm', record, owner }));
		}
	}
	const affectedStreamIds = Object.freeze([...changed, ...missing]);
	return Object.freeze({
		storageStatus: changed.length ? 'changed' : missing.length ? 'missing' : 'exact',
		affectedStreamIds,
		spools,
	});
}

export function assertEncodedCapturePacket(
	packet: Extract<CapturePacket, { readonly kind: 'encoded-video' }>,
	stream: FramescaperCaptureStreamManifestV1,
	record: EncodedCaptureSpoolRecord,
): void {
	if (packet.role !== stream.role || packet.mimeType !== record.mimeType
		|| packet.byteLength !== packet.bytes.byteLength || packet.byteLength < 1) {
		throw new Error('Encoded capture packet format does not match its registered stream.');
	}
	if (packet.sequence !== record.packetCount) {
		throw new Error('Encoded capture packets require the next contiguous sequence.');
	}
	const expectedPts = record.lastPtsEndMicroseconds;
	if (!Number.isSafeInteger(packet.presentationTimeUs) || packet.presentationTimeUs < 0
		|| (expectedPts !== null && packet.presentationTimeUs !== expectedPts)) {
		throw new Error('Encoded capture packets require contiguous presentation time.');
	}
}

export function assertPcmCapturePacket(
	packet: Extract<CapturePacket, { readonly kind: 'pcm-audio' }>,
	stream: FramescaperCaptureStreamManifestV1,
	record: RawPcmSpoolRecord,
): void {
	if (packet.role !== stream.role || packet.sampleRate !== record.sampleRate
		|| packet.channelCount !== record.channelCount || packet.frameCount < 1
		|| packet.samples.length !== packet.frameCount * packet.channelCount) {
		throw new Error('PCM capture packet format does not match its registered stream.');
	}
	if (packet.sequence !== record.chunkCount) {
		throw new Error('PCM capture packets require the next contiguous sequence.');
	}
	if (packet.durationUs !== frameTimeMicroseconds(packet.frameCount, record.sampleRate)) {
		throw new Error('PCM capture packet duration does not match its frame count.');
	}
	const droppedFrames = exactDroppedFrames(packet);
	const previousEnd = stream.timing.lastPresentationEndMicroseconds;
	if (!Number.isSafeInteger(packet.presentationTimeUs) || packet.presentationTimeUs < 0
		|| (record.chunkCount === 0 && (previousEnd !== null || droppedFrames !== 0))) {
		throw new Error('PCM capture packet has invalid initial presentation time.');
	}
	if (record.chunkCount > 0) {
		if (previousEnd === null || Math.abs(
				packet.presentationTimeUs - previousEnd
				- frameTimeMicroseconds(droppedFrames, record.sampleRate),
			) > 1) {
			throw new Error('PCM capture packet contiguous presentation time disagrees with exact dropped frames.');
		}
	}
}

export function deinterleaveCapturePcm(
	samples: Float32Array,
	frameCount: number,
	channelCount: number,
): readonly Float32Array[] {
	const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			channels[channel]![frame] = samples[frame * channelCount + channel]!;
		}
	}
	return Object.freeze(channels);
}

export async function cleanupCreatedCaptureSpools(
	repositories: DurableCaptureStoragePorts,
	created: Map<string, OwnedCaptureSpool>,
): Promise<void> {
	for (const spool of [...created.values()].reverse()) {
		try {
			if (spool.kind === 'encoded-media') await repositories.encodedSpools.delete(spool.record);
			else await repositories.rawPcmSpools.remove(spool.record);
		} catch { /* Creation failure remains primary; exact leftovers remain inventoried. */ }
	}
}

/** Reconcile a raw global reservation after its exact terminal registry row is already absent. */
export async function releaseMissingCaptureSpoolReservation(
	repositories: DurableCaptureStoragePorts,
	manifest: FramescaperCaptureSessionManifestV1,
	stream: FramescaperCaptureStreamManifestV1,
): Promise<void> {
	if (stream.storage.kind !== 'raw-pcm') return;
	const release = repositories.rawPcmSpools.releaseReservation;
	if (typeof release !== 'function' || !await release.call(repositories.rawPcmSpools, {
		projectId: manifest.projectFence.projectId,
		spoolId: stream.storage.spoolId,
		spoolToken: stream.storage.spoolToken,
	})) throw new Error(`Framescaper capture storage ownership changed for ${stream.streamId}.`);
}

export function requiredCaptureSpool(
	spools: Map<string, OwnedCaptureSpool>,
	streamId: string,
): OwnedCaptureSpool {
	const spool = spools.get(streamId);
	if (!spool) throw new Error(`Framescaper capture spool ${streamId} is missing.`);
	return spool;
}

/** Retire only the append intent proven by the newly durable manifest prefix. */
export async function acknowledgeCaptureAppend(
	repositories: DurableCaptureStoragePorts,
	manifest: FramescaperCaptureSessionManifestV1,
	streamId: string,
	spool: OwnedCaptureSpool,
): Promise<OwnedCaptureSpool> {
	const stream = manifest.streams.find((candidate) => candidate.streamId === streamId);
	if (!stream) throw new Error(`Framescaper capture stream ${streamId} is missing after append acknowledgement.`);
	if (spool.kind === 'encoded-media' && stream.storage.kind === 'encoded-media') {
		const record = await requiredEncodedAppendReconciliation(repositories)(spool.record, {
			packetCount: stream.storage.packetCount,
			chunkCount: stream.storage.chunkCount,
			byteLength: stream.storage.byteLength,
			firstPtsMicroseconds: stream.timing.firstPresentationMicroseconds,
			lastPtsEndMicroseconds: stream.timing.lastPresentationEndMicroseconds,
		});
		return Object.freeze({ kind: 'encoded-media', record });
	}
	if (spool.kind === 'raw-pcm' && stream.storage.kind === 'raw-pcm') {
		const record = await requiredRawPcmAppendReconciliation(repositories)(spool.record, {
			frameCount: stream.storage.frameCount,
			chunkCount: stream.storage.chunkCount,
		});
		return Object.freeze({ ...spool, record });
	}
	throw new Error('Framescaper capture spool kind changed during append acknowledgement.');
}

function requiredEncodedAppendReconciliation(repositories: DurableCaptureStoragePorts) {
	const reconcile = repositories.encodedSpools.reconcileAppend;
	if (typeof reconcile !== 'function') throw new Error('Encoded capture append reconciliation is unavailable.');
	return reconcile.bind(repositories.encodedSpools);
}

function requiredRawPcmAppendReconciliation(repositories: DurableCaptureStoragePorts) {
	const reconcile = repositories.rawPcmSpools.reconcileAppend;
	if (typeof reconcile !== 'function') throw new Error('Raw PCM append reconciliation is unavailable.');
	return reconcile.bind(repositories.rawPcmSpools);
}

function rawPcmOwner(
	sessionId: string,
	registration: FramescaperRawPcmCaptureStreamRegistration,
): RawPcmOwnerV1 {
	return Object.freeze({
		version: 1,
		kind: 'framescaper-capture-raw-pcm',
		sessionId,
		streamId: registration.streamId,
		sourceId: registration.sourceId,
		role: registration.role,
	});
}

function rawPcmOwnerFromManifest(
	manifest: FramescaperCaptureSessionManifestV1,
	stream: FramescaperCaptureStreamManifestV1,
	storage: Extract<FramescaperCaptureStreamManifestV1['storage'], { readonly kind: 'raw-pcm' }>,
): RawPcmOwnerV1 {
	return Object.freeze({
		version: 1,
		kind: 'framescaper-capture-raw-pcm',
		sessionId: manifest.sessionId,
		streamId: stream.streamId,
		sourceId: storage.sourceId,
		role: stream.role as 'microphone' | 'system-audio',
	});
}

function encodedStorageMatches(
	manifest: FramescaperCaptureSessionManifestV1,
	stream: FramescaperCaptureStreamManifestV1,
	storage: Extract<FramescaperCaptureStreamManifestV1['storage'], { readonly kind: 'encoded-media' }>,
	record: EncodedCaptureSpoolRecord,
): boolean {
	return record.projectId === manifest.projectFence.projectId
		&& record.sessionId === manifest.sessionId
		&& record.streamId === stream.streamId
		&& record.spoolId === storage.spoolId
		&& record.spoolToken === storage.spoolToken
		&& record.sourceId === storage.sourceId
		&& record.mimeType === storage.mimeType
		&& record.packetCount === storage.packetCount
		&& record.chunkCount === storage.chunkCount
		&& record.byteLength === storage.byteLength
		&& storageStateMatches(manifest.state, record.state, record.packetCount > 0);
}

function rawPcmStorageMatches(
	manifest: FramescaperCaptureSessionManifestV1,
	storage: Extract<FramescaperCaptureStreamManifestV1['storage'], { readonly kind: 'raw-pcm' }>,
	record: RawPcmSpoolRecord,
	owner: RawPcmOwnerV1,
): boolean {
	return record.projectId === manifest.projectFence.projectId
		&& record.spoolId === storage.spoolId
		&& record.spoolToken === storage.spoolToken
		&& record.sampleRate === storage.sampleRate
		&& record.channelCount === storage.channelCount
		&& record.appendProtocol === 'framescaper-manifest-v1'
		&& record.frameCount === storage.frameCount
		&& record.chunkCount === storage.chunkCount
		&& JSON.stringify(record.data) === JSON.stringify(owner)
		&& storageStateMatches(manifest.state, record.state, record.frameCount > 0);
}

function storageStateMatches(
	manifestState: FramescaperCaptureSessionManifestV1['state'],
	spoolState: EncodedCaptureSpoolRecord['state'] | RawPcmSpoolRecord['state'],
	hasData: boolean,
): boolean {
	if (manifestState === 'capturing') return spoolState === 'capturing' || spoolState === 'sealed';
	if (manifestState === 'discarded') return spoolState !== 'adopted';
	if (manifestState === 'committed' && spoolState === 'deleting') return true;
	if (!hasData) return spoolState === 'capturing';
	return spoolState === 'sealed' || spoolState === 'adopted';
}

function frameTimeMicroseconds(frames: number, sampleRate: number): number {
	return Math.round(frames * 1_000_000 / sampleRate);
}

function exactDroppedFrames(packet: Extract<CapturePacket, { readonly kind: 'pcm-audio' }>): number {
	const observation = packet.droppedBefore;
	if (observation.confidence !== 'exact' || !Number.isSafeInteger(observation.value)
		|| Number(observation.value) < 0
		|| Number(observation.value) > FRAMESCAPER_CAPTURE_PCM_MAXIMUM_GAP_FRAMES) {
		throw new Error('PCM capture packets require bounded exact dropped-frame evidence.');
	}
	return Number(observation.value);
}
