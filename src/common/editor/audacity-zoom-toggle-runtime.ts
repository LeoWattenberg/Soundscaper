/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveAudioEditorZoomToggle,
	type AudioEditorEditingPreferences,
	type AudioEditorZoomTogglePreset,
} from './editing-preferences.ts';
import { projectDurationFrames } from './project.js';
import { resolveSelectionRange } from './selection-range.ts';
import {
	AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND,
	AUDIO_EDITOR_MAX_PIXELS_PER_SECOND,
} from './timeline-zoom-limits.ts';

interface ZoomToggleProject extends Readonly<Record<string, unknown>> {
	readonly sampleRate?: number;
	readonly tracks?: readonly unknown[];
	readonly clips?: readonly unknown[];
}

interface ZoomToggleSnapshot {
	readonly project?: ZoomToggleProject | null;
	readonly preferences?: Readonly<{
		readonly editing?: Partial<AudioEditorEditingPreferences>;
	}>;
	readonly timeline?: Readonly<{
		readonly pixelsPerSecond?: number;
		readonly viewportWidth?: number;
	}>;
}

interface ZoomToggleResolution {
	readonly pixelsPerSecond: number;
	readonly preset: AudioEditorZoomTogglePreset;
	readonly sampleRate: number;
	readonly selection: Readonly<{ readonly startFrame: number; readonly endFrame: number }> | null;
}

interface ZoomToggleController {
	readonly actions: Readonly<{
		readonly timeline: Readonly<{
			setZoom(value: number, options: Readonly<{ allowBelowProjectFit: true }>): unknown;
		}>;
	}>;
	getSnapshot(): ZoomToggleSnapshot;
	getTelemetrySnapshot?(): Readonly<{ readonly positionFrame?: number }>;
}

interface ZoomToggleUi {
	issue(type: string, payload: Readonly<Record<string, unknown>>): unknown;
}

export function audacityZoomToggleResolution(
	snapshot: ZoomToggleSnapshot,
	selectedClipId: string | null,
): ZoomToggleResolution {
	const project = snapshot.project ?? null;
	const sampleRate = project?.sampleRate || 48_000;
	const selection = resolveSelectionRange(project, { selectedClipId });
	return {
		...resolveAudioEditorZoomToggle(snapshot.preferences?.editing, {
			currentPixelsPerSecond: snapshot.timeline?.pixelsPerSecond || AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND,
			sampleRate,
			projectDurationFrames: project ? projectDurationFrames(project) : 0,
			selection,
			viewportWidth: snapshot.timeline?.viewportWidth || 960,
			defaultPixelsPerSecond: AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND,
			maximumPixelsPerSecond: AUDIO_EDITOR_MAX_PIXELS_PER_SECOND,
		}),
		sampleRate,
		selection,
	};
}

/** Resolve the configured Audacity toggle against the live project geometry. */
export function audacityZoomToggleTarget(
	snapshot: ZoomToggleSnapshot,
	selectedClipId: string | null,
): number {
	return audacityZoomToggleResolution(snapshot, selectedClipId).pixelsPerSecond;
}

/** Apply the chosen preset and tell the browser how Audacity anchors its viewport. */
export function applyAudacityZoomToggle(
	controller: ZoomToggleController,
	ui: ZoomToggleUi,
	selectedClipId: string | null,
): unknown {
	const resolution = audacityZoomToggleResolution(controller.getSnapshot(), selectedClipId);
	const selection = resolution.selection;
	const mode = resolution.preset === 'fit-to-width' || resolution.preset === 'zoom-to-selection'
		? 'start'
		: 'center';
	const positionFrame = resolution.preset === 'fit-to-width'
		? 0
		: resolution.preset === 'zoom-to-selection' && selection
			? selection.startFrame
			: selection
				? selection.startFrame + (selection.endFrame - selection.startFrame) / 2
				: controller.getTelemetrySnapshot?.().positionFrame || 0;
	const applied = controller.actions.timeline.setZoom(
		resolution.pixelsPerSecond,
		{ allowBelowProjectFit: true },
	);
	const appliedPixelsPerSecond = typeof applied === 'number'
		&& Number.isFinite(applied)
		&& applied > 0
		? applied
		: resolution.pixelsPerSecond;
	ui.issue('focus-timeline-zoom', {
		mode,
		positionFrame,
		pixelsPerSecond: appliedPixelsPerSecond,
		sampleRate: resolution.sampleRate,
	});
	return applied;
}
