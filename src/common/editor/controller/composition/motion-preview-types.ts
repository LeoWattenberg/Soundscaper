/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionPreviewQuality } from '../../motion-temporal-sampling.ts';
import type { MotionAsset } from '../../motion-asset.ts';
import type { MotionscaperProject } from '../../motion-project-types.ts';
import type { Rational, RationalInput } from '../../timeline-time.ts';
import type { MotionSurface } from '../../motion-surface.ts';

export type MotionPreviewBackendName = 'worker-webgl2' | 'worker-cpu' | 'host-cpu';
export interface MotionPreviewFrame {
	readonly width: number; readonly height: number; readonly rgba: Uint8ClampedArray;
	readonly time: Rational; readonly compositionId: string; readonly revision: number; readonly generation: number;
	readonly backend: MotionPreviewBackendName;
}
export interface MotionPreviewState {
	readonly status: 'idle' | 'loading' | 'rendering' | 'playing' | 'paused' | 'error' | 'disposed';
	readonly compositionId: string | null; readonly time: Rational | null;
	readonly backend: MotionPreviewBackendName | null; readonly error: string | null;
	readonly cacheBytes: number; readonly generation: number;
}
export type MotionPreviewAssetLoader = (asset: MotionAsset, signal?: AbortSignal) => Promise<Uint8Array>;
export type MotionPreviewFootageDecoder = (asset: Extract<MotionAsset, { kind: 'footage' }>, sourceTime: Rational, signal?: AbortSignal) => Promise<MotionSurface>;
export interface MotionPreviewRequest { readonly compositionId: string; readonly time: RationalInput; readonly quality?: MotionPreviewQuality }
export interface MotionPreviewPlayRequest { readonly compositionId: string; readonly startTime: RationalInput; readonly endTime: RationalInput; readonly quality?: MotionPreviewQuality }
export interface MotionPreviewBackend {
	setProject(project: MotionscaperProject, loadAsset: MotionPreviewAssetLoader, signal: AbortSignal, decodeFootage?: MotionPreviewFootageDecoder): Promise<MotionPreviewBackendName>;
	render(request: Readonly<{ compositionId: string; time: Rational; generation: number; quality?: MotionPreviewQuality }>, signal: AbortSignal): Promise<MotionPreviewFrame>;
	dispose(): void;
}
export interface MotionPreviewClient {
	setProject(project: unknown, loadAsset: MotionPreviewAssetLoader, decodeFootage?: MotionPreviewFootageDecoder): Promise<void>;
	seek(request: MotionPreviewRequest): Promise<void>;
	play(request: MotionPreviewPlayRequest): void;
	pause(): void;
	dispose(): void;
	snapshot(): MotionPreviewState;
}
export interface MotionPreviewOptions {
	readonly onFrame: (frame: MotionPreviewFrame) => void;
	readonly onState: (state: MotionPreviewState) => void;
	readonly onError?: (error: Error) => void;
	readonly maximumCacheBytes?: number;
	readonly maximumAssetBytes?: number;
	readonly maximumWorkingBytes?: number;
	readonly backendFactory?: () => Promise<MotionPreviewBackend>;
	readonly clock?: Readonly<{ now(): number; schedule(callback: () => void, delayMs: number): unknown; cancel(token: unknown): void }>;
}
