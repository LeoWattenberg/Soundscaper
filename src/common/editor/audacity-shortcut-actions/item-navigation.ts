/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	audacityLongSeekFrame,
	audacitySelectionForAdjustment,
	audacityTimelinePixelFrames,
	audacityTimelineStepFrame,
} from '../audacity-action-runtime-helpers.ts';
import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type {
	ControllerClip,
	ControllerProject,
	ControllerTrack,
} from '../controller/track-domain-types.ts';

export type AudacityItemNavigationAction =
	| 'track-view-item-move-left'
	| 'track-view-item-move-right'
	| 'track-view-item-extend-left'
	| 'track-view-item-extend-right'
	| 'track-view-item-reduce-left'
	| 'track-view-item-reduce-right'
	| 'track-view-item-move-up'
	| 'track-view-item-move-down';

export interface AudacityFocusedLabel {
	readonly trackId: string;
	readonly labelId: string;
}

interface ItemNavigationSnapshot {
	readonly project?: ControllerProject | null;
	readonly selectedClipId?: string | null;
	readonly selectedTrackId?: string | null;
	readonly timeline?: Readonly<{ readonly pixelsPerSecond?: unknown }>;
}

interface ItemNavigationController {
	getSnapshot(): ItemNavigationSnapshot;
	getTelemetrySnapshot?(): Readonly<{
		readonly positionFrame?: unknown;
		readonly transportState?: unknown;
	}> | null;
	readonly actions: {
		readonly clip: {
			move(clipId: string, trackId: string, timelineStartFrame: number): unknown;
			trim(clipId: string, changes: Readonly<Record<string, number>>, options?: Readonly<{ minimumDurationFrames?: number }>): unknown;
		};
		readonly edit: {
			commit(command: AudioEditorCommand, selection?: Readonly<{ selectTrackId?: string | null }>): unknown;
		};
		readonly labels: {
			update(trackId: string, labelId: string, changes: Readonly<Record<string, number>>): unknown;
		};
		readonly timeline: {
			setSelection(startFrame: number, endFrame: number, details?: Readonly<Record<string, unknown>>): unknown;
		};
		readonly track: {
			moveUp(trackId: string): unknown;
			moveDown(trackId: string): unknown;
		};
		readonly transport: { seek(frame: number): unknown };
	};
}

interface LabelValue extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

interface FocusedLabelValue extends AudacityFocusedLabel {
	readonly label: LabelValue;
	readonly track: ControllerTrack;
}

const ACTIONS = new Set<AudacityItemNavigationAction>([
	'track-view-item-move-left', 'track-view-item-move-right',
	'track-view-item-extend-left', 'track-view-item-extend-right',
	'track-view-item-reduce-left', 'track-view-item-reduce-right',
	'track-view-item-move-up', 'track-view-item-move-down',
]);
const AUDACITY_MINIMUM_CLIP_WIDTH_PIXELS = 3;

/** Execute Audacity's contextual item command outside the startup graph. */
export function applyAudacityItemNavigationAction(
	actionId: string,
	controller: ItemNavigationController,
	focusedLabel: AudacityFocusedLabel | null = focusedTimelineLabel(),
): unknown {
	if (!ACTIONS.has(actionId as AudacityItemNavigationAction)) return null;
	const snapshot = controller.getSnapshot();
	const project = snapshot.project;
	if (!project) return null;
	const action = actionId as AudacityItemNavigationAction;
	const step = audacityTimelinePixelFrames(
		project.sampleRate, snapshot.timeline?.pixelsPerSecond, 10,
	);
	const label = resolveFocusedLabel(project, snapshot.selectedTrackId, focusedLabel);
	const clip = resolveInteractionClip(project, snapshot.selectedClipId);

	if (action.endsWith('move-left')) return label
		? moveLabel(controller, label, -step)
		: clip ? moveClip(controller, project, clip, -step, 0) : null;
	if (action.endsWith('move-right')) return label
		? moveLabel(controller, label, step)
		: clip ? moveClip(controller, project, clip, step, 0) : null;
	if (action.endsWith('move-up') || action.endsWith('move-down')) {
		const direction = action.endsWith('move-up') ? -1 : 1;
		if (label) return moveLabelTrack(controller, project, label, direction);
		if (clip) return moveClip(controller, project, clip, 0, direction);
		const track = project.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId);
		return track
			? direction < 0 ? controller.actions.track.moveUp(track.id) : controller.actions.track.moveDown(track.id)
			: null;
	}

	const telemetry = controller.getTelemetrySnapshot?.();
	if (action.startsWith('track-view-item-extend-') && telemetry?.transportState === 'playing') {
		const direction = action.endsWith('left') ? -1 : 1;
		return controller.actions.transport.seek(audacityLongSeekFrame(
			telemetry.positionFrame, project.sampleRate, direction,
		));
	}
	if (label) return resizeLabel(controller, label, action, step);
	const boundaryClip = clip || selectedInteractionClip(project);
	if (boundaryClip) return resizeClip(controller, project, boundaryClip, action, step);
	return adjustSelection(controller, project, action);
}

