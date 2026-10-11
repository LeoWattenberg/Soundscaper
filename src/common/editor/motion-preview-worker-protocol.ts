/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionPreviewQuality } from './motion-temporal-sampling.ts';
import type { MotionscaperProject } from './motion-project-types.ts';
import type { MotionSurface } from './motion-surface.ts';
import type { Rational } from './timeline-time.ts';
import type { MotionPreviewBackendName, MotionPreviewFrame } from './controller/composition/motion-preview-types.ts';

export type MotionPreviewWorkerRequest =
	| { readonly type: 'project'; readonly requestId: number; readonly project: MotionscaperProject; readonly maximumAssetBytes: number; readonly maximumWorkingBytes: number; readonly hasFootageDecoder: boolean }
	| { readonly type: 'render'; readonly requestId: number; readonly compositionId: string; readonly time: Rational; readonly generation: number; readonly quality?: MotionPreviewQuality }
	| { readonly type: 'cancel'; readonly requestId: number }
	| { readonly type: 'asset-result'; readonly resourceId: number; readonly bytes: Uint8Array }
	| { readonly type: 'footage-result'; readonly resourceId: number; readonly surface: MotionSurface }
	| { readonly type: 'resource-error'; readonly resourceId: number; readonly message: string; readonly name: string }
	| { readonly type: 'dispose' };
export type MotionPreviewWorkerResponse =
	| { readonly type: 'ready'; readonly requestId: number; readonly backend: MotionPreviewBackendName }
	| { readonly type: 'frame'; readonly requestId: number; readonly frame: MotionPreviewFrame }
	| { readonly type: 'error'; readonly requestId: number; readonly message: string; readonly name: string }
	| { readonly type: 'asset'; readonly requestId: number; readonly resourceId: number; readonly assetId: string }
	| { readonly type: 'footage'; readonly requestId: number; readonly resourceId: number; readonly assetId: string; readonly time: Rational };

export interface MotionPreviewWorkerScope {
	postMessage(message: MotionPreviewWorkerResponse, transfer?: Transferable[]): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<MotionPreviewWorkerRequest>) => void): void;
	removeEventListener(type: 'message', listener: (event: MessageEvent<MotionPreviewWorkerRequest>) => void): void;
}
export interface MotionPreviewWorkerPort {
	postMessage(message: MotionPreviewWorkerRequest, transfer?: Transferable[]): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<MotionPreviewWorkerResponse>) => void): void;
	addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
	removeEventListener(type: 'message', listener: (event: MessageEvent<MotionPreviewWorkerResponse>) => void): void;
	removeEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
	terminate(): void;
}
