/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CaptureDestination,
	CapturePacket,
	CaptureRuntimeAvailability,
	CaptureSelectedSource,
	CaptureSourceRole,
	CaptureStreamMetrics,
} from '../framescaper-capture-domain.ts';
import type {
	CapturePreviewSource,
	CaptureSourceDeviceDescriptor,
	CaptureSourcePortV1,
} from '../platform/capture-source-port.ts';
import type { FramescaperCaptureOriginGuard } from './framescaper-capture-origin-guard.ts';
import type {
	FramescaperCaptureArmOptions,
	FramescaperCaptureStateSnapshot,
} from './framescaper-capture-state-machine.ts';

export type FramescaperCaptureRecorderFormat = Readonly<
	| { readonly kind: 'encoded-media'; readonly mimeType: string }
	| {
		readonly kind: 'raw-pcm';
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly chunkFrames: number;
	}
>;

export interface FramescaperCaptureRecorder {
	readonly format: FramescaperCaptureRecorderFormat;
	start(): PromiseLike<void> | void;
	pause(): PromiseLike<boolean> | boolean;
	resume(): PromiseLike<boolean> | boolean;
	stop(): PromiseLike<void> | void;
	dispose(): PromiseLike<void> | void;
	setMonitoring?(enabled: boolean): unknown;
	setInputGain?(value: number): unknown;
}

export interface FramescaperCaptureStreamIdentity {
	readonly streamId: string;
	readonly sourceId: string;
	readonly role: CaptureSourceRole;
}

export interface FramescaperCaptureRecorderRequest<Stream = unknown, Track = unknown> {
	readonly sessionId: string;
	readonly streamId: string;
	readonly sourceId: string;
	readonly source: Readonly<CapturePreviewSource<Stream, Track>>;
	readonly monitoring: boolean;
	readonly inputGain: number;
	onPacket(packet: Readonly<CapturePacket>): Promise<void>;
	onError(error: unknown): void;
	onBackpressure(): void;
}

export interface FramescaperCaptureProjectFence {
	readonly projectId: string;
	readonly baseRevision: number;
	readonly baseSha256: string;
}

export interface FramescaperCaptureSessionOrigin {
	readonly sequenceId: string;
	readonly playheadMicroseconds: number;
	readonly destination: CaptureDestination;
}

export interface FramescaperCaptureDurableSession {
	readonly sessionId: string;
	readonly sources: readonly Readonly<FramescaperCaptureStreamIdentity>[];
	readonly destination: CaptureDestination;
	readonly projectFence: Readonly<FramescaperCaptureProjectFence>;
	readonly origin: Readonly<FramescaperCaptureSessionOrigin>;
	readonly [key: string]: unknown;
}

export interface FramescaperCaptureDurablePort {
	prepare(request: Readonly<FramescaperCaptureDurableSession & {
		readonly generation: number;
		readonly monotonicOriginMicroseconds: number;
		readonly streams: readonly Readonly<FramescaperCaptureStreamIdentity & {
			readonly required: true;
			readonly format: FramescaperCaptureRecorderFormat;
		}>[];
	}>): Promise<FramescaperCaptureDurableSession>;
	append(
		session: FramescaperCaptureDurableSession,
		packet: Readonly<CapturePacket>,
	): Promise<FramescaperCaptureDurableSession>;
	recordPauseSpan(
		session: FramescaperCaptureDurableSession,
		span: Readonly<{ readonly startMicroseconds: number; readonly endMicroseconds: number }>,
	): Promise<FramescaperCaptureDurableSession>;
	seal(session: FramescaperCaptureDurableSession): Promise<FramescaperCaptureDurableSession>;
	discard(session: FramescaperCaptureDurableSession): Promise<void>;
	findRecovery(projectId: string): Promise<FramescaperCaptureDurableSession | null>;
}

export interface FramescaperCaptureFinalizeRequest {
	readonly session: FramescaperCaptureDurableSession;
	readonly metrics: readonly Readonly<CaptureStreamMetrics>[];
	readonly provenance: 'live' | 'recovered' | 'import-as-is';
}

export interface FramescaperCapturePreviewSurface {
	/** A runtime-owned URL, when the preview backend exposes one. */
	readonly url?: string | null;
	/** A live MediaStream-like value for modern browser `srcObject` playback. */
	readonly stream?: unknown;
	dispose(): PromiseLike<void> | void;
}

export interface FramescaperCaptureLevelMonitor {
	readonly level: number | null;
	dispose(): PromiseLike<void> | void;
}

export interface FramescaperCaptureSourceSettings {
	readonly width?: number;
	readonly height?: number;
	readonly frameRate?: number;
	readonly sampleRate?: number;
	readonly channelCount?: number;
}

