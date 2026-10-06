/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import { createStableId } from '../../../../stable-id.js';
import { sameStoredSourceIdentity, type StorageRecord } from '../../../../storage/media-records.ts';
import type { SourcePcmReadSession, SourceReadOptions } from '../../../../storage/source-read-repository.ts';
import type { ConsolidateAudioCacheStore } from './consolidate-linked-audio-cache.ts';
import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from '../../../../delivery-report.ts';

export interface ConsolidateManagedAudioStore extends ConsolidateAudioCacheStore {
	getSourceMetadata?(id: string): Promise<unknown>;
	openSourceReadSession?(id: string, options?: SourceReadOptions): Promise<SourcePcmReadSession | null>;
	discardSourceIfCurrent?(source: StorageRecord): Promise<boolean>;
}

export function reportConsolidatedPcm(
	report: DeliveryReport, sourceIds: readonly string[], failure?: unknown,
): DeliveryReport {
	const draft = createDeliveryReport(report.subject);
	for (const item of report.items) addDeliveryReportItem(draft, item);
	for (const id of sourceIds) addDeliveryReportItem(draft, {
		code: 'consolidate.pcm-wavpack', disposition: 'converted', scope: { kind: 'source', id },
		message: 'The audio source was converted to verified lossless WavPack; its raw generation remains available to undo.',
	});
	if (failure !== undefined) addDeliveryReportItem(draft, {
		code: 'consolidate.pcm-conversion-failed', disposition: 'missing', severity: 'error',
		data: { reason: failure instanceof Error ? failure.message : String(failure) },
		message: 'PCM consolidation could not finish. The project still references its original audio.',
	});
	return sealDeliveryReport(draft);
}

