/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioBufferLike } from '../../source/source-audio.ts';
import type { EffectSelectionProject, EffectTarget } from '../effect-selection-service.ts';
import type { SourceEditorAudioWindow, SourceEditorAudioWindowRequest } from './source-editor-audio-window.ts';

const SOURCE_TRACK_PREFIX = 'source-editor:';

export interface SourceEditorSelection {
	readonly clipId: string;
	readonly startFrame: number;
	readonly endFrame: number;
}
export interface SourceEditorAudioSource {
	readonly id: string;
	readonly storageKey?: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}
interface Dependencies<Buffer extends AudioBufferLike> {
	readonly getProject: () => EffectSelectionProject;
	readonly loadSourceBuffer: (source: SourceEditorAudioSource) => Promise<Buffer | null>;
	readonly loadSourceWindow?: (source: SourceEditorAudioSource, request: SourceEditorAudioWindowRequest) => Promise<SourceEditorAudioWindow | null>;
	readonly publishDocumentSnapshot: () => void;
}
interface SelectedSource extends SourceEditorSelection {
	readonly projectId: string;
	readonly sourceId: string;
	readonly sourceFrameCount: number;
}

/** Source coordinates are kept separate from the project's timeline selection. */
export function createSourceEditorEffects<Buffer extends AudioBufferLike>(dependencies: Dependencies<Buffer>) {
	let selection: SelectedSource | null = null;
	function setSourceSelection(request: SourceEditorSelection | null): void {
		if (request === null) selection = null;
		else {
			const project = dependencies.getProject();
			const clip = project.clips.find((item) => item.id === request.clipId);
			const source = clip ? findSource(project, clip.sourceId) : null;
			if (!clip || clip.kind !== 'audio' || !source) throw new RangeError('Select an audio clip to edit its source.');
			if (!Number.isFinite(request.startFrame) || !Number.isFinite(request.endFrame)) throw new RangeError('Source selection requires finite frames.');
			const startFrame = Math.max(0, Math.min(source.frameCount - 1, Math.round(Math.min(request.startFrame, request.endFrame))));
			const endFrame = Math.max(startFrame + 1, Math.min(source.frameCount, Math.round(Math.max(request.startFrame, request.endFrame))));
			selection = { projectId: project.id, clipId: clip.id, sourceId: source.id, sourceFrameCount: source.frameCount, startFrame, endFrame };
		}
		dependencies.publishDocumentSnapshot();
	}
	function target(): EffectTarget | null {
		if (!selection) return null;
		const project = dependencies.getProject();
		if (project.id !== selection.projectId) return null;
		const clip = project.clips.find((item) => item.id === selection?.clipId);
		if (!clip) return null;
		const source = findSource(project, clip.sourceId);
		const track = project.tracks.find((item) => item.type === 'audio' && item.clipIds?.includes(clip.id));
		if (!source || !track) return null;
		if (source.id !== selection.sourceId) {
			const startFrame = Math.min(selection.startFrame, source.frameCount - 1);
			const endFrame = Math.max(startFrame + 1, Math.min(source.frameCount,
				selection.endFrame + source.frameCount - selection.sourceFrameCount));
			selection = { ...selection, sourceId: source.id, sourceFrameCount: source.frameCount, startFrame, endFrame };
		}
		return {
			track: { ...track, id: `${SOURCE_TRACK_PREFIX}${source.id}` },
			sourceId: source.id, sourceTrackId: track.id, sourceClipId: clip.id, sourceFrameCount: source.frameCount,
			sourceSampleRate: source.sampleRate,
			startFrame: selection.startFrame, endFrame: selection.endFrame,
			durationFrames: selection.endFrame - selection.startFrame,
			channelCount: source.channelCount, hasAudio: true,
		};
	}
	async function readSource(sourceId: string): Promise<Buffer> {
		const source = findSource(dependencies.getProject(), sourceId);
		if (!source) throw new RangeError('The selected source is no longer available.');
		const buffer = await dependencies.loadSourceBuffer(source);
		if (!buffer || buffer.length !== source.frameCount || buffer.numberOfChannels !== source.channelCount || buffer.sampleRate !== source.sampleRate) {
			throw new RangeError('The selected source audio is unavailable or incomplete.');
		}
		return buffer;
	}
	async function loadSourceAudio(clipId: string): Promise<Buffer> {
		const clip = dependencies.getProject().clips.find((item) => item.id === clipId);
		if (!clip || clip.kind !== 'audio') throw new RangeError('Select an audio clip to load its source.');
		return readSource(clip.sourceId);
	}
	async function loadSourceAudioWindow(clipId: string, request: SourceEditorAudioWindowRequest): Promise<SourceEditorAudioWindow | null> {
		const project = dependencies.getProject();
		const clip = project.clips.find(item => item.id === clipId);
		const source = clip?.kind === 'audio' ? findSource(project, clip.sourceId) : null;
		if (!source) throw new RangeError('Select an audio clip to load its source.');
		const result = await dependencies.loadSourceWindow?.(source, request) ?? null;
		const current = dependencies.getProject();
		return !request.signal?.aborted && current.id === project.id && current.clips.some(item => item.id === clipId && item.sourceId === source.id) ? result : null;
	}
	async function renderRange(trackId: string, startFrame: number, endFrame: number): Promise<Float32Array[] | null> {
		if (!trackId.startsWith(SOURCE_TRACK_PREFIX)) return null;
		const buffer = await readSource(trackId.slice(SOURCE_TRACK_PREFIX.length));
		return Array.from({ length: buffer.numberOfChannels }, (_, index) => {
			const output = new Float32Array(endFrame - startFrame);
			const from = Math.max(0, startFrame);
			const to = Math.min(buffer.length, endFrame);
			if (to > from) output.set(buffer.getChannelData(index).subarray(from, to), from - startFrame);
			return output;
		});
	}
	async function expandResult(resultTarget: EffectTarget, channels: Float32Array[]): Promise<Float32Array[]> {
		if (!resultTarget.sourceId) return channels;
		const buffer = await readSource(resultTarget.sourceId);
		const { startFrame, endFrame } = resultTarget;
		return channels.map((channel, index) => {
			const original = buffer.getChannelData(index);
			const merged = new Float32Array(startFrame + channel.length + buffer.length - endFrame);
			merged.set(original.subarray(0, startFrame));
			merged.set(channel, startFrame);
			merged.set(original.subarray(endFrame), startFrame + channel.length);
			return merged;
		});
	}
	function readSourceSelectionDuration(): number | null {
		const current = target();
		return current?.sourceSampleRate ? current.durationFrames / current.sourceSampleRate : null;
	}
	return Object.freeze({ setSourceSelection, target, readSourceSelectionDuration, loadSourceAudio, loadSourceAudioWindow, renderRange, expandResult });
}

function findSource(project: EffectSelectionProject, sourceId: string): SourceEditorAudioSource | null {
	const source = project.sources?.find((candidate) => candidate.id === sourceId);
	if (!source || (source.kind !== undefined && source.kind !== 'audio')
		|| typeof source.frameCount !== 'number' || !Number.isSafeInteger(source.frameCount) || source.frameCount < 1
		|| typeof source.channelCount !== 'number' || !Number.isSafeInteger(source.channelCount) || source.channelCount < 1) return null;
	return { id: sourceId, frameCount: source.frameCount, channelCount: source.channelCount,
		sampleRate: typeof source.sampleRate === 'number' ? source.sampleRate : project.sampleRate,
		...(typeof source.storageKey === 'string' ? { storageKey: source.storageKey } : {}) };
}
