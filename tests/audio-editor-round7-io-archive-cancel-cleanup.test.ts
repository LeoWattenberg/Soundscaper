/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { stemProject } from '../src/common/editor/controller/export/temporary-export.ts';
import { throwIfAborted } from '../src/common/editor/controller/shared/app-helpers.ts';
import { createSequentialZip32Archive } from '../src/common/editor/controller/export/internal/archive/sequential-zip32-stream.ts';
import { streamStemArchiveExport } from '../src/common/editor/controller/export/internal/archive/streaming-stem-archive-export.ts';

for (const cancellation of ['before-add', 'after-close', 'none'] as const) test(`clip ZIP ownership survives cancellation ${cancellation}`, async () => {
	const project = createSoundscaperProject({ id: 'voice', title: 'Voice', sampleRate: 48_000,
		sources: [{ id: 'voice-source', storageKey: 'voice-pcm', channelCount: 1, frameCount: 100, sampleRate: 48_000 }],
		clips: [{ id: 'voice-clip', sourceId: 'voice-source', title: 'Voice', timelineStartFrame: 0, durationFrames: 100 }],
		tracks: [{ id: 'voice-track', type: 'audio', name: 'Voice', clipIds: ['voice-clip'] }],
	});
	const settings = { mode: 'clips', format: 'wav', bitDepth: 16, dither: 'none', date: '2026-10-10' };
	const plan = createExportPlan(project, settings);
	const signal = new AbortController();
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let retained = true;
	let abortCount = 0;
	let cleanupCount = 0;
	let closedBlob: Blob | null = null;
	const sequential = await createSequentialZip32Archive({
		async write(chunk: Uint8Array) { chunks.push(Uint8Array.from(chunk)); },
		async close() { closedBlob = new Blob(chunks, { type: 'application/zip' }); return closedBlob; },
		async abort() { abortCount += 1; retained = false; },
	});
	const wav = encodeWav([new Float32Array(100).fill(0.25)], { sampleRate: 48_000, bitDepth: 16, dither: 'none' });
	const deliver = () => streamStemArchiveExport({
		abortSignal: signal.signal, admitOutputBytes: 1024 ** 2, copy: {},
		async createStreamingStemArchive() {
			return {
				add: sequential.add, abort: sequential.abort,
				async finish() {
					const finished = await sequential.finish();
					if (cancellation === 'after-close') signal.abort();
					return { blob: finished.output, async cleanup() { cleanupCount += 1; retained = false; } };
				},
			};
		},
		exportProject: project, exportRenderSources: {}, plan, settings, stemProject, throwIfAborted,
		async renderAndEncode() {
			if (cancellation === 'before-add') signal.abort();
			return { bytes: wav };
		},
		async conformExport() { return []; }, reportProgress() {},
	});
	if (cancellation === 'none') {
		const result = await deliver();
		assert.equal(retained, true, 'successful delivery transfers the finished file to its caller');
		assert.equal(cleanupCount, 0);
		const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
		assert.deepEqual(Object.keys(entries), [plan.outputs[0]!.fileName]);
		assert.deepEqual(entries[plan.outputs[0]!.fileName], wav);
		await result.cleanup();
		assert.equal(cleanupCount, 1);
		assert.equal(retained, false);
	} else {
		await assert.rejects(deliver, { name: 'AbortError' });
		assert.equal(retained, false, 'a cancelled delivery must release the ZIP even after its writer closes');
		assert.equal(cleanupCount, cancellation === 'after-close' ? 1 : 0);
		assert.equal(closedBlob !== null, cancellation === 'after-close');
	}
	assert.equal(abortCount, cancellation === 'before-add' ? 1 : 0, 'finished ZIP abort intentionally leaves caller-owned output alone');
});