/** New immutable physical sources keep old project and undo generations readable. */
export async function prepareManagedAudioConsolidation(
	project: Readonly<Record<string, unknown>>, store: ConsolidateManagedAudioStore,
	assertCurrent: () => void, signal?: AbortSignal,
): Promise<{ readonly commands: AudioEditorCommand[]; discard(): Promise<void> }> {
	const published: StorageRecord[] = [];
	const discard = async (): Promise<void> => {
		const failures = await Promise.allSettled(published.map((source) => store.discardSourceIfCurrent?.(source)));
		const errors = failures.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
			.map((entry) => entry.reason as unknown);
		if (errors.length) throw new AggregateError(errors, 'Consolidated audio cleanup failed.', { cause: errors[0] });
	};
	const commands: AudioEditorCommand[] = [];
	if (!store.beginSourceWrite || !store.openSourceReadSession || !store.getSourceMetadata) return { commands, discard };
	try {
		for (const source of records(project.sources)) {
			ready(assertCurrent, signal);
			if (source.kind === 'video') continue;
			const key = String(source.storageKey || source.id);
			const metadata = storedSource(await store.getSourceMetadata(key));
			ready(assertCurrent, signal);
			if (!metadata || (metadata.storage !== 'copy-on-write' && metadata.rawChunkCount === 0)) continue;
			const chunkCount = positiveInteger(metadata.chunkCount), frameCount = positiveInteger(metadata.frameCount ?? metadata.frameLength);
			if (frameCount !== Number(source.frameCount) || Number(metadata.channelCount) !== Number(source.channelCount)
				|| Number(metadata.sampleRate) !== Number(source.sampleRate)) throw new Error('Consolidation source geometry changed.');
			const input = await store.openSourceReadSession(key, { expectedSource: metadata, signal });
			if (!input) throw new Error('Consolidation requires the exact stored audio generation.');
			try {
				const replacementId = createStableId('consolidated-audio');
				const writer = await store.beginSourceWrite(replacementId, {
					sampleRate: source.sampleRate, channelCount: source.channelCount,
					...(metadata.chunkFrames == null ? {} : { chunkFrames: metadata.chunkFrames }),
					pcmEncodingPolicy: 'wavpack-required', requirePersistentPcm: true,
				});
				let copiedFrames = 0;
				try {
					for (let index = 0; index < chunkCount; index += 1) {
						const chunk = await input.chunk(index, { signal });
						ready(assertCurrent, signal);
						copiedFrames += chunk.frames;
						if (copiedFrames > frameCount) throw new Error('Consolidation audio exceeds its source frame count.');
						await writer.write(chunk.channels, { signal });
						ready(assertCurrent, signal);
					}
					if (copiedFrames !== frameCount) throw new Error('Consolidation audio is missing source frames.');
					const replacement = storedSource(await writer.commit({}, { signal }));
					if (!replacement) throw new Error('Consolidation did not publish source metadata.');
					published.push(replacement);
					ready(assertCurrent, signal);
					if (replacement.rawChunkCount !== 0 || replacement.wavpackChunkCount !== chunkCount
						|| Number(replacement.frameCount) !== frameCount) throw new Error('Consolidation requires WavPack for every PCM packet.');
					await verifyCopy(store, input, replacement, chunkCount, assertCurrent, signal);
					if (!sameStoredSourceIdentity(storedSource(await store.getSourceMetadata(key)), metadata)) {
						throw new Error('Consolidation source generation changed before binding.');
					}
					ready(assertCurrent, signal);
					const clips = [...records(project.clips), ...records(record(project.projectBin)?.clips)]
						.filter((clip) => clip.sourceId === source.id)
						.map((clip) => ({ clipId: String(clip.id), sourceStartFrame: Number(clip.sourceStartFrame) }));
					commands.push({ type: 'source/rewrite-media', sourceId: String(source.id),
						changes: { storageKey: replacementId }, clips });
				} catch (error) { await writer.abort(); throw error; }
			} finally { await input.release(); }
		}
		return { commands, discard };
	} catch (error) {
		try { await discard(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Consolidation and cleanup failed.', { cause: cleanup }); }
		throw error;
	}
}

async function verifyCopy(
	store: ConsolidateManagedAudioStore, original: SourcePcmReadSession, replacement: StorageRecord,
	chunkCount: number, assertCurrent: () => void, signal?: AbortSignal,
): Promise<void> {
	const copy = await store.openSourceReadSession?.(String(replacement.id), { expectedSource: replacement, signal });
	if (!copy) throw new Error('Consolidation requires a fresh read of its published PCM.');
	try {
		for (let index = 0; index < chunkCount; index += 1) {
			const expected = await original.chunk(index, { signal });
			const actual = await copy.chunk(index, { signal });
			ready(assertCurrent, signal);
			if (expected.frames !== actual.frames || expected.channels.length !== actual.channels.length) {
				throw new Error('Consolidated PCM geometry differs from its source.');
			}
			for (let channel = 0; channel < expected.channels.length; channel += 1) {
				const left = expected.channels[channel], right = actual.channels[channel];
				const leftBits = new Uint32Array(left.buffer, left.byteOffset, left.length);
				const rightBits = new Uint32Array(right.buffer, right.byteOffset, right.length);
				if (leftBits.length !== rightBits.length || leftBits.some((bits, frame) => bits !== rightBits[frame])) {
					throw new Error('Consolidated PCM did not preserve its exact source sample bits.');
				}
			}
		}
	} finally { await copy.release(); }
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.flatMap((entry) => { const result = record(entry); return result ? [result] : []; }) : [];
}
function storedSource(value: unknown): StorageRecord | null {
	const item = record(value);
	if (!item) return null;
	if (typeof item.id !== 'string' || typeof item.storage !== 'string'
		|| (item.sourceToken != null && typeof item.sourceToken !== 'string')
		|| (item.path != null && typeof item.path !== 'string')
		|| (item.baseSourceId != null && typeof item.baseSourceId !== 'string')
		|| (item.pcmEncodingVersion != null && typeof item.pcmEncodingVersion !== 'number')) {
		throw new Error('Consolidation source metadata has invalid generation fields.');
	}
	return { ...item, id: item.id, storage: item.storage, sourceToken: item.sourceToken ?? null,
		path: item.path ?? null, baseSourceId: item.baseSourceId ?? null, pcmEncodingVersion: item.pcmEncodingVersion ?? null };
}
function positiveInteger(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError('Consolidation requires positive source geometry.');
	return Number(value);
}
function ready(assertCurrent: () => void, signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Consolidation was cancelled.', 'AbortError');
	assertCurrent();
}
