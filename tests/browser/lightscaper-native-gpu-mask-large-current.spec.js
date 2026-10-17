/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'This bounded capacity witness requires pinned software Chromium or an actual Firefox native target.');
const PROGRAM = '/__lightscaper_native_gpu_mask_large_current.js', BLANK = '/__lightscaper_native_gpu_mask_large_current.html';
let compiled;
test.beforeAll(async () => {
	compiled = await compileNativeImageHandoffScript('native-gpu-mask-large-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-mask-large-current-reference.ts', import.meta.url)));
	expect(compiled.assets).toEqual([]);
});

test('2048² native word tone with radius64 feather returns accepted GPU under the unchanged complete phase limits', async ({ page, browserName }) => {
	// Bound only this real4MP shader+receipt+two-plane-proof workload; no
	// generic timeout, component, source, allocation or startup cap changes.
	test.setTimeout(180_000);
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Actual4MP masked GPU qualification</title>' }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper${BLANK}`));
	const value = await page.evaluate(`import(${JSON.stringify(PROGRAM)}).then(module=>module.qualifyNativeGpuMaskLargeCurrentV1())`);
	expect(value.rejected, value.errorText).toBe(false); expect(value.callbacks).toBe(1);
	expect(value.sourceSha256).toBe(value.before); expect(value.before).toMatch(/^[a-f0-9]{64}$/u);
	expect(value.sourceRetired).toBe(true); expect(value.outputRetired).toBe(true);
	expect(value.descriptor).toEqual({ schemaVersion: 1, width: 2048, height: 2048, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
	expect(value.samples).toHaveLength(27);
	// Independent sample oracle has finite129-term box sums and an identity
	// vertical mean. No production CPU image/coverage plane is allocated here.
	expect(value.samples.map(sample => sample.coverage)).toEqual(Array.from({ length: 3 }, () => [2, 5, 8, 64, 127, 128, 191, 247, 253]).flat());
	const differences = value.samples.flatMap(sample => sample.bits.slice(0, 3).map((word, at) => Math.abs(word - sample.expected[at])));
	expect(Math.max(...differences)).toBeLessThanOrEqual(8);
	expect(value.samples.every(sample => sample.bits[3] === 0x3f800000 && sample.expected[3] === 0x3f800000)).toBe(true);
	const observation = value.observation;
	if (browserName === 'chromium') { expect(observation.renderers.length).toBeGreaterThan(0); for (const renderer of observation.renderers) expect(renderer).toContain('SwiftShader'); }
	await test.info().attach('native-mask-large-observation', { body: JSON.stringify({ browser: page.context().browser()?.version(), value }), contentType: 'application/json' });
	expect(observation.privateRetired).toBe(true); expect(observation.stableUploadsRetired).toBe(true);
	expect(observation.nativeScratchRetired).toBe(true); expect(observation.readbacksRetired).toBe(true);
	expect(observation.incompleteClears).toBe(0); expect(observation.imageLive).toBe(0);
	const admittedNativeTarget = observation.normalFloatSupported && observation.mixedSamplersSupported
		&& observation.maximumTexture >= 2048 && observation.viewportWidth >= 2048 && observation.viewportHeight >= 2048;
	if (browserName === 'firefox' && !admittedNativeTarget) {
		expect(value.backend).toBe('cpu');
		expect(value.reason).toMatch(/^(?:canvas-unavailable|context-unavailable|float-target-unavailable|float-conformance-failed|texture-capacity|uniform-capacity|mask-capability-unavailable|mask-integer-copy-unavailable|mask-integer-clear-unavailable|mask-mixed-sampler-unavailable)$/u);
		test.skip(true, `Actual Firefox native capability is unavailable: ${value.reason}; this is not4MP GPU qualification.`);
	}
	// A metadata-only eligible result, unsupported-stage/working-set shortcut,
	// rejected raw attempt or wholeCPU output cannot satisfy this positive.
	expect(value.backend, value.reason).toBe('webgl2'); expect(admittedNativeTarget).toBe(true);
	expect(value.actualReadback).toBe(true); expect(value.deliveredSha256).toBe(observation.rawReadbackSha256);
	expect(observation.rawReadbackSha256).toMatch(/^[a-f0-9]{64}$/u); expect(observation.fullReads).toBe(1);
	expect(observation.imagePeak).toBe(3); expect(observation.uploads).toBe(1);
	expect(observation.nodes).toBe(1); expect(observation.horizontal).toBe(1); expect(observation.vertical).toBe(1);
	expect(observation.blends).toBe(1); expect(observation.tones).toBe(1);
	expect(observation.integerReads).toBeGreaterThanOrEqual(2048); expect(observation.maximumUintBacking).toBeLessThanOrEqual(65_536);
	expect(observation.readbackBeforeIntegerRetirement).toBe(false);
});
