/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasProjectBinMediaAuthority } from '../project-schema-version.ts';

import {
	collectClipTransformIds as collectLegacyClipTransformIds,
	collectClipTrimIds as collectLegacyClipTrimIds,
} from '../commands/clip-basic-runtime.js';
import {
	prepareOverwriteClipCommand as prepareLegacyOverwriteClipCommand,
	prepareTransformClipsCommand as prepareLegacyTransformClipsCommand,
} from '../commands/clip-transform-runtime.js';
import { createAddTrackCommand } from '../commands/factories.ts';
import { resolveAudioWarpEditFrame } from '../audio-warp-clip-edit.ts';
import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type {
	ClipTransformClip,
	ClipTransformProject,
	ClipTransformSelection,
	ClipTransformSource,
	ClipTransformTrack,
} from './clip-domain-types.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

export interface ClipTransformChanges extends Readonly<Record<string, unknown>> {
	readonly timelineStartFrame?: unknown;
	readonly sourceStartFrame?: unknown;
	readonly sourceDurationFrames?: unknown;
	readonly durationFrames?: unknown;
}

interface ClipTransformCopy {
	readonly audioClipNotFound: string;
	readonly track: string;
	readonly timelineFramesFinite: string;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

interface PreparedTransform {
	readonly clipId: string;
	readonly trackId?: string;
	readonly changes: CommandObject;
}

export interface ClipTransformServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly copy: ClipTransformCopy;
	getProject(): ClipTransformProject;
	getSelectedClipId(): string | null;
	editingBlocked(): boolean;
	createId(prefix: string): string;
	snapTimelineFrame(frame: unknown): number;
	activeSelection(): ClipTransformSelection | null;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
}

export interface ClipTransformService {
	moveClips(
		clipId?: string | null,
		trackId?: string | null,
		timelineStartFrame?: unknown,
		options?: Readonly<{ overwrite?: boolean }>,
	): unknown;
	moveClipsToNewTrack(clipId?: string | null, timelineStartFrame?: unknown): string | null;
	trimClips(
		clipId?: string | null,
		changes?: ClipTransformChanges,
		options?: Readonly<{ minimumDurationFrames?: number; overwrite?: boolean }>,
	): unknown;
	overwriteClips(
		clipId?: string | null,
		trackId?: string | null,
		changes?: ClipTransformChanges,
	): unknown;
}

