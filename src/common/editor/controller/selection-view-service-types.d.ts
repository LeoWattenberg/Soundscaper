/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type { RenderedAudio } from '../rendered-audio-channels.ts';
import type { SelectionRange } from '../selection-range.ts';
import type {
	ClipSelectionNavigationClip,
	ClipSelectionNavigationProject,
	ClipSelectionNavigationSelection,
	ClipSelectionNavigationState,
	ClipSelectionNavigationTrack,
} from './clip-selection-navigation-service.ts';

export type SelectionViewSelectionCommand = Extract<AudioEditorCommand, { readonly type: 'selection/set' }>;
export type SelectionViewSnapCommand = Extract<AudioEditorCommand, { readonly type: 'snap/set' }>;
export type SelectionViewCommand = SelectionViewSelectionCommand | SelectionViewSnapCommand;
export type SelectionViewSelection = ClipSelectionNavigationSelection;

export interface SelectionViewLabel {
	readonly startFrame?: number;
	readonly endFrame?: number;
}

export interface SelectionViewTrack extends ClipSelectionNavigationTrack {
	readonly labels?: readonly SelectionViewLabel[];
}

export type SelectionViewClip = ClipSelectionNavigationClip;

export interface SelectionViewProject extends ClipSelectionNavigationProject {
	readonly id: string;
	readonly schemaVersion: number;
	readonly clips: readonly SelectionViewClip[];
	readonly tracks: readonly SelectionViewTrack[];
	readonly selection: SelectionViewSelection;
	readonly snap?: CommandObject;
}

export interface SelectionViewState extends ClipSelectionNavigationState {
	analysisProcessing: boolean;
	showRms: boolean;
	showVerticalRulers: boolean;
	updateDisplayWhilePlaying: boolean;
	pinnedPlayhead: boolean;
	playbackOnRulerClick: boolean;
	timelineViewportWidth: number;
	pixelsPerSecond: number;
}

export interface SelectionViewCopy {
	readonly audioTrackNotFound: string;
	readonly audioClipNotFound: string;
	readonly selectionFramesFinite: string;
	readonly timelineFramesFinite: string;
	readonly v2Required: string;
	readonly zeroCrossingsAligned: string;
}

export interface SelectionViewEngine {
	getPositionFrames(): number;
	getState(): Readonly<{ readonly state: string }>;
	seek(frame: number): number | void;
}

export interface SelectionViewRenderRange {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly includeTail: false;
	readonly outputFrames: number;
}

export interface SelectionViewZeroCrossingOptions {
	readonly maximumDistance: number;
}

export interface SelectionViewSnapOverrides {
	readonly force?: boolean;
	readonly maximumFrame?: number;
	readonly minimumFrame?: number;
	readonly mode?: string;
	readonly triplets?: boolean;
}

export interface SelectionViewClipOptions {
	readonly additive?: boolean;
	readonly toggle?: boolean;
}

export type SelectionViewSelectionDetails = Omit<
	SelectionViewSelectionCommand,
	'type' | 'startFrame' | 'endFrame'
>;

export interface SelectionViewServiceRuntime<
	Project extends SelectionViewProject = SelectionViewProject,
	Rendered extends RenderedAudio = RenderedAudio,
> {
	readonly DEFAULT_PIXELS_PER_SECOND: number;
	readonly MAX_PIXELS_PER_SECOND: number;
	readonly activeSelection: () => Pick<SelectionRange, 'startFrame' | 'endFrame'> | null;
	readonly audioBufferChannels: (buffer: Rendered) => Float32Array[];
	readonly cloneProject: (project: Project) => Project;
	readonly collectRelatedClipIds: (project: Project, clipIds: readonly string[]) => readonly string[];
	readonly commit: (command: SelectionViewCommand) => Project;
	readonly copy: SelectionViewCopy;
	readonly editorTimelineDurationFrames: (project: Project, sampleRate: number) => number;
	readonly engine: SelectionViewEngine;
	readonly findClip: (project: Project, clipId: string) => SelectionViewClip | null | undefined;
	readonly findClipTrack: (project: Project, clipId: string) => SelectionViewTrack | null | undefined;
	readonly findNearestAudioZeroCrossing: (
		channels: readonly Float32Array[], frame: number, options: SelectionViewZeroCrossingOptions,
	) => number;
	readonly findTrack: (project: Project, trackId: string) => SelectionViewTrack | null | undefined;
	readonly getProject: () => Project | null;
	readonly handleError: (error: unknown) => void;
	readonly normalizeTimelineFrame: (value: unknown) => number;
	readonly persistSetting: (key: string, value: boolean) => PromiseLike<unknown> | unknown;
	readonly productSettingKey: (name: string) => string;
	readonly projectDurationFrames: (project: Project) => number;
	readonly projectSampleRate: () => number;
	readonly publishDocumentSnapshot: () => void;
	readonly publishProjectState: () => void;
	readonly renderSnapshot: (project: Project, range: SelectionViewRenderRange) => PromiseLike<Rendered> | Rendered;
	readonly resetRoutedInputMeter: () => void;
	readonly setStatus: (message: string, state?: string) => void;
	readonly snapAudioEditorFrameWithProject: (
		frame: number, project: Project, overrides: SelectionViewSnapOverrides,
	) => number;
	readonly state: SelectionViewState;
	readonly synchronizeAutomaticSampleEditMode: () => void;
	readonly synchronizeMicrophoneMeterTarget: () => void;
	readonly updatePlayhead: (frame: number) => unknown;
	readonly updateSelection: (command: SelectionViewSelectionCommand) => Project;
}
