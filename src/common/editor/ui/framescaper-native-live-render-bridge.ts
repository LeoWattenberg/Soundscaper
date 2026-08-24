/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NativeQueueInputFingerprintV1 } from '../native-queue-record.ts';

export interface FramescaperNativeLiveRenderInputAudioV1 {
	readonly role: 'staged-audio-mix';
	readonly byteLength: number;
}

export type FramescaperNativeLiveRenderInputRoleV1 =
	| 'evaluated-rgba-frame-pack'
	| 'staged-audio-mix';

export interface FramescaperNativeLiveRenderInputStageRequestV1 {
	readonly liveRenderVersion: 1;
	readonly planVersion: 14;
	readonly planFingerprint: string;
	readonly planPayload: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly restartJobId: string | null;
	readonly carrierByteLength: number;
	readonly audio: FramescaperNativeLiveRenderInputAudioV1 | null;
}

export interface FramescaperNativeLiveRenderBridge {
	stageLiveRenderInputs?(request: FramescaperNativeLiveRenderInputStageRequestV1):
		Promise<Readonly<{
			readonly stageId: string;
			readonly carrierByteLength: number;
			readonly scratchByteLength: number;
		}>>;
	writeLiveRenderInput?(request: Readonly<{
		readonly stageId: string;
		readonly role: FramescaperNativeLiveRenderInputRoleV1;
		readonly sequence: number;
		readonly offset: number;
		readonly bytes: Uint8Array;
	}>): Promise<Readonly<{ readonly sequence: number; readonly receivedBytes: number }>>;
	completeLiveRenderInput?(request: Readonly<{
		readonly stageId: string;
		readonly role: FramescaperNativeLiveRenderInputRoleV1;
		readonly byteLength: number;
		readonly sha256: string;
	}>): Promise<Readonly<{ readonly byteLength: number; readonly sha256: string }>>;
}

export const FRAMESCAPER_NATIVE_LIVE_RENDER_METHODS = Object.freeze([
	'stageLiveRenderInputs', 'writeLiveRenderInput', 'completeLiveRenderInput',
] as const);
