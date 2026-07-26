/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectClipTransformIds as collectLegacyClipTransformIds } from '../commands/clip-basic-runtime.js';
import { preparePasteCommand as prepareLegacyPasteCommand } from '../commands/clipboard-runtime.js';
import {
	prepareLinkedSplitCommand as prepareLegacyLinkedSplitCommand,
	prepareSplitCommand as prepareLegacySplitCommand,
} from '../commands/clip-link-runtime.js';
import { createAddSourceCommand, createAddTrackCommand } from '../commands/factories.ts';
import type {
	AudioEditorClipboard,
	AudioEditorClipboardTrack,
	AudioEditorCommand,
	ClipboardPasteMode,
} from '../commands/protocol.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

export interface ClipboardEditClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sourceId: string;
	readonly kind?: 'audio' | 'video';
	readonly title?: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames?: number;
	readonly durationFrames: number;
	readonly reversed?: boolean;
	readonly avLinkId?: string | null;
	readonly groupId?: string | null;
	readonly videoEffects?: readonly Readonly<Record<string, unknown>>[];
}

export interface ClipboardEditMediaTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: 'audio' | 'video';
	readonly clipIds: readonly string[];
	readonly laneGroupId?: string | null;
}

export interface ClipboardEditLabelTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: 'label';
	readonly labels: readonly Readonly<Record<string, unknown>>[];
}

export type ClipboardEditTrack = ClipboardEditMediaTrack | ClipboardEditLabelTrack;

export interface ClipboardEditSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface ClipboardEditProject {
	readonly id: string;
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly sources: readonly ClipboardEditSource[];
	readonly tracks: readonly ClipboardEditTrack[];
	readonly clips: readonly ClipboardEditClip[];
	readonly selection?: Readonly<{
		readonly startFrame: number;
		readonly endFrame: number;
		readonly trackIds?: readonly string[];
		readonly clipIds?: readonly string[];
	}> | null;
}

export interface ClipboardEditAudioBuffer {
	readonly sampleRate: number;
	readonly numberOfChannels: number;
	getChannelData(channel: number): Float32Array;
}

export interface ClipboardEditState {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	clipboard: AudioEditorClipboard | null;
}

interface SessionClipboard {
	readonly descriptor: AudioEditorClipboard;
	readonly sources: readonly ClipboardEditSource[];
}

export interface ClipboardSessionPort {
	setClipboard(
		descriptor: AudioEditorClipboard,
		options: Readonly<{ originProjectId: string }>,
	): Readonly<{ clipboard: SessionClipboard }>;
	clipboardForProject(projectId: string): SessionClipboard | null;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface ClipboardEditServiceDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly state: ClipboardEditState;
	readonly copy: Readonly<{ noSilencesFound: string; track: string }>;
	readonly session: ClipboardSessionPort;
	readonly sourceBuffers: Readonly<{
		get(sourceId: string): ClipboardEditAudioBuffer | undefined;
	}>;
	getProject(): ClipboardEditProject;
	editingBlocked(): boolean;
	getPositionFrames(): number;
	normalizeFrame(value: unknown): number;
	snapFrame(value: unknown): number;
	createId(prefix?: string): string;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	setStatus(message: string, state?: string): void;
}

export interface ClipboardEditService {
	setSessionClipboard(descriptor: AudioEditorClipboard): AudioEditorClipboard;
	splitAtFrame(frame: unknown, trackIds?: string | readonly string[] | null): unknown;
	commitSplitAtFrames(frames: readonly unknown[], trackIds?: string | readonly string[] | null): unknown;
	prepareControllerPaste(mode: ClipboardPasteMode, atFrame?: number): AudioEditorCommand;
	disjoinSelectedClip(): Promise<void>;
}

type SplitCommand = Extract<AudioEditorCommand, { readonly type: 'clip/split' }>;

