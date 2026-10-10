/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';
import { deriveDesktopDirectWavSmokePaths } from '../scripts/lib/desktop-direct-wav-smoke.mjs';
import {
	createDesktopDirectWavStagingObserver,
	DESKTOP_DIRECT_WAV_SMOKE_FIXTURE,
} from '../scripts/lib/desktop-direct-wav-staging-observer.mjs';

const TOKEN = '0123456789abcdef0123456789abcdef';

test('cancellation staging follows the real atomic writer after the first WAV commits', { timeout: 5_000 }, async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'direct-wav-write-identity-'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const paths = deriveDesktopDirectWavSmokePaths(directory, TOKEN);
	await mkdir(paths.root);
	const targets = new SaveTargetStore();
	const saves = new AtomicSaveManager({ targets } as unknown as ConstructorParameters<typeof AtomicSaveManager>[0]);
	context.after(async () => { await saves.dispose(); });
	const owner = Object.freeze({ name: 'smoke-renderer' });
	const bytes = stagingWav();
	const samples = sampledObserver(paths);
	const firstTarget = targets.registerPath(paths.completed, { owner, purpose: 'audio-pcm-mix' });
	const first = await saves.begin({ owner, targetId: firstTarget.id, size: bytes.length });
	await saves.writeChunk({ owner, writeId: first.writeId, offset: 0, bytes });
	await samples.next();
	await saves.finish(first.writeId, { owner });
	const cancelTarget = targets.registerPath(paths.cancelled, { owner, purpose: 'audio-pcm-mix' });
	const cancelled = await saves.begin({ owner, targetId: cancelTarget.id, size: bytes.length });
	await saves.writeChunk({ owner, writeId: cancelled.writeId, offset: 0, bytes });
	await samples.next();
	await saves.abort(cancelled.writeId, { owner });
	// A subsequent export must not replace the cancelled writer's evidence.
	const aiff = Buffer.alloc(bytes.length);
	aiff.write('FORM invalid AIFF');
	await writeFile(join(paths.root, '.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.soundscaper-part'), aiff);
	await samples.next();
	await rm(join(paths.root, '.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.soundscaper-part'));
	const result = await samples.observer.stop();
	assert.deepEqual(result, {
		observed: true, riffHeaderValidated: true, nonzeroPayloadByteObserved: true,
		maximumStagedBytes: bytes.length, maximumInspectedPrefixBytes: bytes.length, remainingStagingFiles: 0,
	});
});

test('the completed export alone cannot supply cancellation evidence', { timeout: 5_000 }, async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'direct-wav-first-write-'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const paths = deriveDesktopDirectWavSmokePaths(directory, TOKEN);
	await mkdir(paths.root);
	const stage = join(paths.root, `.${TOKEN}.soundscaper-part`);
	await writeFile(stage, stagingWav());
	const samples = sampledObserver(paths);
	await samples.next();
	await rm(stage);
	await writeFile(paths.completed, stagingWav());
	await samples.next();
	const result = await samples.observer.stop();
	assert.equal(result.observed, false);
	assert.equal(result.nonzeroPayloadByteObserved, false);
});

test('a later nonzero write cannot satisfy a silent cancelled write', { timeout: 5_000 }, async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'direct-wav-silent-cancel-'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const paths = deriveDesktopDirectWavSmokePaths(directory, TOKEN);
	await mkdir(paths.root);
	await writeFile(paths.completed, stagingWav());
	const stage = join(paths.root, `.${TOKEN}.soundscaper-part`);
	const silent = stagingWav();
	silent.fill(0, 44);
	await writeFile(stage, silent);
	const samples = sampledObserver(paths);
	await samples.next();
	await rm(stage);
	const later = join(paths.root, '.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.soundscaper-part');
	await writeFile(later, stagingWav());
	await samples.next();
	await rm(later);
	const result = await samples.observer.stop();
	assert.equal(result.observed, true);
	assert.equal(result.riffHeaderValidated, true);
	assert.equal(result.nonzeroPayloadByteObserved, false);
	assert.equal(result.remainingStagingFiles, 0);
});

function stagingWav(): Buffer {
	const output = DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output;
	const bytes = Buffer.alloc(300);
	bytes.write('RIFF', 0);
	bytes.writeUInt32LE(output.byteLength - 8, 4);
	bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(output.channelCount, 22);
	bytes.writeUInt32LE(output.sampleRate, 24);
	bytes.writeUInt32LE(output.sampleRate * output.channelCount * 2, 28);
	bytes.writeUInt16LE(output.channelCount * 2, 32);
	bytes.writeUInt16LE(output.bitDepth, 34);
	bytes.write('data', 36);
	bytes.writeUInt32LE(output.dataBytes, 40);
	bytes[100] = 1;
	return bytes;
}

function sampledObserver(paths: ReturnType<typeof deriveDesktopDirectWavSmokePaths>) {
	let remaining = 0;
	let sampled: (() => void) | undefined;
	const observer = createDesktopDirectWavStagingObserver(paths, {
		pollIntervalMs: 1,
		readdirImpl: (async (root: Parameters<typeof readdir>[0]) => {
			const entries = await readdir(root, { withFileTypes: true });
			if (remaining && --remaining === 0) sampled?.();
			return entries;
		}) as unknown as typeof readdir,
	});
	return {
		observer,
		async next(): Promise<void> {
			remaining = 2;
			await new Promise<void>((resolve) => { sampled = resolve; });
		},
	};
}
