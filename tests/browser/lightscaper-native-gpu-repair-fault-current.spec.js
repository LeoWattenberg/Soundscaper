/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Repair fault evidence requires pinned software Chromium or actual Firefox capability.');
const PROGRAM = '/__lightscaper_native_repair_fault.js', BLANK = '/lightscaper/__native_repair_fault.html';
let compiled;
test.beforeAll(async () => {
	compiled = await compileNativeImageHandoffScript('native-repair-fault.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-repair-fault-current-reference.ts', import.meta.url)));
	expect(compiled.assets).toEqual([]);
});
for (const fault of ['jacobi-abort', 'held-abort', 'detach-opaque']) test(`real native repair candidate joins ${fault} without replay or source mutation`, async ({ page, browserName }) => {
	test.setTimeout(60_000);
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Actual repair candidate lifetime</title>' }));
	await page.goto(resolveBrowserProductTestUrl(BLANK));
	const value = await page.evaluate(async ({ path, fault }) => (await import(path)).runNativeGpuRepairFaultCurrentV1(fault), { path: PROGRAM, fault });
	expect(value.rejected).toBe(true); expect(value.primaryRetained).toBe(true); expect(value.sourceAfter).toEqual(value.before);
	expect(value.callbacks).toBe(fault === 'jacobi-abort' ? 0 : 1); expect(value.readbacksRetired).toBe(true); expect(value.uploadsRetired).toBe(true); expect(value.outputRetired).toBe(true);
	expect(value.after.aliveHandles).toBe(0); for (const kind of Object.keys(value.after.created)) expect(value.after.deleted[kind], kind).toBe(value.after.created[kind]);
	expect(value.after.created.Texture).toBeGreaterThan(0); expect(value.after.created.Program).toBeGreaterThan(0); expect(value.after.created.Shader).toBeGreaterThan(0);
	expect(value.after.contexts).toHaveLength(1); expect(value.after.contexts[0].native).toBe(true); expect(value.after.contexts[0].floatTarget).toBe(true);
	if (fault === 'jacobi-abort') { expect(value.nativeJacobi).toBe(1); expect(value.exactReason).toBe(true); expect(value.cleanupRetained).toBe(false); }
	if (fault === 'held-abort') { expect(value.nativeJacobi).toBe(64); expect(value.exactReason).toBe(true); expect(value.cleanupRetained).toBe(false);
		expect(value.heldPending).toBe(true); expect(value.heldReadbackLive).toBe(true); expect(value.heldHandles).toBeGreaterThan(0); }
	if (fault === 'detach-opaque') { expect(value.nativeJacobi).toBe(0); expect(value.exactReason).toBe(false); expect(value.cleanupRetained).toBe(true); }
	if (browserName === 'chromium') for (const context of value.after.contexts) expect(context.renderer).toContain('SwiftShader');
});
