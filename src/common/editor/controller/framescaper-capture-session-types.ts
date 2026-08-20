/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CaptureDestination,
	CapturePacket,
	CaptureRuntimeAvailability,
	CaptureSelectedSource,
	CaptureSourceRole,
	CaptureStreamMetrics,
} from '../framescaper-capture-domain.ts';
import type { CapturePreviewSource, CaptureSourcePortV1 } from '../platform/capture-source-port.ts';
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

export interface FramescaperCaptureSessionServiceOptions<Stream = unknown, Track = unknown> {
	readonly enabled: boolean;
	readonly embedded: boolean;
	readonly sourcePort: CaptureSourcePortV1<Stream, Track>;
	readonly durable: FramescaperCaptureDurablePort;
	readonly originGuard: FramescaperCaptureOriginGuard;
	readonly completeRuntimeProbe?: (
		availability: CaptureRuntimeAvailability,
	) => PromiseLike<CaptureRuntimeAvailability> | CaptureRuntimeAvailability;
	readonly authorizeUserAction?: (generation: number) => void;
	captureOrigin(): Readonly<{
		readonly projectFence: FramescaperCaptureProjectFence;
		readonly origin: FramescaperCaptureSessionOrigin;
	}>;
	createRecorder(
		request: FramescaperCaptureRecorderRequest<Stream, Track>,
	): PromiseLike<FramescaperCaptureRecorder> | FramescaperCaptureRecorder;
	finalize(request: FramescaperCaptureFinalizeRequest): PromiseLike<void> | void;
	readonly createId?: (prefix: string) => string;
	readonly now?: () => number;
	readonly waitCountdown?: (durationMs: number, signal: AbortSignal) => Promise<void>;
	readonly onChange?: () => void;
}

export interface FramescaperCaptureSessionActions {
	openSetup(): void;
	requestPreview(roles: readonly CaptureSourceRole[]): Promise<void>;
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
	}>[];
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
