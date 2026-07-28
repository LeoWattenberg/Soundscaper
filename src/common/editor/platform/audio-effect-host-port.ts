/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AbortablePortOperation,
	AudioTransferFormat,
	BoundedAudioChunk,
	BoundedByteChunk,
	BoundedPortMessage,
} from './bounded-transfer.ts';

export interface AudioEffectDescriptor {
	readonly id: string;
	readonly name: string;
	readonly vendor?: string;
	readonly version?: string;
	readonly supportsRealtime: boolean;
	readonly supportsOffline: boolean;
}

export interface AudioEffectInventory {
	readonly effects: readonly AudioEffectDescriptor[];
}

export interface AudioEffectOpenRequest extends AbortablePortOperation {
	readonly effectId: string;
	readonly format: AudioTransferFormat;
	readonly maximumChunkFrames: number;
	readonly initialState?: BoundedByteChunk;
}

export interface AudioEffectProcessRequest extends AbortablePortOperation {
	readonly chunk: BoundedAudioChunk;
}

export interface AudioEffectReadStateRequest extends AbortablePortOperation {
	readonly maximumBytes: number;
}

export interface AudioEffectWriteStateRequest extends AbortablePortOperation {
	readonly state: BoundedByteChunk;
}

export interface AudioEffectInstancePort {
	readonly descriptor: AudioEffectDescriptor;
	readonly format: AudioTransferFormat;
	readonly maximumChunkFrames: number;
	process(request: AudioEffectProcessRequest): Promise<BoundedAudioChunk>;
	readState(request: AudioEffectReadStateRequest): Promise<BoundedByteChunk>;
	writeState(request: AudioEffectWriteStateRequest): Promise<void>;
	close(request: AbortablePortOperation): Promise<void>;
}

export interface AudioEffectHostPort {
	enumerate(request: AbortablePortOperation): Promise<BoundedPortMessage<AudioEffectInventory>>;
	open(request: AudioEffectOpenRequest): Promise<AudioEffectInstancePort>;
}
