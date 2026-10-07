/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import type { AudioEditorSignalRenderer } from '../src/common/editor/signal-generator-renderer.ts';

interface InstrumentedGenerator {
	createAudioEditorSignalRenderer(type: string, options: Readonly<Record<string, unknown>>): AudioEditorSignalRenderer;
	readonly work: { powers: number; amplitudes: number; geometry: number };
}

async function instrument(): Promise<InstrumentedGenerator> {
	const url = new URL('../src/common/editor/signal-generator-renderer.ts', import.meta.url);
	const source = (await readFile(url, 'utf8'))
		.replace('frequencyRatio ** progress', '(work.powers++, frequencyRatio ** progress)')
		.replace('startAmplitude + amplitudeDifference * progress', '(work.amplitudes++, startAmplitude + amplitudeDifference * progress)')
		.replace('const toneStart =', 'work.geometry++; const toneStart =');
	const bundle = await build({ stdin: { contents: `const work = { powers: 0, amplitudes: 0, geometry: 0 };\n${source}\nexport { work };`,
		resolveDir: new URL('../src/common/editor/', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
	return await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0]!.text)}`) as InstrumentedGenerator;
}

test('constant logarithmic Chirp frequency and positive amplitude avoid per-frame interpolation work', async () => {
	const module = await instrument();
	const renderer = module.createAudioEditorSignalRenderer('chirp', { sampleRate: 8000, durationSeconds: .13, startFrequency: 211, endFrequency: 211, startAmplitude: .7, endAmplitude: .7 });
	while (renderer.next(127)) { /* Drain the supported constant-endpoint job. */ }
	assert.equal(module.work.powers, 0);
	assert.equal(module.work.amplitudes, 0);
	const varying = module.createAudioEditorSignalRenderer('chirp', { sampleRate: 8000, durationSeconds: .13, startFrequency: 211, endFrequency: 911, startAmplitude: .7, endAmplitude: .1 });
	while (varying.next(127)) { /* Variable jobs retain the original arithmetic. */ }
	assert.equal(module.work.powers, varying.frameCount);
	assert.equal(module.work.amplitudes, varying.frameCount);
});

test('DTMF keeps the exact active symbol geometry across partial block requests', async () => {
	const module = await instrument();
	const renderer = module.createAudioEditorSignalRenderer('dtmf', { sampleRate: 8000, sequence: '1', toneSeconds: 2.11, durationSeconds: 2.113 });
	for (let chunk = 0; chunk < 100; chunk++) renderer.next(1);
	assert.equal(module.work.geometry, 1);
});
