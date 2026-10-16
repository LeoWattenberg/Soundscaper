/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native repair broker conformance requires pinned software Chromium or actual Firefox.');
const PROGRAM = '/__lightscaper_gpu_repair_broker_current.js', BLANK = '/lightscaper/__gpu_repair_broker_current.html';
let compiled;
test.beforeAll(async () => {
	compiled = await compileNativeImageHandoffScript('gpu-repair-broker-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-repair-broker-current-reference.ts', import.meta.url)));
	expect(compiled.assets).toEqual([]);
});
for (const [name, iterations] of [['clone-alpha', 0], ['heal-coupled', 64], ['heal-forward', 128], ['heal-reverse', 128],
	['heal-mixed', 64], ['heal-range', 64], ['underflow-boundary', 0], ['invalid-boundary', 0]]) test(`maintained native repair broker: ${name}`, async ({ page, browserName }) => {
	test.setTimeout(60_000);
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Maintained GPU repair broker</title>' }));
	await page.goto(resolveBrowserProductTestUrl(BLANK));
	const value = await page.evaluate(`import(${JSON.stringify(PROGRAM)}).then(module=>module.runNativeGpuRepairBrokerCurrentV1(${JSON.stringify(name)}))`);
	await test.info().attach('native-repair-broker-observation', { body: JSON.stringify({ browser: page.context().browser()?.version(), value }), contentType: 'application/json' });
	expect(value.renderers.length).toBeGreaterThan(0);
	if (browserName === 'chromium') for (const renderer of value.renderers) expect(renderer).toContain('SwiftShader');
	expect(value.sourceUploads).toBe(1); expect(value.nativeJacobi).toBe(iterations); expect(value.sourceUnchanged).toBe(true);
	expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.uploadsRetired).toBe(true); expect(value.outputRetired).toBe(true); expect(value.overlayRetired).toBe(true);
	if (name === 'underflow-boundary' || name === 'invalid-boundary') expect(value.statuses).toEqual([-1]);
	if (name === 'invalid-boundary') {
		expect(value.callbacks).toBe(0); expect(value.error).toBe(value.cpuError); expect(value.error).toMatch(/paired original boundary/u); return;
	}
	expect(value.callbacks).toBe(1); expect(value.result.matched).toBe(true); expect(value.result.overlay).toEqual(value.expectedOverlay);
	if (name === 'heal-range') {
		expect(value.result.overlay[26]).toBe(255); expect(value.result.overlay[27]).toBe(0);
		const pixels = new Float32Array(Uint32Array.from(value.result.actual).buffer); expect([...pixels.slice(104, 108)]).toEqual([.5, .5, .5, 1]); expect([...pixels.slice(108, 112)]).toEqual([.75, .75, .75, 1]);
	}
	if (name === 'underflow-boundary') {
		expect(value.result.backend).toBe('cpu'); expect(value.result.reason).toBe('numeric-range'); expect(value.result.actual).toEqual(value.expected);
		expect(new Float32Array(Uint32Array.from(value.result.actual).buffer).slice((7 + 5) * 4, (7 + 6) * 4)).toEqual(Float32Array.of(1, .5, -1, 2 ** -126));
		expect(value.result.handlesAtDelivery).toBe(0); expect(value.result.actualReadback).toBe(false);
	} else { expect(value.result.backend).toBe('webgl2'); expect(value.result.actualReadback).toBe(true); }
});
