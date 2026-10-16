/* SPDX-License-Identifier: AGPL-3.0-only */

import { setLocalizedStatus } from '../../../../i18n/presentation-message.ts';
import { preparePasteCommand as prepareLegacyPasteCommand } from '../../../commands/clipboard-runtime.js';
import {
	prepareLinkedSplitCommand as prepareLegacyLinkedSplitCommand,
	prepareSplitCommand as prepareLegacySplitCommand,
} from '../../../commands/clip-link-runtime.js';
import { findClipSilenceRegions } from '../../../clip-silence-regions.ts';
import type {
	AudioEditorCommand,
	ClipboardPasteMode,
} from '../../../commands/protocol.ts';
import type { EditorControllerLifetime } from '../../shared/lifecycle.ts';
import type { ControllerEditSessionClipboardCarrier } from '../../document/project-runtime.ts';
import { mergeEditingRanges, resolveEditingSelectionAuthority } from '../../../commands/editing-selection-authority.ts';
import { prepareClipboardPasteTrackPlan, isClipboardMediaTrack as isMediaTrack } from './clipboard-paste-track-plan.ts';
import { preparePasteCommandV7 } from '../../../commands/clipboard-runtime-v7.ts';
import { normalizeAudioEditorClipboardDescriptor } from '../../../commands/clipboard-codec.ts';
import { normalizeAudioEditorClipboardDescriptorV7 } from '../../../commands/clipboard-codec-v7.ts';
import type { CurrentAudioEditorClipboardDescriptor as AudioEditorClipboard, CurrentAudioEditorMutationCommandV2 } from '../../../commands/clipboard-command-v2.ts';
import { createAudioEditorSessionClipboard } from '../../../session-clipboard-codec.ts';
import { createAudioEditorSessionClipboardV2 } from '../../../session-clipboard-codec-v2.ts';
import type { RuntimeClipProject } from '../../../runtime-clip-projection.ts';
export interface ClipboardEditClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sourceId: string;
	readonly kind?: 'audio' | 'video' | 'image';
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
	readonly labels: readonly object[];
}

export type ClipboardEditTrack = ClipboardEditMediaTrack | ClipboardEditLabelTrack;

export interface ClipboardEditSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface ClipboardEditProject extends RuntimeClipProject {
	readonly id: string;
	readonly revision?: number;
	readonly schemaFamily?: 'soundscaper' | 'framescaper';
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly sources: readonly ClipboardEditSource[];
	readonly tracks: readonly ClipboardEditTrack[];
	readonly clips: readonly ClipboardEditClip[];
	readonly trackFolders?: readonly Readonly<{ readonly id: string }>[];
	readonly primarySequenceId?: string;
	readonly sequences?: readonly Readonly<{
		readonly id: string;
		readonly trackNodes: readonly Readonly<{
			readonly kind: 'folder' | 'track';
			readonly id: string;
			readonly parentFolderId: string | null;
		}>[];
	}>[];
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
		descriptor: AudioEditorClipboard | Readonly<{ schemaVersion: 1 | 2; originProjectId: string;
			descriptor: AudioEditorClipboard; sources: readonly ClipboardEditSource[] }>,
		options: Readonly<{ originProjectId: string }>,
	): Readonly<{ clipboard: Readonly<{ descriptor: unknown; sources: readonly ClipboardEditSource[] }> }>;
	clipboardForProject(projectId: string): (SessionClipboard & Readonly<{ originProjectId?: string }>) | null;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface ClipboardEditServiceDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly state: ClipboardEditState;
	readonly copy: Readonly<{ noSilencesFound: string; noSilencesInLabels?: string; track: string }>;
	readonly session: ClipboardSessionPort;
	readonly sourceBuffers: Readonly<{
		get(sourceId: string): ClipboardEditAudioBuffer | undefined;
	}>;
	loadSourceBuffer?(sourceId: string): Promise<ClipboardEditAudioBuffer | null>;
	getProject(): ClipboardEditProject;
	editingBlocked(): boolean;
	getPositionFrames(): number;
	normalizeFrame(value: unknown): number;
	snapFrame(value: unknown): number;
	createId(prefix?: string): string;
	createEditSessionClipboard?(
		project: ClipboardEditProject,
		descriptor: AudioEditorClipboard,
	): ControllerEditSessionClipboardCarrier;
	prepareEditClipboardPasteCommand?(
		project: ClipboardEditProject,
		clipboard: ControllerEditSessionClipboardCarrier,
		command: CurrentAudioEditorMutationCommandV2,
		createId: (prefix?: string) => string,
	): unknown;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	setStatus(message: string, state?: string, localization?: import('../../../../i18n/presentation-message.ts').LocalizedPresentationMessage): void;
}

