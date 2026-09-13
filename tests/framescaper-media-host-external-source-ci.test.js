/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	downloadPinnedFramescaperMediaHostSource,
	runFramescaperMediaHostExternalSourceCiProvisioning,
} from '../scripts/lib/framescaper-media-host-external-source-ci.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('the external-source downloader admits only exact bytes', async (context) => {
	const temporary = await mkdtemp(join(tmpdir(), 'framescaper-media-source-download-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const bytes = Buffer.from('source archive');
	const source = {
		id: 'fixture', url: 'https://example.test/source.tar.gz', byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
	const response = (body = [bytes]) => ({
		ok: true, status: 200, body,
		headers: { get: (name) => name === 'content-length' ? String(bytes.byteLength) : null },
	});
	const destination = join(temporary, 'source.archive');
	await downloadPinnedFramescaperMediaHostSource({
		destination, source, fetchImpl: async () => response(),
	});
	assert.deepEqual(await readFile(destination), bytes);
	await assert.rejects(downloadPinnedFramescaperMediaHostSource({
		destination: join(temporary, 'bad.archive'),
		source: { ...source, sha256: '0'.repeat(64) },
		fetchImpl: async () => response(),
	}), /digest authentication/iu);
});

test('CI exports five individually authenticated media source trees', async (context) => {
	const runnerTemp = await mkdtemp(join(tmpdir(), 'framescaper-media-source-ci-'));
	context.after(() => rm(runnerTemp, { recursive: true, force: true }));
	const githubEnvironmentPath = join(runnerTemp, 'github-env');
	await writeFile(githubEnvironmentPath, 'EXISTING=1\n');
	const calls = [];
	const result = await runFramescaperMediaHostExternalSourceCiProvisioning({
		repositoryRoot: ROOT, runnerTemp, githubEnvironmentPath,
	}, {
		async download({ destination, source }) {
			calls.push(`download:${source.id}`);
			await writeFile(destination, source.id, { flag: 'wx' });
		},
		async extract({ archivePath, sourceRoot, source }) {
			calls.push(`extract:${source.id}`);
			assert.equal(String(await readFile(archivePath)), source.id);
			await mkdir(sourceRoot);
			await writeFile(join(sourceRoot, 'source.txt'), source.id);
		},
		authenticate(manifest, id, _sourceRoot) {
			calls.push(`authenticate:${id}`);
			const row = manifest.libraries.find((source) => source.id === id);
			assert.ok(row);
			return {
				id, version: row.version, revision: row.revision,
				archiveSha256: row.sha256, extractedTreeSha256: row.extractedTree.sha256,
			};
		},
	});
	assert.deepEqual(result.sources.map(({ id }) => id), [
		'x264', 'x265', 'libvpx', 'libopus', 'zlib',
	]);
	for (const { id, root } of result.sources) {
		assert.equal(String(await readFile(join(root, 'source.txt'))), id);
		const receipt = JSON.parse(await readFile(join(root, '.framescaper-source-identity.json')));
		assert.equal(receipt.component, id);
		await assert.rejects(lstat(join(result.workspace, `${id}.archive`)), /ENOENT/u);
	}
	assert.equal(String(await readFile(githubEnvironmentPath)), [
		'EXISTING=1', `FRAMESCAPER_MEDIA_EXTERNAL_SOURCE_ROOT=${result.sourceSetRoot}`, '',
	].join('\n'));
	assert.equal(calls.length, 15);
});
