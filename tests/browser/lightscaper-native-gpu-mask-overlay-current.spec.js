/* SPDX-License-Identifier: AGPL-3.0-only */
// Native component qualification; application activation has its own broker gate.
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native integer overlay components require pinned software Chromium or Firefox.');
const PATH = '/__lightscaper_native_gpu_mask_overlay_current.js'; let program;
const BLANK = '/lightscaper/__native_mask_overlay_blank.html';
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('native-gpu-mask-overlay-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-mask-overlay-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});
const geometry = (id, params = {}) => ({ id, type: 'develop-geometry-v1', enabled: true, params });
const lens = id => ({ id, type: 'lens-distortion-v1', enabled: true, params: { amount: 52.083333333333336 } });
async function render(page, value) {
	await page.route(`**${PATH}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Native selected mask overlay</title>' }));
	await page.goto(resolveBrowserProductTestUrl(BLANK));
	const result = await page.evaluate(`import(${JSON.stringify(PATH)}).then(module=>module.qualifyNativeGpuMaskOverlayCurrentV1(${JSON.stringify(value)}))`);
	const browserName = page.context().browser()?.browserType().name();
	if (browserName === 'chromium') expect(result.renderer).toContain('SwiftShader');
	await test.info().attach('native-mask-overlay-observation', { body: JSON.stringify({ browser: page.context().browser()?.version(), result }), contentType: 'application/json' });
	return result;
}
function accepted(result, draws) {
	expect(result.rejected).toBe(false); expect(result.coverage).toEqual(result.expected.coverage);
	expect(result.byteProofMatched).toBe(true); expect(result.observedCoverage).toEqual(result.expected.coverage);
	expect([result.width, result.height]).toEqual([result.expected.width, result.expected.height]);
	expect(result.overlayDraws).toBe(draws); expect(result.integerReads).toBeGreaterThan(0);
	expect(result.banksRetiredBeforeDelivery).toBe(true); expect(result.nativeRetiredBeforeDelivery).toBe(true);
	expect(result.proofReads).toBeGreaterThan(0); expect(result.proofBeforeDelivery).toBe(true);
	expect(result.proofScopesRetired).toBe(true); expect(result.receiptsRetiredBeforeDelivery).toBe(true); expect(result.callbacks).toBe(1);
	expect(result.allTexturesRetired).toBe(true); expect(result.nativeRetired).toBe(true); expect(result.hostRetired).toBe(true);
}
for (const enabled of [false, true]) test(`selected ${enabled ? 'neutral' : 'disabled'} stage retains genuine incoming coverage without a candidate`, async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, enabled, effects: [] }); accepted(result, 0);
	expect(result.mode).toBe('observe'); expect(result.coverage).toEqual([43, 128, 213]);
});
test('coverage after the legacy crop uses bound incoming width2 instead of Original width4', async ({ page }) => {
	const result = await render(page, { width: 4, height: 1, legacyCrop: true, effects: [] }); accepted(result, 0);
	expect([result.width, result.height]).toEqual([2, 1]); expect(result.coverage).toEqual([64, 191]);
});
test('two actual radial byte draws round each intermediate; final-only floating projection is refused by the independent literal', async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [lens('first'), lens('last')] }); accepted(result, 2);
	expect(result.coverage).toEqual([38, 128, 188]); expect(result.coverage[2]).not.toBe(187);
});
test('CW geometry → zero-extended lens → output flip retains top-left byte orientation and changing viewport', async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [geometry('cw', { rotationDegrees: 90 }), lens('outward'), geometry('flip', { flipVertical: 1 })] });
	accepted(result, 3); expect([result.width, result.height]).toEqual([1, 3]); expect(result.coverage).toEqual([200, 128, 40]);
});
test('fractional crop replicates only the admitted crop edges rather than extending transparent lens borders', async ({ page }) => {
	const result = await render(page, { width: 4, height: 1, effects: [geometry('crop', { cropX: .125, cropY: 0, cropWidth: .5, cropHeight: 1 })] });
	accepted(result, 1); expect([result.width, result.height]).toEqual([2, 1]); expect(result.coverage).toEqual([64, 128]);
});
test('a subpixel crop clamps both taps to its sole admitted edge sample', async ({ page }) => {
	const result = await render(page, { width: 4, height: 1, effects: [geometry('edge', { cropX: 0, cropY: 0, cropWidth: .125, cropHeight: 1 })] });
	accepted(result, 1); expect(result.coverage).toEqual([32]);
});
test('a nonidentity perspective quad samples the same stage-local byte aperture', async ({ page }) => {
	const result = await render(page, { width: 4, height: 1, effects: [geometry('quad', { perspective: 1, topLeftX: .25, topRightX: .75, bottomLeftX: .25, bottomRightX: .75 })] });
	accepted(result, 1); expect(result.coverage).toEqual([80, 112, 143, 175]);
});
test('rotated aperture is transparent outside its unit window, with exact byte comparison across the whole output', async ({ page }) => {
	const result = await render(page, { width: 4, height: 4, effects: [geometry('diagonal', { rotationDegrees: 17 })] });
	accepted(result, 1); expect(result.coverage.some(value => value === 0)).toBe(true); expect(result.coverage.some(value => value > 0)).toBe(true);
});
test('45 degree byte-half boundaries require exact proof and refuse a native mismatch before delivery', async ({ page }) => {
	const result = await render(page, { width: 4, height: 4, effects: [geometry('byte-half', { rotationDegrees: 45 })] });
	if (!result.rejected) { accepted(result, 1); return; }
	// Float32 coordinates can cross a CPU Double byte-half boundary. Preserve
	// the genuine native mismatch; no tolerance, result patch or host delivery.
	expect(result.byteProofMatched).toBe(false); expect(result.observedCoverage).toHaveLength(36);
	expect(result.observedCoverage).not.toEqual(result.expected.coverage);
	expect(result.overlayDraws).toBe(1); expect(result.callbacks).toBe(0);
	expect(result.proofBeforeDelivery).toBe(true); expect(result.proofStripesRetired).toBe(true);
	expect(result.allTexturesRetired).toBe(true); expect(result.nativeRetired).toBe(true);
});
for (const fault of ['preabort', 'ignored-project', 'repeat-project', 'foreign-texture', 'expired-texture']) test(`${fault} never delivers private host overlay after a failed protocol attempt`, async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [lens('one')], fault });
	expect(result.rejected).toBe(true); expect(result.callbacks).toBe(0); expect(result.allTexturesRetired).toBe(true);
	if (fault === 'preabort') { expect(result.exactReason).toBe(true); expect(result.overlayDraws).toBe(0); }
	if (fault === 'foreign-texture' || fault === 'expired-texture') expect(result.overlayDraws).toBe(0);
});
test('native readback detachment preserves its opaque primary plus physical retirement failure before any host delivery', async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [lens('one')], fault: 'detach-readback-opaque' });
	expect(result.rejected).toBe(true); expect(result.callbacks).toBe(0); expect(result.overlayDraws).toBe(1);
	expect(result.primaryRetained).toBe(true); expect(result.cleanupRetained).toBe(true); expect(result.allTexturesRetired).toBe(true);
});
test('independent pre-GL storage admission cannot be reused after projection starts consuming the owner', async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [lens('one')], fault: 'guard-after-project' });
	expect(result.rejected).toBe(true); expect(result.guardRejected).toBe(true); expect(result.callbacks).toBe(0); expect(result.allTexturesRetired).toBe(true);
});
for (const fault of ['proof-inflight', 'proof-malformed', 'proof-abort']) test(`${fault} is fatal before proof transport can become external delivery`, async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [lens('one')], fault });
	expect(result.rejected).toBe(true); expect(result.callbacks).toBe(0); expect(result.allTexturesRetired).toBe(true);
	if (fault === 'proof-inflight') expect(result.proofRejected).toBe(true);
	if (fault === 'proof-abort') expect(result.exactReason).toBe(true);
});
test('proof stripes are closed as soon as single external delivery starts, even when the failure is caught', async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [lens('one')], fault: 'proof-after-delivery' });
	expect(result.rejected).toBe(true); expect(result.proofRejected).toBe(true); expect(result.callbacks).toBe(1);
	expect(result.proofScopesRetired).toBe(true); expect(result.hostRetired).toBe(true);
});
test('expired proof method cannot expose retired host bytes or alter the caller stripe', async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [lens('one')], fault: 'proof-expired' });
	accepted(result, 1); expect(result.expiredProofRejected).toBe(true); expect(result.expiredTargetUntouched).toBe(true);
});
test('proof completes and retires its stripes before the one held external overlay delivery joins', async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [lens('one')], fault: 'held-delivery' });
	accepted(result, 1); expect(result.pending).toBe(true); expect(result.heldLive).toBe(true);
});
for (const fault of ['held-abort', 'held-loss', 'opaque', 'detach-opaque']) test(`${fault} joins the accepted host view and retires physical storage without replay`, async ({ page }) => {
	const result = await render(page, { width: 3, height: 1, effects: [lens('one')], fault });
	expect(result.rejected).toBe(true); expect(result.callbacks).toBe(1); expect(result.hostRetired).toBe(true); expect(result.allTexturesRetired).toBe(true);
	expect(result.proofReads).toBeGreaterThan(0); expect(result.proofBeforeDelivery).toBe(true); expect(result.proofScopesRetired).toBe(true);
	if (fault.startsWith('held-')) { expect(result.pending).toBe(true); expect(result.heldLive).toBe(true); }
	if (fault === 'held-abort' || fault === 'opaque') expect(result.exactReason).toBe(true);
	if (fault === 'held-loss') expect(result.loss).toBe(true);
	if (fault === 'detach-opaque') { expect(result.primaryRetained).toBe(true); expect(result.cleanupRetained).toBe(true); }
});
