import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createPackageFromStreams, extractFile, statFile } from '@electron/asar';

const ASAR_BLOCK_SIZE = 4 * 1024 * 1024;

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

test('streamed ASAR entries record integrity for the archived bytes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-asar-integrity-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const archivePath = join(root, 'app.asar');
	const archivedBytes = Buffer.from('{"name":"streamed-package"}\n');
	const repositoryBytes = await readFile(join(process.cwd(), 'package.json'));
	assert.notDeepEqual(archivedBytes, repositoryBytes);

	await createPackageFromStreams(archivePath, [{
		path: 'package.json',
		type: 'file',
		streamGenerator: () => Readable.from([archivedBytes]),
		unpacked: false,
		stat: {
			mode: 0o100644,
			size: archivedBytes.byteLength,
		},
	}]);

	const extractedBytes = extractFile(archivePath, 'package.json');
	const { integrity } = statFile(archivePath, 'package.json');
	assert.deepEqual(extractedBytes, archivedBytes);
	assert.deepEqual(integrity, {
		algorithm: 'SHA256',
		hash: sha256(extractedBytes),
		blockSize: ASAR_BLOCK_SIZE,
		blocks: [sha256(extractedBytes)],
	});
});
