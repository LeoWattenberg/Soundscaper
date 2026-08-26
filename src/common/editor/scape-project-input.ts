/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertScapeArchiveByteSource,
	type ScapeArchiveByteSource,
} from './scape-archive-byte-source.ts';
import type {
	ScapeArchiveByteSourceReaderFactory,
	ScapeArchiveReaderFactory,
} from './scape-archive-reader.ts';
import type { ScapeArchiveEntry } from './scape-archive-envelope.ts';

export type ScapeProjectInput = Blob | ScapeArchiveByteSource;

export interface ScapeProjectInputReaderFactories {
	readonly byteSource?: ScapeArchiveByteSourceReaderFactory;
	readonly blob?: ScapeArchiveReaderFactory;
}

export async function withScapeProjectInput<Value>(
	input: ScapeProjectInput,
	signal: AbortSignal | undefined,
	action: (entries: readonly ScapeArchiveEntry[]) => Promise<Value>,
	factories: ScapeProjectInputReaderFactories = {},
): Promise<Value> {
	const {
		withScapeArchiveByteSource,
		withScapeArchiveReader,
	} = await import('./scape-archive-reader.ts');
	if (input instanceof Blob) {
		return withScapeArchiveReader(input, signal, action, factories.blob);
	}
	assertScapeArchiveByteSource(input);
	return withScapeArchiveByteSource(input, signal, action, factories.byteSource);
}
