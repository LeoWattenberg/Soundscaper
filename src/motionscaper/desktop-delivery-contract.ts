/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionRenderIdentity, MotionRenderPlan } from '../common/editor/controller/export/motion-render-pipeline.ts';
export const MOTION_DELIVERY_CHUNK_BYTES = 4 * 1024 * 1024;
export const MOTION_DELIVERY_METHODS = ['getProfile', 'begin', 'write', 'commit', 'cancel'] as const;
export type MotionDeliveryMethod = typeof MOTION_DELIVERY_METHODS[number];
export const MOTION_PRORES_DELIVERY_PROFILE = Object.freeze({
	id: 'prores-4444-v1', extension: 'mov', container: 'mov', codec: 'prores-4444',
	carrierPixelFormat: 'rgba-f32le', encoderPixelFormat: 'yuva444p10', encoderInputBits: 10,
	alphaStorageBits: 16, maximumFrames: 32_768, audio: 'excluded', colorSpace: 'rec709', alphaMode: 'straight',
} as const);
export interface MotionDesktopDeliveryReceipt {
	readonly identity: MotionRenderIdentity; readonly name: string; readonly byteLength: number;
	readonly sha256: string; readonly frameCount: number; readonly profile: typeof MOTION_PRORES_DELIVERY_PROFILE;
}
export interface MotionDesktopDelivery {
	getProfile(): Promise<typeof MOTION_PRORES_DELIVERY_PROFILE | null>;
	begin(request: { readonly plan: MotionRenderPlan; readonly suggestedName: string }): Promise<{ readonly token: string } | null>;
	write(request: { readonly token: string; readonly offset: number; readonly bytes: Uint8Array }): Promise<void>;
	commit(request: { readonly token: string; readonly byteLength: number; readonly sha256: string }): Promise<MotionDesktopDeliveryReceipt>;
	cancel(request: { readonly token: string }): Promise<void>;
}
