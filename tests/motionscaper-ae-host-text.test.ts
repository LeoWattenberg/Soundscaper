/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readMotionAeImportText } from '../src/common/editor/motion-ae-host-import-text.ts';
import { captureMotionAeTextStyle, applyMotionAeHostText, verifyMotionAeHostFont } from '../src/common/editor/motion-ae-host-text.ts';
import { motionAeTextFixture } from './helpers/motionscaper-ae-text-fixture.ts';
function source() { const roots = motionAeTextFixture().compositions[0]!.layers[0]!.properties; return readMotionAeImportText(roots, [], { properties: 0, keys: 0 })!; }
const enums = { horizontal: 'horizontal', verticalRight: 'vertical-right', verticalLeft: 'vertical-left', left: 'left', center: 'center', right: 'right',
	metricKern: 'metric', baseline: 'baseline', normalCaps: 'caps', normalBaseline: 'normal-baseline', leftToRight: 'ltr', defaultDigits: 'digits',
	romanLeading: 'roman', boxNone: 'none', boxTop: 'top', boxAscent: 'ascent' };
function fixture() {
	const sourceText = source(); const { layout: _layout, styleScope: _scope, styleSupport: _support, ...base } = sourceText;
	const range: Record<string, unknown> = { ...base, fontObject: { postScriptName: base.font, isSubstitute: false, hasDesignAxes: false }, fauxBold: false, fauxItalic: false, baselineShift: 0, horizontalScale: 100, verticalScale: 100, tsume: 0,
		firstLineIndent: 0, startIndent: 0, endIndent: 0, spaceBefore: 0, spaceAfter: 0, autoHyphenate: false, noBreak: false, hangingRoman: false,
		autoKernType: enums.metricKern, baselineDirection: enums.baseline, fontCapsOption: enums.normalCaps, fontBaselineOption: enums.normalBaseline, direction: enums.leftToRight, digitSet: enums.defaultDigits, leadingType: enums.romanLeading, ligature: true };
	const doc = { ...range, ...base, boxText: true, boxTextSize: [200, 100], boxTextPos: [-10, -30], lineOrientation: enums.horizontal,
		boxAutoFitPolicy: enums.boxNone, boxVerticalAlignment: enums.boxTop, boxFirstBaselineAlignment: enums.boxAscent, boxFirstBaselineAlignmentMinimum: 0, boxInsetSpacing: 0,
		characterRange: (start: number, end: number) => { assert.equal(start, 0); assert.equal(end, -1); return range; } };
	return { doc, range };
}
test('Motion AE text plan admits only bounded static reviewed paragraph text before any host mutation', () => {
	const text = source(); assert.equal(text.font, 'ExactFace-Regular'); assert.equal(text.layout.kind, 'box');
	const roots = motionAeTextFixture().compositions[0]!.layers[0]!.properties, group = roots[1]!; if (group.kind !== 'group') throw new Error('Expected group.');
	const property = group.children[0]!; if (property.kind !== 'text') throw new Error('Expected text.');
	for (const change of [{ styleScope: 'mixed' }, { styleSupport: 'unavailable' }, { applyStroke: true }, { fontSize: 2000 }, { layout: { kind: 'point', orientation: 'horizontal' } }]) {
		assert.throws(() => readMotionAeImportText([{ ...group, children: [{ ...property, value: { ...property.value, ...change } }] }], [], { properties: 0, keys: 0 }), /text|font|paragraph/iu);
	}
	assert.throws(() => readMotionAeImportText([group, group], [], { properties: 0, keys: 0 }), /text/iu);
});
test('Motion AE full-range capture distinguishes basic, mixed, unavailable and non-neutral text', () => {
	const full = fixture(), captured = captureMotionAeTextStyle(full.doc, enums);
	assert.equal(captured.styleScope, 'uniform'); assert.equal(captured.styleSupport, 'basic');
	assert.deepEqual(captured.layout, { kind: 'box', orientation: 'horizontal', size: [200, 100], position: [-10, -30] });
	full.range.fontSize = undefined; assert.equal(captureMotionAeTextStyle(full.doc, enums).styleScope, 'mixed');
	const styled = fixture(); styled.range.fauxBold = true; assert.equal(captureMotionAeTextStyle(styled.doc, enums).styleSupport, 'unsupported');
	const missing = fixture(); delete missing.range.tsume; assert.equal(captureMotionAeTextStyle(missing.doc, enums).styleSupport, 'unavailable');
	assert.equal(captureMotionAeTextStyle({ ...fixture().doc, characterRange: undefined }, enums).styleScope, 'unavailable');
	const box = { ...fixture().doc, boxInsetSpacing: 5 }; assert.equal(captureMotionAeTextStyle(box, enums).styleSupport, 'unsupported');
});
test('Motion AE importer refuses missing, substitute or ambiguous faces before applying reviewed paragraph values', () => {
	const face = { postScriptName: 'ExactFace-Regular', isSubstitute: false, hasDesignAxes: false };
	assert.equal(verifyMotionAeHostFont(face.postScriptName, () => [face]), face);
	for (const faces of [[], [{ ...face, isSubstitute: true }], [face, face], [{ ...face, postScriptName: 'other' }]]) assert.throws(() => verifyMotionAeHostFont(face.postScriptName, () => faces), /font/iu);
	const target: Record<string, unknown> = { resetCharStyle: () => {}, resetParagraphStyle: () => {} };
	applyMotionAeHostText(target, source(), enums, face);
	assert.equal(target.fontObject, face); assert.equal(target.text, 'Retained\rtext'); assert.equal(target.fontSize, 40); assert.equal(target.tracking, 50);
	assert.deepEqual(target.boxTextPos, [-10, -30]); assert.equal(target.boxAutoFitPolicy, 'none'); assert.equal(target.boxInsetSpacing, 0);
	assert.equal(target.autoLeading, false); assert.equal(target.leading, 48); assert.equal(target.direction, 'ltr');
});

test('generated AE text capture does not read a disabled stroke color and old hosts retain unavailable metadata', async () => {
	const runtime = await readFile(new URL('../src/motionscaper/ae-bridge/motion-ae-installed-text.jsxinc', import.meta.url), 'utf8');
	const sourceText = source(); const document = { ...sourceText, justification: 'left' };
	Object.defineProperty(document, 'strokeColor', { get: () => { throw new Error('AE forbids strokeColor when applyStroke is false'); } });
	const sandbox = { app: { version: '23.0' }, ParagraphJustification: { LEFT_JUSTIFY: 'left', CENTER_JUSTIFY: 'center', RIGHT_JUSTIFY: 'right' },
		MotionAeHostText: { captureMotionAeTextStyle, applyMotionAeHostText, verifyMotionAeHostFont }, document, captured: null as unknown };
	vm.runInNewContext(runtime + '\ncaptured = MotionAeInstalledText.readMotionAeInstalledText(document);', sandbox, { timeout: 1000 });
	const captured = sandbox.captured as { styleScope: string; styleSupport: string; strokeColor: number[] };
	assert.equal(captured.styleScope, 'unavailable'); assert.equal(captured.styleSupport, 'unavailable'); assert.deepEqual(Array.from(captured.strokeColor), [0, 0, 0]);
});
