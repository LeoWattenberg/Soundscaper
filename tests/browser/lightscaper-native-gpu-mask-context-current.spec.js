/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native mask graph conformance requires pinned software Chromium or actual Firefox.');
const PROGRAM = '/__lightscaper_native_mask_context_current.js';
const BLANK = '/lightscaper/__native_mask_context_blank.html';
let compiled;
test.beforeAll(async () => { compiled = await compileNativeImageHandoffScript('native-mask-context-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-mask-context-current-reference.ts', import.meta.url))); expect(compiled.assets).toEqual([]); });
const graph = (nodes, outputNodeId = 'a') => ({ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes, outputNodeId });
const gradient = (id = 'a') => ({ id, kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
const words = values => [...new Uint32Array(Float32Array.from(values).buffer)];
const rank = word => word >= 0x80000000 ? 0x80000000 - (word - 0x80000000) : 0x80000000 + word;
async function run(page, request) {
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Native mask executor component</title>' }));
	await page.goto(resolveBrowserProductTestUrl(BLANK));
	// Raw import expression contains no transformed nested callbacks/__name shim.
	const value = await page.evaluate(`import(${JSON.stringify(PROGRAM)}).then(module=>module.runMaskContextCurrentV1(${JSON.stringify(request)}))`);
	const browserName = page.context().browser()?.browserType().name();
	if (browserName === 'chromium') expect(value.renderer).toContain('SwiftShader');
	await test.info().attach('native-mask-context-observation', { body: JSON.stringify({ browser: page.context().browser()?.version(), value }), contentType: 'application/json' });
	return value;
}
function accepted(value) {
	expect(value.rejected).toBe(false); expect(value.actualCoverage).toEqual(value.expectedCoverage); expect(value.privateRetired).toBe(true);
	expect(value.nativeScratchWiped).toBe(true); expect(value.integerDeletedWithoutZeroClear).toBe(0); expect(value.sourceActiveAtDraw).toBe(0);
	expect(value.source).toEqual(value.before); expect(value.lateRefused).toBe(true); expect(value.selectedLive).toBe(true); expect(value.selectedRetired).toBe(true);
	expect(value.selectedGuardLive).toBe(true); expect(value.selectedGuardExpired).toBe(true); expect(value.selectedGuardForged).toBe(true);
	const expected = new Float32Array(Uint32Array.from(value.expected).buffer), actual = new Float32Array(Uint32Array.from(value.output).buffer);
	const mismatches = [];
	for (let at = 0; at < expected.length; at++) {
		const exact = at % 4 === 3 || expected[at] === 0 || Math.abs(expected[at]) < 2 ** -60;
		const matched = exact ? value.output[at] === value.expected[at]
			: Number.isFinite(actual[at]) && Math.abs(rank(value.output[at]) - rank(value.expected[at])) <= 8;
		if (!matched) mismatches.push({ at, expected: value.expected[at], actual: value.output[at] });
		if (mismatches.length === 16) break;
	}
	expect(mismatches).toEqual([]);
}
const scene = (width, height = 1) => words(Array.from({ length: width * height }, () => [.125, .25, .5, .375]).flat());
for (const [name, node, width, expected] of [
	['gradient', gradient(), 4, [32, 96, 159, 223]],
	['radial', { id: 'a', kind: 'radial-gradient', center: { x: .5, y: .5 }, radius: { x: .5, y: .5 }, innerFraction: 0 }, 5, [51, 153, 255, 153, 51]],
	['rectangle', { id: 'a', kind: 'vector-shape', shape: 'rectangle', x: .5, y: 0, width: .5, height: 1 }, 4, [0, 0, 255, 255]],
	['ellipse', { id: 'a', kind: 'vector-shape', shape: 'ellipse', x: 0, y: 0, width: 1, height: 1 }, 3, [255, 255, 255]],
]) test(`actual executor ${name} integer coverage and masked Float32 result`, async ({ page }) => {
	const value = await run(page, { width, height: 1, words: scene(width), graph: graph([node]) }); accepted(value); expect(value.actualCoverage).toEqual(expected);
});
for (const operation of ['union', 'intersect', 'subtract', 'xor']) test(`actual executor ${operation} preserves ordered folds and shared children`, async ({ page }) => {
	const nodes = [gradient(), { id: 'b', kind: 'invert', inputNodeId: 'a' }, { id: 'c', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: .5, height: 1 },
		{ id: 'out', kind: 'boolean', operation, inputNodeIds: ['a', 'b', 'c'] }];
	accepted(await run(page, { width: 4, height: 1, words: scene(4), graph: graph(nodes, 'out') }));
});
for (const radius of [0, .01, 1, 2, 64]) test(`actual executor feather radius${radius} preserves installed odd-aspect alpha`, async ({ page }) => {
	const value = await run(page, { width: 3, height: 1, words: scene(3), brush: { width: 3, height: 1, alpha: [0, 0, 255] },
		graph: graph([{ id: 'a', kind: 'alpha', inputName: 'Brush' }, { id: 'f', kind: 'feather', inputNodeId: 'a', radius }], 'f') });
	accepted(value); expect(value.reads).toBeGreaterThan(0); if (radius === 1 || radius === .01) expect(value.actualCoverage).toEqual([0, 85, 170]);
});
test('actual executor incoming native range distinguishes sub-byte values and hidden alpha0', async ({ page }) => {
	const value = await run(page, { width: 3, height: 1, words: words([.18, .18, .18, 1, .1801, .1801, .1801, 1, 4, -1, 2, 0]),
		graph: graph([{ id: 'a', kind: 'luminance-range', lower: .18005, upper: .1802, falloff: 0 }]) }); accepted(value); expect(value.actualCoverage).toEqual([0, 255, 0]);
});
test('actual executor color range samples signed linear image rather than encoded display bytes', async ({ page }) => {
	const value = await run(page, { width: 3, height: 1, words: words([.00001, .00001, .00001, 1, .0001, .0001, .0001, 1, .00001, .00001, .00001, 0]),
		graph: graph([{ id: 'a', kind: 'color-range', color: { r: 0, g: 0, b: 0 }, radius: .00002, falloff: 0 }]) }); accepted(value); expect(value.actualCoverage).toEqual([255, 0, 0]);
});
test('actual executor path winding spans more than one256-edge chunk', async ({ page }) => {
	const points = Array.from({ length: 513 }, (_, index) => ({ position: { x: .5 + .49 * Math.cos(index * 2 * Math.PI / 513), y: .5 + .49 * Math.sin(index * 2 * Math.PI / 513) }, inHandle: null, outHandle: null }));
	const value = await run(page, { width: 1, height: 1, words: scene(1), graph: graph([{ id: 'a', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'path', closed: false, points }] }]) }); accepted(value); expect(value.actualCoverage).toEqual([255]);
});
test('actual executor receipt adapter splits an8192-pixel row into bounded native uint transfers', async ({ page }) => {
	accepted(await run(page, { width: 8192, height: 1, words: scene(8192), graph: graph([gradient()]) }));
});
for (const fault of ['preabort', 'held-abort', 'opaque', 'detach-opaque', 'finish-opaque']) test(`actual executor ${fault} joins texture/scratch retirement and exact primary`, async ({ page }) => {
	const value = await run(page, { width: 4, height: 1, words: scene(4), graph: graph([gradient()]), fault });
	expect(value.rejected).toBe(true); expect(value.primary).toBe(true); expect(value.privateRetired).toBe(true); expect(value.nativeScratchWiped).toBe(true);
	expect(value.integerDeletedWithoutZeroClear).toBe(0); expect(value.source).toEqual(value.before); if (fault === 'preabort') expect(value.draws).toBe(0);
	if (fault === 'detach-opaque') expect(value.cleanupRetained).toBe(true);
});


test('native graph retirement waits for submitted bank zeroing before releasing ownership', async ({ page }) => {
	const value = await run(page, { width: 4, height: 1, words: scene(4), graph: graph([gradient()]) });
	accepted(value); expect(value.integerDeletedBeforeFinish).toBe(0);
});
