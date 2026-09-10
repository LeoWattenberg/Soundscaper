/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasCoreEditingProjectAuthority } from '../project-schema-version.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { AudioTrackLeaf } from '../project-media-types.ts';
import type {
	PersistedSampleEdit,
	SampleEditClip,
	SampleEditSource,
	SampleEditStore,
	SamplePencilEdit,
	SamplePencilPoint,
	SmoothSampleRange,
} from '../sample-edit-types.ts';
import type { ClipTransformSelection } from './clip-domain-types.ts';
import {
	EDITOR_PROJECT_TASK_SCOPE,
	type EditorControllerLifetime,
} from './lifecycle.ts';
import type { ControllerRuntimeProject } from './project-runtime.ts';
import type { ControllerWorkspaceState } from './workspace-state-types.ts';

/** The registry name a sample edit holds while it writes its immutable source. */
export const SAMPLE_EDIT_TASK = 'sample-edit';

export type {
	CreatePencilSampleEditsRequest,
	CreateSmoothSampleRangeRequest,
	PersistedSampleEdit,
	PersistImmutableSampleEditRequest,
	SampleEditClip,
	SampleEditSource,
	SampleEditSourceWriter,
	SampleEditStore,
	SampleEditStoredChunk,
	SamplePencilEdit,
	SamplePencilPoint,
	SmoothSampleRange,
} from '../sample-edit-types.ts';

export type SampleEditTrack = Pick<AudioTrackLeaf, 'id' | 'displayMode'>;

export type SampleEditServiceState = Pick<ControllerWorkspaceState<unknown, unknown>,
	| 'pixelsPerSecond' | 'sampleEditAbort' | 'sampleEditAvailable' | 'sampleEditMode'
	| 'sampleEditProcessing' | 'selectedClipId' | 'timelineView'
>;

export interface SampleEditServiceCopy {
	readonly audioClipNotFound: string;
	readonly sampleEditCancelled: string;
	readonly sampleEditDone: string;
	readonly sampleEditSaving: string;
	readonly sampleEditZoomRequired: string;
	readonly timeSelectionRequired: string;
}

export interface ApplySamplePencilOptions {
	readonly clipId?: string | null;
	readonly channel?: number;
	readonly points?: readonly SamplePencilPoint[];
}

export interface SmoothSelectedSamplesOptions {
	readonly clipId?: string | null;
	readonly channel?: number | null;
	readonly radius?: number;
}

export interface SampleEditCommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

interface ImmutableSampleEditRequest {
	readonly clip: SampleEditClip;
	readonly source: SampleEditSource;
	readonly edits?: readonly SamplePencilEdit[] | null;
	readonly smooth?: SmoothSampleRange | null;
	readonly radius?: number;
}

interface PersistSampleEditRequest {
	readonly store: SampleEditStore;
	readonly source: SampleEditSource;
	readonly edits: readonly SamplePencilEdit[] | null;
	readonly smooth: SmoothSampleRange | null;
	readonly sourceId: string;
	readonly radius: number;
	readonly signal: AbortSignal;
}

/** Closed, typed ports for the immutable sample-edit workflow. */
export interface SampleEditServiceRuntime<Project extends ControllerRuntimeProject = ControllerRuntimeProject> {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	readonly activeSelection: () => ClipTransformSelection | null;
	readonly activateStoredSource: (
		source: SampleEditSource,
		metadata: Readonly<Record<string, unknown>>,
	) => PromiseLike<unknown> | unknown;
	readonly canEditAudioSamplesAtZoom: (pixelsPerSecond: number, sampleRate: number) => boolean;
	readonly commit: (command: AudioEditorCommand, selection?: SampleEditCommitSelection) => unknown;
	readonly copy: SampleEditServiceCopy;
	readonly createAddSourceCommand: (source: SampleEditSource) => AudioEditorCommand;
	readonly createPencilSampleEdits: (request: Readonly<{
		readonly clip: SampleEditClip;
		readonly source: SampleEditSource;
		readonly channel: number;
		readonly points: readonly SamplePencilPoint[] | undefined;
	}>) => readonly SamplePencilEdit[];
	readonly createReplaceClipSourceCommand: (clipId: string, sourceId: string) => AudioEditorCommand;
	readonly createSmoothSampleRange: (request: Readonly<{
		readonly clip: SampleEditClip;
		readonly source: SampleEditSource;
		readonly startFrame: number;
		readonly endFrame: number;
		readonly channel: number | null;
	}>) => SmoothSampleRange;
	readonly createStableId: (prefix: string) => string;
	readonly editingBlocked: () => boolean;
	readonly findClip: (project: Project | null, clipId: string) => SampleEditClip | null | undefined;
	readonly findClipTrack: (project: Project | null, clipId: string) => SampleEditTrack | null | undefined;
	readonly findSource: (project: Project | null, sourceId: string) => SampleEditSource | null | undefined;
	readonly getProject: () => Project | null;
	readonly peakCacheKey: (sourceId: string) => string;
	readonly persistImmutableSampleEdit: (
		request: PersistSampleEditRequest,
	) => PromiseLike<PersistedSampleEdit> | PersistedSampleEdit;
	readonly preflightStorage: (requiredBytes: number, purpose: 'effect') => PromiseLike<unknown> | unknown;
	readonly projectSampleRate: () => number;
	readonly retireSourceChunkProvider: (sourceId: string) => PromiseLike<unknown> | unknown;
	readonly publishDocumentSnapshot: () => void;
	readonly setStatus: (message: string, state?: 'info' | 'success' | 'error') => void;
	readonly sourceBuffers: Pick<Map<string, unknown>, 'delete'>;
	readonly sourcePeaks: Pick<Map<string, unknown>, 'delete'>;
	readonly state: SampleEditServiceState;
	readonly store: SampleEditStore;
	readonly throwIfAborted: (signal: AbortSignal | null | undefined) => void;
}

