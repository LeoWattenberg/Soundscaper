/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AbortablePortOperation,
	BoundedByteChunk,
} from './bounded-transfer.ts';

export interface MediaReadOpenRequest<Source> extends AbortablePortOperation {
	readonly source: Source;
	readonly maximumChunkBytes: number;
	readonly startByte?: number;
	readonly endByteExclusive?: number;
}

export interface MediaByteReadRequest extends AbortablePortOperation {
	readonly maximumBytes: number;
}

export interface MediaByteReaderPort {
	readonly maximumChunkBytes: number;
	readonly positionBytes: number;
	readonly sizeBytes: number | null;
	read(request: MediaByteReadRequest): Promise<BoundedByteChunk | null>;
	close(request: AbortablePortOperation): Promise<void>;
}

export interface StreamingMediaReadPort<Source = unknown> {
	open(request: MediaReadOpenRequest<Source>): Promise<MediaByteReaderPort>;
}

export interface MediaWriteOpenRequest<Target> extends AbortablePortOperation {
	readonly target: Target;
	readonly maximumChunkBytes: number;
	readonly expectedBytes?: number;
	readonly overwrite?: boolean;
}

export interface MediaByteWriteRequest extends AbortablePortOperation {
	readonly chunk: BoundedByteChunk;
}

export interface MediaWriteReceipt {
	readonly bytesWritten: number;
	readonly contentId?: string;
}

export interface MediaByteWriterPort {
	readonly maximumChunkBytes: number;
	readonly bytesWritten: number;
	write(request: MediaByteWriteRequest): Promise<void>;
	commit(request: AbortablePortOperation): Promise<Readonly<MediaWriteReceipt>>;
	abort(request: AbortablePortOperation & Readonly<{ reason?: unknown }>): Promise<void>;
}

export interface StreamingMediaWritePort<Target = unknown> {
	open(request: MediaWriteOpenRequest<Target>): Promise<MediaByteWriterPort>;
}