export interface ClipboardEditService {
	setSessionClipboard(descriptor: AudioEditorClipboard): AudioEditorClipboard;
	prepareSessionClipboard(descriptor: AudioEditorClipboard): () => AudioEditorClipboard;
	splitAtFrame(frame: unknown, trackIds?: string | readonly string[] | null): unknown;
	commitSplitAtFrames(frames: readonly unknown[], trackIds?: string | readonly string[] | null): unknown;
	prepareControllerPaste(mode: ClipboardPasteMode, atFrame?: number, pasteAsNewClip?: boolean): CurrentAudioEditorMutationCommandV2;
	disjoinSelectedClip(): Promise<void>;
	disjoinLabeledRegions(
		regions: readonly Readonly<{ startFrame: number; endFrame: number }>[],
		trackIds: readonly string[],
	): Promise<boolean>;
}

type SplitCommand = Extract<AudioEditorCommand, { readonly type: 'clip/split' }>;

export function createClipboardEditService(
	dependencies: ClipboardEditServiceDependencies,
): Readonly<ClipboardEditService> {
	let editSessionClipboard: ControllerEditSessionClipboardCarrier | null = null;
	return Object.freeze({
		setSessionClipboard,
		prepareSessionClipboard,
		splitAtFrame,
		commitSplitAtFrames,
		prepareControllerPaste,
		disjoinSelectedClip,
		disjoinLabeledRegions,
	});

	function setSessionClipboard(descriptor: AudioEditorClipboard): AudioEditorClipboard {
		return prepareClipboardPublication(descriptor, false)();
	}

	/** Capture sources before deletion, publishing the clipboard after successful admission. */
	function prepareSessionClipboard(descriptor: AudioEditorClipboard): () => AudioEditorClipboard {
		return prepareClipboardPublication(descriptor, true);
	}

	function prepareClipboardPublication(descriptor: AudioEditorClipboard, captureSources: boolean): () => AudioEditorClipboard {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const carrier: ControllerEditSessionClipboardCarrier = dependencies.createEditSessionClipboard?.(
			project,
			descriptor,
		) ?? Object.freeze({ descriptor });
		const sessionValue = carrier.sources === undefined ? (captureSources
			? (carrier.descriptor.schemaVersion === 7 ? createAudioEditorSessionClipboardV2 : createAudioEditorSessionClipboard)(project, { descriptor: carrier.descriptor }) : carrier.descriptor) : {
			schemaVersion: carrier.descriptor.schemaVersion === 7 ? 2 : 1,
			originProjectId: carrier.originProjectId ?? project.id,
			descriptor: carrier.descriptor,
			sources: carrier.sources,
		} as const;
		return () => {
			dependencies.lifetime.assertActive();
			const result = dependencies.session.setClipboard(
				sessionValue,
				{ originProjectId: project.id },
			);
			const returned = result.clipboard.descriptor;
			const schema = returned && typeof returned === 'object' ? Object.getOwnPropertyDescriptor(returned, 'schemaVersion') : undefined;
			if (schema && Object.hasOwn(schema, 'value') && schema.value === 7) normalizeAudioEditorClipboardDescriptorV7(returned);
			else normalizeAudioEditorClipboardDescriptor(returned);
			dependencies.state.clipboard = returned as AudioEditorClipboard;
			editSessionClipboard = carrier;
			return dependencies.state.clipboard;
		};
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
		const frames = [...new Set(requestedFrames.map((frame) => dependencies.normalizeFrame(frame)))].sort((left, right) => right - left);
		const commands: AudioEditorCommand[] = [];
		const handledLinks = new Set<string>();
		for (const clipId of targetClipIds) {
			const clip = findClip(project, clipId);
			if (!clip || (clip.avLinkId && handledLinks.has(clip.avLinkId))) continue;
			if (clip.avLinkId) handledLinks.add(clip.avLinkId);
			const handledFrames = new Set<number>();
			const clipEndFrame = clip.timelineStartFrame + clip.durationFrames;
			for (const frame of frames) {
				if (frame <= clip.timelineStartFrame || frame >= clipEndFrame) continue;
				const split = prepareLinkedSplit(project, clip.id, frame);
				if (handledFrames.has(split.atFrame)) continue;
				handledFrames.add(split.atFrame);
				commands.push(split);
			}
		}
		if (!commands.length) return null;
		const command: AudioEditorCommand = commands.length === 1 ? commands[0] : { type: 'batch', commands };
		return dependencies.commit(command);
	}

	function prepareControllerPaste(
		mode: ClipboardPasteMode,
		atFrame = dependencies.getPositionFrames(), pasteAsNewClip = true,
	): CurrentAudioEditorMutationCommandV2 {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const clipboard = dependencies.state.clipboard;
		if (!clipboard) throw new TypeError('An audio editor clipboard is required.');
		const sessionClipboard = dependencies.session.clipboardForProject(project.id);
		const preparedCarrier = editSessionClipboard && sameClipboardDescriptor(editSessionClipboard.descriptor, clipboard) && dependencies.prepareEditClipboardPasteCommand ? editSessionClipboard : null;
		const { commands, trackMap } = prepareClipboardPasteTrackPlan(project, dependencies.state.selectedTrackId,
			clipboard.tracks, sessionClipboard?.sources ?? [], preparedCarrier !== null, dependencies.createId, dependencies.copy);
		const paste = preparePaste(clipboard, project, atFrame, trackMap, mode, pasteAsNewClip);
		const pasteCommands: CurrentAudioEditorMutationCommandV2[] = [...commands, paste];
		const command: CurrentAudioEditorMutationCommandV2 = pasteCommands.length === 1 ? pasteCommands[0]! : { type: 'batch', commands: pasteCommands };
		if (!preparedCarrier || !dependencies.prepareEditClipboardPasteCommand) return command;
		return dependencies.prepareEditClipboardPasteCommand(
			project, preparedCarrier, command, dependencies.createId,
		) as CurrentAudioEditorMutationCommandV2;
	}

	/** Detach a drawn range or selected clips, reading streamed audio on demand. */
	async function disjoinSelectedClip(): Promise<void> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return;
		const project = dependencies.getProject();
		const authority = resolveEditingSelectionAuthority({
			project,
			focusedClipId: dependencies.state.selectedClipId,
			focusedTrackId: dependencies.state.selectedTrackId,
		});
		const clips = disjoinTargetClips(
			project,
			authority.range,
			authority.clipIds,
			authority.trackIds,
		);
		const commands: AudioEditorCommand[] = [];
		for (const clip of clips) {
			const buffer = dependencies.sourceBuffers.get(clip.sourceId)
				?? await dependencies.loadSourceBuffer?.(clip.sourceId);
			dependencies.lifetime.assertActive();
			const current = dependencies.getProject();
			if (current.id !== project.id || current.revision !== project.revision) return;
			if (!buffer) continue;
			commands.push(...detachCommandsForClip(clip, findClipSilenceRegions(clip, buffer, authority.range, project)));
		}
		if (!commands.length) {
			setLocalizedStatus(dependencies.setStatus, dependencies.copy, "noSilencesFound", undefined, 'info');
			return;
		}
		dependencies.commit({ type: 'batch', commands }, { selectClipId: clips[0]?.id ?? null });
	}

	/** The clips a detach scans: those a range touches, else the selected ones. */
	function disjoinTargetClips(
		project: ClipboardEditProject,
		region: Readonly<{ startFrame: number; endFrame: number }> | null,
		clipIds: readonly string[],
		trackIds: readonly string[],
	): readonly ClipboardEditClip[] {
		if (!region) {
			return clipIds
				.map((clipId) => findClip(project, clipId))
				.filter((clip): clip is ClipboardEditClip => clip !== null);
		}
		const requested = trackIds.length ? new Set(trackIds) : null;
		return project.tracks
			.filter(isMediaTrack)
			.filter((track) => !requested || requested.has(track.id))
			.flatMap((track) => track.clipIds)
			.map((clipId) => findClip(project, clipId))
			.filter((clip): clip is ClipboardEditClip => clip !== null
				&& clip.timelineStartFrame < region.endFrame
				&& clip.timelineStartFrame + clip.durationFrames > region.startFrame);
	}

	/** Detach at silences inside labelled regions using the same source reader. */
	async function disjoinLabeledRegions(
		regions: readonly Readonly<{ startFrame: number; endFrame: number }>[],
		trackIds: readonly string[],
	): Promise<boolean> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return false;
		const project = dependencies.getProject();
		const targetTrackIds = new Set(trackIds);
		const scanRegions = mergeEditingRanges(regions.filter(region => region.endFrame > region.startFrame));
		const commands: AudioEditorCommand[] = [];
		for (const track of project.tracks) {
			if (!targetTrackIds.has(track.id) || !Array.isArray((track as ClipboardEditMediaTrack).clipIds)) continue;
			for (const clipId of (track as ClipboardEditMediaTrack).clipIds) {
				const clip = findClip(project, clipId);
				const buffer = clip ? dependencies.sourceBuffers.get(clip.sourceId)
					?? await dependencies.loadSourceBuffer?.(clip.sourceId) : null;
				dependencies.lifetime.assertActive();
				const current = dependencies.getProject();
				if (current.id !== project.id || current.revision !== project.revision) return false;
				if (!clip || !buffer) continue;
				for (const region of [...scanRegions].reverse()) {
					commands.push(...detachCommandsForClip(clip, findClipSilenceRegions(clip, buffer, region, project)));
				}
			}
		}
		if (!commands.length) {
			setLocalizedStatus(dependencies.setStatus, dependencies.copy, (dependencies.copy.noSilencesInLabels ? "noSilencesInLabels" : "noSilencesFound"), undefined, 'info');
			return false;
		}
		dependencies.commit({ type: 'batch', commands });
		return true;
	}

	/** Split away each silent run of one clip, right to left, and drop it. */
	function detachCommandsForClip(
		clip: ClipboardEditClip,
		regions: readonly (readonly [number, number])[],
	): AudioEditorCommand[] {
		if (!regions.length) return [];
		const commands: AudioEditorCommand[] = [];
		if (clip.avLinkId) commands.push({ type: 'clip/unlink-av', clipId: clip.id });
		for (const [startFrame, endFrame] of [...regions].reverse()) {
			const after = prepareSplit(clip.id, endFrame);
			const silence = prepareSplit(clip.id, startFrame);
			commands.push(after, silence, ...(clip.groupId ? [{ type: 'clip/ungroup' as const, clipIds: [silence.rightClipId] }] : []), { type: 'clip/remove', clipId: silence.rightClipId });
		}
		return commands;
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
		const authority = resolveEditingSelectionAuthority({
			project,
			focusedClipId: dependencies.state.selectedClipId,
			focusedTrackId: dependencies.state.selectedTrackId,
		});
		if (authority.clipIds.length) return authority.clipIds;
		const trackIds = new Set(authority.trackIds);
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
		mode: ClipboardPasteMode, pasteAsNewClip: boolean,
	): Extract<CurrentAudioEditorMutationCommandV2, { readonly type: 'clipboard/paste' }> {
		if (clipboard.schemaVersion === 7) return preparePasteCommandV7(clipboard,
			{ project, atFrame, trackMap, mode, pasteAsNewClip }, dependencies.createId);
		return prepareLegacyPasteCommand(
			clipboard,
			{ project, atFrame, trackMap, mode, pasteAsNewClip },
			dependencies.createId,
		) as Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;
	}
}

function sameClipboardDescriptor(left: AudioEditorClipboard, right: AudioEditorClipboard): boolean {
	if (left === right) return true;
	try { return JSON.stringify(left) === JSON.stringify(right); }
	catch { return false; }
}

function findClip(project: ClipboardEditProject, clipId: string | null | undefined): ClipboardEditClip | null {
	return project.clips.find((clip) => clip.id === clipId) ?? null;
}
