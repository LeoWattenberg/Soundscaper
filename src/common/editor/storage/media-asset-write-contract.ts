/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MediaAssetWriteOptions {
	readonly expectedBytes: number;
	readonly expectedSha256: string;
	readonly signal?: AbortSignal;
}

export interface OwnedMediaAssetPublication {
	readonly metadata: Readonly<Record<string, unknown>>;
	discardIfCurrent(): Promise<boolean>;
}

export interface MediaAssetWriter {
	readonly maximumChunkBytes: number;
	readonly bytesWritten: number;
	write(bytes: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	commit(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<Record<string, unknown>>>;
	commitOwned?(options?: Readonly<{ signal?: AbortSignal }>): Promise<OwnedMediaAssetPublication>;
	abort(): Promise<void>;
}

export interface OwnedMediaAssetWriter extends MediaAssetWriter {
	commitOwned(options?: Readonly<{ signal?: AbortSignal }>): Promise<OwnedMediaAssetPublication>;
}
