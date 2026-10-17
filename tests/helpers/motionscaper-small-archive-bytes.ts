/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createBlobScapeArchiveByteSource, readScapeArchiveByteRange } from '../../src/common/editor/scape-archive-byte-source.ts';
import type { ScapeProjectInput } from '../../src/common/editor/scape-project-input.ts';

/** Byte equality for small test fixtures only; production readers never materialize an archive. */
export async function smallMotionscaperArchiveBytes(input: ScapeProjectInput | undefined): Promise<Uint8Array> {
	assert.ok(input); assert.ok(input.size <= 8 * 1024 * 1024, 'Fixture archive must remain bounded.');
	const source = input instanceof Blob ? createBlobScapeArchiveByteSource(input) : input;
	return readScapeArchiveByteRange(source, { offset: 0, length: source.size });
}
