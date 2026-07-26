/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AudioEditorClipboard,
	AudioEditorCommand,
	ClipboardPasteMode,
	CommandObject,
} from '../commands/protocol.ts';
import type { EffectSelectionFrequencyRange, EffectTarget } from './effect-selection-service.ts';
import type { AudioBufferLike } from './source-audio.ts';

type RangeReplacementCommand = Extract<AudioEditorCommand, { readonly type: 'range/replace' }>;
type SelectionCommand = Extract<AudioEditorCommand, { readonly type: 'selection/set' }>;
type PasteCommand = Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;

export interface EffectResultProject {
	readonly id: string;
}

export interface SelectionEffectResult {
	readonly target: EffectTarget;
	readonly channels: Float32Array[];
}

export interface EffectResultSelectionDetails {
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
	readonly frequencyRange?: EffectSelectionFrequencyRange | null;
}

export interface PersistEffectResultOptions {
	readonly allowIndependentLengths?: boolean;
	readonly assertCurrent?: () => void;
	readonly effectName?: string;
	readonly project?: EffectResultProject;
	readonly selectionDetails?: EffectResultSelectionDetails;
	readonly signal?: AbortSignal | null;
}

export interface EffectResultCommitOptions {
	readonly selectTrackId: string;
	readonly selectClipId?: string;
}

export interface EffectResultCopy {
	readonly audioAnalysisFailed: string;
	readonly audioAnalysisWorkerFailed: string;
	readonly audioBufferUnsupported: string;
	readonly audacityProjectTooLong: string;
	readonly decodedAudioEmpty: string;
	readonly decodedChannelLengthsMismatch: string;
	readonly effectChannelLayoutChanged: string;
	readonly effectChannelLengthsMismatch: string;
	readonly effectInvalidAudio: string;
	readonly effectTrackLengthsMismatch?: string | null;
}

export interface EffectResultAudioContext {
	createBuffer?(channelCount: number, length: number, sampleRate: number): AudioBufferLike;
}

export interface EffectResultSource extends CommandObject {
	readonly id: string;
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: 'audio/wav';
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
}

