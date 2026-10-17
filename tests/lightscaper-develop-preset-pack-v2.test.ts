/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePhotoDevelopPresetPackV1, readPhotoDevelopPresetPackV1 } from '../src/lightscaper/archive/develop-preset-pack-v1.ts';
import { encodePhotoDevelopPresetPackV2, readPhotoDevelopPresetPackV2 } from '../src/lightscaper/archive/develop-preset-pack-v2.ts';

async function bytes(source: AsyncIterable<Uint8Array>) { const parts: Uint8Array[] = []; for await (const part of source) parts.push(part);
	const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0)); let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.byteLength; } return result; }
async function* stream(value: Uint8Array) { for (let index = 0; index < value.byteLength; index++) yield value.subarray(index, index + 1); }
const row = { schemaVersion: 2, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 29, presets: [] };

test('preset pack2 preserves positive-empty row2 and exact strict old row1 through its dispatcher', async () => {
	const current = await bytes(encodePhotoDevelopPresetPackV2(row, 'catalog'));
	assert.deepEqual(await readPhotoDevelopPresetPackV2(stream(current), 'catalog'), row);
	await assert.rejects(readPhotoDevelopPresetPackV1(stream(current), 'catalog'));
	const old = { ...row, schemaVersion: 1 };
	assert.deepEqual(await bytes(encodePhotoDevelopPresetPackV2(old, 'catalog')), await bytes(encodePhotoDevelopPresetPackV1(old, 'catalog')));
	assert.deepEqual(await readPhotoDevelopPresetPackV2(stream(await bytes(encodePhotoDevelopPresetPackV1(old, 'catalog'))), 'catalog'), old);
	assert.throws(() => encodePhotoDevelopPresetPackV2({ ...row, schemaVersion: 3 }, 'catalog'));
});

test('eager admission detaches rows before iteration; malformed UTF8 and chunk/byte ceilings refuse', async () => {
	const input = { ...row }, source = encodePhotoDevelopPresetPackV2(input, 'catalog'); input.revision = 1;
	assert.equal((await readPhotoDevelopPresetPackV2(stream(await bytes(source)), 'catalog')).revision, 29);
	await assert.rejects(readPhotoDevelopPresetPackV2(stream(new Uint8Array([0xff])), 'catalog'), TypeError);
	async function* excessive() { yield new Uint8Array(4_194_305); }
	await assert.rejects(readPhotoDevelopPresetPackV2(excessive(), 'catalog'), /chunk|bound/iu);
	const stop = new AbortController(); const reason = Object.freeze({ cancelled: true }); stop.abort(reason); let failure: unknown;
	try { await readPhotoDevelopPresetPackV2(stream(new Uint8Array()), 'catalog', { signal: stop.signal }); } catch (error) { failure = error; }
	assert.equal(failure, reason);
});