function resolveInteractionClip(
	project: ControllerProject,
	selectedClipId: string | null | undefined,
): ControllerClip | null {
	const focused = project.clips.find((clip) => clip.id === selectedClipId) ?? null;
	if (!focused) return null;
	const selectedIds = project.selection?.clipIds || [];
	if (!selectedIds.length || selectedIds.includes(focused.id)) return focused;
	return selectedInteractionClip(project) || focused;
}

function selectedInteractionClip(project: ControllerProject): ControllerClip | null {
	return project.selection?.clipIds
		?.map((id) => project.clips.find((clip) => clip.id === id))
		.find((clip): clip is ControllerClip => Boolean(clip)) ?? null;
}

function moveClip(
	controller: ItemNavigationController,
	project: ControllerProject,
	clip: ControllerClip,
	deltaFrames: number,
	trackDelta: number,
): unknown {
	const currentTrackIndex = project.tracks.findIndex((track) => track.clipIds?.includes(clip.id));
	const currentTrack = project.tracks[currentTrackIndex];
	if (!currentTrack || currentTrack.type === 'label') return null;
	let targetTrackIndex = currentTrackIndex;
	if (trackDelta) {
		const targetType = typeof clip.kind === 'string' ? clip.kind : currentTrack.type;
		do targetTrackIndex += Math.sign(trackDelta);
		while (project.tracks[targetTrackIndex] && project.tracks[targetTrackIndex]?.type !== targetType);
	}
	const targetTrack = project.tracks[targetTrackIndex];
	if (!targetTrack || targetTrack.type === 'label') return null;
	return controller.actions.clip.move(
		clip.id, targetTrack.id, Math.max(0, clip.timelineStartFrame + deltaFrames),
	);
}

function resizeClip(
	controller: ItemNavigationController,
	project: ControllerProject,
	clip: ControllerClip,
	action: AudacityItemNavigationAction,
	step: number,
): unknown {
	const source = project.sources.find((candidate) => candidate.id === clip.sourceId);
	if (!source) return null;
	const minimumDurationFrames = audacityTimelinePixelFrames(
		project.sampleRate,
		controller.getSnapshot().timeline?.pixelsPerSecond,
		AUDACITY_MINIMUM_CLIP_WIDTH_PIXELS,
	);
	const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
	const sourceFramesPerTimelineFrame = sourceDurationFrames / clip.durationFrames;
	const left = action === 'track-view-item-extend-left' || action === 'track-view-item-reduce-right';
	const requestedDelta = action.startsWith('track-view-item-extend-') ? step : -step;
	if (left) {
		const sourceExtension = clip.reversed
			? source.frameCount - clip.sourceStartFrame - sourceDurationFrames
			: clip.sourceStartFrame;
		const timelineExtension = Math.floor(sourceExtension / sourceFramesPerTimelineFrame);
		const delta = Math.max(
			-Math.min(clip.timelineStartFrame, timelineExtension),
			Math.min(Math.max(0, clip.durationFrames - minimumDurationFrames), -requestedDelta),
		);
		if (delta === 0) return null;
		return controller.actions.clip.trim(clip.id, {
			timelineStartFrame: clip.timelineStartFrame + delta,
			durationFrames: clip.durationFrames - delta,
		}, { minimumDurationFrames });
	}
	const sourceExtension = clip.reversed
		? clip.sourceStartFrame
		: source.frameCount - clip.sourceStartFrame - sourceDurationFrames;
	const maximumGrowth = Math.max(0, Math.floor(sourceExtension / sourceFramesPerTimelineFrame));
	const delta = Math.max(
		-Math.max(0, clip.durationFrames - minimumDurationFrames),
		Math.min(maximumGrowth, requestedDelta),
	);
	if (delta === 0) return null;
	return controller.actions.clip.trim(
		clip.id,
		{ durationFrames: clip.durationFrames + delta },
		{ minimumDurationFrames },
	);
}

