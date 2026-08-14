/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import type {
	AutomationPlaybackOwnerV21,
	AutomationWriteModeV21,
	AutomationWritePhaseV21,
} from '../common/editor/automation-write-mode-v21.ts';
import type { ParameterDescriptor } from '../common/editor/parameter-address.ts';
import type { HoldTempoMap } from '../common/editor/timeline-time.ts';

export interface SoundscaperAutomationAuthorityV21 {
	readonly projectId: string | null;
	readonly projectRevision: number | null;
	readonly readOnly: boolean;
	readonly lockReadOnly: boolean;
	readonly transportState: string;
	readonly positionFrame: number;
	readonly sampleRate: number;
	readonly tempoMap?: HoldTempoMap;
}

export interface SoundscaperAutomationTargetV21 {
	readonly lane: AutomationLaneV21;
	readonly descriptor: ParameterDescriptor;
	readonly controlValue: number;
	readonly locked: boolean;
}

export interface SoundscaperAutomationLaneSetCommandV21 {
	readonly type: 'automation-lane/set';
	readonly laneId: string;
	readonly expected: Readonly<Record<string, unknown>>;
	readonly lane: Readonly<Record<string, unknown>>;
}

export interface SoundscaperAutomationPreviewV21 {
	readonly laneId: string;
	readonly mode: AutomationWriteModeV21;
	readonly phase: AutomationWritePhaseV21;
	readonly owner: AutomationPlaybackOwnerV21;
	readonly capture: boolean;
	readonly frame: number;
	readonly value: number;
}

export interface SoundscaperAutomationGestureTokenV21 {
	readonly type: 'soundscaper-automation-gesture-v21';
	readonly laneId: string;
	readonly generation: number;
}

export interface SoundscaperAutomationGestureReleaseV21<Result> {
	readonly owner: AutomationPlaybackOwnerV21;
	readonly committed: boolean;
	readonly result: Result | null;
}

export interface SoundscaperAutomationSessionSnapshotV21 {
	readonly mode: AutomationWriteModeV21;
	readonly laneId: string | null;
	readonly active: boolean;
	readonly gestureActive: boolean;
	readonly generation: number;
	readonly owner: AutomationPlaybackOwnerV21;
	readonly capturePointCount: number;
}

export interface SoundscaperAutomationSessionPortsV21<Result> {
	readonly captureAuthority: () => SoundscaperAutomationAuthorityV21;
	readonly resolveTarget: (laneId: string) => SoundscaperAutomationTargetV21 | null;
	readonly commit: (command: SoundscaperAutomationLaneSetCommandV21) => Result;
	readonly preview?: (preview: SoundscaperAutomationPreviewV21) => void;
	readonly restoreReadback?: (lane: AutomationLaneV21) => void;
}

export interface SoundscaperAutomationSessionV21<Result> {
	getSnapshot(): SoundscaperAutomationSessionSnapshotV21;
	setMode(mode: AutomationWriteModeV21, laneId?: string | null): SoundscaperAutomationSessionSnapshotV21;
	beginGesture(laneId?: string | null, controlValue?: number): SoundscaperAutomationGestureTokenV21;
	previewGesture(
		token: SoundscaperAutomationGestureTokenV21,
		controlValue: number,
		frame?: number,
	): SoundscaperAutomationPreviewV21;
	releaseGesture(
		token: SoundscaperAutomationGestureTokenV21,
		controlValue?: number,
		frame?: number,
	): SoundscaperAutomationGestureReleaseV21<Result>;
	cancelGesture(token?: SoundscaperAutomationGestureTokenV21): boolean;
	synchronize(): Result | null;
	resetProject(): void;
	dispose(): void;
}
