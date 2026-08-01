/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../project-v9.ts';
import {
	createScapeDigest,
	scapeAudioSourceLayout,
	scapeAudioSourceStream,
	scapeHex,
} from '../scape-archive-media.ts';
import { throwIfScapeAborted } from '../scape-abort.ts';
import {
	DESKTOP_SHARED_AUDIO_ENCODING,
	MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES,
	type DesktopSharedManagedAudioSourceDescriptor,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedSourceTransferBridge,
	type DesktopSharedSourceTransferStore,
} from './desktop-shared-project-media-contract.ts';
import {
	preflightAudioTransfer,
	reachableProjectSources,
	type ManagedAudioSource,
} from './desktop-shared-project-media-sources.ts';

const DIGEST = /^[a-f0-9]{64}$/u;
const AUDIO_BINDING_ID = /^m[a-f0-9]{64}$/u;

export async function prepareDesktopSharedProjectAudioHandoff(
	projectValue: unknown,
	bridgeValue: DesktopSharedSourceTransferBridge,
	store: Pick<DesktopSharedSourceTransferStore, 'readSourceChunks'>,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<readonly DesktopSharedManagedSourceDescriptor[]> {
	validateAudioEditorProjectV9(projectValue);
	const project = projectValue as AudioEditorProjectV9;
	const sources = preflightSenderAudioSources(project);
	if (!sources.length) return Object.freeze([]);
	const bridge = transferBridge(bridgeValue);
	const results: DesktopSharedManagedSourceDescriptor[] = [];
	for (const source of sources) {
		throwIfScapeAborted(options.signal);
		results.push(await publishAudioSource(
			project.id,
			project.revision,
			source,
			bridge,
			store,
			options.signal,
		));
	}
	return Object.freeze(results);
}

async function publishAudioSource(
	projectId: string,
	projectRevision: number,
	source: ManagedAudioSource,
	bridge: DesktopSharedSourceTransferBridge,
	store: Pick<DesktopSharedSourceTransferStore, 'readSourceChunks'>,
	signal?: AbortSignal,
): Promise<DesktopSharedManagedSourceDescriptor> {
	const layout = scapeAudioSourceLayout(source);
	const sha256 = await digestAudioSource(source, store, signal);
	const admission = await bridge.beginSharedSourceWrite({
		byteLength: layout.archiveBytes,
		encoding: DESKTOP_SHARED_AUDIO_ENCODING,
		projectId,
		projectRevision,
		sha256,
		sourceId: source.id,
	});
	if (admission.status === 'present') {
		const descriptor = matchingDescriptor(admission.source, source, layout.archiveBytes, sha256);
		if (await digestAudioSource(source, store, signal) !== sha256) {
			throw new Error(`Audio source ${source.id} changed while preparing its managed handoff.`);
		}
		return descriptor;
	}
	const chunkSize = positiveChunkSize(admission.chunkSize);
	let offset = 0;
	const digest = createScapeDigest();
	const stream = scapeAudioSourceStream(store, source, digest, () => undefined, signal);
	try {
		await readStream(stream, async (chunk) => {
			for (let start = 0; start < chunk.byteLength; start += chunkSize) {
				throwIfScapeAborted(signal);
				const bytes = chunk.slice(start, Math.min(chunk.byteLength, start + chunkSize));
				const result = await bridge.writeSharedSourceChunk({ bytes, offset, writeId: admission.writeId });
				if (result?.nextOffset !== offset + bytes.byteLength) {
					throw new Error('Desktop shared-source write acknowledgement is out of sequence.');
				}
				offset = result.nextOffset;
			}
		});
		const transferredDigest = scapeHex(digest.digest());
		if (offset !== layout.archiveBytes || transferredDigest !== sha256) {
			throw new Error(`Audio source ${source.id} changed while preparing its managed handoff.`);
		}
		const descriptor = await bridge.finishSharedSourceWrite({
			sha256: transferredDigest,
			writeId: admission.writeId,
		});
		return matchingDescriptor(descriptor, source, layout.archiveBytes, sha256);
	} catch (error) {
		try {
			await bridge.abortSharedSourceWrite(admission.writeId);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Managed shared-source upload and cleanup failed.');
		}
		throw error;
	}
}

async function digestAudioSource(
	source: ManagedAudioSource,
	store: Pick<DesktopSharedSourceTransferStore, 'readSourceChunks'>,
	signal?: AbortSignal,
): Promise<string> {
	const digest = createScapeDigest();
	let bytes = 0;
	await readStream(
		scapeAudioSourceStream(store, source, digest, (length) => { bytes += length; }, signal),
		async () => undefined,
	);
	if (bytes !== scapeAudioSourceLayout(source).archiveBytes) {
		throw new Error(`Audio source ${source.id} emitted an unexpected canonical byte length.`);
	}
	return scapeHex(digest.digest());
}

function preflightSenderAudioSources(project: AudioEditorProjectV9): readonly ManagedAudioSource[] {
	const sources: ManagedAudioSource[] = [];
	for (const source of reachableProjectSources(project)) {
		if (source.kind !== 'audio') {
			throw new Error(`PCM-only desktop shared handoff does not support reachable video source ${source.id}.`);
		}
		sources.push(source);
	}
	return preflightAudioTransfer(sources);
}

function matchingDescriptor(
	value: unknown,
	source: ManagedAudioSource,
	byteLength: number,
	sha256: string,
): DesktopSharedManagedSourceDescriptor {
	const descriptor = managedAudioDescriptor(value);
	if (descriptor.sourceId !== source.id || descriptor.storageKey !== source.storageKey
		|| descriptor.byteLength !== byteLength || descriptor.sha256 !== sha256) {
		throw new Error(`Managed source descriptor does not match audio source ${source.id}.`);
	}
	return descriptor;
}

function managedAudioDescriptor(value: unknown): DesktopSharedManagedAudioSourceDescriptor {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source descriptor must be an object.');
	}
	const record = value as Record<string, unknown>;
	if (record.kind !== 'audio' || record.encoding !== DESKTOP_SHARED_AUDIO_ENCODING
		|| typeof record.bindingId !== 'string' || !AUDIO_BINDING_ID.test(record.bindingId)
		|| typeof record.sha256 !== 'string' || !DIGEST.test(record.sha256)
		|| typeof record.sourceId !== 'string' || !record.sourceId
		|| typeof record.storageKey !== 'string' || !record.storageKey
		|| !Number.isSafeInteger(record.byteLength) || Number(record.byteLength) < 0) {
		throw new TypeError('Desktop shared-source descriptor is invalid.');
	}
	return Object.freeze({
		bindingId: record.bindingId,
		byteLength: record.byteLength as number,
		encoding: DESKTOP_SHARED_AUDIO_ENCODING,
		kind: 'audio',
		sha256: record.sha256,
		sourceId: record.sourceId,
		storageKey: record.storageKey,
	});
}

function transferBridge(value: DesktopSharedSourceTransferBridge): DesktopSharedSourceTransferBridge {
	if (!value || typeof value !== 'object') throw new TypeError('Desktop shared-source transfer bridge is required.');
	for (const method of [
		'beginSharedSourceWrite',
		'writeSharedSourceChunk',
		'finishSharedSourceWrite',
		'abortSharedSourceWrite',
		'readSharedSourceChunk',
	] as const) {
		if (typeof value[method] !== 'function') throw new TypeError(`Desktop shared-source bridge.${method} is required.`);
	}
	return value;
}

function positiveChunkSize(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES) {
		throw new RangeError('Desktop shared-source chunk size is invalid.');
	}
	return Number(value);
}

async function readStream(
	stream: ReadableStream<Uint8Array>,
	onChunk: (chunk: Uint8Array) => Promise<void>,
): Promise<void> {
	const reader = stream.getReader();
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) return;
			await onChunk(result.value);
		}
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
}