export function createClipTransformService(
	dependencies: ClipTransformServiceDependencies,
): Readonly<ClipTransformService> {
	return Object.freeze({ moveClips, moveClipsToNewTrack, trimClips, overwriteClips });

	function moveClips(
		clipId: string | null = dependencies.getSelectedClipId(),
		trackId?: string | null,
		timelineStartFrame?: unknown,
		options: Readonly<{ overwrite?: boolean }> = {},
	): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const clip = findClip(project, clipId);
		const oldTrack = clip ? findClipTrack(project, clip.id) : null;
		let targetTrack = trackId == null ? oldTrack : findTrack(project, trackId);
		if (clip && targetTrack && hasProjectBinMediaAuthority(project)
			&& targetTrack.type !== clip.kind && targetTrack.laneGroupId) {
			targetTrack = project.tracks.find((track) => (
				track.type === clip.kind && track.laneGroupId === targetTrack?.laneGroupId
			)) ?? targetTrack;
		}
		if (!clip || !oldTrack || !targetTrack || !Array.isArray(targetTrack.clipIds)) {
			throw new Error(dependencies.copy.audioClipNotFound);
		}
		const requestedStartFrame = dependencies.snapTimelineFrame(timelineStartFrame);
		const clipIds = collectClipTransformIds(project, clip.id);
		const audioTracks = timelineTracks(project);
		const oldTrackIndex = audioTracks.findIndex((item) => item.id === oldTrack.id);
		const targetTrackIndex = audioTracks.findIndex((item) => item.id === targetTrack?.id);
		if (oldTrackIndex < 0 || targetTrackIndex < 0) {
			throw new RangeError('Clip destination must be an audio track.');
		}
		const trackDelta = targetTrackIndex - oldTrackIndex;
		const clips = clipIds.map((id) => findClip(project, id)).filter(isClip);
		const selection = dependencies.activeSelection();
		const clipSelection = project.selection;
		const movesClipSelection = Boolean(clipSelection?.clipIds?.includes(clip.id));
		const requestedDelta = requestedStartFrame - clip.timelineStartFrame;
		const earliestMovingFrame = Math.min(
			...clips.map((item) => item.timelineStartFrame),
			...(selection && movesClipSelection ? [selection.startFrame] : []),
		);
		const deltaFrames = Math.max(requestedDelta, -earliestMovingFrame);
		const transforms = clips.map((item): PreparedTransform => {
			const sourceTrack = findClipTrack(project, item.id);
			const sourceTrackIndex = audioTracks.findIndex((candidate) => candidate.id === sourceTrack?.id);
			const destinationTrack = audioTracks[sourceTrackIndex + trackDelta];
			if (!sourceTrack || !destinationTrack) {
				throw new RangeError('The selected clips cannot move beyond the available audio tracks.');
			}
			return {
				clipId: item.id,
				trackId: destinationTrack.id,
				changes: { timelineStartFrame: item.timelineStartFrame + deltaFrames },
			};
		});
		const transformCommand = prepareTransformClipsCommand(project, transforms, {
			overwrite: Boolean(options.overwrite),
		}, dependencies.createId);
		const command: AudioEditorCommand = movesClipSelection && clipSelection ? {
			type: 'batch',
			commands: [transformCommand, movedSelectionCommand(
				clipSelection, selection, audioTracks, trackDelta, deltaFrames,
			)],
		} : transformCommand;
		return dependencies.commit(command, { selectTrackId: targetTrack.id, selectClipId: clip.id });
	}

	function moveClipsToNewTrack(
		clipId: string | null = dependencies.getSelectedClipId(),
		timelineStartFrame: unknown = 0,
	): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const clip = findClip(project, clipId);
		const sourceTrack = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !sourceTrack) throw new Error(dependencies.copy.audioClipNotFound);
		const audioTracks = timelineTracks(project);
		const activeTrackIndex = audioTracks.findIndex((track) => track.id === sourceTrack.id);
		if (activeTrackIndex < 0) throw new RangeError('Clip source must be an audio track.');
		const clipIds = collectClipTransformIds(project, clip.id);
		const clips = clipIds.map((id) => findClip(project, id)).filter(isClip);
		const sourceTrackIndices = clips.map((item) => (
			audioTracks.findIndex((track) => track.clipIds.includes(item.id))
		));
		if (sourceTrackIndices.some((index) => index < 0)) {
			throw new Error(dependencies.copy.audioClipNotFound);
		}
		const requestedStartFrame = dependencies.snapTimelineFrame(timelineStartFrame);
		const selection = dependencies.activeSelection();
		const clipSelection = project.selection;
		const movesClipSelection = Boolean(clipSelection?.clipIds?.includes(clip.id));
		const requestedDelta = requestedStartFrame - clip.timelineStartFrame;
		const earliestMovingFrame = Math.min(
			...clips.map((item) => item.timelineStartFrame),
			...(selection && movesClipSelection ? [selection.startFrame] : []),
		);
		const deltaFrames = Math.max(requestedDelta, -earliestMovingFrame);
		if (hasProjectBinMediaAuthority(project) && clips.some((item) => item.kind === 'video')) {
			return moveMediaClipsToNewTracks(
				project, clip, sourceTrack, clips, clipSelection,
				selection, movesClipSelection, deltaFrames,
			);
		}
		const trackDelta = audioTracks.length - activeTrackIndex;
		const newTrackCount = Math.max(...sourceTrackIndices) + trackDelta - audioTracks.length + 1;
		const newTrackCommands = Array.from({ length: newTrackCount }, (_, index) => createAddTrackCommand({
			type: 'audio',
			id: dependencies.createId('track'),
			name: `${dependencies.copy.track} ${project.tracks.length + index + 1}`,
			armed: false,
		}));
		const virtualTracks: ClipTransformTrack[] = [
			...audioTracks,
			...newTrackCommands.map((command) => command.track as unknown as ClipTransformTrack),
		];
		const transforms = clips.map((item, index): PreparedTransform => ({
			clipId: item.id,
			trackId: virtualTracks[sourceTrackIndices[index]! + trackDelta]!.id,
			changes: { timelineStartFrame: item.timelineStartFrame + deltaFrames },
		}));
		const targetTrackId = virtualTracks[activeTrackIndex + trackDelta]!.id;
		const commands: AudioEditorCommand[] = [
			...newTrackCommands,
			{ type: 'clip/transform-many', transforms, overwrite: false, splitClipIds: {} },
		];
		if (movesClipSelection && clipSelection) {
			commands.push({
				type: 'selection/set',
				startFrame: selection ? selection.startFrame + deltaFrames : clipSelection.startFrame,
				endFrame: selection ? selection.endFrame + deltaFrames : clipSelection.endFrame,
				trackIds: [...new Set((clipSelection.trackIds ?? []).map((selectedTrackId) => {
					const index = audioTracks.findIndex((track) => track.id === selectedTrackId);
					return index < 0 ? selectedTrackId : virtualTracks[index + trackDelta]?.id ?? selectedTrackId;
				}))],
				clipIds: clipSelection.clipIds ?? [],
				frequencyRange: clipSelection.frequencyRange ?? null,
			});
		}
		dependencies.commit({ type: 'batch', commands }, {
			selectTrackId: targetTrackId,
			selectClipId: clip.id,
		});
		return targetTrackId;
	}

	function moveMediaClipsToNewTracks(
		project: ClipTransformProject,
		activeClip: ClipTransformClip,
		sourceTrack: ClipTransformTrack,
		clips: readonly ClipTransformClip[],
		clipSelection: ClipTransformSelection | null | undefined,
		selection: ClipTransformSelection | null,
		movesClipSelection: boolean,
		deltaFrames: number,
	): string {
		const movingTrackIds = new Set(clips
			.map((item) => findClipTrack(project, item.id)?.id)
			.filter(isString));
		const destinationTrackIds = new Map<string, string>();
		const newTrackCommands: AudioEditorCommand[] = [];
		for (const track of project.tracks) {
			if (!movingTrackIds.has(track.id) || destinationTrackIds.has(track.id)) continue;
			if (track.type === 'video') {
				const companion = track.laneGroupId
					? project.tracks.find((candidate) => (
						candidate.type === 'audio' && candidate.laneGroupId === track.laneGroupId
					))
					: null;
				const laneGroupId = dependencies.createId('media-lane');
				const videoTrackId = dependencies.createId('video-track');
				const audioTrackId = dependencies.createId('track');
				newTrackCommands.push(createAddTrackCommand({
					type: 'video', id: videoTrackId, name: track.name,
					height: track.height, laneGroupId,
				}), createAddTrackCommand({
					type: 'audio', id: audioTrackId,
					name: companion?.name || `${track.name} Audio`,
					channelCount: companion?.channelCount || 2,
					color: companion?.color, armed: false, laneGroupId,
				}));
				destinationTrackIds.set(track.id, videoTrackId);
				if (companion) destinationTrackIds.set(companion.id, audioTrackId);
				continue;
			}
			if (track.type === 'audio') {
				const trackId = dependencies.createId('track');
				newTrackCommands.push(createAddTrackCommand({
					type: 'audio', id: trackId,
					name: `${dependencies.copy.track} ${project.tracks.length + newTrackCommands.length + 1}`,
					channelCount: track.channelCount, color: track.color, armed: false,
				}));
				destinationTrackIds.set(track.id, trackId);
			}
		}
		const transforms = clips.map((item): PreparedTransform => {
			const itemSourceTrack = findClipTrack(project, item.id);
			const trackId = itemSourceTrack ? destinationTrackIds.get(itemSourceTrack.id) : undefined;
			if (!trackId) throw new RangeError('The selected media clips cannot move to new tracks.');
			return {
				clipId: item.id, trackId,
				changes: { timelineStartFrame: item.timelineStartFrame + deltaFrames },
			};
		});
		const targetTrackId = destinationTrackIds.get(sourceTrack.id);
		if (!targetTrackId) throw new RangeError('The selected media clips cannot move to new tracks.');
		const commands: AudioEditorCommand[] = [
			...newTrackCommands,
			{ type: 'clip/transform-many', transforms, overwrite: false, splitClipIds: {} },
		];
		if (movesClipSelection && clipSelection) {
			commands.push({
				type: 'selection/set',
				startFrame: selection ? selection.startFrame + deltaFrames : clipSelection.startFrame,
				endFrame: selection ? selection.endFrame + deltaFrames : clipSelection.endFrame,
				trackIds: [...new Set((clipSelection.trackIds ?? []).map((trackId) => (
					destinationTrackIds.get(trackId) ?? trackId
				)))],
				clipIds: clipSelection.clipIds ?? [],
				frequencyRange: clipSelection.frequencyRange ?? null,
			});
		}
		dependencies.commit({ type: 'batch', commands }, {
			selectTrackId: targetTrackId, selectClipId: activeClip.id,
		});
		return targetTrackId;
	}

	function trimClips(
		clipId: string | null = dependencies.getSelectedClipId(),
		changes: ClipTransformChanges = {},
		options: Readonly<{ minimumDurationFrames?: number; overwrite?: boolean }> = {},
	): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const clip = findClip(project, clipId);
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error(dependencies.copy.audioClipNotFound);
		const timelineStartChanged = Object.hasOwn(changes, 'timelineStartFrame')
			&& Math.round(Number(changes.timelineStartFrame)) !== clip.timelineStartFrame;
		if (!timelineStartChanged && !Object.hasOwn(changes, 'durationFrames')) {
			if (!Object.keys(changes).length) return project;
			const command = options.overwrite
				? prepareOverwriteClipCommand(project, clip.id, { trackId: track.id, changes }, dependencies.createId)
				: trimCommand(clip.id, changes);
			return dependencies.commit(command, { selectClipId: clip.id });
		}
		const clipIds = collectClipTrimIds(project, clip.id, timelineStartChanged ? 'left' : 'right');
		const clips = clipIds.map((id) => findClip(project, id)).filter(isClip);
		const minimumDurationFrames = Math.max(1, Math.round(Number(options.minimumDurationFrames) || 1));
		const trimsLeft = timelineStartChanged;
		let requestedDelta: number;
		let lowerBound = Number.NEGATIVE_INFINITY;
		let upperBound = Number.POSITIVE_INFINITY;
		if (trimsLeft) {
			requestedDelta = Math.round(Number(changes.timelineStartFrame)) - clip.timelineStartFrame;
			for (const item of clips) {
				const source = findSource(project, item.sourceId);
				if (!source) throw new Error(dependencies.copy.audioClipNotFound);
				const sourceFramesPerTimelineFrame = item.sourceDurationFrames / item.durationFrames;
				const sourceExtension = item.reversed
					? source.frameCount - item.sourceStartFrame - item.sourceDurationFrames
					: item.sourceStartFrame;
				const timelineExtension = Math.floor(sourceExtension / sourceFramesPerTimelineFrame);
				lowerBound = Math.max(lowerBound, -Math.min(item.timelineStartFrame, timelineExtension));
				upperBound = Math.min(upperBound, item.durationFrames - Math.min(item.durationFrames, minimumDurationFrames));
			}
		} else {
			requestedDelta = Math.round(Number(changes.durationFrames)) - clip.durationFrames;
			for (const item of clips) {
				const source = findSource(project, item.sourceId);
				if (!source) throw new Error(dependencies.copy.audioClipNotFound);
				const sourceFramesPerTimelineFrame = item.sourceDurationFrames / item.durationFrames;
				const sourceExtension = item.reversed
					? item.sourceStartFrame
					: source.frameCount - item.sourceStartFrame - item.sourceDurationFrames;
				lowerBound = Math.max(lowerBound, Math.min(item.durationFrames, minimumDurationFrames) - item.durationFrames);
				upperBound = Math.min(upperBound, Math.floor(sourceExtension / sourceFramesPerTimelineFrame));
			}
		}
		if (!Number.isSafeInteger(requestedDelta)) throw new TypeError(dependencies.copy.timelineFramesFinite);
		const deltaFrames = warpEditableTrimDelta(project, clip, trimsLeft, {
			deltaFrames: Math.max(lowerBound, Math.min(upperBound, requestedDelta)),
			lowerBound,
			upperBound,
		});
		if (!deltaFrames) return project;
		const transforms = clips.map((item): PreparedTransform => {
			const source = findSource(project, item.sourceId);
			if (!source) throw new Error(dependencies.copy.audioClipNotFound);
			const durationFrames = trimsLeft ? item.durationFrames - deltaFrames : item.durationFrames + deltaFrames;
			const sourceExtension = trimsLeft
				? (item.reversed
					? source.frameCount - item.sourceStartFrame - item.sourceDurationFrames
					: item.sourceStartFrame)
				: (item.reversed
					? item.sourceStartFrame
					: source.frameCount - item.sourceStartFrame - item.sourceDurationFrames);
			const nextSourceDurationFrames = Math.max(1, Math.min(
				item.sourceDurationFrames + sourceExtension,
				Math.round(item.sourceDurationFrames * durationFrames / item.durationFrames),
			));
			const removedSourceFrames = item.sourceDurationFrames - nextSourceDurationFrames;
			const trimsSourceStart = trimsLeft ? !item.reversed : item.reversed;
			return {
				clipId: item.id,
				trackId: findClipTrack(project, item.id)?.id,
				changes: {
					...(trimsLeft ? { timelineStartFrame: item.timelineStartFrame + deltaFrames } : {}),
					...(isWarpedAudioClip(item) ? {} : {
						sourceStartFrame: trimsLeft
							? item.sourceStartFrame + (item.reversed ? 0 : removedSourceFrames)
							: item.reversed
								? item.sourceStartFrame + removedSourceFrames
								: item.sourceStartFrame,
						sourceDurationFrames: nextSourceDurationFrames,
						trimStartFrames: Math.max(0, item.trimStartFrames + (trimsSourceStart ? removedSourceFrames : 0)),
						trimEndFrames: Math.max(0, item.trimEndFrames + (trimsSourceStart ? 0 : removedSourceFrames)),
					}),
					durationFrames,
					fadeInFrames: Math.min(item.fadeInFrames, durationFrames),
					fadeOutFrames: Math.min(item.fadeOutFrames, durationFrames),
				},
			};
		});
		if (transforms.length === 1) {
			const normalizedChanges = transforms[0]!.changes;
			const command = options.overwrite
				? prepareOverwriteClipCommand(project, clip.id, {
					trackId: track.id, changes: normalizedChanges,
				}, dependencies.createId)
				: trimCommand(clip.id, normalizedChanges);
			return dependencies.commit(command, { selectClipId: clip.id });
		}
		return dependencies.commit(
			prepareTransformClipsCommand(project, transforms, {
				overwrite: Boolean(options.overwrite),
			}, dependencies.createId),
			{ selectTrackId: track.id, selectClipId: clip.id },
		);
	}

	function overwriteClips(
		clipId: string | null = dependencies.getSelectedClipId(),
		trackId?: string | null,
		changes: ClipTransformChanges = {},
	): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const clip = findClip(project, clipId);
		const clipIds = clip ? collectClipTransformIds(project, clip.id) : [];
		if (clip && clipIds.length > 1) {
			if (Object.hasOwn(changes, 'durationFrames')) {
				return trimClips(clip.id, changes, { overwrite: true });
			}
			return moveClips(clip.id, trackId, changes.timelineStartFrame, { overwrite: true });
		}
		if (!clipId) throw new Error(dependencies.copy.audioClipNotFound);
		return dependencies.commit(
			prepareOverwriteClipCommand(project, clipId, { trackId, changes }, dependencies.createId),
			{ selectTrackId: trackId, selectClipId: clipId },
		);
	}
}

