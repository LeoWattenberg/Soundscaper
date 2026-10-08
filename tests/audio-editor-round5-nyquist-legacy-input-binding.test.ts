/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { parseNyquistPluginHeader } from '../src/common/editor/nyquist/plugin-parser.js';

const runtime = await loadNyquistWasm(await readFile(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
const sampleRate = 48_000;
const input = Float32Array.from({ length: 9_600 }, (_, frame) => 0.25 * Math.sin(2 * Math.PI * 440 * frame / sampleRate));
const archive = gunzipSync(await readFile(new URL('./fixtures/nyquist-archive/10bandeq.ny.gz', import.meta.url))).toString();

test('modern input and prompt controls retain the existing numeric S default', () => {
	const modern = runtime.evaluate({ source: ';nyquist plug-in\n;version 4\n;type process\n(if (= s 0.25) (mult *track* 0.5) "incorrect S")',
		sampleRate, channels: [Float32Array.of(0.5)] });
	assert.equal(modern.type, 'audio', modern.output);
	assert.ok(modern.channels);
	assert.deepEqual([...modern.channels[0] as Float32Array], [0.25]);
	const prompt = runtime.evaluate({ source: 's', sampleRate, channels: [Float32Array.of(0.5)] });
	assert.equal(prompt.type, 'number', prompt.output);
	assert.equal(prompt.value, 0.25);
});

for (const channelCount of [1, 2]) {
	test(`the unchanged archived version-one equalizer processes ${channelCount} selected channel(s)`, () => {
		const plugin = parseNyquistPluginHeader(archive);
		assert.equal(plugin.version, 1);
		const controls = Object.fromEntries(plugin.controls.filter(control => control.variable)
			.map(control => [control.variable, control.defaultValue]));
		const channels = Array.from({ length: channelCount }, (_, index) => Float32Array.from(input, value => value / (index + 1)));
		const result = runtime.evaluate({ source: archive, sampleRate, channels, controls, maxOutputFrames: input.length });
		assert.equal(result.type, 'audio', result.output);
		assert.equal(result.frameCount, input.length);
		assert.equal(result.channels.length, channelCount);
		for (let channel = 0; channel < channelCount; channel++) {
			const output = result.channels[channel] as Float32Array;
			assert.equal(output.length, input.length);
			for (let frame = 0; frame < input.length; frame++) assert.ok(Math.abs(output[frame]! - channels[channel]![frame]!) < 1e-5);
		}
		assert.doesNotMatch(result.output, /error:/iu);
		const boosted = runtime.evaluate({ source: archive, sampleRate, channels,
			controls: { ...controls, band: 5, gain: 6 }, maxOutputFrames: input.length });
		assert.equal(boosted.type, 'audio', boosted.output);
		assert.ok(boosted.channels);
		const boostedEnergy = (boosted.channels[0] as Float32Array).reduce((sum, value) => sum + value * value, 0);
		const originalEnergy = input.reduce((sum, value) => sum + value * value, 0);
		assert.ok(boostedEnergy > originalEnergy * 3);
	});
}

for (const version of [1, 2, 3]) {
	test(`version ${version} process and analyze plug-ins receive the actual legacy input`, () => {
		const header = `;nyquist plug-in\n;version ${version}\n`;
		const processed = runtime.evaluate({ source: `${header};type process\n(mult s 0.5)`,
			sampleRate, channels: [Float32Array.of(1, -0.5, 0.25)] });
		assert.equal(processed.type, 'audio', processed.output);
		assert.ok(processed.channels);
		assert.deepEqual([...processed.channels[0] as Float32Array], [0.5, -0.25, 0.125]);
		const analyzed = runtime.evaluate({ source: `${header};type analyze\n(peak s 3)`,
			sampleRate, channels: [Float32Array.of(0.5, -0.75, 0.25)] });
		assert.equal(analyzed.type, 'number', analyzed.output);
		assert.equal(analyzed.value, 0.75);
	});
}

test('legacy audio does not change modern plug-in or Lisp/SAL prompt S semantics', () => {
	const legacy = runtime.evaluate({ source: ';nyquist plug-in\n;version 1\n;type process\ns',
		sampleRate, channels: [Float32Array.of(0.5)] });
	assert.equal(legacy.type, 'audio', legacy.output);
	const modern = runtime.evaluate({ source: ';nyquist plug-in\n;version 4\n;type process\n(if (= s 0.25) (mult *track* 0.5) "incorrect S")',
		sampleRate, channels: [Float32Array.of(0.5)] });
	assert.equal(modern.type, 'audio', modern.output);
	assert.ok(modern.channels);
	assert.deepEqual([...modern.channels[0] as Float32Array], [0.25]);
	for (const [source, language] of [['s', 'lisp'], ['return s', 'sal']] as const) {
		const prompt = runtime.evaluate({ source, language, sampleRate, channels: [Float32Array.of(0.5)] });
		assert.equal(prompt.type, 'number', prompt.output);
		assert.equal(prompt.value, 0.25);
	}
	const generated = runtime.evaluate({ source: ';nyquist plug-in\n;version 1\n;type generate\ns', sampleRate, channels: [] });
	assert.equal(generated.type, 'number', generated.output);
	assert.equal(generated.value, 0.25);
});
