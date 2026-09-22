/* SPDX-License-Identifier: AGPL-3.0-only */

/** Publish reviewed speech, its source, clip, and private script in one project edit. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createAssistanceTtsScriptBodyV1, createAssistanceTtsScriptBodyPublicationV1 } from
	'../../assistance/tts-script-body-publication-v1.ts';
import type { AssistanceTtsScriptAssetReferenceV1 } from
	'../../assistance/assistance-asset-reference-v1.ts';
import { normalizeAssistanceAssetReferencesV1 } from '../../assistance/assistance-asset-reference-v1.ts';
import { createAddClipCommand, createAddSourceCommand, createAddTrackCommand,
	createRegenerateTtsClipCommand } from
	'../../commands/factories.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../project-media-factory.ts';
import { createNonImportedSourceProvenance } from '../../source-provenance-root.ts';
import { scaleSampleFrame } from '../../timeline-time.ts';
import type { MediaAssetWriter, OwnedMediaAssetPublication } from
	'../../storage/media-asset-write-contract.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../wav-import.js';
import type { TextToSpeechProjectPort, TextToSpeechRequest, TextToSpeechReviewed } from '../../assistance/text-to-speech-port-contract.ts';

type RecordValue = Readonly<Record<string, unknown>>;
type Awaitable<T> = T | PromiseLike<T>;

interface SpeechProject extends RecordValue {
	readonly id: string;
	readonly revision: number;
	readonly sampleRate: number;
	readonly primarySequenceId?: string;
	readonly sources: readonly RecordValue[];
	readonly clips: readonly RecordValue[];
	readonly tracks: readonly RecordValue[];
	readonly assistanceAssets?: readonly unknown[];
}

interface SpeechSourceWriter {
	readonly framesWritten?: number;
	write(channels: readonly Float32Array[]): Awaitable<unknown>;
	commit(metadata?: RecordValue, options?: Readonly<{ ifAbsent?: boolean }>): Awaitable<unknown>;
	abort(reason?: unknown): Awaitable<unknown>;
}

export interface TextToSpeechProjectDependencies {
	readonly getProject: () => SpeechProject | null;
	readonly getSelectedClipId: () => string | null;
	readonly getPlayheadFrame: () => number;
	readonly createId: (prefix: string) => string;
	readonly commit: (command: RecordValue) => void;
	readonly preflightStorage: (bytes: number, category: 'effect') => Promise<unknown>;
	readonly store: Readonly<{
		beginSourceWrite(sourceId: string, metadata: RecordValue): Awaitable<SpeechSourceWriter>;
		deleteSource(sourceId: string): Promise<unknown>;
		getMediaAssetMetadata(storageKey: string): Awaitable<unknown>;
		loadMediaAsset(storageKey: string): Awaitable<unknown>;
		beginMediaAssetWrite(storageKey: string, metadata: RecordValue,
			options: Readonly<{ expectedBytes: number; expectedSha256: string }>): Awaitable<MediaAssetWriter>;
	}>;
}

const SOURCE_CHUNK_FRAMES = 65_536;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;

export function createTextToSpeechProjectPort(
	dependencies: TextToSpeechProjectDependencies,
): TextToSpeechProjectPort {
	let openedProjectId: string | null = null;
	let target: Readonly<{ clipId: string; reference: AssistanceTtsScriptAssetReferenceV1 }> | null = null;
	return Object.freeze({ loadInitial, accept });

	async function loadInitial(): Promise<TextToSpeechRequest | null> {
		const project = dependencies.getProject();
		openedProjectId = project?.id ?? null;
		target = null;
		if (!project) return null;
		const clipId = dependencies.getSelectedClipId();
		if (clipId === null) return null;
		const clip = project.clips.find(({ id }) => id === clipId);
		if (!clip) return null;
		const reference = normalizeAssistanceAssetReferencesV1(project.assistanceAssets ?? []).find(({ kind, sourceId }) =>
			kind === 'tts-script-v1' && sourceId === clip.sourceId) ?? null;
		if (!reference || reference.kind !== 'tts-script-v1') return null;
		const source = project.sources.find(({ id }) => id === reference.sourceId);
		if (!source || source.contentSha256 !== reference.sourceSha256) return null;
		const loaded = await dependencies.store.loadMediaAsset(reference.body.storageKey);
		const bytes = await readBytes(loaded);
		if (bytes.byteLength !== reference.body.byteLength
			|| bytesToHex(sha256(bytes)) !== reference.body.sha256) {
			throw new Error('The saved speech script does not match its project reference.');
		}
		const body = createAssistanceTtsScriptBodyV1(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
		if (body.sourceId !== source.id) throw new Error('The saved speech script belongs to another source.');
		if (dependencies.getProject()?.id !== project.id) throw new Error('The project changed while loading speech.');
		target = Object.freeze({ clipId, reference });
		return Object.freeze({ text: body.text, language: body.language,
			voiceId: body.voiceId, speed: body.speed });
	}

	async function accept(reviewed: TextToSpeechReviewed): Promise<void> {
		const project = dependencies.getProject();
		if (!project || project.id !== openedProjectId) {
			throw new Error('The project changed while speech was being reviewed.');
		}
		if (!(reviewed.audio instanceof Blob) || reviewed.audio.size < 1
			|| reviewed.audio.size > MAXIMUM_OUTPUT_BYTES) {
			throw new TypeError('Reviewed speech audio has an invalid size.');
		}
		const descriptor = await inspectWavBlobPcm(reviewed.audio) as Readonly<{
			sampleRate: number; channelCount: number; frameCount: number; sampleFormat: string;
		}>;
		if (descriptor.sampleRate !== 24_000 || descriptor.channelCount !== 1
			|| descriptor.frameCount < 1 || !['int16', 'float32'].includes(descriptor.sampleFormat)) {
			throw new TypeError('Reviewed speech audio must be 24 kHz mono PCM WAV.');
		}
		await dependencies.preflightStorage(descriptor.frameCount * 4, 'effect');
		assertCurrent(project);
		const sourceId = dependencies.createId('tts-source');
		const digest = bytesToHex(sha256(new Uint8Array(await reviewed.audio.arrayBuffer())));
		const source = createAudioSource({ id: sourceId, storageKey: sourceId,
			name: 'Generated Speech', kind: 'audio', mimeType: 'audio/wav',
			frameCount: descriptor.frameCount, channelCount: 1,
			sampleRate: 24_000, originalSampleRate: 24_000, sampleFormat: 'float32',
			chunkFrames: SOURCE_CHUNK_FRAMES, contentSha256: digest,
			byteLength: reviewed.audio.size,
			provenance: createNonImportedSourceProvenance('generated'),
		});
		const selected = target;
		const sourceHasPeerClip = selected !== null && project.clips.some(({ id, sourceId: clipSourceId }) =>
			id !== selected.clipId && clipSourceId === selected.reference.sourceId);
		const reference = sourceHasPeerClip ? null : selected?.reference ?? null;
		const publication = createAssistanceTtsScriptBodyPublicationV1({
			assetId: reference?.id ?? dependencies.createId('tts-script'),
			text: reviewed.request.text, language: reviewed.request.language,
			voiceId: reviewed.request.voiceId, speed: reviewed.request.speed,
			source: { sourceId, sourceSha256: digest, sourceStartFrame: 0,
				sourceEndFrame: descriptor.frameCount },
			model: { modelId: reviewed.modelId, modelVersion: reviewed.modelVersion,
				artifactSha256s: [...reviewed.artifactSha256s].sort() },
			recipe: { id: 'kokoro-text-to-speech', version: 1 },
		});
		const commands = placementCommands(project, target, source, descriptor.frameCount);
		let sourcePublished = false;
		let ownedBody: OwnedMediaAssetPublication | null = null;
		try {
			await publishSource(dependencies.store, sourceId, reviewed.audio, descriptor.frameCount, digest);
			sourcePublished = true;
			assertCurrent(project);
			ownedBody = await publishBody(dependencies.store, publication);
			assertCurrent(project);
			dependencies.commit({ type: 'assistance-asset/upsert', expectedReference: reference,
				reference: publication.reference, commands });
			target = null;
		} catch (error) {
			const failures: unknown[] = [error];
			if (ownedBody) {
				try { await ownedBody.discardIfCurrent(); } catch (cleanup) { failures.push(cleanup); }
			}
			if (sourcePublished) {
				try { await dependencies.store.deleteSource(sourceId); } catch (cleanup) { failures.push(cleanup); }
			}
			if (failures.length > 1) throw new AggregateError(failures, 'Speech publication rollback failed.', { cause: error });
			throw error;
		}
	}

	function assertCurrent(initial: SpeechProject): void {
		const current = dependencies.getProject();
		if (!current || current.id !== initial.id || current.revision !== initial.revision) {
			throw new Error('The project changed while speech was being accepted.');
		}
		const selected = target;
		if (selected && (dependencies.getSelectedClipId() !== selected.clipId
			|| !current.clips.some(({ id, sourceId }) => id === selected.clipId
				&& sourceId === selected.reference.sourceId))) {
			throw new Error('The selected speech clip changed while it was being reviewed.');
		}
	}

	function placementCommands(
		project: SpeechProject,
		selected: typeof target,
		source: RecordValue,
		frameCount: number,
	): readonly AudioEditorCommand[] {
		const commands: AudioEditorCommand[] = [createAddSourceCommand(source)];
		if (selected) {
			commands.push(createRegenerateTtsClipCommand(selected.clipId, String(source.id)));
			return Object.freeze(commands);
		}
		const trackId = dependencies.createId('tts-track');
		const clipId = dependencies.createId('tts-clip');
		const start = dependencies.getPlayheadFrame();
		if (!Number.isSafeInteger(start) || start < 0) throw new RangeError('The playhead is invalid.');
		commands.push({ ...createAddTrackCommand(createAudioTrack({ id: trackId,
			name: 'Generated Speech' }, project.sampleRate)),
			...(project.primarySequenceId ? { sequenceId: project.primarySequenceId } : {}) });
		commands.push(createAddClipCommand(trackId, createAudioClip({ id: clipId,
			sourceId: String(source.id), title: 'Generated Speech', timelineStartFrame: start,
			sourceStartFrame: 0, sourceDurationFrames: frameCount,
			durationFrames: timelineDuration(frameCount, project.sampleRate), avLinkId: null })));
		return Object.freeze(commands);
	}
}

function timelineDuration(frameCount: number, projectSampleRate: number): number {
	const duration = scaleSampleFrame(frameCount, 24_000, projectSampleRate, 'point');
	if (!Number.isSafeInteger(duration) || duration < 1) throw new RangeError('Speech duration is invalid.');
	return duration;
}

async function publishSource(
	store: TextToSpeechProjectDependencies['store'], sourceId: string, audio: Blob,
	frameCount: number, digest: string,
): Promise<void> {
	let writer: SpeechSourceWriter | null = null;
	try {
		writer = await store.beginSourceWrite(sourceId, { name: 'Generated Speech',
			mimeType: 'audio/wav', sampleFormat: 'float32', sampleRate: 24_000,
			channelCount: 1, chunkFrames: SOURCE_CHUNK_FRAMES,
			contentSha256: digest, byteLength: audio.size });
		await streamWavBlobPcm(audio, { chunkFrames: SOURCE_CHUNK_FRAMES,
			onChunk: (channels: Float32Array[]) => writer!.write(channels) });
		if (writer.framesWritten !== undefined && writer.framesWritten !== frameCount) {
			throw new Error('Speech source writing changed its frame count.');
		}
		await writer.commit({ sampleRate: 24_000, channelCount: 1,
			chunkFrames: SOURCE_CHUNK_FRAMES, contentSha256: digest,
			byteLength: audio.size }, { ifAbsent: true });
	} catch (error) {
		await Promise.resolve(writer?.abort(error)).catch(() => undefined);
		throw error;
	}
}

async function publishBody(
	store: TextToSpeechProjectDependencies['store'],
	publication: ReturnType<typeof createAssistanceTtsScriptBodyPublicationV1>,
): Promise<OwnedMediaAssetPublication | null> {
	const { body } = publication.reference;
	const existing = await store.getMediaAssetMetadata(body.storageKey);
	if (existing !== null && existing !== undefined) {
		const metadata = existing as RecordValue;
		if (metadata.sourceId !== body.storageKey || metadata.size !== body.byteLength
			|| metadata.sha256 !== body.sha256 || metadata.mimeType !== body.mimeType
			|| metadata.kind !== 'assistance-tts-script'
			|| metadata.encoding !== 'canonical-json-v1') {
			throw new Error('An existing speech script has conflicting metadata.');
		}
		const bytes = await readBytes(await store.loadMediaAsset(body.storageKey));
		if (bytes.byteLength !== body.byteLength || bytesToHex(sha256(bytes)) !== body.sha256) {
			throw new Error('An existing speech script conflicts with its content address.');
		}
		return null;
	}
	const writer = await store.beginMediaAssetWrite(body.storageKey, {
		name: `Speech script ${publication.reference.id}`, kind: 'assistance-tts-script',
		encoding: 'canonical-json-v1', mimeType: body.mimeType,
	}, { expectedBytes: body.byteLength, expectedSha256: body.sha256 });
	if (!writer.commitOwned || !Number.isSafeInteger(writer.maximumChunkBytes)
		|| writer.maximumChunkBytes < 1 || writer.maximumChunkBytes > 4 * 1024 * 1024) {
		await writer.abort();
		throw new TypeError('Speech script storage lacks owned publication.');
	}
	let owned: OwnedMediaAssetPublication | null = null;
	try {
		for (let offset = 0; offset < publication.bytes.byteLength; offset += writer.maximumChunkBytes) {
			await writer.write(publication.bytes.subarray(offset, offset + writer.maximumChunkBytes));
		}
		owned = await writer.commitOwned();
		if (!owned?.discardIfCurrent) throw new TypeError('Speech script storage lost rollback authority.');
		return owned;
	} catch (error) {
		if (owned) await owned.discardIfCurrent();
		else await writer.abort();
		throw error;
	}
}

async function readBytes(value: unknown): Promise<Uint8Array> {
	if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
	if (value instanceof Uint8Array) return value;
	throw new TypeError('A saved speech script has an invalid body.');
}