function movedSelectionCommand(
	clipSelection: ClipTransformSelection,
	selection: ClipTransformSelection | null,
	audioTracks: readonly ClipTransformTrack[],
	trackDelta: number,
	deltaFrames: number,
): Extract<AudioEditorCommand, { readonly type: 'selection/set' }> {
	return {
		type: 'selection/set',
		startFrame: selection ? selection.startFrame + deltaFrames : clipSelection.startFrame,
		endFrame: selection ? selection.endFrame + deltaFrames : clipSelection.endFrame,
		trackIds: [...new Set((clipSelection.trackIds ?? []).map((trackId) => {
			const index = audioTracks.findIndex((candidate) => candidate.id === trackId);
			return index < 0 ? trackId : audioTracks[index + trackDelta]?.id ?? trackId;
		}))],
		clipIds: clipSelection.clipIds ?? [],
		frequencyRange: clipSelection.frequencyRange ?? null,
	};
}

function isWarpedAudioClip(clip: ClipTransformClip): boolean {
	return clip.kind === 'audio' && clip.warpMap != null;
}

/**
 * A warped clip only owns exact material where its map resolves a whole source
 * sample, and the source range that follows is the map's to derive rather than
 * the drag's. Move the requested edge onto the nearest boundary the clip can
 * cut; a request no boundary can serve is left for the command to refuse.
 */
