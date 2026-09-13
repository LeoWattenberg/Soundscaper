/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	FRAMESCAPER_FFMPEG_CI_ADMISSION,
	downloadPinnedFramescaperFfmpeg,
	runFramescaperFfmpegCiProvisioning,
} from '../scripts/lib/framescaper-ffmpeg-ci.mjs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/u, '');

test('FFmpeg CI source admission is the exact source-manifest archive and tree', () => {
	assert.deepEqual(FRAMESCAPER_FFMPEG_CI_ADMISSION, {
		version: '9.0.1',
		url: 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz',
		archive: {
			fileName: 'ffmpeg-9.0.1.tar.xz', byteLength: 12_036_420,
			sha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
		},
		extractedTree: {
			algorithm: 'framescaper-portable-source-tree-sha256-v1', fileCount: 10_397,
			sha256: 'dc709cc7d80424f45aab44ac94e59f7c8669fe18b877e9e5f1319006bfa622b4',
		},
	});
});

test('FFmpeg download publishes only its exact URL, length, and digest', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-ffmpeg-download-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const bytes = Buffer.from('ffmpeg');
	const admission = {
		url: 'https://example.test/ffmpeg.tar.xz',
		archive: { byteLength: bytes.byteLength, sha256: digest(bytes) },
	};
	const response = (body = [bytes], url = admission.url) => ({
		ok: true, status: 200, url, body,
	});
	const destination = join(root, 'ffmpeg.tar.xz');
	await downloadPinnedFramescaperFfmpeg({
		destination, admission, fetchImpl: async () => response(),
	});
	assert.deepEqual(await readFile(destination), bytes);
	for (const [name, body, url, pattern] of [
		['wrong-url', [bytes], 'https://mirror.test/ffmpeg.tar.xz', /URL admission/iu],
		['short', [bytes.subarray(1)], admission.url, /authentication/iu],
		['long', [bytes, Buffer.from('!')], admission.url, /exceeded/iu],
	]) {
		await assert.rejects(downloadPinnedFramescaperFfmpeg({
			destination: join(root, `${name}.tar.xz`), admission,
			fetchImpl: async () => response(body, url),
		}), pattern);
	}
});

test('CI writes the authenticated source receipt before publishing its handoff', async (context) => {
	const runnerTemp = await mkdtemp(join(tmpdir(), 'framescaper-ffmpeg-ci-'));
	context.after(() => rm(runnerTemp, { recursive: true, force: true }));
	const environment = join(runnerTemp, 'github-env');
	await writeFile(environment, 'EXISTING=value\n');
	const calls = [];
	const result = await runFramescaperFfmpegCiProvisioning({
		repositoryRoot: ROOT, runnerTemp, githubEnvironmentPath: environment,
	}, {
		async download({ destination }) {
			calls.push('download');
			await writeFile(destination, 'archive');
		},
		async extract({ sourceRoot }) {
			calls.push('extract');
			await mkdir(sourceRoot);
			await writeFile(join(sourceRoot, 'RELEASE'), '9.0.1\n');
		},
		collectTree() {
			calls.push('collect');
			return { ...FRAMESCAPER_FFMPEG_CI_ADMISSION.extractedTree, files: [] };
		},
	});
	assert.deepEqual(calls, ['download', 'extract', 'collect']);
	const receipt = JSON.parse(await readFile(
		join(result.sourceRoot, '.framescaper-source-identity.json'), 'utf8',
	));
	assert.equal(receipt.root, result.sourceRoot);
	assert.equal(receipt.archiveSha256, FRAMESCAPER_FFMPEG_CI_ADMISSION.archive.sha256);
	assert.equal(receipt.extractedTreeSha256, FRAMESCAPER_FFMPEG_CI_ADMISSION.extractedTree.sha256);
	assert.equal(await readFile(environment, 'utf8'), [
		'EXISTING=value', `FRAMESCAPER_FFMPEG_901_SOURCE_ROOT=${result.sourceRoot}`, '',
	].join('\n'));
});

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
