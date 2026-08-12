/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EffectSelectionFrequencyRange {
	readonly minimumFrequency: number;
	readonly maximumFrequency: number;
}

export interface SpectralBrushSelectionOptions {
	readonly centerFrame: number;
	readonly centerFrequency: number;
	readonly radiusFrames: number;
	readonly radiusFrequency: number;
}

export interface EffectSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
	readonly frequencyRange?: EffectSelectionFrequencyRange | null;
}

export interface EffectSelectionClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: 'audio' | 'video';
	readonly sourceId: string;
	readonly title: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
}

export interface EffectSelectionTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds: readonly string[];
	readonly spectrogram?: Readonly<{
		readonly minimumFrequency?: number;
		readonly maximumFrequency?: number;
		readonly windowSize?: number;
	}>;
}

export interface EffectSelectionProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly schemaVersion: number;
	readonly title: string;
	readonly sampleRate: number;
	readonly tracks: readonly EffectSelectionTrack[];
	readonly clips: readonly EffectSelectionClip[];
	readonly selection?: EffectSelection | null;
	readonly master: Readonly<{ readonly effects: readonly unknown[] }>;
	readonly mixer: Readonly<{
		readonly groups: readonly unknown[];
		readonly sends: readonly unknown[];
		readonly routes: Readonly<Record<string, unknown>>;
	}>;
}

export interface EffectTarget {
	readonly track: EffectSelectionTrack;
	readonly clipId?: string;
	readonly clipIds?: readonly string[];
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
	readonly channelCount: number;
	readonly hasAudio: boolean;
}

export interface EffectSelectionState {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	audacityEffectType: string;
}

interface EditingSelection {
	readonly kind: string;
	readonly clipIds: readonly string[];
}

interface EffectSelectionCopy {
	readonly audioTrackRequired: string;
	readonly maximumFrequency: string;
	readonly maximumFrequencyInvalid?: string;
	readonly minimumFrequency: string;
	readonly minimumFrequencyInvalid?: string;
	readonly parameterRangeError: string;
	readonly spectralEffectLengthChanging: string;
	readonly timeSelectionRequired: string;
	readonly v2Required: string;
}

interface SetSelectionResult {
	readonly selection: EffectSelection;
}

export interface EffectSelectionServiceRuntime {
	readonly state: EffectSelectionState;
	readonly copy: EffectSelectionCopy;
	readonly getProject: () => EffectSelectionProject;
	readonly activeSelection: () => EffectSelection | null;
	readonly resolveEditingSelection: (
		project: EffectSelectionProject,
		options: Readonly<{ selectedClipId: string | null }>,
	) => EditingSelection | null;
	readonly audacitySelectionChannelCount: (
		project: EffectSelectionProject,
		trackId: string,
		startFrame: number,
		endFrame: number,
	) => number;
	readonly audioTrackChannelCount: (
		project: EffectSelectionProject,
		track: EffectSelectionTrack,
		fallback: number,
	) => number;
	readonly selectedTracksTimeRange: () => Readonly<{ startFrame: number; endFrame: number }> | null;
	readonly projectSampleRate: () => number;
	readonly editingBlocked: () => boolean;
	readonly setSelection: (
		startFrame: number,
		endFrame: number,
		details: Readonly<{
			trackIds: readonly string[];
			clipIds: readonly string[];
			frequencyRange: EffectSelectionFrequencyRange;
		}>,
	) => SetSelectionResult;
}

export interface EffectTargetOptions {
	readonly includeSilentTracks?: boolean;
}

export interface EffectDefinitionForSelection {
	readonly lengthChanging?: boolean;
}

export interface SpectralBoxOptions {
	readonly minimumFrequency?: unknown;
	readonly maximumFrequency?: unknown;
}