function warpEditableTrimDelta(
	project: ClipTransformProject,
	clip: ClipTransformClip,
	trimsLeft: boolean,
	bounds: Readonly<{ deltaFrames: number; lowerBound: number; upperBound: number }>,
): number {
	if (!isWarpedAudioClip(clip)) return bounds.deltaFrames;
	const edgeFrame = (trimsLeft ? clip.timelineStartFrame : clip.timelineStartFrame + clip.durationFrames)
		+ bounds.deltaFrames;
	const resolved = resolveAudioWarpEditFrame(
		project as unknown as Parameters<typeof resolveAudioWarpEditFrame>[0],
		clip as Parameters<typeof resolveAudioWarpEditFrame>[1],
		edgeFrame,
	);
	if (resolved === null) return bounds.deltaFrames;
	return Math.max(bounds.lowerBound, Math.min(
		bounds.upperBound,
		bounds.deltaFrames + resolved - edgeFrame,
	));
}

function trimCommand(
	clipId: string,
	changes: CommandObject,
): Extract<AudioEditorCommand, { readonly type: 'clip/trim' }> {
	return { type: 'clip/trim', clipId, ...changes } as Extract<AudioEditorCommand, { readonly type: 'clip/trim' }>;
}

function timelineTracks(project: ClipTransformProject): ClipTransformTrack[] {
	return project.tracks.filter((track) => Array.isArray(track.clipIds));
}

