/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { prepareAudacitySerializedDatabase, readAup4SampleBlock, upgradeAudacityProjectDatabase } from '../src/common/editor/aup4-database.js';
import { streamAup4SourceAudio } from '../src/common/editor/aup4-import-audio.ts';
import { readAup4ImportSamples } from '../src/common/editor/aup4-import-sample-reader.ts';
import { AUP4_IMPORT_CHUNK_FRAMES, type Aup4ImportSourcePlan } from '../src/common/editor/aup4-import-plan.ts';
import { createAup3Fixture } from './aup3-fixture.js';
import { SQL } from './helpers/aup4-database-harness.js';

test('a gigabyte sequence is planned without reading or allocating PCM', async () => {
	const frames = 300_000_000;
	const bytes = await createAup3Fixture({ SQL, tracks: [{ clips: [{ blocks: [{ id: -frames }] }] }] });
	const db = new SQL.Database(bytes);
	try {
		const root = upgradeAudacityProjectDatabase(db).validation.document.root;
		const decoded = await decodeAudacityProjectTree(root, () => assert.fail('planning must not load audio'), { planAudio: true });
		const source = decoded.sources[0] as Aup4ImportSourcePlan;
		assert.equal(source.frameCount, frames);
		assert.equal(Object.hasOwn(source, 'channels'), false);
		const stream = streamAup4SourceAudio(source, () => assert.fail('silence has no sample row'));
		try {
			for (let index = 0; index < 3; index += 1) {
				const next = await stream.next();
				assert.equal(next.done, false);
				assert.equal(next.value?.[0]?.length, AUP4_IMPORT_CHUNK_FRAMES);
				assert.equal(next.value?.[0]?.every((sample) => sample === 0), true);
			}
		} finally { await stream.return(undefined); }
	} finally { db.close(); }
});

for (const differentRates of [false, true]) {
	test(`streaming preserves PCM, timing, channel padding and resampling (different rates: ${differentRates})`, async () => {
		const samples = Array.from({ length: 65_536 }, (_, i) => Math.sin(i / 17) * 0.5);
		const bytes = await createAup3Fixture({ SQL, tracks: [
			{ name: 'Stereo', channel: 0, linked: true, rate: 48_000,
				clips: [{ offset: 1, trimLeft: 0.1, blocks: [{ samples }, { id: -123 }, { samples: [0.5, -0.5] }] }] },
			{ name: 'Stereo', channel: 1, rate: differentRates ? 44_100 : 48_000,
				clips: [{ offset: 1, trimLeft: 0.1, sampleFormat: 0x00020001, blocks: [{ samples }, { samples: [0.25] }] }] },
		] });
		const db = new SQL.Database(prepareAudacitySerializedDatabase(bytes));
		try {
			const root = upgradeAudacityProjectDatabase(db).validation.document.root;
			let id = 0;
			const options = { idFactory: (prefix: string) => `${prefix}-${++id}`, now: '2026-09-10T00:00:00.000Z' };
			const full = await decodeAudacityProjectTree(root, (block: number) => readAup4SampleBlock(db, block), options);
			id = 0;
			const planned = await decodeAudacityProjectTree(root, () => assert.fail('unexpected PCM read'), { ...options, planAudio: true });
			assert.deepEqual(planned.project.clips, full.project.clips);
			assert.deepEqual(planned.warnings, full.warnings);
			for (const [index, source] of (planned.sources as Aup4ImportSourcePlan[]).entries()) {
				const expected = full.sources[index]?.channels;
				assert.ok(expected);
				let frames = 0;
				for await (const chunk of streamAup4SourceAudio(source, (block, offset, count) => {
					assert.ok(count <= AUP4_IMPORT_CHUNK_FRAMES);
					return readAup4ImportSamples(db, block, offset, count);
				})) {
					for (const [channel, values] of chunk.entries()) {
						assert.ok(values.length <= AUP4_IMPORT_CHUNK_FRAMES);
						assert.deepEqual(values, expected[channel]!.subarray(frames, frames + values.length));
					}
					frames += chunk[0]!.length;
				}
				assert.equal(frames, source.frameCount);
			}
		} finally { db.close(); }
	});
}

test('pulling stops on cancellation before another sample range is read', async () => {
	const source: Aup4ImportSourcePlan = { sourceId: 'source', sampleRate: 48_000, channelCount: 1,
		frameCount: 131_072, channelPlans: [{ sampleRate: 48_000, frameCount: 131_072, outputFrames: 131_072,
			blocks: [{ blockId: 1, start: 0, frameCount: 131_072 }] }] };
	const abort = new AbortController();
	let reads = 0;
	const stream = streamAup4SourceAudio(source, (_block, _offset, count) => {
		reads += 1;
		return new Float32Array(count);
	}, () => abort.signal.throwIfAborted());
	await stream.next();
	assert.equal(reads, 1);
	abort.abort();
	await assert.rejects(stream.next(), { name: 'AbortError' });
	assert.equal(reads, 1);
});
