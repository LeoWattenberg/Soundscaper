/* SPDX-License-Identifier: AGPL-3.0-only */

import { productProfile } from '../../products.js';
import type {
	CaptureDestination,
	CaptureMetricConfidence,
	CaptureMetricObservation,
	CapturePhase,
	CaptureRuntimeAvailability,
	CaptureSourceRole,
} from '../framescaper-capture-domain.ts';
import type { CaptureSourceDeviceDescriptor } from '../platform/capture-source-port.ts';
import type { FramescaperCaptureDisplaySource } from '../controller/framescaper-capture-session-types.ts';
import {
	WEB_VCR_PANEL_ID,
	type WebVcrUiSnapshot,
	webVcrCapabilityAvailable,
} from './web-vcr-ui-model.ts';

export const FRAMESCAPER_CAPTURE_PANEL_ID = 'recording-setup' as const;
export const FRAMESCAPER_CAPTURE_TOOLBAR_OPT_IN_KEY =
	'framescaper:capture-toolbar-opt-in-v1';

const ACTIVE_OR_RECOVERY_PHASES = new Set<CapturePhase>([
	'permission-pending',
	'previewing',
	'armed',
	'countdown',
	'recording',
	'paused',
	'finalizing',
	'recovery',
]);

export interface FramescaperCaptureUiSource {
	readonly sourceId: string;
	readonly role: CaptureSourceRole;
	readonly label?: string;
	readonly previewUrl?: string | null;
	readonly previewStream?: unknown;
	readonly level?: number | null;
	readonly settings?: Readonly<{
		readonly deviceId?: string;
		readonly width?: number;
		readonly height?: number;
		readonly frameRate?: number;
		readonly sampleRate?: number;
		readonly channelCount?: number;
	}>;
	readonly capabilities?: Readonly<Record<string, unknown>>;
}

export interface FramescaperCaptureUiMetric {
	readonly streamId: string;
	readonly role: CaptureSourceRole;
	readonly droppedRatio?: CaptureMetricObservation;
	readonly currentDriftUs?: CaptureMetricObservation;
}

export interface FramescaperCaptureUiSnapshot {
	readonly phase: CapturePhase;
	readonly availability: CaptureRuntimeAvailability;
	readonly requestedRoles: readonly CaptureSourceRole[];
	readonly sources: readonly FramescaperCaptureUiSource[];
	readonly devices?: readonly Readonly<CaptureSourceDeviceDescriptor>[];
	readonly selectedDeviceIds?: Readonly<Partial<Record<'camera' | 'microphone', string>>>;
	readonly displaySelectionMode?: 'source-list' | 'system-picker' | 'owned-source' | null;
	readonly displaySources?: readonly Readonly<FramescaperCaptureDisplaySource>[];
	readonly selectedDisplaySourceToken?: string | null;
	readonly sourcesFrozen?: boolean;
	readonly destination: CaptureDestination | null;
	readonly countdownMs: number | null;
	readonly setupDefaults?: Readonly<{
		readonly destination: CaptureDestination;
		readonly countdownMs: number;
	}>;
	readonly permissionRequestGeneration?: number | null;
	readonly failure?: Readonly<{ readonly message: string }> | null;
	readonly elapsedTimeMs?: number;
	readonly metrics?: readonly FramescaperCaptureUiMetric[];
	readonly monitoring?: boolean;
	readonly inputGain?: number;
}

export type CapturePrimaryActionKind =
	| 'open-setup'
	| 'start'
	| 'stop'
	| 'finalizing';

export interface CapturePrimaryAction {
	readonly kind: CapturePrimaryActionKind;
	readonly disabled: boolean;
}

/** Application capability policy shared by menus, preferences, docks and toolbar. */
export function workspacePanelAvailable(
	productId: string,
	panelId: string,
	webVcr?: Pick<WebVcrUiSnapshot, 'capability' | 'modeActive'> | null,
	capture?: Pick<FramescaperCaptureUiSnapshot, 'phase'> | null,
): boolean {
	if (panelId === WEB_VCR_PANEL_ID) {
		return productProfile(productId).applicationFeatures.framescaperWebVcr === true
			&& webVcrCapabilityAvailable(webVcr);
	}
	if (panelId === FRAMESCAPER_CAPTURE_PANEL_ID && webVcr?.modeActive === true) return false;
	if (panelId !== FRAMESCAPER_CAPTURE_PANEL_ID) return true;
	if (productId === 'framescaper' && framescaperCaptureRecordRequired(capture)) return true;
	return productProfile(productId).applicationFeatures.framescaperCapture === true;
}

export function workspacePanelRestoresCaptureFocus(panelId: string): boolean {
	return panelId === FRAMESCAPER_CAPTURE_PANEL_ID || panelId === WEB_VCR_PANEL_ID;
}

export function framescaperCaptureRecordVisible(
	productId: string,
	capture: Pick<FramescaperCaptureUiSnapshot, 'phase'> | null | undefined,
	locallyOptedIn: boolean,
): boolean {
	if (!workspacePanelAvailable(productId, FRAMESCAPER_CAPTURE_PANEL_ID, null, capture)) return false;
	return locallyOptedIn || Boolean(capture && ACTIVE_OR_RECOVERY_PHASES.has(capture.phase));
}

/** Media ownership and recovery must retain a reachable status/release control. */
export function framescaperCaptureRecordRequired(
	capture: Pick<FramescaperCaptureUiSnapshot, 'phase'> | null | undefined,
): boolean {
	return Boolean(capture && ACTIVE_OR_RECOVERY_PHASES.has(capture.phase));
}

/** Main Record never opens a source: setup owns every permission-generating gesture. */
export function capturePrimaryAction(
	capture: Pick<FramescaperCaptureUiSnapshot, 'availability' | 'phase'>,
): Readonly<CapturePrimaryAction> {
	switch (capture.phase) {
		case 'armed': return Object.freeze({ kind: 'start', disabled: false });
		case 'countdown':
		case 'recording':
		case 'paused': return Object.freeze({ kind: 'stop', disabled: false });
		case 'finalizing': return Object.freeze({ kind: 'finalizing', disabled: true });
		default: return Object.freeze({ kind: 'open-setup', disabled: false });
	}
}

export function capturePhaseIsSourceLocked(phase: CapturePhase): boolean {
	return ['armed', 'countdown', 'recording', 'paused', 'finalizing', 'recovery'].includes(phase);
}

export function captureMetricText(
	observation: CaptureMetricObservation | undefined,
	format: (value: number) => string,
	unavailable: string,
): Readonly<{ readonly value: string; readonly confidence: CaptureMetricConfidence }> {
	if (!observation || observation.confidence === 'unavailable' || observation.value === null) {
		return Object.freeze({ value: unavailable, confidence: 'unavailable' });
	}
	return Object.freeze({ value: format(observation.value), confidence: observation.confidence });
}

export function readFramescaperCaptureToolbarOptIn(
	storage: Pick<Storage, 'getItem'> | null | undefined,
): boolean {
	try {
		return storage?.getItem(FRAMESCAPER_CAPTURE_TOOLBAR_OPT_IN_KEY) === 'true';
	} catch {
		return false;
	}
}

export function persistFramescaperCaptureToolbarOptIn(
	storage: Pick<Storage, 'setItem'> | null | undefined,
): void {
	try {
		storage?.setItem(FRAMESCAPER_CAPTURE_TOOLBAR_OPT_IN_KEY, 'true');
	} catch {
		// A private or quota-blocked store must not make the capture controls fail.
	}
}
