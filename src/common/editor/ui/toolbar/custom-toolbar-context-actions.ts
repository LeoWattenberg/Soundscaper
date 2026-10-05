/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveAudacityActionSelectionFacts } from '../../audacity-action-enablement.ts';
import { AUDACITY_CLIP_CONTEXT_ACTION_IDS, AUDACITY_TRACK_CONTEXT_ACTION_IDS } from '../../audacity-context-menu.js';
import type { EditingAuthorityClip, EditingAuthorityProject, EditingAuthoritySelection, EditingAuthorityTrack } from '../../commands/editing-selection-authority.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import { AUDIO_EDITOR_TRACK_COLORS } from '../../project-audio-factory.js';
import { resolveTrackWaveformOptions } from '../../track-display-mode.ts';
import { createClipDragMenuItems } from '../timeline/clip-drag-menu-model.ts';
import { createTrackSelectionContextMenuItems, type TrackSelectionContextActions } from '../timeline/track-selection-context-menu.ts';
import type { CustomToolbarButtonMenuItem } from './custom-toolbar-button-actions.ts';

export const CUSTOM_TOOLBAR_AUDIO_CONTEXT_ACTION_IDS = Object.freeze([
	'track-make-stereo', 'track-swap-channels', 'track-split-stereo-to-lr', 'track-split-stereo-to-center',
	'local://reverse-clip', 'local://normalize-clip-peak', 'clip-render-pitch-speed', 'clip-reset-pitch-speed',
	'stretch-clip-to-match-tempo',
] as const);

interface ContextTrack extends EditingAuthorityTrack {
	readonly name: string;
	readonly type: string;
	readonly locked?: boolean;
	readonly displayMode?: string;
	readonly halfWave?: boolean;
	readonly showRms?: boolean;
}

interface ContextClip extends EditingAuthorityClip {
	readonly kind: string;
	readonly sourceId?: string;
	readonly speedRatio?: number;
	readonly linkPitchAndTempo?: boolean;
}

interface ContextProject extends EditingAuthorityProject {
	readonly tracks: readonly ContextTrack[];
	readonly clips: readonly ContextClip[];
	readonly sources?: readonly Readonly<{ id: string; channelCount?: number }>[];
}

export interface CustomToolbarContextSnapshot extends AudioEditorEditBlockingSnapshot {
	readonly project?: ContextProject | null;
	readonly selectedTrackId?: string | null;
	readonly selectedClipId?: string | null;
	readonly selection?: EditingAuthoritySelection | null;
	readonly timeline?: Readonly<{ view?: string; showRms?: boolean }>;
	readonly preferences?: Readonly<{ waveformDisplay?: Readonly<{ halfWave?: boolean }> }>;
}

interface ClipContextActions {
	readonly update?: (id: string, changes: Readonly<{ color: string }>) => unknown;
	readonly reverse?: (id: string) => unknown;
	readonly normalizePeak?: (id: string) => unknown;
	readonly renderPitchSpeed?: (id: string) => unknown;
	readonly resetPitchSpeed?: (id: string) => unknown;
	readonly toggleStretchToTempo?: (id: string) => unknown;
	readonly move?: (id: string, trackId: string, frame: number, options: Readonly<{ preserveTime: true }>) => unknown;
}

export interface CustomToolbarContextInput {
	readonly controller?: Readonly<{ actions?: Readonly<{
		track?: TrackSelectionContextActions;
		clip?: ClipContextActions;
		timeline?: Readonly<{ selectClip?: (id: string, options?: Readonly<{ additive: boolean }>) => unknown }>;
		trackFolders?: Readonly<{ wrapSelection?: (trackIds: readonly string[]) => unknown }>;
	}> }>;
	readonly snapshot: CustomToolbarContextSnapshot;
	readonly copy: Readonly<Record<string, string>>;
	readonly productId: string;
	readonly capabilities: Readonly<{ audioEffects?: boolean; trackFolders?: boolean }>;
	readonly blocked?: boolean;
}

