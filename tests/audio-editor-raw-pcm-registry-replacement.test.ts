/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { normalizeRawPcmSpoolRegistry } from '../src/common/editor/storage/raw-pcm-spool-record.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';

for (const manifest of [false, true]) {
	const protocol = manifest ? 'manifest' : 'ordinary';
	test(`${protocol} replacement retries registry drift while preserving another spool`, async () => {
		const fixture = await replacementFixture(manifest);
		let attempts = 0;
		fixture.onReplace = async (key, expected, replacement) => {
			attempts += 1;
			if (attempts === 1) {
				const registry = normalizeRawPcmSpoolRegistry(expected, 'project');
				await fixture.values.replaceIfCurrent(key, expected, {
					...registry,
					records: registry.records.map((record) => record.spoolId === 'second'
						? { ...record, data: { owner: 'concurrent' } } : record),
				});
				return false;
			}
			return fixture.values.replaceIfCurrent(key, expected, replacement);
		};
		const updated = await fixture.repository.replaceData(fixture.first, { owner: 'updated' });
		assert.deepEqual(updated.data, { owner: 'updated' });
		assert.equal(attempts, 2);
		assert.equal(fixture.recoveryReads.filter((key) => key.startsWith('capture-spool-tail')).length, manifest ? 2 : 0);
		assert.equal(fixture.recoveryReads.filter((key) => key.startsWith('framescaper-capture-spool-append')).length, manifest ? 2 : 0);
		assert.deepEqual((await fixture.repository.load('project', 'second'))?.data, { owner: 'concurrent' });
	});

	test(`${protocol} replacement refuses a changed record after losing its CAS race`, async () => {
		const fixture = await replacementFixture(manifest);
		let attempts = 0;
		fixture.onReplace = async (key, expected) => {
			attempts += 1;
			const registry = normalizeRawPcmSpoolRegistry(expected, 'project');
			await fixture.values.replaceIfCurrent(key, expected, {
				...registry,
				records: registry.records.map((record) => record.spoolId === 'first'
					? { ...record, data: { owner: 'winner' } } : record),
			});
			return false;
		};
		await assert.rejects(fixture.repository.replaceData(fixture.first, { owner: 'loser' }), /changed before data replacement/u);
		assert.equal(attempts, 1);
		assert.deepEqual((await fixture.repository.load('project', 'first'))?.data, { owner: 'winner' });
	});

	test(`${protocol} replacement stops after the bounded CAS retry limit`, async () => {
		const fixture = await replacementFixture(manifest);
		let attempts = 0;
		fixture.onReplace = async () => { attempts += 1; return false; };
		await assert.rejects(fixture.repository.replaceData(fixture.first, { owner: 'refused' }), /replacement exceeded its bounded CAS retry limit/u);
		assert.equal(attempts, 32);
		assert.deepEqual((await fixture.repository.load('project', 'first'))?.data, { owner: 'first' });
	});
}

async function replacementFixture(manifest: boolean) {
	const memory = getMemoryDatabase(`raw-replacement-${Date.now()}-${Math.random()}`);
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const recoveryReads: string[] = [];
	const fixture = {
		values, recoveryReads,
		onReplace: null as ((...args: Parameters<KeyValueRepository['replaceIfCurrent']>) => Promise<boolean>) | null,
	};
	const faultValues = {
		putIfAbsent: values.putIfAbsent.bind(values),
		deleteIfCurrent: values.deleteIfCurrent.bind(values),
		listByPrefix: values.listByPrefix.bind(values),
		get: (key: string) => {
			if (key.startsWith('capture-spool-tail') || key.startsWith('framescaper-capture-spool-append')) recoveryReads.push(key);
			return values.get(key);
		},
		replaceIfCurrent: (...args: Parameters<KeyValueRepository['replaceIfCurrent']>) => (
			args[0].startsWith('raw-pcm-spool-registry') && fixture.onReplace
				? fixture.onReplace(...args) : values.replaceIfCurrent(...args)
		),
	};
	const repository = new RawPcmSpoolRepository(faultValues, new SourceRecordRepository(port));
	const create = (spoolId: string) => (manifest ? repository.createFramescaper.bind(repository) : repository.create.bind(repository))({
		projectId: 'project', spoolId, spoolToken: `${spoolId}-token`,
		sampleRate: 48_000, channelCount: 1, chunkFrames: 8, data: { owner: spoolId },
	});
	const first = await create('first');
	await create('second');
	recoveryReads.length = 0;
	return Object.assign(fixture, { repository, first });
}
