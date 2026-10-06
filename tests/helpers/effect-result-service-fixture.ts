/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import type { AudioEditorCommand } from '../../src/common/editor/commands/protocol.ts';
import {
	createSelectionEffectResultService,
	type EffectResultCommitOptions,
	type SelectionEffectResultRuntime,
} from '../../src/common/editor/controller/effects/internal/effect-result-service.ts';
import type { AudioBufferLike } from '../../src/common/editor/controller/source/source-audio.ts';

type PasteOptions = Parameters<SelectionEffectResultRuntime['preparePasteCommand']>[1];
type RangeDeleteOptions = Parameters<SelectionEffectResultRuntime['prepareRangeDeleteCommand']>[1];
type RangeReplacementOptions = Parameters<SelectionEffectResultRuntime['prepareRangeReplacementCommand']>[1];

interface HarnessEvents {
	readonly analysesDeleted: string[];
	readonly analysesSaved: string[];
	readonly assertedChannels: number[];
	readonly buffersCached: string[];
	readonly commits: Array<Readonly<{
		command: AudioEditorCommand;
		options: EffectResultCommitOptions;
	}>>;
	readonly contexts: string[];
	readonly eventOrder: string[];
	readonly labels: Array<unknown>;
	readonly pasteOptions: PasteOptions[];
	readonly rangeDeletes: RangeDeleteOptions[];
	readonly rangeReplacements: RangeReplacementOptions[];
	readonly sourcesAborted: string[];
	readonly sourcesDeleted: string[];
	readonly sourcesOpened: string[];
	readonly sourcesWritten: string[];
}

interface HarnessOptions {
	readonly runtime?: Partial<SelectionEffectResultRuntime>;
}

export function createBuffer(channels: readonly Float32Array[], sampleRate = 48_000): AudioBufferLike {
	return {
		length: channels[0]?.length ?? 0,
		numberOfChannels: channels.length,
		sampleRate,
		getChannelData(channel: number) {
			return channels[channel] ?? new Float32Array(0);
		},
	};
}

export function createHarness({ runtime: overrides = {} }: HarnessOptions = {}) {
	const events: HarnessEvents = {
		analysesDeleted: [],
		analysesSaved: [],
		assertedChannels: [],
		buffersCached: [],
		commits: [],
		contexts: [],
		eventOrder: [],
		labels: [],
		pasteOptions: [],
		rangeDeletes: [],
		rangeReplacements: [],
		sourcesAborted: [],
		sourcesDeleted: [],
		sourcesOpened: [],
		sourcesWritten: [],
	};
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const project = { id: 'project-1' };
	let sourceIndex = 0;
	let replacementIndex = 0;
	const defaults: SelectionEffectResultRuntime = {
		SOURCE_CHUNK_FRAMES: 65_536,
		assertAudacityEffectOutput(channels) {
			events.assertedChannels.push(channels.length);
		},
		audioSelectionEffectLabel(type) {
			events.labels.push(type);
			return 'Effect';
		},
		async bufferFromChannels(channels, sampleRate, context) {
			events.contexts.push(String(context));
			return createBuffer(channels, sampleRate);
		},
		cacheSourceBuffer(sourceId, buffer) {
			events.buffersCached.push(sourceId);
			sourceBuffers.set(sourceId, buffer);
		},
		commit(command, options) {
			events.eventOrder.push('editor-commit');
			events.commits.push({ command, options });
		},
		copy: {
			audioAnalysisFailed: 'Analysis failed.',
			audioAnalysisWorkerFailed: 'Analysis worker failed.',
			audioBufferUnsupported: 'Audio buffers are unsupported.',
			audacityProjectTooLong: 'The project is too long.',
			decodedAudioEmpty: 'Decoded audio is empty.',
			decodedChannelLengthsMismatch: 'Decoded channel lengths changed.',
			effectChannelLayoutChanged: 'Channel layout changed.',
			effectChannelLengthsMismatch: 'Channel lengths changed.',
			effectInvalidAudio: 'Invalid audio.',
			effectTrackLengthsMismatch: 'Track lengths changed.',
		},
		createStableId(prefix) {
			sourceIndex += 1;
			return `${prefix}-${sourceIndex}`;
		},
		engine: {
			async getAudioContext() {
				return {};
			},
		},
		async generateWaveformPeaks(channels) {
			return { channelCount: channels.length };
		},
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		preparePasteCommand(clipboard, options) {
			events.pasteOptions.push(options);
			return {
				type: 'clipboard/paste',
				clipboard,
				atFrame: options.atFrame,
				trackMap: options.trackMap,
				mode: options.mode,
			};
		},
		prepareRangeDeleteCommand(_project, options) {
			events.rangeDeletes.push(options);
			return {
				type: 'range/ripple-delete',
				trackIds: options.trackIds,
				startFrame: options.startFrame,
				endFrame: options.endFrame,
			};
		},
		prepareRangeReplacementCommand(_project, options) {
			events.rangeReplacements.push(options);
			replacementIndex += 1;
			return {
				type: 'range/replace',
				...options,
				clipId: `replacement-clip-${replacementIndex}`,
			};
		},
		getProject: () => project,
		projectSampleRate: () => 48_000,
		sourceBuffers,
		sourcePeaks,
		state: { selectedTrackId: 'track-2' },
		store: {
			async beginSourceWrite(sourceId) {
				events.sourcesOpened.push(sourceId);
				return {
					async write() {
						events.eventOrder.push(`write:${sourceId}`);
						events.sourcesWritten.push(sourceId);
					},
					async commit() {
						events.eventOrder.push(`source-commit:${sourceId}`);
					},
					async abort() {
						events.sourcesAborted.push(sourceId);
					},
				};
			},
			async saveAnalysis(key) {
				events.eventOrder.push(`analysis:${key}`);
				events.analysesSaved.push(key);
			},
			async deleteAnalysis(key) {
				events.analysesDeleted.push(key);
			},
			async deleteSource(sourceId) {
				events.sourcesDeleted.push(sourceId);
			},
		},
		throwIfAborted(signal) {
			if (!signal?.aborted) return;
			throw signal.reason instanceof Error
				? signal.reason
				: new DOMException('The operation was cancelled.', 'AbortError');
		},
		async writeBuffer(writer, buffer) {
			await writer.write(Array.from(
				{ length: buffer.numberOfChannels },
				(_, channel) => buffer.getChannelData(channel),
			));
		},
	};
	const runtime: SelectionEffectResultRuntime = { ...defaults, ...overrides };
	return {
		events,
		project,
		runtime,
		service: createSelectionEffectResultService(runtime),
		sourceBuffers,
		sourcePeaks,
	};
}

export function target(
	id: string,
	options: Readonly<{
		channelCount?: number;
		clipId?: string;
		durationFrames?: number;
		hasAudio?: boolean;
		startFrame?: number;
	}> = {},
) {
	const startFrame = options.startFrame ?? 10;
	const durationFrames = options.durationFrames ?? 4;
	return {
		channelCount: options.channelCount ?? 1,
		durationFrames,
		endFrame: startFrame + durationFrames,
		hasAudio: options.hasAudio ?? true,
		startFrame,
		track: {
			clipIds: options.clipId ? [options.clipId] : [],
			id,
			name: `Track ${id}`,
			type: 'audio' as const,
		},
		...(options.clipId ? { clipId: options.clipId } : {}),
	};
}

export function requireBatch(command: AudioEditorCommand | undefined): Extract<AudioEditorCommand, { readonly type: 'batch' }> {
	assert.equal(command?.type, 'batch');
	if (!command || command.type !== 'batch') throw new Error('Expected a batch command.');
	return command;
}

