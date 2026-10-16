/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native repair conformance requires pinned software Chromium or actual Firefox.');
const MODULE = '/__lightscaper_native_gpu_repair_current.js', BLANK = '/__lightscaper_native_gpu_repair_current.html';
let compiled;
test.beforeAll(async () => {
	compiled = await compileNativeImageHandoffScript('native-gpu-repair-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-repair-current-reference.ts', import.meta.url)));
	expect(compiled.assets).toEqual([]);
});
for (const [name, iterations] of [['clone-alpha', 0], ['heal-coupled', 64], ['heal-forward', 128], ['heal-reverse', 128]]) test(`real native repair candidate: ${name}`, async ({ page, browserName }) => {
	test.setTimeout(60_000);
	await page.route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Real GPU Clone and Poisson Heal component</title>' }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper${BLANK}`));
	const value = await page.evaluate(`import(${JSON.stringify(MODULE)}).then(module=>module.runNativeGpuRepairCurrentV1(${JSON.stringify(name)}))`);
	if (browserName === 'chromium') expect(value.renderer).toContain('SwiftShader');
	await test.info().attach('native-repair-observation', { body: JSON.stringify({ browser: page.context().browser()?.version(), value }), contentType: 'application/json' });
	expect(value.callbacks).toBe(1); expect(value.result.matched).toBe(true); expect(value.result.copiedExact).toBe(true); expect(value.result.actualReadback).toBe(true);
	expect(value.nativeJacobi).toBe(iterations); expect(value.result.draws.jacobi).toBe(iterations);
	expect(value.floatUploads).toBe(1); expect(value.byteUploads).toBe(0); expect(value.aliveHandles).toBe(0);
	expect(value.readbacksRetired).toBe(true); expect(value.uploadsRetired).toBe(true); expect(value.sourceUnchanged).toBe(true); expect(value.scratchRetired).toBe(true);
	for (const literal of value.result.literals) expect(literal.actual).toEqual(literal.rgba);
});
