/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
	type RuntimePersistedClip,
} from '../runtime-clip-projection.ts';

export interface ClipSelectionNavigationFrequencyRange {
	readonly minimumFrequency: number;
	readonly maximumFrequency: number;
}

export interface ClipSelectionNavigationSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
	readonly annotationIds?: readonly string[];
	readonly frequencyRange?: ClipSelectionNavigationFrequencyRange | null;
}

export interface ClipSelectionNavigationClip extends RuntimePersistedClip {
	readonly id: string;
}

export interface ClipSelectionNavigationTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly clipIds?: readonly string[];
}

export interface ClipSelectionNavigationProject extends RuntimeClipProject {
	readonly sampleRate: number;
	readonly clips: readonly ClipSelectionNavigationClip[];
	readonly tracks: readonly ClipSelectionNavigationTrack[];
	readonly selection?: ClipSelectionNavigationSelection;
}

export interface ClipSelectionNavigationState {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
}

export interface ClipSelectionNavigationSelectionCommand {
	readonly type: 'selection/set';
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
	readonly clipIds: readonly string[];
	readonly annotationIds?: readonly string[];
	readonly frequencyRange: ClipSelectionNavigationFrequencyRange | null;
}

export interface ClipSelectionNavigationServiceDependencies<
	Project extends ClipSelectionNavigationProject,
	SelectionResult,
> {
	readonly state: ClipSelectionNavigationState;
	readonly getProject: () => Project | null;
	readonly updateSelection: (
		command: ClipSelectionNavigationSelectionCommand,
	) => SelectionResult;
	readonly seek: (frame: number) => void;
}

interface ProjectedAudioClipCandidate {
	readonly clipId: string;
	readonly trackId: string;
	readonly trackIndex: number;
	readonly documentIndex: number;
	readonly startFrame: number;
	readonly endFrame: number;
}

export function createClipSelectionNavigationService<
	Project extends ClipSelectionNavigationProject,
	SelectionResult,
>(dependencies: ClipSelectionNavigationServiceDependencies<Project, SelectionResult>) {
	return Object.freeze({
		selectPreviousClipBoundaryToCursor: () => selectClipBoundary(false),
		selectCursorToNextClipBoundary: () => selectClipBoundary(true),
		selectPreviousClip: () => selectAdjacentClip(false),
		selectNextClip: () => selectAdjacentClip(true),
		skipToSelectionStart: () => skipToSelectionBoundary('startFrame'),
		skipToSelectionEnd: () => skipToSelectionBoundary('endFrame'),
		selectNoTracks,
	});

	function selectClipBoundary(next: boolean): SelectionResult | null {
		const project = dependencies.getProject();
		const selection = project?.selection;
		if (!project || !selection) return null;
		const startFrame = selectionFrame(selection.startFrame, 'selection.startFrame');
		const endFrame = selectionFrame(selection.endFrame, 'selection.endFrame');
		const pivot = next ? endFrame : startFrame;
		const boundary = nearestClipBoundary(project, selection, pivot, next);
		if (boundary === null) return null;
		return dependencies.updateSelection(selectionCommand(
			selection,
			next ? startFrame : boundary,
			next ? boundary : endFrame,
		));
	}

	function selectAdjacentClip(next: boolean): SelectionResult | null {
		const project = dependencies.getProject();
		const selection = project?.selection;
		if (!project || !selection) return null;
		const startFrame = selectionFrame(selection.startFrame, 'selection.startFrame');
		const endFrame = selectionFrame(selection.endFrame, 'selection.endFrame');
		const candidate = adjacentClip(project, selection, startFrame, endFrame, next);
		if (!candidate) return null;
		const command = exactClipSelectionCommand(selection, candidate);
		const previousFocus = Object.freeze({
			selectedTrackId: dependencies.state.selectedTrackId,
			selectedClipId: dependencies.state.selectedClipId,
			selectedAnnotationId: dependencies.state.selectedAnnotationId,
		});
		dependencies.state.selectedTrackId = candidate.trackId;
		dependencies.state.selectedClipId = candidate.clipId;
		dependencies.state.selectedAnnotationId = null;
		try {
			return dependencies.updateSelection(command);
		} catch (error) {
			dependencies.state.selectedTrackId = previousFocus.selectedTrackId;
			dependencies.state.selectedClipId = previousFocus.selectedClipId;
			dependencies.state.selectedAnnotationId = previousFocus.selectedAnnotationId;
			throw error;
		}
	}

	function skipToSelectionBoundary(
		boundary: 'startFrame' | 'endFrame',
	): number | null {
		const selection = dependencies.getProject()?.selection;
		if (!selection) return null;
		const frame = selectionFrame(selection[boundary], `selection.${boundary}`);
		dependencies.seek(frame);
		return frame;
	}

	function selectNoTracks(): SelectionResult | null {
		const selection = dependencies.getProject()?.selection;
		if (!selection) return null;
		const command = selectionCommand(
			selection,
			selectionFrame(selection.startFrame, 'selection.startFrame'),
			selectionFrame(selection.endFrame, 'selection.endFrame'),
			[],
		);
		const previousTrackId = dependencies.state.selectedTrackId;
		dependencies.state.selectedTrackId = null;
		try {
			return dependencies.updateSelection(command);
		} catch (error) {
			dependencies.state.selectedTrackId = previousTrackId;
			throw error;
		}
	}
}

