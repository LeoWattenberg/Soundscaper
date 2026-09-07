/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MacroTransactionMetadata } from './macro-transaction-metadata.ts';

import type { EnginePublicApi } from '../engine/public-api.ts';
import type { EditorCommandCapabilities } from './command-capability-policy.ts';
import type { EditorControllerLifetime, EditorProjectGeneration } from './lifecycle.ts';
import type {
	EditorCommandMoment,
	MutationProject,
	ProjectMutationState,
} from './project-mutation-service.ts';
import type {
	ProjectRetentionServiceDependencies,
	ProjectRetentionState,
	RetentionProject,
} from './project-retention-service.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { ControllerProjectRuntime, ControllerRuntimeHistory, ControllerRuntimeProject } from './project-runtime.ts';
import type {
	ProjectSaveServiceDependencies,
	ProjectSaveSnapshot,
	ProjectSaveStatus,
	ProjectSnapshotPreparationPurpose,
} from './project-save-service.ts';
import type { ProjectSessionTab } from './project-session-service.ts';
import type {
	ProjectSessionSelectionProject,
	ProjectSessionSelectionState,
} from './project-session-selection-service.ts';
import type { ProjectViewProject, ProjectViewState } from './project-view-service.ts';
import type { createRegularIntervalAnnotationController } from './regular-interval-annotation-controller.ts';
import type { SourceRuntimeComposition, SourceRuntimeProject } from './source-runtime-composition.ts';
import type { TimelineAnnotationControllerState } from './timeline-annotation-service.ts';
import type { TrackDuplicationProject } from './track-duplication-service.ts';
import type { RecordingRouting } from './track-service.ts';

/** One document shape that satisfies every persistence and mutation service's constraint. */
export type DocumentProject =
	& ControllerRuntimeProject
	& SourceRuntimeProject
	& MutationProject
	& RetentionProject
	& ProjectSaveSnapshot
	& ProjectSessionSelectionProject
	& ProjectViewProject
	& TrackDuplicationProject
	& ReturnType<Parameters<typeof createRegularIntervalAnnotationController>[0]['getProject']>;

/** The product runtime's history, as the mutation and retention services read it. */
export type DocumentHistory = ControllerRuntimeHistory<DocumentProject>;

/** A session tab as the session controller keeps it; the persistence services read its dirty flag and history. */
export type DocumentSessionTab = ProjectSessionTab & {
	readonly dirty: boolean;
	readonly readOnly: boolean;
	readonly history: DocumentHistory;
};

/** What the session controller does for the document: tabs, metadata, saved marks and source reference counts. */
export interface DocumentSessionPort {
	getSnapshot(): Readonly<{ readonly tabs: readonly DocumentSessionTab[] }>;
	updateProjectMetadata(projectId: string, metadata: Record<string, unknown>): unknown;
	updateProjectHistory(projectId: string, history: DocumentHistory, options: Readonly<{ dirty: boolean }>): unknown;
	markProjectSaved(projectId: string): unknown;
	getSourceReferenceCounts(): Readonly<Record<string, number>>;
}

export type DocumentCompositionState =
	& ProjectMutationState<DocumentProject, DocumentHistory, RecordingRouting>
	& ProjectRetentionState<DocumentHistory>
	& ProjectViewState
	& ProjectSessionSelectionState
	& TimelineAnnotationControllerState
	& {
		recentProjectIds: string[];
		saveState: ProjectSaveStatus;
	};

export type DocumentCompositionCopy = Readonly<{
	readonly projectReadOnly: string;
	readonly projectCopySuffix: string;
}>;

export type DocumentCompositionStore = Readonly<{
	loadSetting(key: string, fallback: unknown): Promise<unknown>;
	saveProject: ProjectSaveServiceDependencies<DocumentProject>['saveProject'];
}>;

export interface DocumentCompositionDependencies {
	readonly state: DocumentCompositionState;
	readonly copy: DocumentCompositionCopy;
	readonly lifetime: EditorControllerLifetime;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	/** The product runtime's document and history operations; each keeps the shape of what it is given, which every consumer assumes. */
	readonly projectRuntime: Readonly<{
		readonly cloneProject: <Project>(project: Project) => Project;
		readonly applyCommand: <Project>(project: Project, command: AudioEditorCommand) => Project;
		readonly executeCommand: <History>(history: History, command: unknown, options?: EditorCommandMoment) => History;
		readonly collapseHistory?: <History>(history: History, depth: number, command: MacroTransactionMetadata) => History;
		readonly rollbackHistory?: <History>(history: History, depth: number) => History;
		readonly prepareTrackDuplicateCarrier: ControllerProjectRuntime['prepareTrackDuplicateCarrier'];
	}>;
	readonly product: Readonly<{ readonly id: string; readonly name: string }>;
	readonly capabilities: EditorCommandCapabilities;
	readonly session: DocumentSessionPort;
	readonly store: DocumentCompositionStore;
	readonly engine: Pick<EnginePublicApi, 'getPositionFrames' | 'getState' | 'seek'>;
	readonly sourceBuffers: ReadonlyMap<string, unknown>;
	readonly sourcePeaks: ReadonlyMap<string, unknown>;
	/** The render cache that pins clip renders, and the bin's staged sources retention must keep. */
	readonly timePitchCache: ProjectRetentionServiceDependencies<DocumentProject, DocumentHistory>['clipCache'];
	readonly protectedSourceIds: Iterable<string>;
	readonly maximumPixelsPerSecond: number;
	readonly settingKeys: Readonly<{ readonly recentProjects: string; readonly lastProject: string }>;
	readonly scheduleTimer: (callback: () => void, delayMs: number) => number;
	readonly clearTimer: (handle: number) => void;
	/** The product's own snapshot preparation, run before a save leaves the editor. */
	readonly prepareProjectSnapshot?: (
		purpose: ProjectSnapshotPreparationPurpose,
		snapshot: DocumentProject,
	) => PromiseLike<unknown> | unknown;
	readonly sources: Pick<SourceRuntimeComposition, 'projectVisual' | 'timePitchCaches' | 'playbackApply' | 'sourceLifecycle'>;
	readonly getProject: () => DocumentProject | null;
	readonly setProject: (project: DocumentProject | null) => void;
	readonly getHistory: () => DocumentHistory | null;
	readonly setHistory: (history: DocumentHistory) => void;
	readonly projectDurationFrames: (project: DocumentProject) => number;
	readonly editorTimelineDurationFrames: (project: DocumentProject, sampleRate: number) => number;
	readonly projectSampleRate: () => number;
	readonly persistSetting: (key: string, value: unknown) => Promise<unknown>;
	readonly preflightStorage: (bytes: number, category: 'project') => Promise<unknown>;
	readonly garbageCollectSources: () => Promise<unknown>;
	readonly refreshStorageUsage: () => Promise<unknown>;
	readonly editingBlocked: () => boolean;
	/** Refuse an edit the Framescaper capture origin has fenced. */
	readonly assertEditingAllowed: () => void;
	readonly updatePlayhead: (frame: number, duration: number) => void;
	readonly synchronizeAutomaticSampleEditMode: () => void;
	readonly synchronizeMicrophoneMeterTarget: () => void;
	readonly stopProjectBinPreview: () => unknown;
	readonly persistRecordingRouting: () => Promise<unknown>;
	readonly publishDocumentSnapshot: () => void;
	readonly handleError: (error: unknown) => void;
}
