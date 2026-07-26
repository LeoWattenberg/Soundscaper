/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddLabelCommand, createAddLabelTrackCommand } from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import { nyquistChannelStats } from './nyquist-audio.ts';
import type { EditorProjectToken } from './lifecycle.ts';
import type {
	EffectSelection,
	EffectSelectionProject,
	EffectTarget,
} from './effect-selection-service.ts';

export interface NyquistHostProject extends EffectSelectionProject {
	readonly tempo?: number | Readonly<{ readonly bpm?: number }>;
}

export interface NyquistPreviewSource {
	buffer: unknown;
	onended: (() => void) | null;
	onerror: (() => void) | null;
	connect(destination: unknown): void;
	start(): void;
	stop(): void;
	disconnect?(): void;
}

interface NyquistAudioContext {
	readonly destination: unknown;
	resume?(): Promise<unknown> | unknown;
	createBufferSource(): NyquistPreviewSource;
}

export interface NyquistHostState {
	selectedTrackId: string | null;
	nyquistAbort: AbortController | null;
	audacityEffectProcessing: boolean;
	audacityPreviewSource: NyquistPreviewSource | null;
}

interface NyquistHostCopy {
	readonly audacityPreviewCancelled?: string;
	readonly audacityPreviewComplete?: string;
	readonly audacityPreviewPlaying?: string;
	readonly labels: string;
	readonly playing: string;
	readonly ready: string;
}

export interface NyquistHostRequest extends Readonly<Record<string, unknown>> {
	readonly name?: unknown;
}

export interface NyquistLabel {
	readonly start?: unknown;
	readonly end?: unknown;
	readonly text?: unknown;
	readonly baseFrame: number;
}

export interface NyquistHostProperties {
	readonly AUDACITY: Readonly<{ VERSION: readonly [3, 7, 7]; LANGUAGE: string }>;
	readonly PROJECT: Readonly<{
		NAME: string;
		RATE: number;
		TEMPO: number;
		TRACKS: number;
		WAVETRACKS: number;
		LABELTRACKS: number;
		PREVIEW_DURATION: 6;
	}>;
	readonly SELECTION: Readonly<Record<string, unknown> & {
		START: number;
		END: number;
		TRACKS: readonly number[];
		PEAK: number | number[];
		RMS: number | number[];
	}>;
	readonly TRACK: Readonly<{
		INDEX: number;
		NAME: string;
		CLIPS: readonly unknown[];
		INCLIPS: readonly unknown[];
	}>;
}

export interface NyquistHostServiceRuntime {
	readonly state: NyquistHostState;
	readonly copy: NyquistHostCopy;
	readonly locale: string;
	readonly getProject: () => NyquistHostProject;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly activeSelection: () => EffectSelection | null;
	readonly projectSampleRate: () => number;
	readonly getPositionFrames: () => number;
	readonly getAudioContext: () => Promise<NyquistAudioContext>;
	readonly pauseTransport: () => void;
	readonly assertAudioOutput: (channels: readonly Float32Array[]) => void;
	readonly bufferFromChannels: (
		channels: readonly Float32Array[],
		sampleRate: number,
		context: NyquistAudioContext,
	) => Promise<unknown>;
	readonly cancelAudacityEffectPreview: (options: Readonly<{ publish: false }>) => boolean;
	readonly createId: (prefix: string) => string;
	readonly commit: (
		command: AudioEditorCommand,
		options: Readonly<{ selectTrackId: string }>,
	) => void;
	readonly setStatus: (message: string, status?: string) => void;
	readonly publishDocumentSnapshot: () => void;
}

