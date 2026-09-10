/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EffectControlPreviewSource } from '../effects/effect-controls-service.ts';
import type { AnalysisActions } from '../analysis/analysis-composition.ts';
import type { EnginePublicApi, EngineParametricEqPreview } from '../../engine/public-api.ts';
import type { createEditorCodecRuntime } from '../../editor-codec-runtime.ts';
import type { createAudioEditorFileService } from '../../file-service.js';
import type { createProjectStore } from '../../storage.js';
import type { createFramescaperCaptureAppBinding } from '../capture/framescaper-capture-app-binding.ts';
import type { AUDIO_EDITOR_DEFAULT_SHORTCUTS } from '../../preferences.js';
import type { createTrackAudioComposition } from '../track-audio/track-audio-composition.ts';
import type { createEffectsComposition } from '../effects/effects-composition.ts';
import type { createDocumentComposition } from '../document/document-composition.ts';
import type { createClipVideoComposition } from '../clip-video/clip-video-composition.ts';
import type { createControllerSoundActivationPolicy } from '../recording/sound-activation-controller-composition.ts';
import type { createEditorTaskProgressCoordinator } from '../shared/task-progress.ts';
import type { EffectMacroLibraryServiceRuntime } from '../effects/effect-macro-library-service.ts';
import type { MacroScriptLibraryServiceRuntime } from '../effects/macro-script-library-service.ts';
import type { TrimMediaFfmpegHost } from '../document/trim-media-service.ts';
import type { ExportActionState } from '../export/export-action-group.ts';

type MacroState = EffectMacroLibraryServiceRuntime['state'] & MacroScriptLibraryServiceRuntime['state'];
interface EditorActionState extends MacroState, ExportActionState {
	audacityEffectType: string;
	effectPresets: unknown;
	selectedTrackId: string | null;
	audacityPreviewSource: EffectControlPreviewSource | Partial<Pick<EngineParametricEqPreview, 'readSpectrum' | 'audition'>> | null;
	audacityPreviewAuditionBandId: string | number | null;
	readonly recentProjectIds: readonly string[];
	readonly projects: readonly Readonly<{ id: string }>[];
	readonly playAtSpeedRate: number;
	readonly recorder: unknown;
	readonly recordingStarting: boolean;
	readonly timedRecording: unknown;
	readonly timedRecordingPreparing: boolean;
}

export interface EditorActionResources {
	readonly AUDIO_EDITOR_DEFAULT_SHORTCUTS: typeof AUDIO_EDITOR_DEFAULT_SHORTCUTS;
	readonly analysisService: AnalysisActions;
	readonly audioWarpService: ReturnType<typeof createTrackAudioComposition>['audioWarp'];
	readonly capabilities: Readonly<Record<string, boolean>>;
	readonly copy: Readonly<Record<string, string> & { projectNotFound: string }>;
	readonly effectSelectionService: ReturnType<typeof createEffectsComposition>['selection'];
	readonly engine: EnginePublicApi;
	readonly ffmpeg: ReturnType<typeof createEditorCodecRuntime> & Partial<TrimMediaFfmpegHost>;
	readonly fileService: ReturnType<typeof createAudioEditorFileService>;
	readonly product: Readonly<{ id: string; name: string }>;
	readonly regularIntervalAnnotationController: ReturnType<typeof createDocumentComposition>['regularIntervalAnnotation'];
	readonly selectionViewService: ReturnType<typeof createTrackAudioComposition>['selectionView'];
	readonly sequenceTimingService: ReturnType<typeof createClipVideoComposition>['sequenceTiming'];
	readonly soundActivationPolicyService: ReturnType<typeof createControllerSoundActivationPolicy>;
	readonly sourceMonitorService: ReturnType<typeof createClipVideoComposition>['sourceMonitor'];
	readonly state: EditorActionState;
	readonly store: ReturnType<typeof createProjectStore>;
	readonly takeCompService: ReturnType<typeof createTrackAudioComposition>['takeComp'];
	readonly taskProgress: ReturnType<typeof createEditorTaskProgressCoordinator>;
	readonly timelineAnnotationService: ReturnType<typeof createDocumentComposition>['timelineAnnotation'];
	readonly trackFolderService: ReturnType<typeof createDocumentComposition>['trackFolder'];
	readonly trackStructuralOperations: ReturnType<typeof createTrackAudioComposition>['track']['structuralOperations'];
	readonly videoEditService: ReturnType<typeof createClipVideoComposition>['videoEdit'];
	readonly videoNavigationService: ReturnType<typeof createClipVideoComposition>['videoNavigation'];
	readonly videoSourceReprobeService: ReturnType<typeof createClipVideoComposition>['videoSourceReprobe'];
	readonly videoTrimServices: ReturnType<typeof createClipVideoComposition>['videoTrim'];
	readonly framescaperCaptureActions?: NonNullable<ReturnType<typeof createFramescaperCaptureAppBinding>>['actions'];
	readonly framescaperWebVcrActions?: NonNullable<ReturnType<typeof createFramescaperCaptureAppBinding>>['webVcrActions'];
	readonly productSequenceActions?: unknown;
	readonly productId?: string;
	readonly locale?: string;
	readonly macroScriptStartedAt?: () => string;
	readonly onMacroScriptLog?: (entry: Readonly<{ level: 'info' | 'warn' | 'error'; text: string; at: number }>) => void;
}
