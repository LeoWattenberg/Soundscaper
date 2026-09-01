/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	isNativeCheckpointDirectorySyncUnsupported,
	syncNativeCheckpointDirectory,
} from '../desktop/native-services-checkpoint-directory-durability.ts';

for (const sourceFile of [
	'../desktop/native-services-checkpoint-recovery.ts',
	'../desktop/native-services-checkpoint-recovery-v3.ts',
]) {
	test(`${sourceFile} syncs the checkpoint directory after atomic rename`, async () => {
		const source = await readFile(new URL(sourceFile, import.meta.url), 'utf8');
		const store = source.slice(source.indexOf('export function createFramescaperNativeFilesystemCheckpointStore'),
			source.indexOf('function checkpointAuthority'));
		assert.match(store, /await rename\(temporary, destination\);\s+await syncNativeCheckpointDirectory\(directory\);/u);
	});
}

test('checkpoint directory sync tolerates only unsupported-platform errors', async () => {
	for (const code of ['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EPERM']) {
		const error = Object.assign(new Error(code), { code });
		assert.equal(isNativeCheckpointDirectorySyncUnsupported(error), true);
		await syncNativeCheckpointDirectory('/checkpoint', async () => { throw error; });
	}
	const storageFailure = Object.assign(new Error('I/O failure'), { code: 'EIO' });
	assert.equal(isNativeCheckpointDirectorySyncUnsupported(storageFailure), false);
	await assert.rejects(
		syncNativeCheckpointDirectory('/checkpoint', async () => { throw storageFailure; }),
		(error: unknown) => error === storageFailure,
	);
});

test('checkpoint directory sync verifies and closes its directory handle', async () => {
	const events: string[] = [];
	await syncNativeCheckpointDirectory('/checkpoint', async () => ({
		async stat() { events.push('stat'); return { isDirectory: () => true }; },
		async sync() { events.push('sync'); },
		async close() { events.push('close'); },
	}));
	assert.deepEqual(events, ['stat', 'sync', 'close']);

	await assert.rejects(syncNativeCheckpointDirectory('/checkpoint', async () => ({
		async stat() { return { isDirectory: () => false }; },
		async sync() { throw new Error('sync must not run'); },
		async close() { events.push('rejected-close'); },
	})), /not a directory/iu);
	assert.equal(events.at(-1), 'rejected-close');
});
