/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EffectTarget } from '../effects/effect-selection-service.ts';
import type { EnginePublicApi } from '../../engine/public-api.ts';
import type { AbsentSubsystemContext } from '../composition/absent-audio-subsystems.ts';
import type { saveLabelExport } from '../shared/app-helpers.ts';
import type { ClipboardEditServiceDependencies } from './internal/clipboard-edit-service.ts';
import type { AudioGeneratorServiceDependencies } from './generator-service.ts';
import type { LabelServiceDependencies } from './internal/label-service.ts';
import type { EditorControllerLifetime, EditorProjectGeneration } from '../shared/lifecycle.ts';
import type { ProjectChangedOptions } from '../document/project-mutation-service.ts';
import type { ControllerProjectRuntime, ControllerRuntimeHistory, ControllerRuntimeCommandOptions, ControllerEditClipboardRuntimeBindings } from '../document/project-runtime.ts';
import type { bufferFromChannels } from '../source/source-audio.ts';
import type { EditorTaskProgressCoordinator } from '../shared/task-progress.ts';
import type { generateWaveformPeaks } from '../source/waveform-analysis.ts';
import type { AudioEditorEditingPreferences } from '../../editing-preferences.ts';
import type { PasteMonoConversionPlan } from './paste-mono-conversion-policy.ts';
import type {
	PasteMonoConfirmationDecision,
	PasteMonoDerivedSourcesPort,
} from './paste-mono-conversion-service.ts';
import type {
	DeleteBehaviorConfirmationDecision,
	DeleteBehaviorConfirmationRequest,
} from '../../delete-behavior-onboarding.ts';

/** The document identity the label and generator services read. */
export type EditCompositionProject =
	& ReturnType<LabelServiceDependencies['getProject']>
	& ReturnType<AudioGeneratorServiceDependencies['getProject']>;

/** The resolved-sample projection the clipboard, edit and generator services read. */
export type EditCommandProject =
	& ReturnType<ClipboardEditServiceDependencies['getProject']>
	& ReturnType<NonNullable<AudioGeneratorServiceDependencies['getCommandProject']>>;

export type EditCompositionState<History extends ControllerRuntimeHistory = ControllerRuntimeHistory> =
	& LabelServiceDependencies['state']
	& ClipboardEditServiceDependencies['state']
	& AudioGeneratorServiceDependencies['state']
	& {
		history: History | null;
		preferences?: Readonly<{ readonly editing?: Partial<AudioEditorEditingPreferences> }>;
		videoEffectGestures: Map<string, unknown>;
	};

export type EditCompositionCopy =
	& LabelServiceDependencies['copy']
	& ClipboardEditServiceDependencies['copy']
	& AudioGeneratorServiceDependencies['copy']
	& Parameters<typeof bufferFromChannels>[3]
	& Parameters<typeof generateWaveformPeaks>[1]
	& Readonly<{
		readonly generatingAudio: string;
		readonly editingDeleteBehavior: string;
		readonly monoConversionPrompt: string;
		readonly monoConversionTitle: string;
		readonly timeSelectionRequired: string;
		readonly labeledAudioRequired: string;
	}>;

export interface EditMonoConversionConfirmationRequest {
	readonly title: string;
	readonly body: string;
	readonly plan: Readonly<PasteMonoConversionPlan>;
	readonly signal?: AbortSignal;
}

export type EditDeleteBehaviorConfirmationRequest = DeleteBehaviorConfirmationRequest;

export interface EditCompositionRuntime<History extends ControllerRuntimeHistory> extends ControllerEditClipboardRuntimeBindings {
	readonly prepareEditClipboardDescriptor: ControllerProjectRuntime['prepareEditClipboardDescriptor'];
	readonly projectForEditClipboardConsumers?: (project: EditCompositionProject) => Readonly<Record<string, unknown>>;
	readonly undo: (history: History, options?: ControllerRuntimeCommandOptions) => History;
	readonly redo: (history: History, options?: ControllerRuntimeCommandOptions) => History;
}

export interface EditCompositionDependencies<History extends ControllerRuntimeHistory = ControllerRuntimeHistory> {
	readonly state: EditCompositionState<History>;
	readonly copy: EditCompositionCopy;
	readonly lifetime: EditorControllerLifetime;
	readonly projectGeneration: EditorProjectGeneration;
	readonly projectRuntime: Readonly<EditCompositionRuntime<History>>;
	/** Whether this product composes generators; without them the domain gets a refusing stand-in. */
	readonly composition: Readonly<{ readonly generators: boolean }>;
	readonly absentSubsystem: AbsentSubsystemContext;
	readonly session: ClipboardEditServiceDependencies['session'];
	readonly store: AudioGeneratorServiceDependencies['store'];
	readonly engine: Pick<EnginePublicApi, 'getAudioContext' | 'getPositionFrames'>;
	readonly sourceBuffers:
		& ClipboardEditServiceDependencies['sourceBuffers']
		& AudioGeneratorServiceDependencies['sourceBuffers'];
	readonly sourcePeaks: AudioGeneratorServiceDependencies['sourcePeaks'];
	readonly sourceChunkFrames: number;
	readonly derivedSources: PasteMonoDerivedSourcesPort;
	readonly confirmMonoConversion: (
		request: Readonly<EditMonoConversionConfirmationRequest>,
	) => PromiseLike<PasteMonoConfirmationDecision> | PasteMonoConfirmationDecision;
	readonly confirmDeleteBehavior: (
		request: Readonly<EditDeleteBehaviorConfirmationRequest>,
	) => PromiseLike<DeleteBehaviorConfirmationDecision> | DeleteBehaviorConfirmationDecision;
	readonly updatePreferences: (patch: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
	readonly taskProgress: Pick<EditorTaskProgressCoordinator, 'run'>;
	/** The product's own label saver, when it has one, and the file service the default saver uses. */
	readonly saveLabelFile: Parameters<typeof saveLabelExport>[1];
	readonly fileService: Parameters<typeof saveLabelExport>[2];
	/** Generated audio lands through the effect pipeline's target selection and result persistence. */
	readonly effectTargets: AudioGeneratorServiceDependencies<unknown, EffectTarget>['effectTargets'];
	readonly persistEffectResults: AudioGeneratorServiceDependencies<unknown, EffectTarget>['persistEffectResults'];
	readonly getProject: () => EditCompositionProject | null;
	readonly getCommandProject: () => EditCommandProject;
	readonly editingBlocked: () => boolean;
	readonly commit:
		& LabelServiceDependencies['commit']
		& ClipboardEditServiceDependencies['commit']
		& AudioGeneratorServiceDependencies['commit'];
	readonly setStatus: (message: string, state?: string) => void;
	readonly publishDocumentSnapshot: () => void;
	readonly handleError: (error: unknown) => void;
	readonly preflightStorage: AudioGeneratorServiceDependencies['preflightStorage'];
	readonly normalizeTimelineFrame: (frame: unknown) => number;
	readonly snapTimelineFrame: (frame: unknown) => number;
	readonly activeSelection: () => Readonly<{ readonly startFrame: number; readonly endFrame: number }> | null;
	readonly cacheSourceBuffer: AudioGeneratorServiceDependencies['cacheSourceBuffer'];
	readonly projectChanged: (options?: ProjectChangedOptions) => void;
	readonly garbageCollectSources: () => Promise<unknown>;
	readonly compactLiveSourceState: () => unknown;
}
