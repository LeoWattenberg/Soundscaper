/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './audio-editor-test-fixtures.js';

test.use({ browserCoverage: false });
const ROOT = '/__direct-dry-track-pcm__';

test('neutral stereo PCM preserves the real engine source scheduling at frame boundaries', async ({ page }) => {
	const bundle = await build({
		stdin: {
			contents: `export { renderSimpleDryTrackPcm } from './src/common/editor/controller/effects/internal/direct-dry-track-pcm.ts';
export { createAudioEditorEngine } from './src/common/editor/engine/runtime-class.ts';
export { createSoundscaperProject } from './src/soundscaper/editor-project.ts';
export { createAudioClip, createAudioTrack, createAudioSource } from './src/common/editor/project-media-factory.ts';`,
			resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
		},
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'],
		plugins: [{
			name: 'unused-neutral-graph-assets',
			setup(builder) {
				builder.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: 'asset-url' }));
				builder.onLoad({ filter: /.*/, namespace: 'asset-url' }, () => ({
					contents: 'export default "/__unused_neutral_graph_asset__";', loader: 'js',
				}));
			},
		}],
	});
	await page.route(`${ROOT}/**`, async (route) => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript',
			body: html ? '<!doctype html><title>Direct dry PCM parity</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async (root) => {
		const { createAudioEditorEngine, createSoundscaperProject, createAudioSource, createAudioTrack,
			createAudioClip, renderSimpleDryTrackPcm } = await import(`${root}/entry.js`);
		const results = [];
		for (const sampleRate of [8_000, 44_100, 48_000, 96_000]) {
			const buffer = new AudioBuffer({ length: 4_003, numberOfChannels: 2, sampleRate });
			for (let channel = 0; channel < 2; channel += 1) {
				const input = buffer.getChannelData(channel);
				for (let frame = 0; frame < input.length; frame += 1) input[frame] = Math.sin(frame * 0.17 + channel) * 0.3;
				input.set([-0, 1e-40, -1e-40, 1.1754943508222875e-38], 201);
			}
			for (const [clipStart, sourceStart, start, end] of [[101, 17, 89, 2_900], [1_337, 1_101, 1_501, 2_801], [129, 131, 129, 2_830]]) {
				const project = createSoundscaperProject({ sampleRate, masterChannels: 2,
					sources: [createAudioSource({ id: 'source', sampleRate, channelCount: 2, frameCount: buffer.length })],
					tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] }, sampleRate)],
					clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: clipStart,
						sourceStartFrame: sourceStart, durationFrames: 2_701 })],
				});
				const sources = new Map([['source', buffer]]);
				const direct = await renderSimpleDryTrackPcm(project, sources, 'track', start, end, 2);
				if (!direct) throw new Error('The neutral fixture was not admitted');
				const engine = createAudioEditorEngine();
				let different = 0;
				try {
					engine.loadProject(project, sources);
					const rendered = await engine.renderMix({ startFrame: start, endFrame: end, outputFrames: end - start,
						trackId: 'track', includeMaster: false, includeTrackPan: false, respectMuteSolo: false });
					for (let channel = 0; channel < 2; channel += 1) {
						const actual = new Uint32Array(direct[channel].buffer);
						const expected = new Uint32Array(rendered.getChannelData(channel).buffer);
						for (let frame = 0; frame < actual.length; frame += 1) if (actual[frame] !== expected[frame]) different += 1;
					}
				} finally { await engine.dispose(); }
				results.push({ sampleRate, clipStart, sourceStart, start, end, different });
			}
			const longBuffer = new AudioBuffer({ length: sampleRate * 9 + 137, numberOfChannels: 2, sampleRate });
			for (let channel = 0; channel < 2; channel++) {
				const input = longBuffer.getChannelData(channel);
				for (let frame = 0; frame < input.length; frame++) input[frame] = Math.sin(frame * 0.037 + channel) * 0.3;
				input.set([-0, 1e-40, -1e-40, 1.1754943508222875e-38], sampleRate * 5 + 13);
			}
			const project = createSoundscaperProject({ sampleRate, masterChannels: 2,
				sources: [createAudioSource({ id: 'source', sampleRate, channelCount: 2, frameCount: longBuffer.length })],
				tracks: [createAudioTrack({ id: 'left', clipIds: ['a'] }, sampleRate)],
				clips: [createAudioClip({ id: 'a', sourceId: 'source', timelineStartFrame: 0,
					sourceStartFrame: 137, durationFrames: sampleRate * 7 })],
			});
			for (const sourceMode of ['buffer', 'chunks']) {
			for (const [startFrame, endFrame] of [[111, sampleRate * 7], [0, sampleRate * 7],
				[sampleRate * 5 - 7, sampleRate * 5 + 13], [111, sampleRate * 7 - 1]]) {
			const engine = createAudioEditorEngine();
			try {
				const provider = { sampleRate, channelCount: 2, frameCount: longBuffer.length, chunkFrames: 65_536,
					readStorageChunk(index) { return [0, 1].map(channel => longBuffer.getChannelData(channel).subarray(index * 65_536, (index + 1) * 65_536)); } };
				engine.loadProject(project, sourceMode === 'buffer' ? new Map([['source', longBuffer]]) : new Map(),
					sourceMode === 'chunks' ? { chunkSources: new Map([['source', provider]]) } : undefined);
				const range = { startFrame, endFrame, includeTail: false };
				const whole = await engine.renderMix(range);
				const blocks = [];
				const begun = performance.now();
				await engine.renderMixRealtime({ ...range, preferBoundedOffline: true,
					onChunk: (channels) => { blocks.push(channels); } });
				const elapsed = performance.now() - begun;
				let different = 0; let offset = 0; let maximumError = 0; const mismatches = [];
				for (const channels of blocks) {
					for (let channel = 0; channel < 2; channel++) {
						const actual = new Uint32Array(channels[channel].buffer);
						const expected = new Uint32Array(whole.getChannelData(channel).buffer);
						for (let frame = 0; frame < actual.length; frame++) if (actual[frame] !== expected[offset + frame]) { maximumError = Math.max(maximumError, Math.abs(channels[channel][frame] - whole.getChannelData(channel)[offset + frame])); different++; if (mismatches.length < 8) mismatches.push({ frame: offset + frame, channel, actual: actual[frame], expected: expected[offset + frame] }); }
					}
					offset += channels[0].length;
				}
				results.push({ sampleRate, sourceMode, startFrame, endFrame, elapsed,
					windows: blocks.length, offset, length: whole.length, different, maximumError, mismatches });
			} finally { await engine.dispose(); }
			}
		}
		}
		return results;
	}, ROOT);
	expect(result).toHaveLength(44);
	for (const comparison of result) {
		if (comparison.sourceMode === 'chunks') {
			expect(comparison.maximumError, JSON.stringify(comparison)).toBeLessThanOrEqual(1e-7);
			expect(comparison.offset).toBe(comparison.length);
		} else expect(comparison.different, JSON.stringify(comparison)).toBe(0);
	}
});
