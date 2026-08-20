/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCaptureSessionManifestV1,
	FramescaperCaptureStreamManifestV1,
} from '../framescaper-capture-session-manifest.ts';
import type {
	EncodedCaptureSpoolRecord,
	EncodedCaptureSpoolRepository,
} from '../storage/encoded-capture-spool-repository.ts';
import type { StorageRecord } from '../storage/media-records.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from '../storage/media-asset-write-contract.ts';
import type { OwnedAudioSourceWriter } from '../storage/source-write-repository.ts';
import type {
	RawPcmSpoolRecord,
	RawPcmSpoolRepository,
} from '../storage/raw-pcm-spool-repository.ts';
import { normalizeRational, roundRational, type RationalRate } from '../timeline-time.ts';
import {
	createVideoTimingAssetPublication,
	decodeVideoTimingAsset,
	encodeVideoTimingAsset,
	type VideoTimingAssetInput,
} from '../video-timing-asset.ts';
import {
	loadVideoTimingAsset,
	publishVideoTimingAsset,
	type VideoTimingMediaStore,
} from '../video-timing-storage.ts';
import { normalizeVideoSourceCharacteristics } from '../video-source-characteristics.ts';
import type {
	FramescaperCaptureAssetPublicationMode,
	FramescaperCaptureAssetStream,
	FramescaperOwnedCaptureAssetPublication,
} from './framescaper-capture-publication-service.ts';
import {
	inspectFramescaperCaptureEncodedMedia,
	openFramescaperCaptureEncodedMedia,
	type FramescaperCaptureEncodedMaterial,
	type FramescaperCaptureEncodedMediaInput,
} from './framescaper-capture-encoded-media.ts';
import {
	inspectFramescaperCapturePcmTimeline,
	writeFramescaperCapturePcmTimeline,
} from './framescaper-capture-canonical-pcm.ts';

type EncodedSpoolPublicationPort = Pick<EncodedCaptureSpoolRepository, 'load' | 'read'>;
type RawPcmSpoolPublicationPort = Pick<RawPcmSpoolRepository, 'load' | 'chunks'>;

export interface FramescaperCaptureCanonicalStore extends VideoTimingMediaStore {
	getSourceMetadata(sourceId: string): PromiseLike<StorageRecord | null>;
	beginSourceWrite(
		sourceId: string,
		metadata?: Record<string, unknown>,
	): PromiseLike<OwnedAudioSourceWriter>;
	discardSourceIfCurrent(source: StorageRecord): PromiseLike<boolean>;
}

export interface FramescaperCaptureVideoProbeResult {
	readonly backend: string;
	readonly nominalRate: RationalRate;
	readonly timing: VideoTimingAssetInput;
	readonly width: number;
	readonly height: number;
	readonly characteristics?: unknown;
}

export interface FramescaperCaptureCanonicalAssetOptions {
	readonly store: FramescaperCaptureCanonicalStore;
	readonly encodedSpools: EncodedSpoolPublicationPort;
	readonly rawPcmSpools: RawPcmSpoolPublicationPort;
	readonly probeVideo: (
		/** The already-retained ordinary media Blob/File; never an adapter-assembled take. */
		input: Blob,
		context: Readonly<{
			readonly manifest: FramescaperCaptureSessionManifestV1;
			readonly stream: FramescaperCaptureStreamManifestV1;
			readonly signal: AbortSignal | null;
		}>,
	) => PromiseLike<FramescaperCaptureVideoProbeResult> | FramescaperCaptureVideoProbeResult;
}

export async function publishFramescaperCaptureCanonicalAsset(
	options: FramescaperCaptureCanonicalAssetOptions,
	manifest: FramescaperCaptureSessionManifestV1,
	streamManifest: FramescaperCaptureStreamManifestV1,
	stream: FramescaperCaptureAssetStream,
	projectSampleRate: number,
	signal: AbortSignal | null,
	publicationMode: FramescaperCaptureAssetPublicationMode,
): Promise<FramescaperOwnedCaptureAssetPublication> {
	return streamManifest.storage.kind === 'raw-pcm'
		? publishRawPcm(options, manifest, streamManifest, stream, projectSampleRate, signal, publicationMode)
		: publishEncodedVideo(options, manifest, streamManifest, stream, projectSampleRate, signal, publicationMode);
}

