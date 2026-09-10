/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAup4DatabaseAdapter } from './aup4-database-sql.js';
import { decodeAudacitySampleBlock } from './audacity-sample-block.js';
import { AUP4_IMPORT_CHUNK_FRAMES, type Aup4ImportBlock } from './aup4-import-plan.ts';

/** Read only the requested PCM range into JavaScript, omitting block summaries. */
export function readAup4ImportSamples(
	database: Parameters<typeof createAup4DatabaseAdapter>[0],
	block: Aup4ImportBlock, offset: number, frames: number,
): Float32Array {
	if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(frames)
		|| frames < 1 || frames > AUP4_IMPORT_CHUNK_FRAMES || offset + frames > block.frameCount) {
		throw new RangeError('Invalid Audacity sample-block range.');
	}
	const adapter = createAup4DatabaseAdapter(database) as { rows(sql: string, bind: number[]): unknown[][] };
	const row = adapter.rows(`SELECT sampleformat, length(samples),
		substr(samples, ? * (sampleformat >> 16) + 1, ? * (sampleformat >> 16))
		FROM sampleblocks WHERE blockid = ? LIMIT 1`, [offset, frames, block.blockId])[0];
	if (!row) throw new Error(`Audacity sample block ${block.blockId} is missing.`);
	const format = Number(row[0]);
	if (Number(row[1]) !== block.frameCount * (format >>> 16)) throw new Error('An Audacity sample block has changed length.');
	if (!(row[2] instanceof Uint8Array)) throw new Error('An Audacity sample block has no PCM payload.');
	return decodeAudacitySampleBlock(row[2], format, { maxSamples: AUP4_IMPORT_CHUNK_FRAMES }) as Float32Array;
}
