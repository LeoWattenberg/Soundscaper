/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectDocument } from '../src/common/editor/controller/document/native-project-types.ts';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

const FRAMES = 4_096;
const SAMPLE_RATE = 48_000;

test('a failed second PCM source aborts one streamed destination without publishing and permits retry', async () => {
	const project = createCurrentAudioEditorProject({
		id: 'project-a', title: 'Two sources', sampleRate: SAMPLE_RATE,
		sources: [
			{ id: 's1', name: 'first.wav', frameCount: FRAMES, channelCount: 2, sampleRate: SAMPLE_RATE },
			{ id: 's2', name: 'second.wav', frameCount: FRAMES, channelCount: 2, sampleRate: SAMPLE_RATE },
		],
		clips: [
			{ id: 'c1', sourceId: 's1', title: 'First', timelineStartFrame: 0, durationFrames: FRAMES, sourceDurationFrames: FRAMES },
			{ id: 'c2', sourceId: 's2', title: 'Second', timelineStartFrame: FRAMES, durationFrames: FRAMES, sourceDurationFrames: FRAMES },
		],
		tracks: [{ type: 'audio', id: 't1', name: 'Audio', clipIds: ['c1', 'c2'] }],
	} as never) as unknown as NativeProjectDocument;
	const pcm = new Float32Array(FRAMES).fill(0.25);
	const failure = new Error('second PCM source failed');
	const attempts: Array<{
		bytesWritten: number;
		chunks: Uint8Array<ArrayBuffer>[];
		commits: number;
		abortReasons: unknown[];
	}> = [];
	const published: Blob[] = [];
	let failSecond = true;
	const fixture = createFixture({
		getProject: () => project,
		loadStoredSourceChannels: async () => { throw new Error('whole source read'); },
		store: {
			estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }),
			beginSourceWrite: async () => { throw new Error('unexpected source write'); },
			deleteSource: async () => undefined,
			async *readSourceChunks(sourceId: string) {
				const attempt = attempts.at(-1);
				assert.ok(attempt);
				if (sourceId === 's1') {
					yield { channels: [pcm, pcm] };
					return;
				}
				assert.equal(sourceId, 's2');
				assert.ok(attempt.bytesWritten > FRAMES * 2 * 4, 'the first PCM source reached the ZIP before the second source');
				if (failSecond) {
					yield { channels: [pcm.subarray(0, FRAMES / 2), pcm.subarray(0, FRAMES / 2)] };
					throw failure;
				}
				yield { channels: [pcm, pcm] };
			},
		},
		fileService: {
			isDesktop: false,
			chooseSaveTarget: async () => null,
			prepareSave: async () => {
				const attempt = { bytesWritten: 0, chunks: [] as Uint8Array<ArrayBuffer>[], commits: 0, abortReasons: [] as unknown[] };
				attempts.push(attempt);
				return {
					mode: 'stream' as const,
					createWritable: async () => new WritableStream<Uint8Array>({
						write(value) {
							attempt.chunks.push(value.slice() as Uint8Array<ArrayBuffer>);
							attempt.bytesWritten += value.byteLength;
						},
					}),
					bytesWritten: () => attempt.bytesWritten,
					commit: async () => {
						attempt.commits += 1;
						published.push(new Blob(attempt.chunks));
						return { fileName: 'two-sources.dawproject', size: attempt.bytesWritten };
					},
					abort: async (reason: unknown) => { attempt.abortReasons.push(reason); },
				};
			},
			saveFile: async () => { throw new Error('Blob fallback was used'); },
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	await assert.rejects(service.saveDawproject(), (error: unknown) => error === failure);
	assert.equal(attempts.length, 1);
	assert.ok(attempts[0]!.bytesWritten > 0);
	assert.equal(attempts[0]!.commits, 0);
	assert.deepEqual(attempts[0]!.abortReasons, [failure]);
	assert.deepEqual(published, [], 'the incomplete archive was never published');

	failSecond = false;
	await service.saveDawproject();
	assert.equal(attempts.length, 2);
	assert.equal(attempts[1]!.commits, 1);
	assert.deepEqual(attempts[1]!.abortReasons, []);
	assert.equal(published.length, 1);
	const archive = await readDawprojectArchive(published[0]!);
	try {
		assert.equal((await archive.readEntry('audio/001-first.wav'))?.size, 44 + FRAMES * 2 * 4);
		assert.equal((await archive.readEntry('audio/002-second.wav'))?.size, 44 + FRAMES * 2 * 4);
	} finally {
		await archive.close();
	}
});
