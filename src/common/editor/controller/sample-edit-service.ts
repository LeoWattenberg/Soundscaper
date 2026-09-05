/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasCoreEditingProjectAuthority } from '../project-schema-version.ts';
import { EDITOR_PROJECT_TASK_SCOPE, type EditorControllerLifetime } from './lifecycle.ts';

/** The registry name a sample edit holds while it writes its immutable source. */
export const SAMPLE_EDIT_TASK = 'sample-edit';

/**
 * Transitional ports for the sample-edit workflow. Property names are explicit
 * so a misspelled dependency fails during composition instead of becoming an
 * undefined runtime value while the legacy project model is narrowed.
 */
export interface SampleEditServiceRuntime {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly activeSelection: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly activateStoredSource: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly canEditAudioSamplesAtZoom: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly commit: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly copy: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly createAddSourceCommand: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly createPencilSampleEdits: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly createReplaceClipSourceCommand: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly createSmoothSampleRange: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly createStableId: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly editingBlocked: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly findClip: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly findClipTrack: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly findSource: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly getProject: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly peakCacheKey: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly persistImmutableSampleEdit: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly preflightStorage: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly projectSampleRate: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly retireSourceChunkProvider: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly publishDocumentSnapshot: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly setStatus: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly sourceBuffers: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly sourcePeaks: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly state: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly store: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly throwIfAborted: (...args: any[]) => any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;

export function createSampleEditService(runtime: SampleEditServiceRuntime) {
	const {
		activeSelection, activateStoredSource, canEditAudioSamplesAtZoom, commit, copy,
		createAddSourceCommand, createPencilSampleEdits, createReplaceClipSourceCommand,
		createSmoothSampleRange, createStableId, editingBlocked, findClip, findClipTrack,
		findSource, getProject, peakCacheKey, persistImmutableSampleEdit, preflightStorage,
		projectSampleRate, publishDocumentSnapshot, retireSourceChunkProvider, setStatus,
		sourceBuffers, sourcePeaks, state, store, throwIfAborted,
	} = runtime;

	function sampleEditingAvailable(clipId: RuntimeValue = state.selectedClipId) {
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

	function setSampleEditMode(mode: RuntimeValue = null) {
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

	function applySamplePencil(options: RuntimeValue = {}) {
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

	function smoothSelectedSamples(options: RuntimeValue = {}) {
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

	async function applyImmutableSampleEdit({ clip, source, edits = null, smooth = null, radius = 2 }: RuntimeValue) {
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
		let persisted: RuntimeValue = null;
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

	async function discardUnpublishedSampleEdit(sourceId: RuntimeValue, persisted: RuntimeValue) {
		await retireSourceChunkProvider(sourceId);
		sourceBuffers.delete(sourceId);
		sourcePeaks.delete(sourceId);
		await Promise.resolve(store.deleteAnalysis?.(peakCacheKey(sourceId))).catch(() => undefined);
		await persisted?.rollback().catch(() => undefined);
	}

	function sampleEditStorageBytes(source: RuntimeValue, edits: RuntimeValue, smooth: RuntimeValue) {
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