export interface FramescaperCaptureDisplaySource {
	/** Opaque, expiring desktop authority; never a native source identifier. */
	readonly token: string;
	readonly name: string;
	readonly kind: 'screen' | 'window';
}

export interface FramescaperCaptureDisplaySelectionPort {
	readonly mode: 'source-list' | 'system-picker';
	listSources?(): PromiseLike<readonly Readonly<FramescaperCaptureDisplaySource>[]>
		| readonly Readonly<FramescaperCaptureDisplaySource>[];
	authorize(request: Readonly<{
		readonly generation: number;
		readonly roles: readonly CaptureSourceRole[];
		readonly sourceToken: string | null;
	}>): PromiseLike<void> | void;
}

export interface FramescaperCaptureSessionServiceOptions<Stream = unknown, Track = unknown> {
	readonly enabled: boolean;
	readonly embedded: boolean;
	readonly sourcePort: CaptureSourcePortV1<Stream, Track>;
	readonly displaySelection?: FramescaperCaptureDisplaySelectionPort;
	readonly durable: FramescaperCaptureDurablePort;
	readonly originGuard: FramescaperCaptureOriginGuard;
	readonly completeRuntimeProbe?: (
		availability: CaptureRuntimeAvailability,
	) => PromiseLike<CaptureRuntimeAvailability> | CaptureRuntimeAvailability;
	readonly recoveryProjectIds?: () => PromiseLike<readonly string[]> | readonly string[];
	readonly authorizeUserAction?: (generation: number) => void;
	captureOrigin(): Readonly<{
		readonly projectFence: FramescaperCaptureProjectFence;
		readonly origin: FramescaperCaptureSessionOrigin;
	}>;
	createRecorder(
		request: FramescaperCaptureRecorderRequest<Stream, Track>,
	): PromiseLike<FramescaperCaptureRecorder> | FramescaperCaptureRecorder;
	readonly createPreviewSurface?: (
		source: Readonly<CapturePreviewSource<Stream, Track>>,
	) => PromiseLike<FramescaperCapturePreviewSurface> | FramescaperCapturePreviewSurface;
	readonly createLevelMonitor?: (
		source: Readonly<CapturePreviewSource<Stream, Track>>,
		onLevel: () => void,
	) => PromiseLike<FramescaperCaptureLevelMonitor> | FramescaperCaptureLevelMonitor;
	finalize(request: FramescaperCaptureFinalizeRequest): PromiseLike<void> | void;
	readonly createId?: (prefix: string) => string;
	readonly now?: () => number;
	readonly waitCountdown?: (durationMs: number, signal: AbortSignal) => Promise<void>;
	readonly onChange?: () => void;
}

export interface FramescaperCaptureSessionActions {
	openSetup(): void;
	requestPreview(roles: readonly CaptureSourceRole[]): Promise<void>;
	listDisplaySources(): Promise<void>;
	selectDisplaySource(sourceToken: string): void;
	selectDevice(role: 'camera' | 'microphone', deviceId: string): Promise<void>;
	configureSource(sourceId: string, settings: Readonly<FramescaperCaptureSourceSettings>): Promise<void>;
	release(): Promise<void>;
	configure(changes: Readonly<Record<string, unknown>>): void;
	arm(options: Readonly<FramescaperCaptureArmOptions>): void;
	start(): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	stop(): Promise<void>;
	recover(): Promise<void>;
	importAsIs(): Promise<void>;
	discard(): Promise<void>;
	resetFailure(): void;
}

export interface FramescaperCaptureSessionSnapshot extends Omit<FramescaperCaptureStateSnapshot, 'sources'> {
	readonly sources: readonly Readonly<CaptureSelectedSource & {
		readonly label?: string;
		readonly settings?: Readonly<Record<string, unknown>>;
		readonly capabilities?: Readonly<Record<string, unknown>>;
		readonly previewUrl?: string | null;
		readonly previewStream?: unknown;
		readonly level?: number | null;
	}>[];
	readonly devices: readonly Readonly<CaptureSourceDeviceDescriptor>[];
	readonly selectedDeviceIds: Readonly<Partial<Record<'camera' | 'microphone', string>>>;
	readonly displaySelectionMode: 'source-list' | 'system-picker' | null;
	readonly displaySources: readonly Readonly<FramescaperCaptureDisplaySource>[];
	readonly selectedDisplaySourceToken: string | null;
	readonly monitoring: boolean;
	readonly inputGain: number;
	readonly elapsedTimeMs: number;
	readonly metrics: readonly Readonly<CaptureStreamMetrics>[];
}

export interface FramescaperCaptureSessionService {
	readonly snapshot: Readonly<FramescaperCaptureSessionSnapshot>;
	readonly actions: Readonly<FramescaperCaptureSessionActions>;
	initialize(): Promise<void>;
	settled(): Promise<void>;
	dispose(): Promise<void>;
}