function findClip(project: ClipTransformProject, clipId: string | null | undefined): ClipTransformClip | null {
	return project.clips.find((clip) => clip.id === clipId) ?? null;
}

function findTrack(project: ClipTransformProject, trackId: string | null | undefined): ClipTransformTrack | null {
	return project.tracks.find((track) => track.id === trackId) ?? null;
}

function findClipTrack(project: ClipTransformProject, clipId: string): ClipTransformTrack | null {
	return project.tracks.find((track) => track.clipIds.includes(clipId)) ?? null;
}

function findSource(project: ClipTransformProject, sourceId: string): ClipTransformSource | null {
	return project.sources.find((source) => source.id === sourceId) ?? null;
}

function isClip(value: ClipTransformClip | null): value is ClipTransformClip {
	return value !== null;
}

function isString(value: string | undefined): value is string {
	return typeof value === 'string';
}

function collectClipTransformIds(project: ClipTransformProject, activeClipId: string): string[] {
	return (collectLegacyClipTransformIds as (
		project: ClipTransformProject,
		activeClipId: string,
	) => string[])(project, activeClipId);
}

function collectClipTrimIds(
	project: ClipTransformProject,
	activeClipId: string,
	edge: 'left' | 'right',
): string[] {
	return (collectLegacyClipTrimIds as (
		project: ClipTransformProject,
		activeClipId: string,
		edge: 'left' | 'right',
	) => string[])(project, activeClipId, edge);
}

function prepareTransformClipsCommand(
	project: ClipTransformProject,
	transforms: readonly PreparedTransform[],
	options: Readonly<{ overwrite?: boolean }>,
	idFactory: (prefix: string) => string,
): Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }> {
	return (prepareLegacyTransformClipsCommand as unknown as (
		project: ClipTransformProject,
		transforms: readonly PreparedTransform[],
		options: Readonly<{ overwrite?: boolean }>,
		idFactory: (prefix: string) => string,
	) => Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }>)(
		project, transforms, options, idFactory,
	);
}

function prepareOverwriteClipCommand(
	project: ClipTransformProject,
	clipId: string,
	options: Readonly<{ trackId?: string | null; changes?: CommandObject }>,
	idFactory: (prefix: string) => string,
): Extract<AudioEditorCommand, { readonly type: 'clip/overwrite' }> {
	return (prepareLegacyOverwriteClipCommand as (
		project: ClipTransformProject,
		clipId: string,
		options: Readonly<{ trackId?: string | null; changes?: CommandObject }>,
		idFactory: (prefix: string) => string,
	) => Extract<AudioEditorCommand, { readonly type: 'clip/overwrite' }>)(
		project, clipId, options, idFactory,
	);
}