function nearestClipBoundary(
	project: ClipSelectionNavigationProject,
	selection: ClipSelectionNavigationSelection,
	pivot: number,
	next: boolean,
): number | null {
	let result: number | null = null;
	for (const clip of projectedAudioClips(project, selection)) {
		result = nearerBoundary(result, clip.startFrame, pivot, next);
		result = nearerBoundary(result, clip.endFrame, pivot, next);
	}
	return result;
}

function adjacentClip(
	project: ClipSelectionNavigationProject,
	selection: ClipSelectionNavigationSelection,
	startFrame: number,
	endFrame: number,
	next: boolean,
): ProjectedAudioClipCandidate | null {
	const candidates = projectedAudioClips(project, selection);
	const sameStart = candidates.filter((clip) => (
		clip.startFrame === startFrame && (next ? clip.endFrame > endFrame : clip.endFrame < endFrame)
	));
	if (sameStart.length) return sameStart.sort(compareCandidateOrder)[0] ?? null;
	const directional = candidates.filter((clip) => (
		next ? clip.startFrame > startFrame : clip.startFrame < startFrame
	));
	if (!directional.length) return null;
	let adjacentStart = directional[0]!.startFrame;
	for (const clip of directional.slice(1)) {
		if (next ? clip.startFrame < adjacentStart : clip.startFrame > adjacentStart) {
			adjacentStart = clip.startFrame;
		}
	}
	return directional
		.filter((clip) => clip.startFrame === adjacentStart)
		.sort(compareCandidateOrder)[0] ?? null;
}

