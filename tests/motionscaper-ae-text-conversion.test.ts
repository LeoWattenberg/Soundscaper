/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMotionAeProperties } from '../src/common/editor/motion-ae-property-custody.ts';
import type { MotionAeProperty, MotionAeText } from '../src/common/editor/motion-ae-exchange-types.ts';
import { normalizeMotionAsset } from '../src/common/editor/motion-asset.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import { createMotionTextAnimator } from '../src/common/editor/motion-authoring-operators.ts';
import { convertMotionAeTextDocument, exportMotionAeTextDocument } from '../src/common/editor/motion-ae-text-conversion.ts';
import { normalizeMotionAeFontBindings } from '../src/common/editor/motion-ae-text-fonts.ts';
const asset = normalizeMotionAsset({ id: 'retained-font', name: 'User supplied face', kind: 'font', family: 'Display Family', style: 'Regular',
	sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}`, byteLength: 100, mimeType: 'font/otf' });
if (asset.kind !== 'font') throw new Error('Expected font.');
const bindings = [{ postScriptName: 'ExactPostScript-Regular', asset }];
const source: MotionAeText = { text: 'Hello\r中文', font: bindings[0]!.postScriptName, fontSize: 40, fillColor: [0.5, 0.25, 0.75],
	applyFill: true, applyStroke: false, strokeColor: [0, 0, 0], strokeWidth: 0, tracking: 50, leading: 48, autoLeading: false, justification: 'center',
	styleScope: 'uniform', styleSupport: 'basic', layout: { kind: 'box', orientation: 'horizontal', size: [320, 160], position: [-10, -30] } };
const property = (value = source): Extract<MotionAeProperty, { kind: 'text' }> => ({ kind: 'text', matchName: 'ADBE Text Document', name: 'Source Text', value, keys: [], expression: null });
const options = { layoutPolicy: 'review-reflow', colorSpace: 'srgb', lineHeight: 1.25 } as const;
const reverse = { layoutPolicy: 'review-reflow', colorSpace: 'srgb', leading: 50 } as const;
test('Motion AE text imports explicitly bound static style and returns the independent box offset', () => {
	const result = convertMotionAeTextDocument(property(), bindings, options);
	assert.equal(result.status, 'editable'); assert.ok(result.document); assert.deepEqual(result.localOffset, [-10, -30]);
	const run = result.document.runs[0]!;
	assert.equal(run.text, 'Hello\n中文'); assert.equal(run.fontAssetId, asset.id); assert.equal(run.fontSize.value, 40); assert.equal(run.tracking.value, 2);
	assert.ok(Math.abs(run.color.value[0] - 0.21404114048223255) < 1e-14); assert.equal(run.color.value[3], 1);
	assert.deepEqual(result.document.boxSize.value, [320, 160]); assert.equal(result.document.lineHeight.value, 1.25); assert.equal(result.document.align, 'center');
	assert.ok(result.messages.some(message => message.code === 'text-layout-reflow' && message.status === 'unsupported'));
	assert.ok(result.messages.some(message => message.code === 'text-newlines')); assert.ok(Object.isFrozen(result.document));
});
test('Motion AE text never substitutes a family name, unavailable font, unknown style or unsupported layout', () => {
	for (const change of [{ font: asset.family }, { styleScope: 'mixed' as const }, { styleScope: 'unavailable' as const },
		{ styleSupport: 'unsupported' as const }, { styleSupport: 'unavailable' as const }, { applyStroke: true }, { applyFill: false },
		{ layout: { kind: 'point' as const, orientation: 'horizontal' as const } },
		{ layout: { ...source.layout!, orientation: 'vertical-right-to-left' as const } }, { text: 'x'.repeat(65_537) }, { text: 'e\u0301' }]) {
		const result = convertMotionAeTextDocument(property({ ...source, ...change }), bindings, options);
		assert.equal(result.status, 'unsupported'); assert.equal(result.document, null); assert.equal(result.localOffset, null);
	}
	assert.equal(convertMotionAeTextDocument(property(), [], options).document, null);
	const { styleScope: _scope, styleSupport: _support, layout: _layout, ...legacy } = source;
	assert.deepEqual(normalizeMotionAeProperties([property(legacy)], { properties: 0, keys: 0 })[0], property(legacy));
	assert.equal(convertMotionAeTextDocument(property(legacy), bindings, options).document, null);
});
test('Motion AE text refuses source animation and malformed or unreviewed mapping options', () => {
	const input = property();
	assert.equal(convertMotionAeTextDocument({ ...input, expression: { source: 'eval(userCode)', enabled: true, disposition: 'unsupported' } }, bindings, options).document, null);
	const key = { time: 0, value: source, inInterpolation: 'hold' as const, outInterpolation: 'hold' as const, inEase: [{ speed: 0, influence: 33 }], outEase: [{ speed: 0, influence: 33 }], inSpatialTangent: null, outSpatialTangent: null, roving: false };
	assert.equal(convertMotionAeTextDocument({ ...input, keys: [key] }, bindings, options).document, null);
	assert.throws(() => convertMotionAeTextDocument(input, bindings, { ...options, lineHeight: 0 }), /line height/iu);
	assert.throws(() => convertMotionAeTextDocument(input, bindings, { ...options, layoutPolicy: 'guess' } as never), /policy/iu);
});
test('Motion AE text exports only explicit PostScript bindings and reports reviewed reflow', () => {
	const document = convertMotionAeTextDocument(property(), bindings, options).document!;
	const result = exportMotionAeTextDocument(document, bindings, reverse);
	assert.equal(result.status, 'editable'); assert.ok(result.property);
	assert.equal(result.property.value.font, source.font); assert.equal(result.property.value.text, source.text); assert.equal(result.property.value.tracking, 50);
	assert.equal(result.property.value.leading, 50); assert.equal(result.property.value.autoLeading, false);
	assert.deepEqual(result.property.value.layout, { kind: 'box', orientation: 'horizontal', size: [320, 160], position: [0, 0] });
	for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(result.property.value.fillColor[channel]! - source.fillColor[channel]!) < 1e-14);
	assert.ok(result.messages.some(message => message.code === 'text-layout-reflow' && message.status === 'unsupported'));
	assert.equal(exportMotionAeTextDocument(document, [], reverse).property, null);
	const run = document.runs[0]!;
	for (const candidate of [
		{ ...document, runs: [run, { ...run, fontSize: motionScalar(41) }] },
		{ ...document, runs: [{ ...run, color: { ...run.color, value: [1, 1, 1, 0.5] as const } }] },
		{ ...document, lineHeight: { ...document.lineHeight, expression: { source: 'time', enabled: true, references: [] } } },
		{ ...document, align: 'justify' as const },
		{ ...document, animators: [createMotionTextAnimator('animated')] },
		{ ...document, runs: [{ ...run, fontSize: { ...run.fontSize, curve: { anchors: [{ position: { num: 0, den: 1 }, value: 40 }], segments: [] } } }] },
	]) assert.equal(exportMotionAeTextDocument(candidate, bindings, reverse).property, null);
	const split = { ...document, runs: [{ ...run, text: 'Hello\n' }, { ...run, text: '中文' }] };
	assert.equal(exportMotionAeTextDocument(split, bindings, reverse).property!.value.text, source.text);
});
test('Motion AE font binding contracts reject ambiguity and retain digest-bound descriptors', () => {
	assert.deepEqual(normalizeMotionAeFontBindings(bindings), bindings);
	assert.throws(() => normalizeMotionAeFontBindings([...bindings, ...bindings]), /unique/iu);
	assert.throws(() => normalizeMotionAeFontBindings([{ ...bindings[0], postScriptName: asset.family }, ...bindings]), /unique/iu);
	assert.throws(() => normalizeMotionAeFontBindings([{ ...bindings[0], asset: { ...asset, storageKey: 'other-body' } }]), /digest/iu);
	assert.throws(() => normalizeMotionAeFontBindings([{ ...bindings[0], systemFallback: true }]), /unsupported field/iu);
});
test('Motion AE optional text custody is closed and rejects ambiguous geometry', () => {
	assert.deepEqual(normalizeMotionAeProperties([property()], { properties: 0, keys: 0 })[0], property());
	for (const value of [{ ...source, styleScope: 'first-character' }, { ...source, layout: { kind: 'point', orientation: 'horizontal', size: [10, 10] } },
		{ ...source, layout: { kind: 'box', orientation: 'horizontal', size: [0, 10], position: [0, 0] } }, { ...source, layout: { ...source.layout, systemFont: true } }]) {
		assert.throws(() => normalizeMotionAeProperties([{ ...property(), value }], { properties: 0, keys: 0 }));
	}
});