/** Context-menu commands bound to the current persisted selection or focus. */
export function createCustomToolbarContextMenus(input: CustomToolbarContextInput): readonly CustomToolbarButtonMenuItem[] {
	const { snapshot, copy, productId, capabilities } = input;
	const project = snapshot.project ?? null;
	const facts = resolveAudacityActionSelectionFacts(snapshot as unknown as Parameters<typeof resolveAudacityActionSelectionFacts>[0]);
	const track = project?.tracks.find((candidate) => candidate.id === facts.selectedTrack?.id) ?? null;
	// A time range is the editing authority; retained clip focus must not turn
	// a range on another track into a whole-clip command on the old focus.
	const clip = facts.timeSelection ? null : project?.clips.find((candidate) => candidate.id === facts.selectedClip?.id) ?? null;
	const clipTrack = clip ? project?.tracks.find((candidate) => candidate.clipIds?.includes(clip.id)) ?? null : null;
	const actions = input.controller?.actions ?? {};
	const blocked = input.blocked === true || selectAudioEditorEditBlock(snapshot).blocked;
	const audioEffects = productId !== 'framescaper' && capabilities.audioEffects !== false;
	const trackItems = createTrackSelectionContextMenuItems({
		project, track, copy, blocked, audioEffects, actions: actions.track,
	});
	const item = (id: string, label: string, disabled: boolean, onClick: () => unknown): CustomToolbarButtonMenuItem => ({
		id, label, disabled: blocked || disabled, onClick,
	});
	const clipItem = (id: string, label: string, unavailable: boolean, operation?: (id: string) => unknown) => item(
		id, label, !clip || clip.kind !== 'audio' || clipTrack?.type !== 'audio' || unavailable || !operation,
		() => clip ? operation?.(clip.id) : undefined,
	);
	const colorName = (color: string) => copy[`color${color[0]!.toUpperCase()}${color.slice(1)}`] || color;
	const trackColors = AUDIO_EDITOR_TRACK_COLORS.map((color: string, index: number) => item(
		AUDACITY_TRACK_CONTEXT_ACTION_IDS.changeColor.replace('%1', String(index)), colorName(color),
		!track || track.type !== 'audio' || !actions.track?.update,
		() => track ? actions.track?.update?.(track.id, { color }) : undefined,
	));
	const clipColors = AUDIO_EDITOR_TRACK_COLORS.map((color: string, index: number) => item(
		AUDACITY_CLIP_CONTEXT_ACTION_IDS.changeColor.replace('%1', String(index)), colorName(color),
		!clip || !actions.clip?.update,
		() => clip ? actions.clip?.update?.(clip.id, { color }) : undefined,
	));
	const waveform = resolveTrackWaveformOptions(track, snapshot.timeline?.view,
		Boolean(snapshot.timeline?.showRms), snapshot.preferences?.waveformDisplay?.halfWave);
	const contextTrackItems: CustomToolbarButtonMenuItem[] = [
		...trackItems.shared, ...trackItems.audio,
		item('track-half-wave', copy.halfWave, !track || track.type !== 'audio'
			|| waveform.displayMode === 'spectrogram' || !actions.track?.update,
		() => track ? actions.track?.update?.(track.id, { halfWave: !waveform.halfWave }) : undefined),
		item('track-show-rms', copy.showRms, !track || track.type !== 'audio'
			|| waveform.displayMode === 'spectrogram' || !actions.track?.update,
		() => track ? actions.track?.update?.(track.id, { showRms: !waveform.showRms }) : undefined),
		{ id: 'custom-track-colors', label: copy.trackColor, items: trackColors },
	];
	if (capabilities.trackFolders) {
		contextTrackItems.push(item('track-wrap-in-folder', copy.wrapTracksInFolder,
			!track || !actions.trackFolders?.wrapSelection,
			() => track ? actions.trackFolders?.wrapSelection?.(facts.selectedTrackIds) : undefined));
	}
	const selectedTrackClips = item('clip-select-track-clips', copy.selectTrackClips,
		!clip || !clipTrack || !actions.timeline?.selectClip, () => {
			for (const [index, clipId] of (clipTrack?.clipIds ?? []).entries()) {
				actions.timeline?.selectClip?.(clipId, { additive: index > 0 });
			}
		});
	const clipDragItems = project && clip ? createClipDragMenuItems({
		project, clipId: clip.id, blocked, copy: { selectTrackClips: copy.selectTrackClips, moveClipPreserveTime: copy.moveClipPreserveTime },
		select: () => selectedTrackClips.onClick?.(),
		move: (clipId, trackId) => actions.clip?.move?.(clipId, trackId, clip.timelineStartFrame ?? 0, { preserveTime: true }),
	}) : [];
	const moveItems = clipDragItems[1]?.items?.map((menuItem) => ({
		...menuItem,
		disabled: menuItem.disabled || !actions.clip?.move,
	})) ?? [];
	const transformed = Number(clip?.pitchCents ?? 0) !== 0 || (clip?.speedRatio ?? 1) !== 1;
	const renderable = (clip?.speedRatio ?? 1) !== 1 || (!clip?.linkPitchAndTempo && Number(clip?.pitchCents ?? 0) !== 0);
	return [
		{ id: 'custom-current-track', label: copy.tracksMenu, items: contextTrackItems },
		{ id: 'custom-current-clip', label: copy.clipPropertiesCommand, items: [
			...(audioEffects ? [
				clipItem(AUDACITY_CLIP_CONTEXT_ACTION_IDS.reverse, copy.reverse, false, actions.clip?.reverse),
				clipItem(AUDACITY_CLIP_CONTEXT_ACTION_IDS.normalizePeak, copy.normalizePeak, false, actions.clip?.normalizePeak),
				clipItem(AUDACITY_CLIP_CONTEXT_ACTION_IDS.renderPitchSpeed, copy.renderPitchSpeed, !renderable, actions.clip?.renderPitchSpeed),
				clipItem(AUDACITY_CLIP_CONTEXT_ACTION_IDS.resetPitchSpeed, copy.resetPitchSpeed, !transformed, actions.clip?.resetPitchSpeed),
				clipItem(AUDACITY_CLIP_CONTEXT_ACTION_IDS.stretchToTempo, copy.stretchToTempo, false, actions.clip?.toggleStretchToTempo),
			] : []),
			{ id: 'custom-clip-colors', label: copy.clipColor, items: clipColors },
			selectedTrackClips,
			{ id: 'custom-clip-move-preserve-time', label: copy.moveClipPreserveTime, items: moveItems },
		] },
	];
}