export function createClipboardEditService(
	dependencies: ClipboardEditServiceDependencies,
): Readonly<ClipboardEditService> {
	return Object.freeze({
		setSessionClipboard,
		splitAtFrame,
		commitSplitAtFrames,
		prepareControllerPaste,
		disjoinSelectedClip,
	});

	function setSessionClipboard(descriptor: AudioEditorClipboard): AudioEditorClipboard {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const result = dependencies.session.setClipboard(descriptor, { originProjectId: project.id });
		dependencies.state.clipboard = result.clipboard.descriptor;
		return dependencies.state.clipboard;
	}

	function splitAtFrame(
		requestedFrame: unknown,
		trackIds: string | readonly string[] | null = null,
	): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const frame = dependencies.snapFrame(dependencies.normalizeFrame(requestedFrame));
		return commitSplitAtFrames([frame], trackIds);
	}

	function commitSplitAtFrames(
		requestedFrames: readonly unknown[],
		trackIds: string | readonly string[] | null = null,
	): unknown {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const targetClipIds = collectSplitTargetClipIds(project, trackIds);
		const frames = [...new Set(requestedFrames.map((frame) => dependencies.normalizeFrame(frame)))]
			.sort((left, right) => right - left);
		const commands: AudioEditorCommand[] = [];
		const handledLinks = new Set<string>();
		for (const clipId of targetClipIds) {
			const clip = findClip(project, clipId);
			if (!clip) continue;
			if (clip.avLinkId && handledLinks.has(clip.avLinkId)) continue;
			if (clip.avLinkId) handledLinks.add(clip.avLinkId);
			const clipEndFrame = clip.timelineStartFrame + clip.durationFrames;
			for (const frame of frames) {
				if (frame <= clip.timelineStartFrame || frame >= clipEndFrame) continue;
				commands.push(prepareLinkedSplit(project, clip.id, frame));
			}
		}
		if (!commands.length) return null;
		const command: AudioEditorCommand = commands.length === 1
			? commands[0]
			: { type: 'batch', commands };
		return dependencies.commit(command);
	}

	function prepareControllerPaste(
		mode: ClipboardPasteMode,
		atFrame = dependencies.getPositionFrames(),
	): AudioEditorCommand {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const clipboard = dependencies.state.clipboard;
		if (!clipboard) throw new TypeError('An audio editor clipboard is required.');
		const trackMap: Record<string, string> = {};
		const sessionClipboard = dependencies.session.clipboardForProject(project.id);
		const commands: AudioEditorCommand[] = (sessionClipboard?.sources ?? [])
			.filter((source) => !findSource(project, source.id))
			.map((source) => createAddSourceCommand(source));
		let addedTrackCount = 0;
		const usedTrackIds = new Set<string>();
		const selected = findMediaTrack(project, dependencies.state.selectedTrackId);
		const clipboardTracks = clipboard.tracks ?? [];
		const laneGroups = groupClipboardLanes(clipboardTracks);

		const targetMatches = (
			target: ClipboardEditMediaTrack | null,
			clipboardTrack: AudioEditorClipboardTrack,
		): target is ClipboardEditMediaTrack => Boolean(
			target
			&& target.type === clipboardTrackType(clipboardTrack)
			&& !usedTrackIds.has(target.id)
		);
		const assignTarget = (clipboardTrack: AudioEditorClipboardTrack, target: ClipboardEditMediaTrack) => {
			trackMap[clipboardTrack.sourceTrackId] = target.id;
			usedTrackIds.add(target.id);
		};
		const findTargetLanePair = (
			candidate: ClipboardEditMediaTrack | null,
		): readonly [ClipboardEditMediaTrack, ClipboardEditMediaTrack] | null => {
			if (!candidate?.laneGroupId) return null;
			const grouped = project.tracks
				.filter(isMediaTrack)
				.filter((track) => track.laneGroupId === candidate.laneGroupId);
			if (
				grouped.length !== 2
				|| grouped[0]?.type !== 'video'
				|| grouped[1]?.type !== 'audio'
				|| grouped.some((track) => usedTrackIds.has(track.id))
			) return null;
			return [grouped[0], grouped[1]];
		};
		const createTargetTrack = (
			clipboardTrack: AudioEditorClipboardTrack,
			laneGroupId: string | null = null,
		): ClipboardEditMediaTrack => {
			const type = clipboardTrackType(clipboardTrack);
			if (type === 'video' && project.schemaVersion < 4) {
				throw new RangeError('Video clipboard tracks require an AudioEditorProjectV4 project.');
			}
			const trackId = dependencies.createId(type === 'video' ? 'video-track' : 'track');
			addedTrackCount += 1;
			commands.push(createAddTrackCommand({
				schemaVersion: project.schemaVersion,
				type,
				id: trackId,
				name: clipboardTrack.sourceTrackName
					|| `${dependencies.copy.track} ${project.tracks.length + addedTrackCount}`,
				laneGroupId,
			}));
			return { id: trackId, type, name: clipboardTrack.sourceTrackName, laneGroupId, clipIds: [] };
		};

		for (const [index, clipboardTrack] of clipboardTracks.entries()) {
			if (trackMap[clipboardTrack.sourceTrackId]) continue;
			const grouped = clipboardTrack.sourceLaneGroupId
				? laneGroups.get(clipboardTrack.sourceLaneGroupId)
				: null;
			const videoClipboardTrack = grouped?.find((track) => clipboardTrackType(track) === 'video');
			const audioClipboardTrack = grouped?.find((track) => clipboardTrackType(track) === 'audio');
			if (grouped?.length === 2 && videoClipboardTrack && audioClipboardTrack) {
				const existingVideo = findMediaTrack(project, videoClipboardTrack.sourceTrackId);
				const existingAudio = findMediaTrack(project, audioClipboardTrack.sourceTrackId);
				let targetPair: readonly [ClipboardEditMediaTrack, ClipboardEditMediaTrack] | null = (
					targetMatches(existingVideo, videoClipboardTrack)
					&& targetMatches(existingAudio, audioClipboardTrack)
					&& existingVideo.laneGroupId
					&& existingVideo.laneGroupId === existingAudio.laneGroupId
				) ? [existingVideo, existingAudio] : null;
				if (!targetPair && (
					targetMatches(selected, videoClipboardTrack)
					|| targetMatches(selected, audioClipboardTrack)
				)) targetPair = findTargetLanePair(selected);
				if (!targetPair) {
					const laneGroupId = dependencies.createId('media-lanes');
					targetPair = [
						createTargetTrack(videoClipboardTrack, laneGroupId),
						createTargetTrack(audioClipboardTrack, laneGroupId),
					];
				}
				assignTarget(videoClipboardTrack, targetPair[0]);
				assignTarget(audioClipboardTrack, targetPair[1]);
				continue;
			}

			let target = findMediaTrack(project, clipboardTrack.sourceTrackId);
			if (!targetMatches(target, clipboardTrack)) target = null;
			if (!target && index === 0 && targetMatches(selected, clipboardTrack)) target = selected;
			if (!target) target = createTargetTrack(clipboardTrack);
			assignTarget(clipboardTrack, target);
		}
		commands.push(preparePaste(clipboard, project, atFrame, trackMap, mode));
		return commands.length === 1 ? commands[0] : { type: 'batch', commands };
	}

	async function disjoinSelectedClip(): Promise<void> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return;
		const project = dependencies.getProject();
		const clip = findClip(project, dependencies.state.selectedClipId);
		const buffer = clip ? dependencies.sourceBuffers.get(clip.sourceId) : null;
		if (!clip || !buffer) return;
		const sourceDurationFrames = clip.sourceDurationFrames ?? clip.durationFrames;
		const minimumSilenceFrames = Math.max(1, Math.round(buffer.sampleRate * 0.01));
		const regions: Array<readonly [number, number]> = [];
		let silenceStart: number | null = null;
		for (let relativeSourceFrame = 0; relativeSourceFrame < sourceDurationFrames; relativeSourceFrame += 1) {
			const sourceFrame = clip.reversed
				? clip.sourceStartFrame + sourceDurationFrames - 1 - relativeSourceFrame
				: clip.sourceStartFrame + relativeSourceFrame;
			let peak = 0;
			for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
				peak = Math.max(peak, Math.abs(buffer.getChannelData(channel)[sourceFrame] ?? 0));
			}
			if (peak <= 0.001) silenceStart ??= relativeSourceFrame;
			else if (silenceStart != null) {
				if (relativeSourceFrame - silenceStart >= minimumSilenceFrames) {
					regions.push([silenceStart, relativeSourceFrame]);
				}
				silenceStart = null;
			}
		}
		if (silenceStart != null && sourceDurationFrames - silenceStart >= minimumSilenceFrames) {
			regions.push([silenceStart, sourceDurationFrames]);
		}
		const timelineRegions = regions.map(([start, end]) => [
			clip.timelineStartFrame + Math.round(start / sourceDurationFrames * clip.durationFrames),
			clip.timelineStartFrame + Math.round(end / sourceDurationFrames * clip.durationFrames),
		] as const).filter(([start, end]) => (
			start > clip.timelineStartFrame
			&& end < clip.timelineStartFrame + clip.durationFrames
			&& end > start
		)).slice(0, 128);
		if (!timelineRegions.length) {
			dependencies.setStatus(dependencies.copy.noSilencesFound, 'info');
			return;
		}
		const commands: AudioEditorCommand[] = [];
		if (clip.avLinkId) commands.push({ type: 'clip/unlink-av', clipId: clip.id });
		for (const [startFrame, endFrame] of timelineRegions.reverse()) {
			const after = prepareSplit(clip.id, endFrame);
			const silence = prepareSplit(clip.id, startFrame);
			commands.push(after, silence, { type: 'clip/remove', clipId: silence.rightClipId });
		}
		dependencies.commit({ type: 'batch', commands }, { selectClipId: clip.id });
	}

	function collectSplitTargetClipIds(
		project: ClipboardEditProject,
		requestedTrackIds: string | readonly string[] | null,
	): readonly string[] {
		if (requestedTrackIds != null) {
			const trackIds = new Set(Array.isArray(requestedTrackIds) ? requestedTrackIds : [requestedTrackIds]);
			return project.tracks
				.filter(isMediaTrack)
				.filter((track) => trackIds.has(track.id))
				.flatMap((track) => track.clipIds);
		}
		const selectedClipIds = dependencies.state.selectedClipId
			? project.selection?.clipIds?.filter((clipId) => findClip(project, clipId)) ?? []
			: [];
		const seedClipIds = selectedClipIds.length
			? selectedClipIds
			: findClip(project, dependencies.state.selectedClipId) ? [dependencies.state.selectedClipId as string] : [];
		if (seedClipIds.length) {
			const targetIds = new Set(seedClipIds.flatMap((clipId) => collectClipTransformIds(project, clipId)));
			return project.clips.filter((clip) => targetIds.has(clip.id)).map((clip) => clip.id);
		}
		const selectedTrackIds = project.selection?.trackIds?.length
			? project.selection.trackIds
			: dependencies.state.selectedTrackId ? [dependencies.state.selectedTrackId] : [];
		const trackIds = new Set(selectedTrackIds);
		return project.tracks
			.filter(isMediaTrack)
			.filter((track) => trackIds.has(track.id))
			.flatMap((track) => track.clipIds);
	}

	function prepareLinkedSplit(project: ClipboardEditProject, clipId: string, atFrame: number): SplitCommand {
		return prepareLegacyLinkedSplitCommand(project, clipId, atFrame, dependencies.createId) as SplitCommand;
	}

	function prepareSplit(clipId: string, atFrame: number): SplitCommand {
		return prepareLegacySplitCommand(clipId, atFrame, dependencies.createId) as SplitCommand;
	}

	function preparePaste(
		clipboard: AudioEditorClipboard,
		project: ClipboardEditProject,
		atFrame: number,
		trackMap: Readonly<Record<string, string>>,
		mode: ClipboardPasteMode,
	): Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }> {
		return prepareLegacyPasteCommand(
			clipboard,
			{ project, atFrame, trackMap, mode },
			dependencies.createId,
		) as Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;
	}
}