async function publishRawPcm(
	options: FramescaperCaptureCanonicalAssetOptions,
	manifest: FramescaperCaptureSessionManifestV1,
	streamManifest: FramescaperCaptureStreamManifestV1,
	stream: FramescaperCaptureAssetStream,
	projectSampleRate: number,
	signal: AbortSignal | null,
	publicationMode: FramescaperCaptureAssetPublicationMode,
): Promise<FramescaperOwnedCaptureAssetPublication> {
	if (streamManifest.storage.kind !== 'raw-pcm') throw new Error('Capture PCM storage kind changed.');
	const storage = streamManifest.storage;
	const spool = await options.rawPcmSpools.load(manifest.projectFence.projectId, storage.spoolId);
	assertRawPcmSpool(manifest, streamManifest, spool);
	const timeline = await inspectFramescaperCapturePcmTimeline(options.rawPcmSpools, spool, streamManifest);
	const durationFrames = scaledFrameCount(timeline.outputFrameCount, projectSampleRate, storage.sampleRate);
	assertFinalDuration(stream, durationFrames);
	const fingerprint = publicationFingerprint(manifest, streamManifest, timeline.outputFrameCount);
	const existing = await options.store.getSourceMetadata(storage.sourceId);
	if (existing) {
		assertExistingAudio(existing, storage, timeline.outputFrameCount, fingerprint);
		return borrowedPublication(audioSource(streamManifest, spool, timeline.outputFrameCount), durationFrames);
	}
	if (publicationMode === 'reconcile-only') {
		throw new Error(`Capture source ${storage.sourceId} is missing during commit reconciliation.`);
	}
	const writer = await options.store.beginSourceWrite(storage.sourceId, {
		name: captureName(streamManifest.role),
		mimeType: 'audio/x-soundscaper-pcm',
		sampleRate: storage.sampleRate,
		channelCount: storage.channelCount,
		chunkFrames: spool.chunkFrames,
		framescaperCapturePublicationV1: fingerprint,
	});
	let committed: StorageRecord | null = null;
	try {
		await writeFramescaperCapturePcmTimeline(options.rawPcmSpools, spool, writer, timeline, signal);
		committed = await writer.commit({
			sampleRate: storage.sampleRate,
			channelCount: storage.channelCount,
		}, { ...(signal ? { signal } : {}), ifAbsent: true });
		assertExistingAudio(committed, storage, timeline.outputFrameCount, fingerprint);
		return Object.freeze({
			source: audioSource(streamManifest, spool, timeline.outputFrameCount),
			timelineDurationFrames: durationFrames,
			discardIfCurrent: () => options.store.discardSourceIfCurrent(committed!),
		});
	} catch (error) {
		if (committed) {
			if (!await options.store.discardSourceIfCurrent(committed)) {
				throw new AggregateError(
					[error, new Error('Capture PCM publication ownership changed before rollback.')],
					'Capture PCM publication and rollback both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
		await abortWriter(writer, error);
		const concurrent = await options.store.getSourceMetadata(storage.sourceId);
		if (concurrent) {
			assertExistingAudio(concurrent, storage, timeline.outputFrameCount, fingerprint);
			return borrowedPublication(audioSource(streamManifest, spool, timeline.outputFrameCount), durationFrames);
		}
		throw error;
	}
}

async function publishEncodedVideo(
	options: FramescaperCaptureCanonicalAssetOptions,
	manifest: FramescaperCaptureSessionManifestV1,
	streamManifest: FramescaperCaptureStreamManifestV1,
	stream: FramescaperCaptureAssetStream,
	projectSampleRate: number,
	signal: AbortSignal | null,
	publicationMode: FramescaperCaptureAssetPublicationMode,
): Promise<FramescaperOwnedCaptureAssetPublication> {
	if (streamManifest.storage.kind !== 'encoded-media') throw new Error('Capture video storage kind changed.');
	const storage = streamManifest.storage;
	const spool = await options.encodedSpools.load(manifest.projectFence.projectId, storage.spoolId);
	assertEncodedSpool(manifest, streamManifest, spool);
	const media = openFramescaperCaptureEncodedMedia(options.encodedSpools, spool, signal);
	const material = await inspectFramescaperCaptureEncodedMedia(media);
	const fingerprint = publicationFingerprint(manifest, streamManifest);
	const body = await publishVideoBody(options.store, {
		sourceId: storage.sourceId,
		name: captureName(streamManifest.role),
		mimeType: storage.mimeType,
		media,
		material,
		fingerprint,
		signal,
		publicationMode,
	});
	let timingPublication: OwnedMediaAssetPublication | null = null;
	try {
		const retainedBody = await loadRetainedVideoBody(
			options.store,
			storage.sourceId,
			material.byteLength,
			signal,
		);
		const probed = normalizeVideoProbe(await options.probeVideo(retainedBody, {
			manifest,
			stream: streamManifest,
			signal,
		}));
		const durationFrames = scaledFrameCount(
			probed.timing.endTicks,
			projectSampleRate,
			probed.timing.timescale,
		);
		assertFinalDuration(stream, durationFrames);
		const publishedTiming = await publishCanonicalTiming(
			options.store,
			material.sha256,
			probed.timing,
			signal,
			publicationMode,
		);
		timingPublication = publishedTiming.publication;
		const source = Object.freeze({
			kind: 'video', id: storage.sourceId, storageKey: storage.sourceId,
			name: captureName(streamManifest.role), mimeType: storage.mimeType,
			sampleFrameCount: durationFrames, sampleRate: projectSampleRate,
			width: probed.width, height: probed.height,
			frameRate: probed.rate, sourceFrameCount: probed.timing.frameCount,
			contentSha256: material.sha256, timingAsset: publishedTiming.reference,
			timingDecision: Object.freeze({ mode: 'exact', rate: probed.rate, backend: probed.backend }),
			characteristics: probed.characteristics,
			videoCodec: probed.characteristics.videoCodec ?? 'unknown',
			audioCodec: null, hasAudio: false,
			posterStorageKey: null, thumbnailStorageKey: null,
			opaqueExtensions: Object.freeze({}),
		});
		return compositeMediaPublication(source, durationFrames, [body.publication, timingPublication]);
	} catch (error) {
		await rollbackMediaPublications([body.publication, timingPublication], error);
		throw error;
	}
}

async function publishVideoBody(
	store: FramescaperCaptureCanonicalStore,
	input: Readonly<{
		readonly sourceId: string;
		readonly name: string;
		readonly mimeType: string;
		readonly media: FramescaperCaptureEncodedMediaInput;
		readonly material: FramescaperCaptureEncodedMaterial;
		readonly fingerprint: Readonly<Record<string, unknown>>;
		readonly signal: AbortSignal | null;
		readonly publicationMode: FramescaperCaptureAssetPublicationMode;
	}>,
): Promise<Readonly<{
	readonly metadata: Readonly<Record<string, unknown>>;
	readonly publication: OwnedMediaAssetPublication | null;
}>> {
	const existing = await store.getMediaAssetMetadata(input.sourceId);
	if (existing) {
		assertExistingVideo(existing, input);
		return Object.freeze({ metadata: existing, publication: null });
	}
	if (input.publicationMode === 'reconcile-only') {
		throw new Error(`Capture source ${input.sourceId} is missing during commit reconciliation.`);
	}
	const writer = await store.beginMediaAssetWrite(input.sourceId, {
		name: input.name, mimeType: input.mimeType,
		framescaperCapturePublicationV1: input.fingerprint,
	}, {
		expectedBytes: input.material.byteLength,
		expectedSha256: input.material.sha256,
		...(input.signal ? { signal: input.signal } : {}),
	}) as OwnedMediaAssetWriter;
	let publication: OwnedMediaAssetPublication | null = null;
	try {
		const maximumChunkBytes = positiveInteger(writer.maximumChunkBytes, 'capture media writer chunk bound');
		let emittedBytes = 0;
		for await (const chunk of input.media.chunks()) {
			for (let offset = 0; offset < chunk.byteLength; offset += maximumChunkBytes) {
				throwIfAborted(input.signal);
				const bytes = chunk.subarray(offset, Math.min(offset + maximumChunkBytes, chunk.byteLength));
				await writer.write(bytes, input.signal ? { signal: input.signal } : {});
				emittedBytes += bytes.byteLength;
			}
		}
		if (emittedBytes !== input.material.byteLength || writer.bytesWritten !== input.material.byteLength) {
			throw new Error('Capture media emitted an unexpected byte length.');
		}
		publication = await writer.commitOwned(input.signal ? { signal: input.signal } : {});
		assertExistingVideo(publication.metadata, input);
		return Object.freeze({ metadata: publication.metadata, publication });
	} catch (error) {
		if (publication) await rollbackMediaPublications([publication], error);
		else await abortMediaWriter(writer, error);
		const concurrent = await store.getMediaAssetMetadata(input.sourceId);
		if (concurrent) {
			assertExistingVideo(concurrent, input);
			return Object.freeze({ metadata: concurrent, publication: null });
		}
		throw error;
	}
}

async function loadRetainedVideoBody(
	store: FramescaperCaptureCanonicalStore,
	storageKey: string,
	expectedBytes: number,
	signal: AbortSignal | null,
): Promise<Blob> {
	throwIfAborted(signal);
	const body = await store.loadMediaAsset(storageKey, signal ? { signal } : {});
	throwIfAborted(signal);
	if (!body || body.size !== expectedBytes) {
		throw new Error('The retained capture media body is missing or truncated before probing.');
	}
	return body;
}

async function publishCanonicalTiming(
	store: FramescaperCaptureCanonicalStore,
	sourceSha256: string,
	timing: VideoTimingAssetInput,
	signal: AbortSignal | null,
	publicationMode: FramescaperCaptureAssetPublicationMode,
) {
	const options = signal ? { signal } : {};
	if (publicationMode === 'publish') {
		return publishVideoTimingAsset(store, sourceSha256, timing, options);
	}
	const { reference } = createVideoTimingAssetPublication(sourceSha256, timing);
	const existing = await store.getMediaAssetMetadata(reference.storageKey);
	if (!existing || existing.sha256 !== reference.sha256 || existing.size !== reference.byteLength) {
		throw new Error('The immutable capture timing asset is missing during commit reconciliation.');
	}
	const loaded = await loadVideoTimingAsset(store, reference, { ...options, sourceSha256 });
	if (loaded.status !== 'available') {
		throw new Error(`The immutable capture timing asset is ${loaded.status} during commit reconciliation.`);
	}
	return Object.freeze({ reference, created: false, publication: null });
}

function audioSource(
	stream: FramescaperCaptureStreamManifestV1,
	spool: RawPcmSpoolRecord,
	outputFrameCount: number,
): Readonly<Record<string, unknown>> {
	if (stream.storage.kind !== 'raw-pcm') throw new Error('Capture PCM source storage changed.');
	return Object.freeze({
		kind: 'audio', schemaVersion: 4,
		id: stream.storage.sourceId, storageKey: stream.storage.sourceId,
		name: captureName(stream.role), mimeType: 'audio/x-soundscaper-pcm',
		sampleRate: stream.storage.sampleRate, originalSampleRate: stream.storage.sampleRate,
		frameCount: outputFrameCount, channelCount: stream.storage.channelCount,
		sampleFormat: 'float32', chunkFrames: spool.chunkFrames,
		opaqueExtensions: Object.freeze({}),
	});
}

function normalizeVideoProbe(value: FramescaperCaptureVideoProbeResult) {
	const backend = stableText(value?.backend, 'capture timing probe backend');
	const rate = normalizeRational(value?.nominalRate);
	if (rate.num <= 0) throw new RangeError('Capture video probe requires a positive nominal rate.');
	const timing = decodeVideoTimingAsset(encodeVideoTimingAsset(value?.timing));
	const width = positiveInteger(value?.width, 'capture video width');
	const height = positiveInteger(value?.height, 'capture video height');
	const supplied = value?.characteristics && typeof value.characteristics === 'object'
		&& !Array.isArray(value.characteristics)
		? value.characteristics as Readonly<Record<string, unknown>>
		: {};
	const characteristics = normalizeVideoSourceCharacteristics({
		...supplied,
		backend: supplied.backend ?? backend,
		codedWidth: supplied.codedWidth ?? width,
		codedHeight: supplied.codedHeight ?? height,
	}, { rate });
	return Object.freeze({ backend, rate, timing, width, height, characteristics });
}

function assertRawPcmSpool(
	manifest: FramescaperCaptureSessionManifestV1,
	stream: FramescaperCaptureStreamManifestV1,
	spool: RawPcmSpoolRecord | null,
): asserts spool is RawPcmSpoolRecord {
	if (!spool || stream.storage.kind !== 'raw-pcm' || spool.state !== 'sealed'
		|| spool.projectId !== manifest.projectFence.projectId
		|| spool.spoolId !== stream.storage.spoolId || spool.spoolToken !== stream.storage.spoolToken
		|| spool.sampleRate !== stream.storage.sampleRate || spool.channelCount !== stream.storage.channelCount
		|| spool.frameCount !== stream.storage.frameCount || spool.chunkCount !== stream.storage.chunkCount
		|| !sameData(spool.data, {
			version: 1,
			kind: 'framescaper-capture-raw-pcm',
			sessionId: manifest.sessionId,
			streamId: stream.streamId,
			sourceId: stream.storage.sourceId,
			role: stream.role,
		})) {
		throw new Error(`Capture PCM spool ownership changed for ${stream.streamId}.`);
	}
}

function assertEncodedSpool(
	manifest: FramescaperCaptureSessionManifestV1,
	stream: FramescaperCaptureStreamManifestV1,
	spool: EncodedCaptureSpoolRecord | null,
): asserts spool is EncodedCaptureSpoolRecord {
	if (!spool || stream.storage.kind !== 'encoded-media' || spool.state !== 'sealed'
		|| spool.projectId !== manifest.projectFence.projectId || spool.sessionId !== manifest.sessionId
		|| spool.streamId !== stream.streamId || spool.spoolId !== stream.storage.spoolId
		|| spool.spoolToken !== stream.storage.spoolToken || spool.sourceId !== stream.storage.sourceId
		|| spool.mimeType !== stream.storage.mimeType || spool.packetCount !== stream.storage.packetCount
		|| spool.chunkCount !== stream.storage.chunkCount || spool.byteLength !== stream.storage.byteLength) {
		throw new Error(`Capture video spool ownership changed for ${stream.streamId}.`);
	}
}

function publicationFingerprint(
	manifest: FramescaperCaptureSessionManifestV1,
	stream: FramescaperCaptureStreamManifestV1,
	outputFrameCount?: number,
): Readonly<Record<string, unknown>> {
	const storage = stream.storage;
	return Object.freeze({
		version: 1, projectId: manifest.projectFence.projectId, sessionId: manifest.sessionId,
		streamId: stream.streamId, spoolId: storage.spoolId, spoolToken: storage.spoolToken,
		sourceId: storage.sourceId, kind: storage.kind, timing: stream.timing,
		acknowledgedUnits: storage.kind === 'raw-pcm'
			? Object.freeze({ frameCount: storage.frameCount, chunkCount: storage.chunkCount, outputFrameCount })
			: Object.freeze({
				packetCount: storage.packetCount, chunkCount: storage.chunkCount, byteLength: storage.byteLength,
			}),
	});
}

function assertExistingAudio(
	metadata: StorageRecord,
	storage: Extract<FramescaperCaptureStreamManifestV1['storage'], { readonly kind: 'raw-pcm' }>,
	outputFrameCount: number,
	fingerprint: Readonly<Record<string, unknown>>,
): void {
	if (metadata.id !== storage.sourceId || metadata.sampleRate !== storage.sampleRate
		|| metadata.channelCount !== storage.channelCount || metadata.frameCount !== outputFrameCount
		|| !sameData(metadata.framescaperCapturePublicationV1, fingerprint)) {
		throw new Error(`Capture source ${storage.sourceId} is owned by different content.`);
	}
}

function assertExistingVideo(
	metadata: Readonly<Record<string, unknown>>,
	input: Readonly<{
		readonly sourceId: string;
		readonly mimeType: string;
		readonly material: FramescaperCaptureEncodedMaterial;
		readonly fingerprint: Readonly<Record<string, unknown>>;
	}>,
): void {
	if (metadata.sourceId !== input.sourceId || metadata.mimeType !== input.mimeType
		|| metadata.size !== input.material.byteLength || metadata.sha256 !== input.material.sha256
		|| !sameData(metadata.framescaperCapturePublicationV1, input.fingerprint)) {
		throw new Error(`Capture source ${input.sourceId} is owned by different content.`);
	}
}

function borrowedPublication(
	source: Readonly<Record<string, unknown>>,
	timelineDurationFrames: number,
): FramescaperOwnedCaptureAssetPublication {
	return Object.freeze({ source, timelineDurationFrames, discardIfCurrent: () => true });
}

function compositeMediaPublication(
	source: Readonly<Record<string, unknown>>,
	timelineDurationFrames: number,
	publications: readonly (OwnedMediaAssetPublication | null)[],
): FramescaperOwnedCaptureAssetPublication {
	return Object.freeze({
		source,
		timelineDurationFrames,
		async discardIfCurrent() {
			let discarded = true;
			const errors: unknown[] = [];
			for (const publication of [...publications].reverse()) {
				if (!publication) continue;
				try { discarded = await publication.discardIfCurrent() && discarded; } catch (error) { errors.push(error); }
			}
			if (errors.length) throw new AggregateError(errors, 'Capture media rollback failed.');
			return discarded;
		},
	});
}

async function rollbackMediaPublications(
	publications: readonly (OwnedMediaAssetPublication | null)[],
	primary: unknown,
): Promise<void> {
	const errors: unknown[] = [];
	for (const publication of [...publications].reverse()) {
		if (!publication) continue;
		try {
			if (!await publication.discardIfCurrent()) {
				errors.push(new Error('Capture media publication ownership changed before rollback.'));
			}
		} catch (error) { errors.push(error); }
	}
	if (errors.length) {
		throw new AggregateError([primary, ...errors], 'Capture media publication and rollback both failed.', {
			cause: primary,
		});
	}
}

async function abortWriter(writer: OwnedAudioSourceWriter, primary: unknown): Promise<void> {
	try { await writer.abort(); } catch (error) {
		throw new AggregateError([primary, error], 'Capture PCM publication and cleanup both failed.', { cause: primary });
	}
}

async function abortMediaWriter(writer: OwnedMediaAssetWriter, primary: unknown): Promise<void> {
	try { await writer.abort(); } catch (error) {
		throw new AggregateError([primary, error], 'Capture media publication and cleanup both failed.', { cause: primary });
	}
}

function scaledFrameCount(
	frames: number | bigint,
	targetRate: number,
	sourceRate: number,
): number {
	const numerator = (typeof frames === 'bigint' ? frames : BigInt(positiveInteger(frames, 'capture source frame count')))
		* BigInt(positiveInteger(targetRate, 'project sample rate'));
	return positiveInteger(roundRational(
		numerator,
		BigInt(positiveInteger(sourceRate, 'capture source rate')),
		'point',
	), 'capture timeline duration');
}

function assertFinalDuration(stream: FramescaperCaptureAssetStream, expected: number): void {
	if (stream.timelineDurationFrames !== undefined && stream.timelineDurationFrames !== expected) {
		throw new Error(`Capture ${stream.role} final duration disagrees with its canonical media probe.`);
	}
}

function captureName(role: FramescaperCaptureStreamManifestV1['role']): string {
	switch (role) {
		case 'camera': return 'Camera Capture';
		case 'microphone': return 'Microphone Capture';
		case 'display': return 'Screen Capture';
		case 'system-audio': return 'System Audio Capture';
	}
}

function sameData(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function stableText(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value.length > 128 || /[^\x20-\x7e]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function throwIfAborted(signal: AbortSignal | null): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Capture publication was cancelled.', 'AbortError');
}
