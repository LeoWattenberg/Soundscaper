/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiffStreamEncoder, inspectAiffLayout } from '../src/common/editor/aiff.js';
import { normalizeBextMetadata } from '../src/common/editor/broadcast-wave.ts';
import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES } from '../src/common/editor/pcm-sink-admission.ts';
import { createWavStreamEncoder, inspectWavLayout } from '../src/common/editor/wav.js';
import { createDirectPcmExportFixture, directPlan } from './helpers/direct-pcm-export-fixture.ts';

for (const format of ['wav', 'bwf', 'aiff'] as const) {
	test(`the ${format.toUpperCase()} download fallback keeps a continuous bounded capture clock`, async () => {
		const bext = format === 'bwf' ? normalizeBextMetadata({ description: 'Realtime delivery' }, { version: 2 }) : null;
		const geometry = { sampleRate: 48_000, channelCount: 2, totalFrames: 2, bitDepth: 24, ...(bext ? { bext } : {}) } as const;
		const layout = format === 'aiff' ? inspectAiffLayout(geometry) : inspectWavLayout(geometry);
		const plan = { ...directPlan({ format, outputFileBytesPerRender: layout.byteLength }), bext,
			mimeType: format === 'aiff' ? 'audio/aiff' : 'audio/wav',
			outputs: [{ fileName: `mix.${format === 'aiff' ? 'aiff' : 'wav'}`, trackId: 'track' }] };
		const fixture = createDirectPcmExportFixture(plan);
		fixture.setPrepared({ mode: 'blob' });
		const createRenderEngine = fixture.runtime.createCacheAwareRenderEngine as () => SimulatedRenderEngine;
		const runtime = {
			...fixture.runtime, createWavStreamEncoder, createAiffStreamEncoder,
			createCacheAwareRenderEngine() {
				const engine = createRenderEngine();
				return { ...engine, async renderMixRealtime(request: Readonly<Record<string, unknown>>) {
					if (request.suspendForBackpressure !== false) {
						throw Object.assign(new Error('The realtime capture clock skipped audio frames.'), { code: 'REALTIME_CAPTURE_CLOCK_GAP' });
					}
					return engine.renderMixRealtime(request);
				} };
			},
		};
		await createEditorExportService(runtime).handleExportAction('export');
		assert.deepEqual(fixture.errors, []);
		assert.equal(fixture.downloads.length, 1);
		const delivered = fixture.downloads[0]?.blob;
		assert.ok(delivered instanceof Blob);
		assert.equal(delivered.size, layout.byteLength);
		const header = new TextDecoder().decode((await delivered.arrayBuffer()).slice(0, 4));
		assert.equal(header, format === 'aiff' ? 'FORM' : 'RIFF');
		const request = fixture.renderRequests[0];
		const pendingChunks = Number(request?.maximumPendingChunks);
		const chunkFrames = Number(request?.chunkFrames);
		assert.equal(pendingChunks * chunkFrames * 2 * Float32Array.BYTES_PER_ELEMENT, AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES);
	});
}

interface SimulatedRenderEngine {
	renderMixRealtime(request: Readonly<Record<string, unknown>>): Promise<unknown>;
}
