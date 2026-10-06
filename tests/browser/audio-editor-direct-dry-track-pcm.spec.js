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
		}
		return results;
	}, ROOT);
	expect(result).toHaveLength(12);
	for (const comparison of result) expect(comparison.different, JSON.stringify(comparison)).toBe(0);
});
