/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EnginePublicApi } from '../engine/public-api.ts';
import type { AbsentSubsystemContext } from './absent-audio-subsystems.ts';
import type { saveLabelExport } from './app-helpers.ts';
import type { ClipboardEditServiceDependencies } from './clipboard-edit-service.ts';
import type { AudioGeneratorServiceDependencies } from './generator-service.ts';
import type { LabelServiceDependencies } from './label-service.ts';
import type { EditorControllerLifetime, EditorProjectGeneration } from './lifecycle.ts';
import type { ProjectChangedOptions } from './project-mutation-service.ts';
import type { ControllerProjectRuntime, ControllerRuntimeHistory } from './project-runtime.ts';
import type { bufferFromChannels } from './source-audio.ts';
import type { EditorTaskProgressCoordinator } from './task-progress.ts';
import type { generateWaveformPeaks } from './waveform-analysis.ts';

/** The document identity the label and generator services read. */
export type EditCompositionProject =
	& ReturnType<LabelServiceDependencies['getProject']>
	& ReturnType<AudioGeneratorServiceDependencies['getProject']>;

/** The resolved-sample projection the clipboard, edit and generator services read. */
export type EditCommandProject =
	& ReturnType<ClipboardEditServiceDependencies['getProject']>
	& ReturnType<NonNullable<AudioGeneratorServiceDependencies['getCommandProject']>>;

export type EditCompositionState =
	& LabelServiceDependencies['state']
	& ClipboardEditServiceDependencies['state']
	& AudioGeneratorServiceDependencies['state']
	& {
		history: ControllerRuntimeHistory | null;
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
		readonly timeSelectionRequired: string;
		readonly labeledAudioRequired: string;
	}>;

export interface EditCompositionDependencies {
	readonly state: EditCompositionState;
	readonly copy: EditCompositionCopy;
	readonly lifetime: EditorControllerLifetime;
	readonly projectGeneration: EditorProjectGeneration;
	readonly projectRuntime: Readonly<ControllerProjectRuntime>;
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
	readonly taskProgress: Pick<EditorTaskProgressCoordinator, 'run'>;
	/** The product's own label saver, when it has one, and the file service the default saver uses. */
	readonly saveLabelFile: Parameters<typeof saveLabelExport>[1];
	readonly fileService: Parameters<typeof saveLabelExport>[2];
	/** Generated audio lands through the effect pipeline's target selection and result persistence. */
	readonly effectTargets: AudioGeneratorServiceDependencies['effectTargets'];
	readonly persistEffectResults: AudioGeneratorServiceDependencies['persistEffectResults'];
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
