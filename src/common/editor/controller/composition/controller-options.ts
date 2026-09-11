/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RuntimeProjectProjection } from '../../runtime-clip-projection.ts';
import type { CommandProjectView } from '../../command-project-view.ts';
import type { RecordingControllerFactory } from '../recording/recording-transaction-types.ts';
import type { createRecordingCapturePool } from '../../recording.js';
import type { createFramescaperCaptureAdminInterlock } from '../capture/framescaper-capture-admin-interlock.ts';
import type { createFramescaperCaptureAppBinding, FramescaperCaptureAppBindingOptions } from '../capture/framescaper-capture-app-binding.ts';
import type { CaptureCompositionDependencies, CaptureCompositionRuntime } from '../capture/capture-composition.ts';
import type { ClipVideoCompositionDependencies } from '../clip-video/clip-video-composition-types.ts';
import type { ControllerTimerOptions } from './controller-timers.ts';
import type { ControllerResourceOptions } from './controller-resources.ts';
import type { DocumentCompositionDependencies, DocumentProject, DocumentHistory } from '../document/document-composition-types.ts';
import type { EditCompositionDependencies } from '../edit/edit-composition-types.ts';
import type { EditorActionFunctions } from './editor-action-functions.ts';
import type { NativeProjectServiceRuntime } from '../document/native-project-types.ts';
import type { PlaybackProjectService } from '../source/playback-project-service.ts';
import type { ProjectAdminServiceRuntime } from '../document/project-admin-service.ts';
import type { ProjectLockServiceRuntime } from '../document/project-lock-service.ts';
import type { ControllerProjectRuntimeInput } from '../document/project-runtime.ts';
import type { ProjectSwitchServiceRuntime } from '../document/project-switch-service-types.ts';
import type { ProductNativeRenderInputAuthorityBinding } from './product-native-render-input-authority.ts';
import type { ScapeProjectFileServiceRuntime, ScapeProjectInspection } from '../document/scape-project-file-service.ts';
import type { SourceRuntimeCompositionDependencies } from '../source/source-runtime-composition-types.ts';
import type { TrackAudioCompositionDependencies } from '../track-audio/track-audio-composition-types.ts';
import type { SoundscaperPersistentDeliveryExportRuntime } from '../export/soundscaper-persistent-delivery-runtime-binding.ts';

type CaptureBinding = ReturnType<typeof createFramescaperCaptureAppBinding>;
type ScapeInspectionRuntime = ScapeProjectFileServiceRuntime<ScapeProjectInspection, unknown>;

/** Host-supplied resources and product policies read by controller assembly. */
export interface ControllerOptions extends ControllerResourceOptions, ControllerTimerOptions {
	readonly productSequenceActions?: ReturnType<typeof import('./product-action-runtime.ts').productActionRuntime>['productSequenceActions'];
	readonly productVideoExportStrategy?: import('../export/product-video-export-strategy.ts').ProductVideoExportStrategy;
	readonly productId?: string;
	readonly product?: Readonly<{ id: string }>;
	readonly locale?: string;
	readonly headless?: boolean;
	readonly copy?: Readonly<Record<string, string>>;
	readonly now?: () => number;
	readonly monotonicNow?: () => number;
	readonly bindSoundscaperPersistentDeliveryRuntime?: (runtime: SoundscaperPersistentDeliveryExportRuntime) => void;
	readonly projectRuntime?: ControllerProjectRuntimeInput<DocumentProject, DocumentHistory, unknown,
		DocumentProject | RuntimeProjectProjection<DocumentProject> | CommandProjectView<DocumentProject>>;
	readonly projectMaintenanceRuntime?: ProjectAdminServiceRuntime['projectMaintenanceRuntime'];
	readonly playbackProjectService?: PlaybackProjectService;
	readonly acquireProjectLock?: ProjectLockServiceRuntime['acquireProjectLock'];
	readonly createProjectIfAbsent?: ProjectSwitchServiceRuntime<DocumentProject, DocumentHistory>['createProjectIfAbsent'];
	readonly prepareProjectSnapshot?: DocumentCompositionDependencies['prepareProjectSnapshot'];
	readonly prepareProjectForExport?: TrackAudioCompositionDependencies['export']['prepareProjectForExport'];
	readonly productNativeRenderInputAuthority?: ProductNativeRenderInputAuthorityBinding;
	readonly recordingCapturePool?: ReturnType<typeof createRecordingCapturePool>;
	readonly recordingControllerFactory?: RecordingControllerFactory;
	readonly mediaDevices?: import('../../recording-input-options.ts').RecordingMediaDevices;
	readonly createStream?: FramescaperCaptureAppBindingOptions['createStream'];
	readonly MediaRecorder?: FramescaperCaptureAppBindingOptions['MediaRecorder'];
	readonly MediaStreamTrackProcessor?: FramescaperCaptureAppBindingOptions['MediaStreamTrackProcessor'];
	readonly AudioWorkletNode?: FramescaperCaptureAppBindingOptions['AudioWorkletNode'];
	readonly framescaperCaptureRuntime?: CaptureCompositionRuntime<CaptureBinding> & {
		createAdminInterlock: typeof createFramescaperCaptureAdminInterlock;
	};
	readonly createFramescaperCaptureProxyScheduler?: CaptureCompositionDependencies['proxy']['createScheduler'];
	readonly createProductVideoRetimeProgramOrdinalBridge?: ClipVideoCompositionDependencies['createVideoRetimeProgramOrdinalBridge'];
	readonly resolveProductVideoPreviewMedia?: SourceRuntimeCompositionDependencies['resolveProductVideoPreviewMedia'];
	readonly reportProductVideoPreviewPressure?: EditorActionFunctions['reportVideoPreviewPressure'];
	readonly saveLabelFile?: EditCompositionDependencies['saveLabelFile'];
	readonly confirmMonoConversion?: EditCompositionDependencies['confirmMonoConversion'];
	readonly confirmDeleteBehavior?: EditCompositionDependencies['confirmDeleteBehavior'];
	readonly aup4Client?: NativeProjectServiceRuntime['initialAup4Client'];
	readonly aup4?: NativeProjectServiceRuntime['aup4Options'];
	readonly adaptAudacityProject?: NativeProjectServiceRuntime['adaptAudacityProject'];
	readonly prepareAudacityProjectExport?: NativeProjectServiceRuntime['prepareAudacityProjectExport'];
	readonly scapeInspectionQuiescenceOptions?: ScapeInspectionRuntime['scapeInspectionQuiescenceOptions'];
	readonly scapeProjectRuntime?: Readonly<{
		inspectScapeProject?: ScapeInspectionRuntime['inspectScapeProject'];
		importScapeProject?: NativeProjectServiceRuntime['importScapeProject'];
		exportScapeProject?: NativeProjectServiceRuntime['exportScapeProject'];
		copyScapeArchive?: NativeProjectServiceRuntime['copyFutureScapeArchive'];
	}>;
}

/** Versioned capabilities exposed by the product's maintained sandbox preloads. */
declare global {
	var framescaperCaptureDesktop: Readonly<{ v1: NonNullable<FramescaperCaptureAppBindingOptions['desktopBridge']> }> | undefined;
	var framescaperWebVcr: Readonly<{ v1: NonNullable<FramescaperCaptureAppBindingOptions['webVcrBridge']> }> | undefined;
}