export function createNyquistHostService(runtime: NyquistHostServiceRuntime) {
	function cancelNyquistEvaluation(): boolean {
		const running = runtime.state.nyquistAbort;
		running?.abort();
		const preview = runtime.cancelAudacityEffectPreview({ publish: false });
		if (!running) runtime.state.audacityEffectProcessing = false;
		runtime.setStatus(runtime.copy.audacityPreviewCancelled || runtime.copy.ready);
		runtime.publishDocumentSnapshot();
		return Boolean(running || preview);
	}

	function nyquistHostProperties(
		target: EffectTarget | null,
		targets: readonly (EffectTarget | null)[],
		index: number,
		channels: readonly Float32Array[],
		request: NyquistHostRequest,
	): NyquistHostProperties {
		const project = runtime.getProject();
		const sampleRate = runtime.projectSampleRate();
		const selection = runtime.activeSelection();
		const frequencyRange = selection?.frequencyRange;
		const startFrame = target?.startFrame ?? selection?.startFrame ?? runtime.getPositionFrames();
		const endFrame = target?.endFrame ?? selection?.endFrame ?? startFrame;
		const track = target?.track ?? null;
		const clips = track?.clipIds
			.map((clipId) => project.clips.find((clip) => clip.id === clipId) ?? null)
			.filter(isPresent)
			.map((clip) => [
				clip.timelineStartFrame / sampleRate,
				(clip.timelineStartFrame + clip.durationFrames) / sampleRate,
			] as const) ?? [];
		const stats = nyquistChannelStats([...channels]);
		const lowHz = Number(frequencyRange?.minimumFrequency);
		const highHz = Number(frequencyRange?.maximumFrequency);
		const selectedTrackIndices = targets.map((candidate) => {
			const projectIndex = project.tracks.findIndex((projectTrack) => projectTrack.id === candidate?.track.id);
			return projectIndex >= 0 ? projectIndex + 1 : null;
		}).filter(isInteger);
		const selectionProperties: Record<string, unknown> & {
			START: number;
			END: number;
			TRACKS: readonly number[];
			PEAK: number | number[];
			RMS: number | number[];
		} = {
			START: startFrame / sampleRate,
			END: endFrame / sampleRate,
			TRACKS: selectedTrackIndices,
			PEAK: stats.peak,
			RMS: stats.rms,
		};
		if (Number.isFinite(lowHz)) selectionProperties.LOW_HZ = lowHz;
		if (Number.isFinite(highHz)) selectionProperties.HIGH_HZ = highHz;
		if (Number.isFinite(lowHz) && lowHz > 0 && Number.isFinite(highHz) && highHz > lowHz) {
			selectionProperties.CENTER_HZ = Math.sqrt(lowHz * highHz);
			selectionProperties.BANDWIDTH = Math.log2(highHz / lowHz);
		}
		const trackClips: readonly unknown[] = channels.length > 1 ? channels.map(() => clips) : clips;
		return {
			AUDACITY: { VERSION: [3, 7, 7], LANGUAGE: runtime.locale },
			PROJECT: {
				NAME: project.title || '',
				RATE: sampleRate,
				TEMPO: projectTempo(project),
				TRACKS: project.tracks.length,
				WAVETRACKS: project.tracks.filter((candidate) => candidate.type === 'audio').length,
				LABELTRACKS: project.tracks.filter((candidate) => candidate.type === 'label').length,
				PREVIEW_DURATION: 6,
			},
			SELECTION: selectionProperties,
			TRACK: {
				INDEX: index + 1,
				NAME: track?.name || String(request.name || ''),
				CLIPS: trackClips,
				INCLIPS: trackClips,
			},
		};
	}

	async function playNyquistPreview(
		channels: readonly Float32Array[],
		sampleRate: number,
		signal: AbortSignal | null = null,
	): Promise<void> {
		const projectToken = runtime.captureProject();
		throwIfAborted(signal);
		runtime.assertAudioOutput(channels);
		const context = await runtime.getAudioContext();
		assertCurrent(runtime, projectToken, signal);
		await context.resume?.();
		assertCurrent(runtime, projectToken, signal);
		const buffer = await runtime.bufferFromChannels(channels, sampleRate, context);
		assertCurrent(runtime, projectToken, signal);
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(context.destination);
		source.onended = () => {
			if (runtime.state.audacityPreviewSource !== source) return;
			runtime.state.audacityPreviewSource = null;
			source.disconnect?.();
			if (!projectIsCurrent(runtime, projectToken)) return;
			runtime.setStatus(runtime.copy.audacityPreviewComplete || runtime.copy.ready, 'success');
			runtime.publishDocumentSnapshot();
		};
		runtime.pauseTransport();
		runtime.state.audacityPreviewSource = source;
		source.start();
		runtime.setStatus(runtime.copy.audacityPreviewPlaying || runtime.copy.playing, 'success');
	}

	function persistNyquistLabels(labels: readonly NyquistLabel[], name: unknown = null): string | null {
		if (!labels.length) return null;
		const project = runtime.getProject();
		const sampleRate = runtime.projectSampleRate();
		let target = project.tracks.find((track) => track.id === runtime.state.selectedTrackId) ?? null;
		if (target?.type !== 'label') target = project.tracks.find((track) => track.type === 'label') ?? null;
		const commands: AudioEditorCommand[] = [];
		let targetId = target?.id ?? null;
		if (!targetId) {
			targetId = runtime.createId('label-track');
			commands.push(createAddLabelTrackCommand({ id: targetId, name: String(name || runtime.copy.labels) }));
		}
		for (const label of labels) {
			const startFrame = Math.max(0, label.baseFrame + Math.round(Number(label.start || 0) * sampleRate));
			const endFrame = Math.max(
				startFrame,
				label.baseFrame + Math.round(Number(label.end ?? label.start ?? 0) * sampleRate),
			);
			commands.push(createAddLabelCommand(targetId, {
				startFrame,
				endFrame,
				title: String(label.text || ''),
			}));
		}
		runtime.commit({ type: 'batch', commands }, { selectTrackId: targetId });
		return targetId;
	}

	return Object.freeze({
		cancelNyquistEvaluation,
		nyquistHostProperties,
		persistNyquistLabels,
		playNyquistPreview,
	});
}

function assertCurrent(runtime: NyquistHostServiceRuntime, projectToken: EditorProjectToken, signal: AbortSignal | null): void {
	throwIfAborted(signal);
	runtime.assertProject(projectToken);
}

function projectIsCurrent(runtime: NyquistHostServiceRuntime, token: EditorProjectToken): boolean {
	try { runtime.assertProject(token); return true; } catch { return false; }
}

function throwIfAborted(signal: AbortSignal | null): void {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new DOMException('The operation was cancelled.', 'AbortError');
}

function projectTempo(project: NyquistHostProject): number {
	const tempo = typeof project.tempo === 'object' ? project.tempo?.bpm : project.tempo;
	return Number(tempo) || 120;
}

function isPresent<Value>(value: Value | null): value is Value {
	return value !== null;
}

function isInteger(value: number | null): value is number {
	return Number.isInteger(value);
}
