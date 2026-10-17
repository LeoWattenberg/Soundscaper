/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'This bounded capacity witness requires pinned software Chromium or an actual Firefox native target.');
const PROGRAM = '/__lightscaper_native_gpu_repair_large_current.js', BLANK = '/__lightscaper_native_gpu_repair_large_current.html';
const MiB = 1024 * 1024;
let compiled;
test.beforeAll(async () => {
	compiled = await compileNativeImageHandoffScript('native-gpu-repair-large-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-repair-large-current-reference.ts', import.meta.url)));
	expect(compiled.assets).toEqual([]);
});

test('2048² native Heal with512² halo and radius64 mask reuses three image banks and returns an accepted native readback', async ({ page, browserName }) => {
	// Bound this one genuine4MP shader+64sweep+receipt+two-plane-proof workload.
	// No general timeout, source/component/working/startup ceiling changes.
	test.setTimeout(240_000);
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Actual4MP Heal and masked GPU qualification</title>' }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper${BLANK}`));
	const value = await page.evaluate(`import(${JSON.stringify(PROGRAM)}).then(module=>module.qualifyNativeGpuRepairLargeCurrentV1())`);
	await test.info().attach('native-repair-large-observation', { body: JSON.stringify({ browser: page.context().browser()?.version(), value }), contentType: 'application/json' });
	expect(value.rejected, value.errorText).toBe(false); expect(value.callbacks).toBe(1);
	expect(value.sourceSha256).toBe(value.before); expect(value.before).toMatch(/^[a-f0-9]{64}$/u);
	expect(value.sourceRetired).toBe(true); expect(value.outputRetired).toBe(true);
	expect(value.descriptor).toEqual({ schemaVersion: 1, width: 2048, height: 2048, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
	expect(value.samples).toHaveLength(27);
	expect(value.samples.map(sample => sample.coverage)).toEqual(Array.from({ length: 3 }, () => [2, 5, 8, 64, 127, 128, 191, 247, 253]).flat());
	const differences = value.samples.flatMap(sample => sample.bits.slice(0, 3).map((word, at) => Math.abs(word - sample.expected[at])));
	expect(Math.max(...differences)).toBeLessThanOrEqual(8);
	expect(value.samples.every(sample => sample.bits[3] === 0x3f800000 && sample.expected[3] === 0x3f800000)).toBe(true);
	// The only Original defect is the center sample [.75,.875,1]. The actual
	// nonempty Heal must restore [.125,.25,.5] before the masked exposure. A
	// skipped/opacity0/same-source no-op cannot equal this other-row sample.
	const repaired = value.samples.find(sample => sample.x === 1024 && sample.y === 1024);
	const control = value.samples.find(sample => sample.x === 1024 && sample.y === 0);
	expect(repaired.bits).toEqual(control.bits);
	const admission = value.admission;
	expect(admission.supported).toBe(true); expect(admission.eligible).toBe(true);
	expect(admission.halo).toEqual({ x: 768, y: 768, width: 512, height: 512 });
	expect(admission.imageTextureCount).toBe(3); expect(admission.imageTextureBytes).toBe(192 * MiB);
	expect(admission.floatCaptureBytes).toBe(64 * MiB); expect(admission.referenceBytes).toBe(128 * MiB);
	expect(admission.repairGpuHaloBytes).toBe(129 * 512 ** 2); expect(admission.repairCpuScratchBytes).toBe(105 * 512 ** 2 + 4096);
	expect(admission.peakWorkingBytes).toBeLessThanOrEqual(768 * MiB); expect(admission.maximumMaskComponentBytes).toBeLessThanOrEqual(64 * MiB);
	const observation = value.observation;
	if (browserName === 'chromium') { expect(observation.renderers.length).toBeGreaterThan(0); for (const renderer of observation.renderers) expect(renderer).toContain('SwiftShader'); }
	expect(observation.privateRetired).toBe(true); expect(observation.stableUploadsRetired).toBe(true);
	expect(observation.nativeScratchRetired).toBe(true); expect(observation.readbacksRetired).toBe(true);
	expect(observation.referenceRetired).toBe(true); expect(observation.repairScratchRetired).toBe(true);
	expect(observation.incompleteClears).toBe(0); expect(observation.imageLive).toBe(0); expect(observation.haloLive).toBe(0);
	const admittedNativeTarget = observation.normalFloatSupported && observation.mixedSamplersSupported
		&& observation.maximumTexture >= 2048 && observation.viewportWidth >= 2048 && observation.viewportHeight >= 2048;
	if (browserName === 'firefox' && !admittedNativeTarget) {
		expect(value.backend).toBe('cpu');
		expect(value.reason).toMatch(/^(?:canvas-unavailable|context-unavailable|float-target-unavailable|float-conformance-failed|texture-capacity|uniform-capacity|repair-capability-unavailable|mask-capability-unavailable|mask-integer-copy-unavailable|mask-integer-clear-unavailable|mask-mixed-sampler-unavailable)$/u);
		test.skip(true, `Actual Firefox native capability is unavailable: ${value.reason}; this is not4MP GPU qualification.`);
	}
	// Only the maintained high broker can accept the full native result after
	// whole-plane CPU repair/mask proof. Raw shader attempts are insufficient.
	expect(value.backend, value.reason).toBe('webgl2'); expect(admittedNativeTarget).toBe(true);
	expect(value.actualReadback).toBe(true); expect(value.deliveredSha256).toBe(observation.rawReadbackSha256);
	expect(observation.rawReadbackSha256).toMatch(/^[a-f0-9]{64}$/u); expect(observation.fullReads).toBe(1);
	expect(observation.imagePeak).toBe(3); expect(observation.imageTextureCount).toBe(3); expect(observation.uploads).toBe(1);
	expect(observation.imageBanksReused).toBe(true); expect(observation.lateImageAllocations).toBe(0);
	expect(observation.repairImageOutputCount).toBe(1); expect(observation.authoredImageOutputCount).toBe(2);
	expect(observation.jacobi).toBe(64); expect(observation.healBlends).toBe(1);
	expect(observation.haloPeak).toBe(9); expect(observation.haloTextureCount).toBe(9);
	expect(observation.haloFloatCount).toBe(8); expect(observation.haloByteCount).toBe(1);
	expect(observation.haloBeforeGraph).toBe(false); expect(observation.haloBeforeReference).toBe(false);
	expect(observation.scratchBeforeIntegerRetirement).toBe(false); expect(observation.repairScratchBeforeAuthoredReplay).toBe(false);
	expect(observation.cpuRepairScratchAllocations).toBe(1); expect(observation.referencePlaneAllocations).toBe(3); expect(observation.referencePlanePeak).toBe(2);
	expect(observation.cpuCoverageUploads).toBe(0); expect(observation.nodes).toBe(1);
	expect(observation.horizontal).toBe(1); expect(observation.vertical).toBe(1); expect(observation.blends).toBe(1); expect(observation.tones).toBe(1);
	expect(observation.integerReads).toBeGreaterThanOrEqual(2048); expect(observation.maximumUintBacking).toBeLessThanOrEqual(65_536);
	expect(observation.readbackBeforeIntegerRetirement).toBe(false);
});