function projectedAudioClips(
	project: ClipSelectionNavigationProject,
	selection: ClipSelectionNavigationSelection,
): ProjectedAudioClipCandidate[] {
	const projection = resolveRuntimeProjectProjection(project);
	const clipById = new Map<string, Readonly<{
		readonly clip: Readonly<Record<string, unknown>>;
		readonly documentIndex: number;
	}>>();
	for (const [documentIndex, value] of projection.clips.entries()) {
		const clip = value as Readonly<Record<string, unknown>>;
		const clipId = nonEmptyId(clip.id, 'clip.id');
		if (clipById.has(clipId)) throw new RangeError(`Duplicate clip ID ${clipId}.`);
		clipById.set(clipId, { clip, documentIndex });
	}

	const selectedTrackIds = new Set(selectionIds(selection.trackIds, 'selection.trackIds'));
	const audioTracks = projection.tracks
		.map((track, trackIndex) => ({ track, trackIndex }))
		.filter(({ track }) => track.type === 'audio');
	const selectedAudioTracks = audioTracks.filter(({ track }) => (
		selectedTrackIds.has(nonEmptyId(track.id, 'track.id'))
	));
	const searchedTracks = selectedAudioTracks.length ? selectedAudioTracks : audioTracks;
	const result: ProjectedAudioClipCandidate[] = [];
	for (const { track, trackIndex } of searchedTracks) {
		const trackId = nonEmptyId(track.id, 'track.id');
		const clipIds = selectionIds(track.clipIds, `track ${trackId}.clipIds`);
		for (const clipId of clipIds) {
			const entry = clipById.get(clipId);
			if (!entry) throw new ReferenceError(`Track ${trackId} references missing clip ${clipId}.`);
			if (entry.clip.kind !== 'audio') continue;
			result.push(Object.freeze({
				clipId,
				trackId,
				trackIndex,
				documentIndex: entry.documentIndex,
				startFrame: selectionFrame(entry.clip.timelineStartFrame, `clip ${clipId}.timelineStartFrame`),
				endFrame: selectionFrame(entry.clip.timelineEndFrame, `clip ${clipId}.timelineEndFrame`),
			}));
		}
	}
	return result;
}

function compareCandidateOrder(
	left: ProjectedAudioClipCandidate,
	right: ProjectedAudioClipCandidate,
): number {
	return left.trackIndex - right.trackIndex || left.documentIndex - right.documentIndex;
}

function nearerBoundary(
	current: number | null,
	candidate: number,
	pivot: number,
	next: boolean,
): number | null {
	if (next) {
		if (candidate <= pivot) return current;
		return current === null || candidate < current ? candidate : current;
	}
	if (candidate >= pivot) return current;
	return current === null || candidate > current ? candidate : current;
}

function selectionCommand(
	selection: ClipSelectionNavigationSelection,
	startFrame: number,
	endFrame: number,
	trackIds = selectionIds(selection.trackIds, 'selection.trackIds'),
): ClipSelectionNavigationSelectionCommand {
	const command: ClipSelectionNavigationSelectionCommand = {
		type: 'selection/set',
		startFrame,
		endFrame,
		trackIds: Object.freeze([...trackIds]),
		clipIds: Object.freeze(selectionIds(selection.clipIds, 'selection.clipIds')),
		frequencyRange: frequencyRange(selection.frequencyRange),
		...(Object.hasOwn(selection, 'annotationIds') ? {
			annotationIds: Object.freeze(selectionIds(selection.annotationIds, 'selection.annotationIds')),
		} : {}),
	};
	return Object.freeze(command);
}

function exactClipSelectionCommand(
	selection: ClipSelectionNavigationSelection,
	clip: ProjectedAudioClipCandidate,
): ClipSelectionNavigationSelectionCommand {
	return Object.freeze({
		type: 'selection/set',
		startFrame: clip.startFrame,
		endFrame: clip.endFrame,
		trackIds: Object.freeze([clip.trackId]),
		clipIds: Object.freeze([clip.clipId]),
		frequencyRange: null,
		...(Object.hasOwn(selection, 'annotationIds') ? {
			annotationIds: Object.freeze([] as string[]),
		} : {}),
	});
}

function selectionIds(value: unknown, name: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => nonEmptyId(candidate, `${name}[${String(index)}]`));
}

function frequencyRange(
	value: ClipSelectionNavigationFrequencyRange | null | undefined,
): ClipSelectionNavigationFrequencyRange | null {
	if (value == null) return null;
	const minimumFrequency = finiteNumber(value.minimumFrequency, 'selection.frequencyRange.minimumFrequency');
	const maximumFrequency = finiteNumber(value.maximumFrequency, 'selection.frequencyRange.maximumFrequency');
	if (minimumFrequency < 0 || maximumFrequency <= minimumFrequency) {
		throw new RangeError('selection.frequencyRange must be an ordered non-negative range.');
	}
	return Object.freeze({ minimumFrequency, maximumFrequency });
}

function selectionFrame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${name} must be finite.`);
	}
	return value;
}

function nonEmptyId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}
