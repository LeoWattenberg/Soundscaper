/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AbortablePortOperation,
	BoundedAudioChunk,
	BoundedByteChunk,
	BoundedPortMessage,
} from './bounded-transfer.ts';
import type {
	MediaByteReaderPort,
	MediaByteWriterPort,
} from './media-stream-port.ts';

export type MediaTransferChunk = BoundedByteChunk | BoundedAudioChunk;

export interface MediaProbeRequest extends AbortablePortOperation {
	readonly reader: MediaByteReaderPort;
	readonly maximumProbeBytes: number;
}

export interface MediaProbePort<Result = Readonly<Record<string, unknown>>> {
	probe(request: MediaProbeRequest): Promise<BoundedPortMessage<Result>>;
}

export interface MediaDecodeOpenRequest<Configuration> extends AbortablePortOperation {
	readonly reader: MediaByteReaderPort;
	readonly configuration: BoundedPortMessage<Configuration>;
}

export interface MediaDecodeReadRequest extends AbortablePortOperation {
	readonly maximumOutputBytes: number;
}

export interface MediaDecodeSessionPort<Chunk extends MediaTransferChunk = MediaTransferChunk> {
	read(request: MediaDecodeReadRequest): Promise<Chunk | null>;
	close(request: AbortablePortOperation): Promise<void>;
}

export interface MediaDecodePort<
	Configuration = Readonly<Record<string, unknown>>,
	Chunk extends MediaTransferChunk = MediaTransferChunk,
> {
	open(request: MediaDecodeOpenRequest<Configuration>): Promise<MediaDecodeSessionPort<Chunk>>;
}

export interface MediaEncodeOpenRequest<Configuration> extends AbortablePortOperation {
	readonly writer: MediaByteWriterPort;
	readonly configuration: BoundedPortMessage<Configuration>;
}

export interface MediaEncodeWriteRequest<Chunk extends MediaTransferChunk> extends AbortablePortOperation {
	readonly chunk: Chunk;
}

export interface MediaCodecCompletion {
	readonly inputChunks: number;
	readonly outputBytes: number;
}

export interface MediaEncodeSessionPort<Chunk extends MediaTransferChunk = MediaTransferChunk> {
	write(request: MediaEncodeWriteRequest<Chunk>): Promise<void>;
	finish(request: AbortablePortOperation): Promise<BoundedPortMessage<MediaCodecCompletion>>;
	abort(request: AbortablePortOperation & Readonly<{ reason?: unknown }>): Promise<void>;
}

export interface MediaEncodePort<
	Configuration = Readonly<Record<string, unknown>>,
	Chunk extends MediaTransferChunk = MediaTransferChunk,
> {
	open(request: MediaEncodeOpenRequest<Configuration>): Promise<MediaEncodeSessionPort<Chunk>>;
}
