/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/browser-coverage-fixture.js';
import { PIXEL_FRAME_WEBGL2_MASK_BLEND_FRAGMENT_CURRENT_V1, preparePixelFrameWebGl2MaskBlendUniformsCurrentV1 } from '../../src/common/editor/imaging/pixel-frame-webgl2-mask-blend-glsl-current-v1.ts';
import { referenceNativeMaskBlendCurrentV1 } from './helpers/lightscaper-native-gpu-mask-blend-current-reference.ts';
import { MASK_BLEND_COMPONENT_PAGE_SOURCE } from './helpers/lightscaper-native-gpu-mask-blend-page-source.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native mask blend diagnostics require pinned software Chromium or actual Firefox.');

const generic = Object.freeze({ kind: 'generic' }), unchanged = Object.freeze({ kind: 'unchanged-components' });
const decode = words => [...new Float32Array(Uint32Array.from(words).buffer)];
const rank = word => word >= 0x80000000 ? 0x80000000 - (word - 0x80000000) : 0x80000000 + word;
const exactFloatWord = value => new Uint32Array(Float32Array.of(value).buffer)[0];
const repeated = (count, pixel) => Array.from({ length: count }, () => pixel).flat();

/** Direct native shader diagnostic, with expected words from the extracted
 * unchanged CPU finisher. No application CPU fallback or result patch can make
 * a component positive pass. Mandatory contexts fail instead of being skipped. */
async function run(page, value) {
	const expected = await referenceNativeMaskBlendCurrentV1(value);
	const payload = { fragment: PIXEL_FRAME_WEBGL2_MASK_BLEND_FRAGMENT_CURRENT_V1, before: expected.before,
		candidate: expected.candidate, coverage: expected.coverage, width: expected.width,
		uniforms: preparePixelFrameWebGl2MaskBlendUniformsCurrentV1(value.policy) };
	await page.goto('about:blank');
	// Raw function source is invoked as a string expression, avoiding tsx's
	// named-function __name helpers in page.evaluate. No global shim is installed.
	const actual = await page.evaluate(`(${MASK_BLEND_COMPONENT_PAGE_SOURCE})(${JSON.stringify(payload)})`);
	const browserName = page.context().browser()?.browserType().name();
	if (browserName === 'chromium') expect(actual.context.renderer).toContain('SwiftShader');
	expect(actual.draws).toBe(1); expect(actual.floatReadbacks).toBe(1);
	expect(actual.retired).toEqual({ textures: true, framebuffers: true, program: true, shaders: true, vao: true, host: true });
	await test.info().attach('native-mask-blend-observation', {
		body: JSON.stringify({ browser: page.context().browser()?.version(), actual, expected, policy: value.policy }), contentType: 'application/json',
	});
	return { ...expected, bits: actual.bits, policy: value.policy };
}
function equivalent(value) {
	const expected = decode(value.expected), actual = decode(value.bits), before = decode(value.before), candidate = decode(value.candidate);
	return expected.every((sample, at) => {
		if (value.expected[at] === value.bits[at]) return true;
		if (!Number.isFinite(actual[at]) || at % 4 === 3 || sample === 0 || actual[at] === 0 || Math.abs(sample) < 2 ** -60) return false;
		const channel = at % 4, amount = value.coverage[Math.floor(at / 4)];
		const copied = amount === 0 || amount === 255 || value.policy.kind === 'ca-copy' && (channel === 1 || channel === 0 && value.policy.copyRed || channel === 2 && value.policy.copyBlue)
			|| value.policy.kind === 'unchanged-components' && before[at] === candidate[at];
		return !copied && Math.abs(rank(value.expected[at]) - rank(value.bits[at])) <= 8;
	});
}
function accepted(value) { expect(equivalent(value), JSON.stringify({ expected: value.expected, actual: value.bits })).toBe(true); }

test('generic endpoints copy exact signed HDR RGB and incoming alpha, including hidden RGB and minus zero', async ({ page }) => {
	const value = await run(page, { incoming: [-0, -.25, 2, -0, 1e-30, 4, -2, 0], candidate: [.5, 8, -4, 1, -0, -1, 3, 1], coverage: [0, 255], policy: generic });
	accepted(value);
	expect(value.bits).toEqual([...value.before.slice(0, 4), ...value.candidate.slice(4, 7), value.before[7]]);
});

