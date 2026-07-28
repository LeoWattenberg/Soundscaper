/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AbortablePortOperation,
	AudioTransferFormat,
	BoundedAudioChunk,
	BoundedPortMessage,
} from './bounded-transfer.ts';

export type AudioDeviceKind = 'audio-input' | 'audio-output';

export interface AudioDeviceDescriptor {
	readonly id: string;
	readonly kind: AudioDeviceKind;
	readonly label: string;
	readonly isDefault: boolean;
}

export interface AudioDeviceInventory {
	readonly devices: readonly AudioDeviceDescriptor[];
}

export interface AudioDeviceOpenRequest extends AbortablePortOperation {
	readonly deviceId: string;
	readonly format: AudioTransferFormat;
	readonly maximumChunkFrames: number;
}

export interface AudioInputStreamPort {
	readonly device: AudioDeviceDescriptor;
	readonly format: AudioTransferFormat;
	readonly maximumChunkFrames: number;
	read(request: AbortablePortOperation): Promise<BoundedAudioChunk | null>;
	close(request: AbortablePortOperation): Promise<void>;
}

export interface AudioOutputWriteRequest extends AbortablePortOperation {
	readonly chunk: BoundedAudioChunk;
}

export interface AudioOutputStreamPort {
	readonly device: AudioDeviceDescriptor;
	readonly format: AudioTransferFormat;
	readonly maximumChunkFrames: number;
	write(request: AudioOutputWriteRequest): Promise<void>;
	close(request: AbortablePortOperation): Promise<void>;
}

export interface AudioDeviceHostPort {
	enumerate(request: AbortablePortOperation): Promise<BoundedPortMessage<AudioDeviceInventory>>;
	openInput(request: AudioDeviceOpenRequest): Promise<AudioInputStreamPort>;
	openOutput(request: AudioDeviceOpenRequest): Promise<AudioOutputStreamPort>;
}