function resolveFocusedLabel(
	project: ControllerProject,
	selectedTrackId: string | null | undefined,
	focus: AudacityFocusedLabel | null,
): FocusedLabelValue | null {
	if (!focus || focus.trackId !== selectedTrackId) return null;
	const track = project.tracks.find((candidate) => (
		candidate.id === focus.trackId && candidate.type === 'label'
	));
	const labels = track && Array.isArray(track.labels) ? track.labels : [];
	const label = labels.find((candidate): candidate is LabelValue => (
		isLabel(candidate) && candidate.id === focus.labelId
	));
	return track && label ? { ...focus, track, label } : null;
}

function moveLabel(
	controller: ItemNavigationController,
	focus: FocusedLabelValue,
	deltaFrames: number,
): unknown {
	const durationFrames = focus.label.endFrame - focus.label.startFrame;
	const startFrame = Math.max(0, focus.label.startFrame + deltaFrames);
	if (startFrame === focus.label.startFrame) return null;
	return controller.actions.labels.update(focus.trackId, focus.labelId, {
		startFrame, endFrame: startFrame + durationFrames,
	});
}

function resizeLabel(
	controller: ItemNavigationController,
	focus: FocusedLabelValue,
	action: AudacityItemNavigationAction,
	step: number,
): unknown {
	const { startFrame, endFrame } = focus.label;
	let changes: Readonly<Record<string, number>>;
	if (action === 'track-view-item-extend-left') changes = { startFrame: Math.max(0, startFrame - step) };
	else if (action === 'track-view-item-extend-right') changes = { endFrame: endFrame + step };
	else if (action === 'track-view-item-reduce-left') changes = { endFrame: Math.max(startFrame, endFrame - step) };
	else changes = { startFrame: Math.min(endFrame, startFrame + step) };
	if (Object.entries(changes).every(([key, value]) => focus.label[key] === value)) return null;
	return controller.actions.labels.update(focus.trackId, focus.labelId, changes);
}

function moveLabelTrack(
	controller: ItemNavigationController,
	project: ControllerProject,
	focus: FocusedLabelValue,
	direction: number,
): unknown {
	let targetIndex = project.tracks.findIndex((track) => track.id === focus.trackId);
	do targetIndex += Math.sign(direction);
	while (project.tracks[targetIndex] && project.tracks[targetIndex]?.type !== 'label');
	const target = project.tracks[targetIndex];
	if (!target) return null;
	return controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{ type: 'label/remove', trackId: focus.trackId, labelId: focus.labelId },
			{ type: 'label/add', trackId: target.id, label: focus.label as CommandObject },
		],
	}, { selectTrackId: target.id });
}

function adjustSelection(
	controller: ItemNavigationController,
	project: ControllerProject,
	action: AudacityItemNavigationAction,
): unknown {
	const telemetry = controller.getTelemetrySnapshot?.();
	const selection = audacitySelectionForAdjustment(project.selection, telemetry?.positionFrame);
	const left = action === 'track-view-item-extend-left' || action === 'track-view-item-reduce-right';
	const direction = action === 'track-view-item-extend-left' || action === 'track-view-item-reduce-left' ? -1 : 1;
	const boundary = left ? selection.startFrame : selection.endFrame;
	const target = audacityTimelineStepFrame(
		boundary, direction, project, controller.getSnapshot().timeline?.pixelsPerSecond,
	);
	return left
		? controller.actions.timeline.setSelection(Math.min(selection.endFrame, target), selection.endFrame, {})
		: controller.actions.timeline.setSelection(selection.startFrame, Math.max(selection.startFrame, target), {});
}

function focusedTimelineLabel(): AudacityFocusedLabel | null {
	const active = globalThis.document?.activeElement as Element | null | undefined;
	if (!active || typeof active.closest !== 'function') return null;
	const marker = active.closest<HTMLElement>('[data-label-id]');
	const row = marker?.closest<HTMLElement>('[data-label-track][data-track-id]');
	return marker?.dataset.labelId && row?.dataset.trackId
		? { labelId: marker.dataset.labelId, trackId: row.dataset.trackId }
		: null;
}

function isLabel(value: unknown): value is LabelValue {
	if (!value || typeof value !== 'object') return false;
	const label = value as Partial<LabelValue>;
	return typeof label.id === 'string'
		&& Number.isSafeInteger(label.startFrame)
		&& Number.isSafeInteger(label.endFrame);
}
