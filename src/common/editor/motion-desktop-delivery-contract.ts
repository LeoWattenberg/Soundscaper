/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionRenderIdentity, MotionRenderPlan } from './controller/export/motion-render-pipeline.ts';
import type { MotionNativePcmOptions, MotionNativePcmReceipt } from './motion-native-pcm-carrier-v1.ts';
export const MOTION_DELIVERY_CHUNK_BYTES = 4 * 1024 * 1024;
export const MOTION_DELIVERY_METHODS = ['getProfile', 'begin', 'write', 'commit', 'cancel'] as const;
export type MotionDeliveryMethod = typeof MOTION_DELIVERY_METHODS[number];
export const MOTION_PRORES_DELIVERY_PROFILE = Object.freeze({
	id: 'prores-4444-v1', extension: 'mov', container: 'mov', codec: 'prores-4444',
	carrierPixelFormat: 'rgba-f32le', encoderPixelFormat: 'yuva444p10', encoderInputBits: 10,
	alphaStorageBits: 16, maximumFrames: 32_768, audio: 'pcm-s24le', audioInputBits: 32, audioOutputBits: 24,
	maximumAudioSamples: 134_217_728, sampleRateMaximum: 192_000, colorSpace: 'rec709', alphaMode: 'straight',
} as const);
export interface MotionDesktopDeliveryReceipt {
	readonly identity: MotionRenderIdentity; readonly name: string; readonly byteLength: number;
	readonly sha256: string; readonly frameCount: number; readonly profile: typeof MOTION_PRORES_DELIVERY_PROFILE;
	readonly audio: (MotionNativePcmOptions & { readonly sampleCount: number }) | null;
}
export interface MotionDesktopDelivery {
	getProfile(): Promise<typeof MOTION_PRORES_DELIVERY_PROFILE | null>;
	begin(request: { readonly plan: MotionRenderPlan; readonly suggestedName: string; readonly audio?: MotionNativePcmOptions }): Promise<{ readonly token: string } | null>;
	write(request: { readonly token: string; readonly offset: number; readonly bytes: Uint8Array; readonly stream?: 'audio' }): Promise<void>;
	commit(request: { readonly token: string; readonly byteLength: number; readonly sha256: string; readonly audio?: MotionNativePcmReceipt }): Promise<MotionDesktopDeliveryReceipt>;
	cancel(request: { readonly token: string }): Promise<void>;
}