export interface EffectResultSourceWriter {
	write(channels: Float32Array[]): Promise<unknown> | unknown;
	commit(metadata: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
	abort(reason?: unknown): Promise<unknown> | unknown;
}

export interface EffectResultStore {
	beginSourceWrite(
		sourceId: string,
		metadata: Readonly<{
			name: string;
			mimeType: 'audio/wav';
			sampleRate: number;
			channelCount: number;
			chunkFrames: number;
		}>,
	): Promise<EffectResultSourceWriter>;
	saveAnalysis(key: string, value: unknown): Promise<unknown>;
	deleteAnalysis?(key: string): Promise<unknown>;
	deleteSource(sourceId: string): Promise<unknown>;
}

interface EffectResultCache {
	delete(sourceId: string): unknown;
}

interface EffectResultPeakCache extends EffectResultCache {
	set(sourceId: string, peaks: unknown): unknown;
}

interface RangeReplacementOptions {
	readonly trackId: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly source: EffectResultSource;
}

interface RangeDeleteOptions {
	readonly trackIds: readonly string[];
	readonly startFrame: number;
	readonly endFrame: number;
	readonly rippleMode: 'track';
}

interface PasteOptions {
	readonly project: EffectResultProject;
	readonly atFrame: number;
	readonly trackMap: Readonly<Record<string, string>>;
	readonly mode: ClipboardPasteMode;
}

export interface SelectionEffectResultRuntime {
	readonly SOURCE_CHUNK_FRAMES: number;
	readonly assertAudacityEffectOutput: (channels: Float32Array[]) => unknown;
	readonly audioSelectionEffectLabel: (type: string | null, copy: EffectResultCopy) => string;
	readonly bufferFromChannels: (
		channels: Float32Array[],
		sampleRate: number,
		context: EffectResultAudioContext,
		copy: EffectResultCopy,
	) => Promise<AudioBufferLike>;
	readonly cacheSourceBuffer: (sourceId: string, buffer: AudioBufferLike) => unknown;
	readonly commit: (command: AudioEditorCommand, options: EffectResultCommitOptions) => unknown;
	readonly copy: EffectResultCopy;
	readonly createStableId: (prefix: 'audacity-effect') => string;
	readonly engine: Readonly<{
		getAudioContext(options: Readonly<{ resume: false }>): Promise<EffectResultAudioContext>;
	}>;
	readonly generateWaveformPeaks: (
		channels: Float32Array[],
		copy: EffectResultCopy,
	) => Promise<unknown>;
	readonly peakCacheKey: (sourceId: string) => string;
	readonly preparePasteCommand: (clipboard: AudioEditorClipboard, options: PasteOptions) => PasteCommand;
	readonly prepareRangeDeleteCommand: (
		project: EffectResultProject,
		options: RangeDeleteOptions,
	) => AudioEditorCommand;
	readonly prepareRangeReplacementCommand: (
		project: EffectResultProject,
		options: RangeReplacementOptions,
	) => RangeReplacementCommand;
	readonly getProject: () => EffectResultProject;
	readonly projectSampleRate: () => number;
	readonly sourceBuffers: EffectResultCache;
	readonly sourcePeaks: EffectResultPeakCache;
	readonly state: Readonly<{ selectedTrackId: string | null }>;
	readonly store: EffectResultStore;
	readonly throwIfAborted: (signal: AbortSignal | null) => void;
	readonly writeBuffer: (
		writer: EffectResultSourceWriter,
		buffer: AudioBufferLike,
		signal: AbortSignal | null,
	) => Promise<unknown>;
}

export interface SelectionEffectResultService {
	persistAudacityEffectResults(
		results: readonly SelectionEffectResult[],
		type: string | null,
		options?: PersistEffectResultOptions,
	): Promise<Array<RangeReplacementCommand | null>>;
	prepareSilentAudacityRippleCommand(target: EffectTarget, outputFrameCount: number): AudioEditorCommand | null;
}

interface EffectResultEntryBase {
	readonly target: EffectTarget;
	readonly channels: Float32Array[];
	readonly frameCount: number;
	readonly command: AudioEditorCommand | null;
}

interface SilentEffectResultEntry extends EffectResultEntryBase {
	readonly buffer: null;
	readonly sourceId: null;
	readonly sourceName: null;
	readonly replacement: null;
}

interface PersistedEffectResultEntry extends EffectResultEntryBase {
	readonly buffer: AudioBufferLike;
	readonly source: EffectResultSource;
	readonly sourceId: string;
	readonly sourceName: string;
	readonly replacement: RangeReplacementCommand | null;
}

type EffectResultEntry = SilentEffectResultEntry | PersistedEffectResultEntry;
type ExactClipEffectResultEntry = EffectResultEntry & Readonly<{
	target: EffectTarget & Readonly<{ clipId: string }>;
}>;

export function createSelectionEffectResultService(
	runtime: SelectionEffectResultRuntime,
): Readonly<SelectionEffectResultService> {
	const {
		SOURCE_CHUNK_FRAMES, assertAudacityEffectOutput, audioSelectionEffectLabel, bufferFromChannels,
		cacheSourceBuffer, commit, copy, createStableId,
		engine, generateWaveformPeaks, peakCacheKey, preparePasteCommand,
		prepareRangeDeleteCommand, prepareRangeReplacementCommand, getProject, projectSampleRate,
		sourceBuffers, sourcePeaks, state, store,
		throwIfAborted, writeBuffer,
	} = runtime;

	async function persistAudacityEffectResults(
		results: readonly SelectionEffectResult[],
		type: string | null,
		options: PersistEffectResultOptions = {},
	): Promise<Array<RangeReplacementCommand | null>> {
		const signal = options.signal || null;
		const assertCurrent = typeof options.assertCurrent === 'function'
			? options.assertCurrent
			: () => {};
		const assertOperationCurrent = (): void => {
			throwIfAborted(signal);
			assertCurrent();
		};
		assertOperationCurrent();
		const uncheckedResults: unknown = results;
		if (!Array.isArray(uncheckedResults) || !uncheckedResults.length) throw new Error(copy.effectInvalidAudio);
		const sampleRate = projectSampleRate();
		const context = await engine.getAudioContext({ resume: false });
		assertOperationCurrent();
		const effectName = options.effectName || audioSelectionEffectLabel(type, copy);
		const entries: EffectResultEntry[] = [];
		for (const result of uncheckedResults as unknown[]) {
			assertOperationCurrent();
			const candidate = (result || {}) as Readonly<{
				target?: unknown;
				channels?: unknown;
			}>;
			const { target: targetValue, channels: channelValue } = candidate;
			const rawChannels = Array.isArray(channelValue) ? channelValue as unknown[] : null;
			const firstChannelLength = rawChannels?.[0] == null
				? undefined
				: (rawChannels[0] as Readonly<{ length?: unknown }>).length;
			if (!targetValue || !rawChannels?.length || rawChannels.length > 2 || !firstChannelLength) {
				throw new Error(copy.effectInvalidAudio);
			}
			if (!rawChannels.every((channel): channel is Float32Array => (
				channel instanceof Float32Array && channel.length === firstChannelLength
			))) {
				throw new Error(copy.effectChannelLengthsMismatch);
			}
			const target = targetValue as EffectTarget;
			const channels = rawChannels;
			const frameCount = channels[0]!.length;
			assertAudacityEffectOutput(channels);
			if (channels.length !== target.channelCount) throw new Error(copy.effectChannelLayoutChanged);
			if (target.hasAudio === false) {
				entries.push({
					target,
					channels,
					frameCount,
					buffer: null,
					sourceId: null,
					sourceName: null,
					replacement: null,
					command: prepareSilentAudacityRippleCommand(target, frameCount),
				});
				continue;
			}
			const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
			assertOperationCurrent();
			const sourceId = createStableId('audacity-effect');
			const sourceName = `${target.track.name} — ${effectName}.wav`;
			const source: EffectResultSource = {
				id: sourceId,
				storageKey: sourceId,
				name: sourceName,
				mimeType: 'audio/wav',
				frameCount,
				channelCount: buffer.numberOfChannels,
				sampleRate,
				originalSampleRate: sampleRate,
			};
			const replacement = target.clipId ? null : prepareRangeReplacementCommand(getProject(), {
				trackId: target.track.id,
				startFrame: target.startFrame,
				endFrame: target.endFrame,
				source,
			});
			entries.push({
				target,
				channels,
				frameCount,
				buffer,
				source,
				sourceId,
				sourceName,
				replacement,
				command: replacement,
			});
		}
		const firstEntry = entries[0]!;
		const exactClipEntries = getExactClipEntries(entries);
		const exactClipReplacement = exactClipEntries !== null;
		if (!exactClipReplacement && (entries.some((entry) => entry.target.startFrame !== firstEntry.target.startFrame)
			|| (!options.allowIndependentLengths && entries.some((entry) => entry.frameCount !== firstEntry.frameCount)))) {
			throw new Error(copy.effectTrackLengthsMismatch || 'Selected tracks produced different effect lengths and cannot be rippled together.');
		}
		const selectionFrameCount = options.allowIndependentLengths
			? Math.max(...entries.map((entry) => entry.frameCount))
			: firstEntry.frameCount;

		const persistedEntries: PersistedEffectResultEntry[] = [];
		try {
			for (const entry of entries) {
				assertOperationCurrent();
				if (!isPersistedEntry(entry)) continue;
				const writer = await store.beginSourceWrite(entry.sourceId, {
					name: entry.sourceName,
					mimeType: 'audio/wav',
					sampleRate,
					channelCount: entry.buffer.numberOfChannels,
					chunkFrames: SOURCE_CHUNK_FRAMES,
				});
				try {
					assertOperationCurrent();
					await writeBuffer(writer, entry.buffer, signal);
					assertOperationCurrent();
					await writer.commit({ sampleRate, channelCount: entry.buffer.numberOfChannels });
					persistedEntries.push(entry);
					assertOperationCurrent();
				} catch (error) {
					await writer.abort();
					throw error;
				}
			}
			for (const entry of entries) {
				assertOperationCurrent();
				if (!isPersistedEntry(entry)) continue;
				cacheSourceBuffer(entry.sourceId, entry.buffer);
				const peaks = await generateWaveformPeaks(entry.channels, copy);
				assertOperationCurrent();
				sourcePeaks.set(entry.sourceId, peaks);
				await store.saveAnalysis(peakCacheKey(entry.sourceId), peaks);
				assertOperationCurrent();
			}
			assertOperationCurrent();
			const replacementCommands: AudioEditorCommand[] = exactClipEntries
				? [{
					type: 'clip/render-replace-many',
					entries: exactClipEntries.map((entry) => ({
						clipId: entry.target.clipId,
						source: isPersistedEntry(entry)
							? entry.replacement?.source || entry.source
							: effectCommandSource(entry, sampleRate),
					})),
				}]
				: entries.map((entry) => entry.command).filter(isCommand);
			const selectionCommand: SelectionCommand = exactClipEntries
				? {
					type: 'selection/set',
					startFrame: 0,
					endFrame: 0,
					trackIds: [...new Set(exactClipEntries.map((entry) => entry.target.track.id))],
					clipIds: exactClipEntries.map((entry) => entry.target.clipId),
					frequencyRange: null,
				}
				: {
					type: 'selection/set',
					startFrame: firstEntry.target.startFrame,
					endFrame: firstEntry.target.startFrame + selectionFrameCount,
					...(options.selectionDetails || {}),
				};
			commit({
				type: 'batch',
				commands: [
					...replacementCommands,
					selectionCommand,
				],
			}, {
				selectTrackId: entries.find((entry) => entry.target.track.id === state.selectedTrackId)?.target.track.id
					|| firstEntry.target.track.id,
				...(entries.length === 1 && firstEntry.replacement
					? { selectClipId: firstEntry.replacement.clipId }
					: {}),
			});
			return entries.map((entry) => entry.replacement);
		} catch (error) {
			for (const entry of entries) {
				if (!entry.sourceId) continue;
				sourceBuffers.delete(entry.sourceId);
				sourcePeaks.delete(entry.sourceId);
				await store.deleteAnalysis?.(peakCacheKey(entry.sourceId)).catch(() => undefined);
			}
			for (const entry of persistedEntries) await store.deleteSource(entry.sourceId).catch(() => undefined);
			throw error;
		}
	}

	function prepareSilentAudacityRippleCommand(
		target: EffectTarget,
		outputFrameCount: number,
	): AudioEditorCommand | null {
		const timelineDelta = outputFrameCount - target.durationFrames;
		if (!timelineDelta) return null;
		if (timelineDelta < 0) {
			return prepareRangeDeleteCommand(getProject(), {
				trackIds: [target.track.id],
				startFrame: target.startFrame + outputFrameCount,
				endFrame: target.endFrame,
				rippleMode: 'track',
			});
		}
		const trackId = target.track.id;
		return preparePasteCommand({
			schemaVersion: 1,
			sampleRate: projectSampleRate(),
			durationFrames: timelineDelta,
			tracks: [{
				sourceTrackId: trackId,
				sourceTrackName: target.track.name,
				clips: [],
			}],
		}, {
			project: getProject(),
			atFrame: target.endFrame,
			trackMap: { [trackId]: trackId },
			mode: 'insert-track',
		});
	}

	return Object.freeze({ persistAudacityEffectResults, prepareSilentAudacityRippleCommand });
}

function isPersistedEntry(entry: EffectResultEntry): entry is PersistedEffectResultEntry {
	return entry.buffer !== null;
}

function isCommand(command: AudioEditorCommand | null): command is AudioEditorCommand {
	return Boolean(command);
}

function getExactClipEntries(entries: EffectResultEntry[]): ExactClipEffectResultEntry[] | null {
	return entries.every(isExactClipEntry) ? entries : null;
}

function isExactClipEntry(entry: EffectResultEntry): entry is ExactClipEffectResultEntry {
	return Boolean(entry.target.clipId);
}

function effectCommandSource(entry: EffectResultEntry, sampleRate: number): CommandObject {
	return {
		id: entry.sourceId,
		storageKey: entry.sourceId,
		name: entry.sourceName,
		mimeType: 'audio/wav',
		frameCount: entry.frameCount,
		channelCount: entry.channels.length,
		sampleRate,
		originalSampleRate: sampleRate,
	};
}