for (const amount of [1, 127, 128, 254]) test(`fraction byte${amount} blends signed HDR and hidden RGB without an alpha-zero bypass`, async ({ page }) => {
	const value = await run(page, { incoming: [-2, .25, 4, 0, -.5, 1, 2, .375], candidate: [-4, .5, 8, 1, -1, 2, 4, 0], coverage: [amount, amount], policy: generic });
	accepted(value);
	expect(value.expected.slice(0, 3)).toEqual([exactFloatWord(-2 - 2 * amount / 255), exactFloatWord(.25 + .25 * amount / 255), exactFloatWord(4 + 4 * amount / 255)]);
	expect(value.expected.slice(0, 3)).not.toEqual(value.before.slice(0, 3));
	expect(value.bits[3]).toBe(exactFloatWord(0)); expect(value.bits[7]).toBe(exactFloatWord(.375));
});

test('all four generic fractional signed-zero endpoint combinations produce normative plus-zero RGB', async ({ page }) => {
	const incoming = [-0, -0, -0, -0, -0, 0, -0, 0, 0, -0, 0, .375, 0, 0, 0, 1];
	const candidate = [-0, 0, -0, 1, 0, -0, 0, 1, -0, -0, 0, 1, 0, 0, 0, 0];
	const value = await run(page, { incoming, candidate, coverage: [1, 127, 128, 254], policy: generic });
	accepted(value);
	for (let at = 0; at < value.bits.length; at++) expect(value.bits[at]).toBe(at % 4 === 3 ? value.before[at] : 0);
});

test('unchanged equality precedes even q255 and retains original minus-zero instead of candidate plus-zero', async ({ page }) => {
	const incoming = [-0, 0, 1e-30, -0], candidate = [0, -0, 1e-30, 1];
	const kept = await run(page, { incoming, candidate, coverage: [255], policy: unchanged }); accepted(kept); expect(kept.bits).toEqual(kept.before);
	const endpoint = await run(page, { incoming, candidate, coverage: [255], policy: generic }); accepted(endpoint);
	expect(endpoint.bits.slice(0, 3)).toEqual(endpoint.candidate.slice(0, 3)); expect(endpoint.bits).not.toEqual(kept.bits);
});

test('unchanged policy bypasses only identical components while other hidden signed HDR channels still blend', async ({ page }) => {
	const value = await run(page, { incoming: [-0, .25, 2, 0, 1e-30, -2, .5, -0], candidate: [0, .5, 4, 1, 1e-30, -4, 1, 1], coverage: [128, 127], policy: unchanged });
	accepted(value); expect(value.bits[0]).toBe(value.before[0]); expect(value.bits[4]).toBe(value.before[4]);
	expect(value.expected[1]).not.toBe(value.before[1]); expect(value.expected[2]).not.toBe(value.before[2]);
});

for (const [copyRed, copyBlue] of [[false, true], [true, false], [false, false], [true, true]]) {
	test(`CA copies Green/alpha and independently copied R${copyRed}/B${copyBlue} for every endpoint and fractional byte`, async ({ page }) => {
		const coverage = [0, 1, 127, 128, 254, 255], value = await run(page, {
			incoming: repeated(6, [-0, -0, -0, 0]), candidate: repeated(6, [.5, 3, -.5, 1]), coverage,
			policy: { kind: 'ca-copy', copyRed, copyBlue },
		});
		accepted(value);
		for (let pixel = 0; pixel < 6; pixel++) {
			const at = pixel * 4; expect(value.bits[at + 1]).toBe(value.before[at + 1]); expect(value.bits[at + 3]).toBe(value.before[at + 3]);
			if (copyRed) expect(value.bits[at]).toBe(value.before[at]);
			if (copyBlue) expect(value.bits[at + 2]).toBe(value.before[at + 2]);
		}
	});
}

test('tiny unchanged native components below2^-60 keep exact input words', async ({ page }) => {
	const value = await run(page, { incoming: [2 ** -70, -(2 ** -70), -0, .5], candidate: [2 ** -70, -(2 ** -70), 0, 1], coverage: [128], policy: unchanged });
	accepted(value); expect(value.bits).toEqual(value.before);
});

test('cancellation witness keeps the existing eightULP contract instead of accepting every finite blend draw', async ({ page }) => {
	const value = await run(page, { incoming: [1, .25, 2, 1], candidate: [-1, .5, 4, 0], coverage: [128], policy: generic });
	expect(value.expected[0]).toBe(exactFloatWord(-1 / 255));
	// Predicted Float32 ratio cancellation on the pinned software renderers.
	// If actual execution is more accurate, retain the unmodified8ULP contract
	// and record acceptance honestly rather than manufacture a required refusal.
	const distance = Math.abs(rank(value.expected[0]) - rank(value.bits[0]));
	expect(equivalent(value)).toBe(distance <= 8);
	if (distance > 8) expect(value.bits[0]).not.toBe(value.expected[0]);
});
