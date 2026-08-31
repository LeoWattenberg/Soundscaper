/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LocalDiagnosticsErrorEntry } from './local-diagnostics-error-journal.ts';

export const LOCAL_DIAGNOSTICS_REPORT_SCHEMA_VERSION = 1;
export const LOCAL_DIAGNOSTICS_MAX_BYTES = 128 * 1024;

export const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper'] as const);
export const PROJECT_FAMILIES = PRODUCT_IDS;
export const PLATFORMS = Object.freeze(['linux', 'darwin', 'win32', 'android', 'ios', 'unknown'] as const);
export const ARCHITECTURES = Object.freeze(['x64', 'arm64', 'arm', 'ia32', 'unknown'] as const);
export const BROWSER_NAMES = Object.freeze(['chromium', 'firefox', 'webkit', 'unknown'] as const);
export const STORAGE_STATES = Object.freeze([
	'opening', 'indexeddb', 'memory-ephemeral', 'version-stale', 'error', 'closing', 'closed', 'unknown',
] as const);
export const STORAGE_BACKENDS = Object.freeze(['indexeddb', 'memory', 'unknown'] as const);
export const STORAGE_PRESSURES = Object.freeze(['normal', 'warning', 'critical', 'unknown'] as const);
export const EVICTION_PROTECTIONS = Object.freeze(['granted', 'best-effort', 'unavailable', 'unknown'] as const);
export const PREFLIGHT_STATUSES = Object.freeze(['checking', 'ready', 'insufficient', 'unknown'] as const);
export const RECOVERY_STATES = Object.freeze([
	'not-applicable', 'not-observed', 'inactive', 'active', 'pending', 'recovery',
] as const);
export const ERROR_SOURCES = Object.freeze(['controller', 'workspace', 'desktop'] as const);

/** Closed product capability inventory. Arbitrary snapshot extensions never enter the report. */
export const LOCAL_DIAGNOSTICS_CAPABILITY_IDS = Object.freeze([
	'assistanceAssets', 'audioAnalysis', 'audioAutomation', 'audioEffects', 'audioGenerators',
	'audioImport', 'audioMacros', 'audioMixerGraph', 'audioMixing', 'audioPlayback', 'audioRecording',
	'audioSampleEditing', 'audioSpectralEditing', 'audioTimelineEditing', 'audioTrackFreeze',
	'audioWarp', 'immersiveAdm', 'masteringSequences', 'multicamera', 'musicalTimeline',
	'nestedSequences', 'ofxEffects', 'project', 'projectBin', 'sequenceTiming',
	'sourceCharacteristics', 'takeComp', 'timelineAnnotations', 'timelineImages', 'trackFolders',
	'videoAdjustmentLayers', 'videoCaptions', 'videoColorManagement', 'videoCompositing',
	'videoDenoise', 'videoEffects', 'videoExport', 'videoFreeze', 'videoGenerators', 'videoGeometry',
	'videoGrading', 'videoImport', 'videoKeyframes', 'videoMasksMattes', 'videoMotionTracking',
	'videoPlayback', 'videoRetime', 'videoStabilization', 'videoStills', 'videoTimelineEditing',
	'videoTimingAssets', 'videoTransitionDissolve', 'videoTransitions',
] as const);

export type ProductId = typeof PRODUCT_IDS[number];
export type Platform = typeof PLATFORMS[number];
export type Architecture = typeof ARCHITECTURES[number];
export type BrowserName = typeof BROWSER_NAMES[number];
export type RecoveryState = typeof RECOVERY_STATES[number];

export interface LocalDiagnosticsRuntimeIdentity {
	readonly kind: 'browser' | 'desktop';
	readonly platform: Platform;
	readonly architecture: Architecture;
	readonly locale: string;
	readonly browser: Readonly<{ readonly name: BrowserName; readonly version: string | null }> | null;
	readonly desktop: Readonly<{
		readonly electron: string | null;
		readonly chromium: string | null;
		readonly node: string | null;
	}> | null;
}

export interface LocalDiagnosticsReport {
	readonly kind: 'soundscaper-local-diagnostics';
	readonly schemaVersion: 1;
	readonly generatedAt: string;
	readonly product: Readonly<{ readonly id: ProductId }>;
	readonly versions: Readonly<{
		readonly application: string;
		readonly diagnostics: 1;
		readonly project: Readonly<{ readonly family: ProductId; readonly version: number }> | null;
		readonly scapeFormat: number;
	}>;
	readonly environment: Readonly<LocalDiagnosticsRuntimeIdentity>;
	readonly capabilities: readonly Readonly<{ readonly id: string; readonly available: boolean }>[];
	readonly errors: Readonly<{
		readonly retainedLimit: 32;
		readonly recent: readonly Readonly<LocalDiagnosticsErrorEntry>[];
	}>;
	readonly storage: Readonly<{
		readonly state: string;
		readonly backend: string;
		readonly persistent: boolean;
		readonly ephemeral: boolean;
		readonly pressure: string;
		readonly evictionProtection: string;
		readonly usageBytes: number | null;
		readonly quotaBytes: number | null;
		readonly freeBytes: number | null;
		readonly lastPreflightStatus: string;
	}>;
	readonly library: Readonly<{
		readonly projectCount: number;
		readonly openProjectCount: number;
		readonly current: Readonly<{
			readonly family: ProductId;
			readonly version: number;
			readonly revision: number;
			readonly readOnly: boolean;
		}> | null;
	}>;
	readonly recovery: Readonly<{
		readonly takeCycle: RecoveryState;
		readonly capture: RecoveryState;
		readonly webVcr: RecoveryState;
		readonly renderQueue: 'not-observed';
	}>;
	readonly streaming: Readonly<{
		readonly streamUnderrunFrames: number;
		readonly streamedPlaybackObserved: boolean;
	}>;
}

export interface SerializedLocalDiagnosticsReport {
	readonly text: string;
	readonly fileName: string;
	readonly mimeType: 'application/json';
}