export function createSampleEditService<Project extends ControllerRuntimeProject>(
	runtime: SampleEditServiceRuntime<Project>,
) {
	const {
		activeSelection, activateStoredSource, canEditAudioSamplesAtZoom, commit, copy,
		createAddSourceCommand, createPencilSampleEdits, createReplaceClipSourceCommand,
		createSmoothSampleRange, createStableId, editingBlocked, findClip, findClipTrack,
		findSource, getProject, peakCacheKey, persistImmutableSampleEdit, preflightStorage,
		projectSampleRate, publishDocumentSnapshot, retireSourceChunkProvider, setStatus,
		sourceBuffers, sourcePeaks, state, store, throwIfAborted,
	} = runtime;

	function sampleEditingAvailable(clipId: string | null = state.selectedClipId) {
		const project = getProject();
		if (!project || !hasCoreEditingProjectAuthority(project) || !clipId) return false;
		const clip = findClip(project, clipId);
		const source = clip ? findSource(project, clip.sourceId) : null;
		const track = clip ? findClipTrack(project, clip.id) : null;
		const displayMode = track?.displayMode && track.displayMode !== 'waveform'
			? track.displayMode
			: state.timelineView;
		if (!clip || !source || displayMode !== 'waveform' || !clip.durationFrames || !clip.sourceDurationFrames) return false;
		const visibleSourceSamplesPerSecond = projectSampleRate() * clip.sourceDurationFrames / clip.durationFrames;
		return canEditAudioSamplesAtZoom(state.pixelsPerSecond, visibleSourceSamplesPerSecond);
	}

	function synchronizeAutomaticSampleEditMode() {
		const available = sampleEditingAvailable();
		if (!available) state.sampleEditMode = null;
		else if (!state.sampleEditAvailable) state.sampleEditMode = 'pencil';
		state.sampleEditAvailable = available;
	}

	function setSampleEditMode(mode: 'pencil' | null = null) {
		if (mode != null && mode !== 'pencil') throw new RangeError('Unsupported sample-edit mode.');
		if (mode && !sampleEditingAvailable()) throw new Error(copy.sampleEditZoomRequired);
		state.sampleEditMode = mode;
		publishDocumentSnapshot();
		return state.sampleEditMode;
	}

	function cancelSampleEdit() {
		state.sampleEditAbort?.abort();
		return Boolean(state.sampleEditAbort);
	}

	function applySamplePencil(options: ApplySamplePencilOptions = {}) {
		const project = getProject();
		const clipId = options.clipId || state.selectedClipId;
		const clip = clipId ? findClip(project, clipId) : null;
		const source = clip ? findSource(project, clip.sourceId) : null;
		if (!clip || !source) throw new Error(copy.audioClipNotFound);
		const edits = createPencilSampleEdits({
			clip,
			source,
			channel: options.channel ?? 0,
			points: options.points,
		});
		return applyImmutableSampleEdit({ clip, source, edits });
	}

	function smoothSelectedSamples(options: SmoothSelectedSamplesOptions = {}) {
		const project = getProject();
		const clipId = options.clipId || state.selectedClipId;
		const clip = clipId ? findClip(project, clipId) : null;
		const source = clip ? findSource(project, clip.sourceId) : null;
		const selection = activeSelection();
		if (!clip || !source) throw new Error(copy.audioClipNotFound);
		if (!selection) throw new Error(copy.timeSelectionRequired);
		const smooth = createSmoothSampleRange({
			clip,
			source,
			startFrame: selection.startFrame,
			endFrame: selection.endFrame,
			channel: options.channel ?? null,
		});
		return applyImmutableSampleEdit({ clip, source, smooth, radius: options.radius });
	}

	async function applyImmutableSampleEdit({
		clip, source, edits = null, smooth = null, radius = 2,
	}: ImmutableSampleEditRequest): Promise<PersistedSampleEdit | null> {
		if (editingBlocked()) return null;
		if (!sampleEditingAvailable(clip.id)) throw new Error(copy.sampleEditZoomRequired);
		const projectAtStart = getProject();
		const sourceId = createStableId('sample-edit');
		// startTask replaces any sample edit still in flight and enrols this one
		// in the project scope, so a project switch cancels it without the switch
		// having to know that sample editing exists.
		const abort = runtime.lifetime.startTask(SAMPLE_EDIT_TASK, { scope: EDITOR_PROJECT_TASK_SCOPE });
		state.sampleEditAbort = abort;
		state.sampleEditProcessing = true;
		publishDocumentSnapshot();
		setStatus(copy.sampleEditSaving);
		let persisted: PersistedSampleEdit | null = null;
		let published = false;
		try {
			await preflightStorage(sampleEditStorageBytes(source, edits, smooth), 'effect');
			persisted = await persistImmutableSampleEdit({
				store,
				source,
				edits,
				smooth,
				sourceId,
				radius,
				signal: abort.signal,
			});
			throwIfAborted(abort.signal);
			const project = getProject();
			const liveClip = project === projectAtStart ? findClip(project, clip.id) : null;
			if (!liveClip || liveClip.sourceId !== source.id) throw new Error('The clip changed while its sample edit was being prepared.');
			await activateStoredSource(persisted.source, persisted.metadata);
			throwIfAborted(abort.signal);
			commit({
				type: 'batch',
				commands: [
					createAddSourceCommand(persisted.source),
					createReplaceClipSourceCommand(clip.id, sourceId),
				],
			}, { selectTrackId: findClipTrack(project, clip.id)?.id, selectClipId: clip.id });
			published = true;
			setStatus(copy.sampleEditDone, 'success');
			return persisted;
		} catch (error) {
			if (!published) {
				try {
					await discardUnpublishedSampleEdit(sourceId, persisted);
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						'Sample editing and cleanup both failed.',
						{ cause: error },
					);
				}
			}
			if ((error as Readonly<{ name?: string }> | null)?.name === 'AbortError') {
				setStatus(copy.sampleEditCancelled);
				return null;
			}
			throw error;
		} finally {
			abort.finish();
			if (state.sampleEditAbort === abort) state.sampleEditAbort = null;
			state.sampleEditProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function discardUnpublishedSampleEdit(sourceId: string, persisted: PersistedSampleEdit | null): Promise<void> {
		await retireSourceChunkProvider(sourceId);
		sourceBuffers.delete(sourceId);
		sourcePeaks.delete(sourceId);
		await Promise.resolve(store.deleteAnalysis?.(peakCacheKey(sourceId))).catch(() => undefined);
		await Promise.resolve(persisted?.rollback()).catch(() => undefined);
	}

	function sampleEditStorageBytes(
		source: SampleEditSource,
		edits: readonly SamplePencilEdit[] | null,
		smooth: SmoothSampleRange | null,
	): number {
		const chunkIndices = new Set<number>();
		for (const edit of edits || []) chunkIndices.add(Math.floor(edit.frame / source.chunkFrames));
		if (smooth) {
			const first = Math.floor(smooth.startFrame / source.chunkFrames);
			const last = Math.floor((smooth.endFrame - 1) / source.chunkFrames);
			for (let index = first; index <= last; index += 1) chunkIndices.add(index);
		}
		return Math.max(1, chunkIndices.size) * source.chunkFrames * source.channelCount * Float32Array.BYTES_PER_ELEMENT;
	}

	return Object.freeze({
		applySamplePencil,
		cancelSampleEdit,
		sampleEditStorageBytes,
		sampleEditingAvailable,
		setSampleEditMode,
		smoothSelectedSamples,
		synchronizeAutomaticSampleEditMode,
	});
}
