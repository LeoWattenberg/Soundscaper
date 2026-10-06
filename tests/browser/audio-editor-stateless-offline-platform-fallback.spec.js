/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from './audio-editor-test-fixtures.js';

test.use({ browserCoverage: false });

const ROOT = '/__stateless-offline-platform-fallback__';

async function routeRuntime(page) {
	const bundle = await build({
		stdin: {
			contents: `export { createAudioEditorEngine } from './src/common/editor/engine/runtime-class.ts';
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
	const worklet = await readFile(new URL('../../src/common/editor/render-capture-worklet.js', import.meta.url), 'utf8');
	let captureWorkletRequests = 0;
	await page.route('**/render-capture-worklet.js', async (route) => {
		captureWorkletRequests++;
		await route.fulfill({ contentType: 'text/javascript', body: worklet });
	});
	await page.route(`${ROOT}/**`, async (route) => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript',
			body: html ? '<!doctype html><title>Offline platform fallback</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
	return () => captureWorkletRequests;
}

test('WebKit streams the requested PCM through clocked capture when bounded offline is preferred', async ({ page, browserName }) => {
	test.skip(browserName !== 'webkit', 'This regression exercises the actual WebKit platform fallback; admitted engines retain their offline parity tests.');
	const captureWorkletRequests = await routeRuntime(page);
	const result = await page.evaluate(async (root) => {
		const { createAudioEditorEngine, createSoundscaperProject, createAudioSource,
			createAudioTrack, createAudioClip } = await import(`${root}/entry.js`);
		const sampleRate = 48_000;
		const sourceFrames = 8_003;
		const sourceStartFrame = 137;
		const startFrame = 111;
		const endFrame = 6_512;
		// Exact binary fractions with a period of 257 expose a missing 128-frame quantum.
		const sample = (frame, channel) => channel === 0
			? (frame % 257 + 1) / 1_024
			: -((frame * 3 + 17) % 257 + 1) / 1_024;
		const buffer = new AudioBuffer({ length: sourceFrames, numberOfChannels: 2, sampleRate });
		for (let channel = 0; channel < 2; channel++) {
			buffer.copyToChannel(Float32Array.from({ length: sourceFrames }, (_, frame) => sample(frame, channel)), channel);
		}
		const project = createSoundscaperProject({ sampleRate, masterChannels: 2,
			sources: [createAudioSource({ id: 'source', sampleRate, channelCount: 2, frameCount: sourceFrames })],
			tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] }, sampleRate)],
			clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 0,
				sourceStartFrame, sourceDurationFrames: 7_003, durationFrames: 7_003 })],
		});
		let offlineCalls = 0;
		const engine = createAudioEditorEngine({ offlineAudioContextFactory: () => {
			offlineCalls++;
			throw new Error('WebKit must use clocked capture instead of the native offline backend.');
		} });
		const expected = [0, 1].map(channel => new Uint32Array(Float32Array.from(
			{ length: endFrame - startFrame }, (_, frame) => sample(sourceStartFrame + startFrame + frame, channel),
		).buffer));
		const packets = [];
		let capturedFrames = 0;
		let different = 0;
		const mismatches = [];
		try {
			engine.loadProject(project, new Map([['source', buffer]]));
			const rendered = await engine.renderMixRealtime({ preferBoundedOffline: true,
				startFrame, endFrame, includeTail: false, chunkFrames: 512,
				onChunk: async (channels, metadata) => {
					if (metadata.frameOffset !== capturedFrames || metadata.sampleRate !== sampleRate
						|| channels.length !== 2 || channels.some(channel => channel.length !== channels[0].length)) {
						throw new Error('The clocked PCM packet geometry changed.');
					}
					for (let channel = 0; channel < channels.length; channel++) {
						const words = new Uint32Array(channels[channel].buffer, channels[channel].byteOffset, channels[channel].length);
						for (let frame = 0; frame < words.length; frame++) {
							const reference = expected[channel][capturedFrames + frame];
							if (words[frame] === reference) continue;
							different++;
							if (mismatches.length < 8) mismatches.push({ channel, frame: capturedFrames + frame, actual: words[frame], expected: reference });
						}
					}
					packets.push({ frameOffset: metadata.frameOffset, frames: channels[0].length });
					capturedFrames += channels[0].length;
					await Promise.resolve();
				},
			});
			return { offlineCalls, rendered, capturedFrames, different, mismatches, packets };
		} finally { await engine.dispose(); }
	}, ROOT);
	expect(result.offlineCalls).toBe(0);
	expect(captureWorkletRequests()).toBe(1);
	expect(result.rendered).toEqual({ sampleRate: 48_000, channelCount: 2, frameCount: 6_401, chunkCount: 13 });
	expect(result.capturedFrames).toBe(6_401);
	expect(result.packets).toHaveLength(13);
	expect(result.packets.at(-1)).toEqual({ frameOffset: 6_144, frames: 257 });
	expect(result.different, JSON.stringify(result.mismatches)).toBe(0);
});
