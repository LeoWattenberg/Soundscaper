/* SPDX-License-Identifier: AGPL-3.0-only */

import { stepAudioEditorSnappedFrame } from './snap-grid.js';

const AUDACITY_SHORT_SEEK_SECONDS = 1;
const AUDACITY_LONG_SEEK_SECONDS = 15;

interface AudacityCursorController {
	readonly actions: {
		readonly transport: { readonly seek: (frame: number) => unknown };
	};
	getTelemetrySnapshot?(): Readonly<{
		readonly positionFrame?: unknown;
		readonly transportState?: unknown;
	}> | null;
}

type AudacityProjectReader = () => Readonly<{ readonly sampleRate?: unknown }> | null | undefined;
type AudacitySelectionSetter = (startFrame: number, endFrame: number) => unknown;
type AudacityNudgeTarget = (frame: number, direction: number) => number;

export function audacitySelectionForAdjustment(
	selection: Readonly<{ readonly startFrame?: unknown; readonly endFrame?: unknown }> | null | undefined,
	positionFrame: unknown,
): Readonly<{ startFrame: number; endFrame: number }> {
	const startFrame = Number(selection?.startFrame) || 0;
	const endFrame = Number(selection?.endFrame) || 0;
	if (endFrame > startFrame) return { startFrame, endFrame };
	const position = Number(positionFrame);
	const cursorFrame = Number.isFinite(position) ? Math.max(0, position) : Math.max(0, startFrame);
	return { startFrame: cursorFrame, endFrame: cursorFrame };
}

function audacitySeekFrame(
	positionFrame: unknown,
	sampleRate: unknown,
	direction: number,
	seconds: number,
): number {
	const position = Number(positionFrame) || 0;
	const rate = Number(sampleRate) || 48_000;
	return Math.max(0, position + direction * Math.round(rate * seconds));
}

export function audacityShortSeekFrame(positionFrame: unknown, sampleRate: unknown, direction: number): number {
	return audacitySeekFrame(positionFrame, sampleRate, direction, AUDACITY_SHORT_SEEK_SECONDS);
}

export function audacityLongSeekFrame(positionFrame: unknown, sampleRate: unknown, direction: number): number {
	return audacitySeekFrame(positionFrame, sampleRate, direction, AUDACITY_LONG_SEEK_SECONDS);
}

/** Convert Audacity's zoom-relative pixel steps to project frames. */
export function audacityTimelinePixelFrames(sampleRate: unknown, pixelsPerSecond: unknown, pixels = 1): number {
	const rate = Number(sampleRate) || 48_000;
	const zoom = Number(pixelsPerSecond) || 120;
	return Math.max(1, Math.round(rate * pixels / zoom));
}

export function audacityTimelineStepFrame(
	positionFrame: unknown,
	direction: number,
	project: Readonly<{
		sampleRate?: unknown;
		snap?: Readonly<{ enabled?: unknown; readonly [key: string]: unknown }>;
		readonly [key: string]: unknown;
	}> | null | undefined,
	pixelsPerSecond: unknown,
): number {
	const frame = Math.max(0, Math.round(Number(positionFrame) || 0));
	if (project?.snap?.enabled) return stepAudioEditorSnappedFrame(frame, direction, project.snap, project);
	return Math.max(0, frame + Math.sign(direction) * audacityTimelinePixelFrames(project?.sampleRate, pixelsPerSecond));
}

export function createAudacityCursorActionRuntime(
	controller: AudacityCursorController,
	project: AudacityProjectReader,
	setSelection: AudacitySelectionSetter,
	nudgeTarget: AudacityNudgeTarget,
) {
	function move(direction: number, seconds: number | null) {
		const telemetry = controller.getTelemetrySnapshot?.();
		const target = seconds === null
			? nudgeTarget(Number(telemetry?.positionFrame) || 0, direction)
			: audacitySeekFrame(telemetry?.positionFrame, project()?.sampleRate, direction, seconds);
		const result = controller.actions.transport.seek(target);
		if (telemetry?.transportState !== 'playing') setSelection(target, target);
		return result;
	}
	function nudge(direction: number) {
		return move(direction, controller.getTelemetrySnapshot?.()?.transportState === 'playing'
			? AUDACITY_SHORT_SEEK_SECONDS : null);
	}
	return Object.freeze({
		cursorShortJumpLeft: () => move(-1, AUDACITY_SHORT_SEEK_SECONDS),
		cursorShortJumpRight: () => move(1, AUDACITY_SHORT_SEEK_SECONDS),
		cursorLongJumpLeft: () => move(-1, AUDACITY_LONG_SEEK_SECONDS),
		cursorLongJumpRight: () => move(1, AUDACITY_LONG_SEEK_SECONDS),
		nudgePlayheadLeft: () => nudge(-1),
		nudgePlayheadRight: () => nudge(1),
	});
}

export function freezeAudacityActionTree<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) freezeAudacityActionTree(child);
	return Object.freeze(value);
}
