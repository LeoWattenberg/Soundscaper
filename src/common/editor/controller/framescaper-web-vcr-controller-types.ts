/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WebVcrAudioMonitor } from './web-vcr-audio-monitor.ts';
import type { FramescaperCaptureSourceAdapterId } from './framescaper-capture-source-adapter-router.ts';
import type { FramescaperCaptureStartAdmissionPort } from './framescaper-capture-start-admission.ts';
import type {
	FramescaperCaptureSessionActions,
	FramescaperCaptureSessionSnapshot,
} from './framescaper-capture-session-types.ts';
import type {
	WebVcrAspect,
	WebVcrCapability,
	WebVcrCommandV1,
	WebVcrDimensions,
	WebVcrLifecyclePhase,
	WebVcrNormalizedCrop,
	WebVcrResolution,
	WebVcrSnapshot,
} from '../web-vcr-domain.ts';

export type WebVcrSessionReference = Readonly<{
	readonly version: 1;
	readonly sessionId: string;
	readonly generation: number;
}>;
export type WebVcrCaptureState = 'preparing' | 'recording' | 'finalizing' | 'recovery' | 'ready';
export type WebVcrCaptureStateRequest = WebVcrSessionReference & Readonly<
	| { readonly state: 'preparing'; readonly recordingToken: string }
	| { readonly state: Exclude<WebVcrCaptureState, 'preparing'> }
>;
export type WebVcrHandshake = Readonly<{
	readonly version: 1;
	readonly capability: WebVcrCapability;
	readonly captureGrantTtlMs: number;
}>;
export type WebVcrDispatchResult = Readonly<
	| { readonly version: 1; readonly kind: 'snapshot'; readonly snapshot: Readonly<WebVcrSnapshot> }
	| { readonly version: 1; readonly kind: 'data-clear-confirmation'; readonly sessionId: string;
		readonly generation: number; readonly nonce: string; readonly expiresAtMs: number }
>;

export interface FramescaperWebVcrBridgeV1 {
	handshake(): PromiseLike<Readonly<WebVcrHandshake>>;
	open(value: Readonly<{ readonly resolution: WebVcrResolution }>): PromiseLike<Readonly<WebVcrSnapshot>>;
	dispatch(value: Readonly<WebVcrCommandV1>): PromiseLike<Readonly<WebVcrDispatchResult>>;
	prepareCapture(value: WebVcrSessionReference): PromiseLike<unknown>;
	setCaptureState(value: Readonly<WebVcrCaptureStateRequest>): PromiseLike<boolean>;
	subscribe(listener: (value: Readonly<WebVcrSnapshot>) => void): () => void;
	dispose(value: WebVcrSessionReference): PromiseLike<boolean>;
}

export interface FramescaperWebVcrCaptureController {
	readonly snapshot: Readonly<FramescaperCaptureSessionSnapshot>;
	readonly actions: Pick<FramescaperCaptureSessionActions,
		'release' | 'requestPreview' | 'arm' | 'start' | 'stop' | 'sealForShutdown' | 'resetFailure'>;
}

export interface FramescaperWebVcrCaptureAdapterControl {
	select(id: FramescaperCaptureSourceAdapterId): void;
	freezeCrop(value: Readonly<WebVcrNormalizedCrop>): void;
	setMonitorMuted?(value: boolean): void;
}

export interface FramescaperWebVcrUiSnapshot {
	readonly capability: Readonly<{ readonly status: 'checking' | 'available' | 'unavailable'; readonly reason: string | null }>;
	readonly phase: WebVcrLifecyclePhase;
	readonly modeActive: boolean;
	readonly navigation: Readonly<{ readonly url: string; readonly canGoBack: boolean;
		readonly canGoForward: boolean; readonly loading: boolean; readonly generation: number }>;
	readonly resolution: WebVcrResolution;
	readonly availableResolutions: readonly WebVcrResolution[];
	readonly autoCrop: boolean;
	readonly aspect: WebVcrAspect;
	readonly crop: Readonly<WebVcrNormalizedCrop>;
	readonly monitorMuted: boolean;
	readonly autoStop: boolean;
	readonly surface: Readonly<WebVcrDimensions> | null;
	readonly output: Readonly<WebVcrDimensions> | null;
	readonly intrinsic: Readonly<WebVcrDimensions> | null;
	readonly target: Readonly<{ readonly id: string; readonly generation: number }> | null;
	readonly lowerResolutionWarning: boolean;
	readonly previewStream?: unknown;
	readonly error: string | null;
}

type PointerInput = Omit<Extract<WebVcrCommandV1, { readonly kind: 'pointer-input' }>,
	'version' | 'sessionId' | 'generation' | 'kind'>;
type KeyInput = Omit<Extract<WebVcrCommandV1, { readonly kind: 'key-input' }>,
	'version' | 'sessionId' | 'generation' | 'kind'>;

export interface FramescaperWebVcrActions {
	activate(): Promise<void>;
	close(): Promise<void>;
	navigate(url: string): Promise<void>;
	back(): Promise<void>;
	forward(): Promise<void>;
	reload(): Promise<void>;
	setResolution(resolution: WebVcrResolution): Promise<void>;
	setAutoCrop(enabled: boolean): Promise<void>;
	setAspect(aspect: WebVcrAspect): Promise<void>;
	setCrop(crop: Readonly<WebVcrNormalizedCrop>): Promise<void>;
	setMonitorMuted(muted: boolean): Promise<void>;
	setAutoStop(enabled: boolean): Promise<void>;
	sendPointerInput(input: Readonly<PointerInput>): Promise<void>;
	sendKeyInput(input: Readonly<KeyInput>): Promise<void>;
	record(): Promise<void>;
	stopAndImport(): Promise<void>;
	clearBrowserData(): Promise<void>;
}

export interface FramescaperWebVcrCaptureAuthority {
	prepareCapture(): Promise<void>;
	captureSurface(): Readonly<WebVcrDimensions>;
	attachMonitor(value: Readonly<WebVcrAudioMonitor>): () => void;
	reportDimensions(value: Readonly<{ readonly inputSize: Readonly<WebVcrDimensions>;
		readonly outputSize: Readonly<WebVcrDimensions> }>): void;
	reportFailure(error: unknown): void;
}

export interface FramescaperWebVcrController {
	readonly snapshot: Readonly<FramescaperWebVcrUiSnapshot>;
	readonly actions: Readonly<FramescaperWebVcrActions>;
	readonly captureAuthority: Readonly<FramescaperWebVcrCaptureAuthority>;
	initialize(): Promise<void>;
	synchronizeCapture(): void;
	sealForShutdown(): Promise<void>;
	dispose(): Promise<void>;
}

export interface FramescaperWebVcrControllerOptions {
	readonly enabled: boolean;
	readonly bridge?: FramescaperWebVcrBridgeV1 | null;
	readonly cropRuntimeAvailable: boolean;
	getCapture(): FramescaperWebVcrCaptureController;
	readonly adapter: FramescaperWebVcrCaptureAdapterControl;
	readonly startAdmission: Pick<FramescaperCaptureStartAdmissionPort, 'begin'>;
	readonly showPanel?: () => void;
	readonly hidePanel?: () => void;
	readonly onChange?: () => void;
	readonly onWarning?: (error: unknown) => void;
}

export type WebVcrCommandInput = WebVcrCommandV1 extends infer Command
	? Command extends WebVcrCommandV1 ? Omit<Command, 'version' | 'sessionId' | 'generation'> : never
	: never;
