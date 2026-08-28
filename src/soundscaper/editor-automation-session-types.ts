/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import type {
	AutomationPlaybackOwnerV21,
	AutomationWriteModeV21,
	AutomationWritePhaseV21,
} from '../common/editor/automation-write-mode-v21.ts';
import type { ParameterDescriptor } from '../common/editor/parameter-address.ts';
import type { HoldTempoMap } from '../common/editor/timeline-time.ts';

export interface SoundscaperAutomationAuthority {
	readonly projectId: string | null;
	readonly projectRevision: number | null;
	readonly readOnly: boolean;
	readonly lockReadOnly: boolean;
	readonly transportState: string;
	readonly positionFrame: number;
	readonly sampleRate: number;
	readonly tempoMap?: HoldTempoMap;
}

export interface SoundscaperAutomationTarget {
	readonly lane: AutomationLaneV21;
	readonly descriptor: ParameterDescriptor;
	readonly controlValue: number;
	readonly locked: boolean;
}

export interface SoundscaperAutomationLaneSetCommand {
	readonly type: 'automation-lane/set';
	readonly laneId: string;
	readonly expected: Readonly<Record<string, unknown>>;
	readonly lane: Readonly<Record<string, unknown>>;
}

export interface SoundscaperAutomationPreview {
	readonly laneId: string;
	readonly mode: AutomationWriteModeV21;
	readonly phase: AutomationWritePhaseV21;
	readonly owner: AutomationPlaybackOwnerV21;
	readonly capture: boolean;
	readonly frame: number;
	readonly value: number;
}

export interface SoundscaperAutomationGestureToken {
	readonly type: 'soundscaper-automation-gesture-v21';
	readonly laneId: string;
	readonly generation: number;
}

export interface SoundscaperAutomationGestureRelease<Result> {
	readonly owner: AutomationPlaybackOwnerV21;
	readonly committed: boolean;
	readonly result: Result | null;
}

export interface SoundscaperAutomationSessionSnapshot {
	readonly mode: AutomationWriteModeV21;
	readonly laneId: string | null;
	readonly active: boolean;
	readonly gestureActive: boolean;
	readonly generation: number;
	readonly owner: AutomationPlaybackOwnerV21;
	readonly capturePointCount: number;
}

export interface SoundscaperAutomationSessionPorts<Result> {
	readonly captureAuthority: () => SoundscaperAutomationAuthority;
	readonly resolveTarget: (laneId: string) => SoundscaperAutomationTarget | null;
	readonly commit: (command: SoundscaperAutomationLaneSetCommand) => Result;
	readonly preview?: (preview: SoundscaperAutomationPreview) => void;
	readonly restoreReadback?: (lane: AutomationLaneV21) => void;
}

export interface SoundscaperAutomationSession<Result> {
	getSnapshot(): SoundscaperAutomationSessionSnapshot;
	setMode(mode: AutomationWriteModeV21, laneId?: string | null): SoundscaperAutomationSessionSnapshot;
	beginGesture(laneId?: string | null, controlValue?: number): SoundscaperAutomationGestureToken;
	previewGesture(
		token: SoundscaperAutomationGestureToken,
		controlValue: number,
		frame?: number,
	): SoundscaperAutomationPreview;
	releaseGesture(
		token: SoundscaperAutomationGestureToken,
		controlValue?: number,
		frame?: number,
	): SoundscaperAutomationGestureRelease<Result>;
	cancelGesture(token?: SoundscaperAutomationGestureToken): boolean;
	synchronize(): Result | null;
	resetProject(): void;
	dispose(): void;
}