export function createEffectSelectionService(runtime: EffectSelectionServiceRuntime) {
	function audacityEffectTarget(requestedTrackId: string | null = runtime.state.selectedTrackId): EffectTarget | null {
		const project = runtime.getProject();
		const editingSelection = runtime.resolveEditingSelection(project, {
			selectedClipId: runtime.state.selectedClipId,
		});
		const selectedClip = editingSelection?.kind === 'clips'
			? editingSelection.clipIds
				.map((clipId) => findClip(project, clipId))
				.find((clip) => clip !== null && clip.kind !== 'video'
					&& (!requestedTrackId || findClipTrack(project, clip.id)?.id === requestedTrackId)) ?? null
			: null;
		const selectedClipTrack = selectedClip ? findClipTrack(project, selectedClip.id) : null;
		const track = findTrack(project, requestedTrackId) ?? selectedClipTrack;
		if (!track) return null;
		const selection = runtime.activeSelection();
		const trackClip = selectedClipTrack?.id === track.id ? selectedClip : null;
		const startFrame = selection?.startFrame ?? trackClip?.timelineStartFrame;
		const endFrame = selection?.endFrame
			?? (trackClip ? trackClip.timelineStartFrame + trackClip.durationFrames : null);
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
			|| startFrame == null || endFrame == null || endFrame <= startFrame) return null;
		const channelCount = runtime.audacitySelectionChannelCount(project, track.id, startFrame, endFrame);
		if (!channelCount) return null;
		return {
			track,
			...(trackClip ? { clipId: trackClip.id, clipIds: [trackClip.id] } : {}),
			startFrame,
			endFrame,
			durationFrames: endFrame - startFrame,
			channelCount,
			hasAudio: true,
		};
	}

	function audacityEffectTargets(options: EffectTargetOptions = {}): EffectTarget[] {
		const project = runtime.getProject();
		const editingSelection = runtime.resolveEditingSelection(project, {
			selectedClipId: runtime.state.selectedClipId,
		});
		const selection = runtime.activeSelection();
		if (editingSelection?.kind === 'clips') {
			return editingSelection.clipIds.map((clipId): EffectTarget | null => {
				const clip = findClip(project, clipId);
				const track = clip ? findClipTrack(project, clip.id) : null;
				if (!clip || clip.kind === 'video' || track?.type !== 'audio') return null;
				const startFrame = clip.timelineStartFrame;
				const endFrame = clip.timelineStartFrame + clip.durationFrames;
				const channelCount = runtime.audacitySelectionChannelCount(project, track.id, startFrame, endFrame)
					|| runtime.audioTrackChannelCount(project, track, 1);
				return {
					track,
					clipId: clip.id,
					clipIds: [clip.id],
					startFrame,
					endFrame,
					durationFrames: clip.durationFrames,
					channelCount,
					hasAudio: true,
				};
			}).filter(isEffectTarget);
		}
		if (!selection?.trackIds?.length) {
			const target = audacityEffectTarget();
			return target ? [target] : [];
		}
		const selectedTrackIds = new Set(selection.trackIds);
		return project.tracks.map((track): EffectTarget | null => {
			if (track.type !== 'audio' || !selectedTrackIds.has(track.id)) return null;
			const channelCount = runtime.audacitySelectionChannelCount(
				project, track.id, selection.startFrame, selection.endFrame,
			);
			const hasAudio = Boolean(channelCount);
			if (!hasAudio && !options.includeSilentTracks) return null;
			return {
				track,
				startFrame: selection.startFrame,
				endFrame: selection.endFrame,
				durationFrames: selection.endFrame - selection.startFrame,
				channelCount: channelCount || runtime.audioTrackChannelCount(project, track, 1),
				hasAudio,
			};
		}).filter(isEffectTarget);
	}

	function audacityEffectSelectionDetails(
		selection: EffectSelection | null,
		targets: readonly EffectTarget[],
	): Readonly<{
		trackIds: readonly string[];
		clipIds: readonly string[];
		frequencyRange: EffectSelectionFrequencyRange | null;
	}> {
		return {
			trackIds: selection?.trackIds?.length
				? [...selection.trackIds]
				: targets.map((target) => target.track.id),
			clipIds: targets.flatMap((target) => target.clipId ? [target.clipId] : []),
			frequencyRange: selection?.frequencyRange ?? null,
		};
	}

	function audacitySpectralEffectContext(
		target: EffectTarget,
		definition: EffectDefinitionForSelection,
	): Readonly<EffectSelectionFrequencyRange & { windowSize: number }> | null {
		const frequencyRange = runtime.activeSelection()?.frequencyRange;
		if (!frequencyRange || runtime.state.audacityEffectType === 'eq') return null;
		if (definition.lengthChanging) throw new Error(runtime.copy.spectralEffectLengthChanging);
		return {
			minimumFrequency: frequencyRange.minimumFrequency,
			maximumFrequency: frequencyRange.maximumFrequency,
			windowSize: target.track.spectrogram?.windowSize || 2_048,
		};
	}

	function setSpectralBoxSelection(options: SpectralBoxOptions = {}): EffectSelection | null {
		if (runtime.editingBlocked()) return null;
		const project = runtime.getProject();
		if (project.schemaVersion < 2) throw new Error(runtime.copy.v2Required);
		const selectedClip = runtime.state.selectedClipId ? findClip(project, runtime.state.selectedClipId) : null;
		const clipTrack = selectedClip ? findClipTrack(project, selectedClip.id) : null;
		const track = findTrack(project, runtime.state.selectedTrackId) ?? clipTrack;
		if (!track || track.type !== 'audio') throw new Error(runtime.copy.audioTrackRequired);
		const current = runtime.activeSelection();
		const trackRange = runtime.selectedTracksTimeRange();
		const startFrame = current?.startFrame ?? selectedClip?.timelineStartFrame ?? trackRange?.startFrame;
		const endFrame = current?.endFrame
			?? (selectedClip ? selectedClip.timelineStartFrame + selectedClip.durationFrames : trackRange?.endFrame);
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
			|| startFrame == null || endFrame == null || endFrame <= startFrame) {
			throw new Error(runtime.copy.timeSelectionRequired);
		}
		const nyquist = runtime.projectSampleRate() / 2;
		const minimumFrequency = Number(options.minimumFrequency ?? track.spectrogram?.minimumFrequency ?? 0);
		const maximumFrequency = Number(options.maximumFrequency ?? track.spectrogram?.maximumFrequency ?? nyquist);
		if (!Number.isFinite(minimumFrequency) || minimumFrequency < 0 || minimumFrequency >= nyquist) {
			throw new RangeError(runtime.copy.minimumFrequencyInvalid
				|| formatRangeError(runtime.copy, runtime.copy.minimumFrequency, 0, nyquist));
		}
		if (!Number.isFinite(maximumFrequency) || maximumFrequency <= minimumFrequency || maximumFrequency > nyquist) {
			throw new RangeError(runtime.copy.maximumFrequencyInvalid
				|| formatRangeError(runtime.copy, runtime.copy.maximumFrequency, minimumFrequency, nyquist));
		}
		return runtime.setSelection(startFrame, endFrame, {
			trackIds: current?.trackIds?.length ? current.trackIds : [track.id],
			clipIds: current?.clipIds ?? (selectedClip ? [selectedClip.id] : []),
			frequencyRange: { minimumFrequency, maximumFrequency },
		}).selection;
	}

	function setSpectralBrushSelection(
		options: SpectralBrushSelectionOptions,
	): EffectSelection | null {
		if (runtime.editingBlocked()) return null;
		const project = runtime.getProject();
		if (project.schemaVersion < 2) throw new Error(runtime.copy.v2Required);
		const track = findTrack(project, runtime.state.selectedTrackId);
		if (!track || track.type !== 'audio') throw new Error(runtime.copy.audioTrackRequired);
		const centerFrame = safeNonNegativeInteger(options?.centerFrame, 'spectral brush center frame');
		const radiusFrames = safePositiveInteger(options?.radiusFrames, 'spectral brush frame radius');
		const endFrame = centerFrame + radiusFrames;
		if (!Number.isSafeInteger(endFrame)) throw new RangeError('Spectral brush frame range exceeds the safe integer domain.');
		const nyquist = runtime.projectSampleRate() / 2;
		const centerFrequency = finiteInRange(
			options?.centerFrequency,
			0,
			nyquist,
			'spectral brush center frequency',
		);
		const radiusFrequency = finitePositive(options?.radiusFrequency, 'spectral brush frequency radius');
		const minimumFrequency = Math.max(0, centerFrequency - radiusFrequency);
		const maximumFrequency = Math.min(nyquist, centerFrequency + radiusFrequency);
		if (!(maximumFrequency > minimumFrequency)) {
			throw new RangeError('Spectral brush frequency range must be positive.');
		}
		return runtime.setSelection(Math.max(0, centerFrame - radiusFrames), endFrame, {
			trackIds: [track.id],
			clipIds: [],
			frequencyRange: { minimumFrequency, maximumFrequency },
		}).selection;
	}

	return Object.freeze({
		audacityEffectSelectionDetails,
		audacityEffectTarget,
		audacityEffectTargets,
		audacitySpectralEffectContext,
		setSpectralBoxSelection,
		setSpectralBrushSelection,
	});
}

function safeNonNegativeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

function safePositiveInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function finitePositive(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
	if (!(number > 0)) throw new RangeError(`${name} must be positive.`);
	return number;
}

function finiteInRange(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
	if (number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	return number;
}

function findTrack(project: EffectSelectionProject, trackId: string | null | undefined): EffectSelectionTrack | null {
	return project.tracks.find((track) => track.id === trackId) ?? null;
}

function findClip(project: EffectSelectionProject, clipId: string | null | undefined): EffectSelectionClip | null {
	return project.clips.find((clip) => clip.id === clipId) ?? null;
}

function findClipTrack(project: EffectSelectionProject, clipId: string): EffectSelectionTrack | null {
	return project.tracks.find((track) => track.clipIds.includes(clipId)) ?? null;
}

function isEffectTarget(value: EffectTarget | null): value is EffectTarget {
	return value !== null;
}

function formatRangeError(
	copy: Pick<EffectSelectionCopy, 'parameterRangeError'>,
	label: string,
	minimum: number,
	maximum: number,
): string {
	return copy.parameterRangeError
		.replace('{label}', label)
		.replace('{minimum}', String(minimum))
		.replace('{maximum}', String(maximum));
}