function findClip(project: ClipboardEditProject, clipId: string | null | undefined): ClipboardEditClip | null {
	return project.clips.find((clip) => clip.id === clipId) ?? null;
}

function findSource(project: ClipboardEditProject, sourceId: string): ClipboardEditSource | null {
	return project.sources.find((source) => source.id === sourceId) ?? null;
}

function isMediaTrack(track: ClipboardEditTrack): track is ClipboardEditMediaTrack {
	return (track.type === 'audio' || track.type === 'video') && Array.isArray(track.clipIds);
}

function findMediaTrack(
	project: ClipboardEditProject,
	trackId: string | null | undefined,
): ClipboardEditMediaTrack | null {
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	return track && isMediaTrack(track) ? track : null;
}

function clipboardTrackType(track: AudioEditorClipboardTrack): 'audio' | 'video' {
	if (track.sourceTrackType === 'video') return 'video';
	if (track.sourceTrackType === 'audio') return 'audio';
	return track.clips[0]?.kind === 'video' ? 'video' : 'audio';
}

function groupClipboardLanes(
	tracks: readonly AudioEditorClipboardTrack[],
): ReadonlyMap<string, readonly AudioEditorClipboardTrack[]> {
	const laneGroups = new Map<string, AudioEditorClipboardTrack[]>();
	for (const track of tracks) {
		if (!track.sourceLaneGroupId) continue;
		const grouped = laneGroups.get(track.sourceLaneGroupId) ?? [];
		grouped.push(track);
		laneGroups.set(track.sourceLaneGroupId, grouped);
	}
	return laneGroups;
}

function collectClipTransformIds(project: ClipboardEditProject, clipId: string): readonly string[] {
	return collectLegacyClipTransformIds(project, clipId) as readonly string[];
}
