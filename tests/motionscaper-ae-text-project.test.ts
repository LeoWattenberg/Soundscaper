/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { offsetMotionAeTextAnchor, rebaseMotionAeTextLayer } from '../src/common/editor/motion-ae-text-layer.ts';
import { motionVector } from '../src/common/editor/motion-property.ts';
import { evaluateInterpolationCurve, compileInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import { motionAeTextFixture, motionAeTextFont, motionAeTextOptions } from './helpers/motionscaper-ae-text-fixture.ts';
function options() { let serial = 0; return { projectId: 'destination', allocateId: () => `text-${String(++serial)}`, bindings: [], fonts: [motionAeTextFont], text: motionAeTextOptions }; }
test('Motion AE project text requires explicit review and retains font geometry under rotated nonuniform transforms', () => {
	const exchange = motionAeTextFixture(), converted = convertMotionscaperAeExchange(exchange, options()), layer = converted.project.compositions[0]!.layers[0]!;
	assert.equal(layer.kind, 'text'); if (layer.kind !== 'text') throw new Error('Expected text.');
	assert.equal(layer.document.runs[0]!.fontAssetId, motionAeTextFont.asset.id);
	assert.deepEqual(layer.transform.anchor.value, [15, 36, 0]); assert.deepEqual(layer.transform.position.value, [100, 120, 0]);
	assert.deepEqual(layer.transform.scale.value, [1.5, 0.8, 1]); assert.equal(layer.transform.rotation.value[2], 30);
	assert.deepEqual(converted.project.assets, [motionAeTextFont.asset]);
	assert.ok(converted.report.some(entry => entry.code === 'text-layout-reflow' && entry.status === 'unsupported'));
	assert.ok(converted.report.some(entry => entry.code === 'text-box-origin' && entry.status === 'editable'));
	const { text: _text, ...unreviewed } = options();
	assert.equal(convertMotionscaperAeExchange(exchange, unreviewed).project.compositions[0]!.layers[0]!.kind, 'null');
	assert.throws(() => convertMotionscaperAeExchange(exchange, { ...options(), allocateId: () => motionAeTextFont.asset.id }), /identity/iu);
	assert.equal(exchange.compositions[0]!.layers[0]!.properties[0]?.kind, 'group');
});
test('Motion AE anchor rebasing translates base, keyed anchors and Bezier controls without moving time or Z', () => {
	const anchor = { ...motionVector([5, 6, 7]), curves: [{ anchors: [{ position: { num: 0, den: 1 }, value: 5 }, { position: { num: 24, den: 1 }, value: 9 }],
		segments: [{ kind: 'bezier' as const, control1: { position: { num: 4, den: 1 }, value: 8 }, control2: { position: { num: 18, den: 1 }, value: 6 } }] }, null, null] as const };
	const shifted = offsetMotionAeTextAnchor(anchor, [-10, -30]);
	assert.deepEqual(shifted.value, [15, 36, 7]); assert.equal(shifted.curves[2], null);
	assert.equal(shifted.curves[0]!.anchors[0]!.value, 15);
	for (const time of [0, 5, 12, 24]) assert.ok(Math.abs(evaluateInterpolationCurve(shifted.curves[0]!, { num: time, den: 1 }) - evaluateInterpolationCurve(compileInterpolationCurve(anchor.curves[0]), { num: time, den: 1 }) - 10) < 1e-10);
	assert.equal(anchor.curves[0].anchors[0]!.value, 5);
});
test('Motion AE reverse text binds the exact retained font and carries static Source Text plus reflow report', () => {
	const converted = convertMotionscaperAeExchange(motionAeTextFixture(), options());
	const text = { layoutPolicy: 'review-reflow', colorSpace: 'srgb', leading: 48 } as const;
	const prepared = prepareMotionscaperAeExport(converted.project, { fonts: [motionAeTextFont], text }), layer = prepared.exchange.compositions[0]!.layers[0]!;
	assert.equal(layer.kind, 'text'); assert.equal(layer.enabled, true); assert.equal(layer.sourceId, null);
	const group = layer.properties.find(property => property.matchName === 'ADBE Text Properties'); assert.equal(group?.kind, 'group');
	if (group?.kind !== 'group' || group.children[0]?.kind !== 'text') throw new Error('Expected Source Text.');
	assert.equal(group.children[0].value.font, motionAeTextFont.postScriptName); assert.equal(group.children[0].value.text, 'Retained\rtext');
	assert.deepEqual(group.children[0].value.layout, { kind: 'box', orientation: 'horizontal', size: [200, 100], position: [0, 0] });
	assert.ok(prepared.exchange.report.some(entry => entry.code === 'text-layout-reflow' && entry.status === 'unsupported'));
	assert.equal(prepareMotionscaperAeExport(converted.project).exchange.compositions[0]!.layers[0]!.kind, 'null');
	assert.throws(() => prepareMotionscaperAeExport(converted.project, { text, fonts: [{ ...motionAeTextFont, asset: { ...motionAeTextFont.asset, sha256: 'b'.repeat(64), storageKey: `motion-sha256:${'b'.repeat(64)}` } }] }), /font.*retained/iu);
});
test('Motion AE text layer controls stay explicit: nonempty animators refuse and unmapped layout controls are reported', () => {
	const input = motionAeTextFixture(), comp = input.compositions[0]!, layer = comp.layers[0]!, group = layer.properties[1]!;
	if (group.kind !== 'group') throw new Error('Expected Text group.');
	const alter = (matchName: string) => ({ ...input, compositions: [{ ...comp, layers: [{ ...layer, properties: [layer.properties[0]!, { ...group, children: [...group.children,
		{ kind: 'group' as const, name: 'Unmapped controls', matchName, children: [{ kind: 'numeric' as const, name: 'Original control', matchName: 'original', value: [1], keys: [], expression: null, spatial: false }] },
	] }] }] }] });
	assert.equal(convertMotionscaperAeExchange(alter('ADBE Text Animators'), options()).project.compositions[0]!.layers[0]!.kind, 'null');
	const partial = convertMotionscaperAeExchange(alter('ADBE Text More Options'), options());
	assert.equal(partial.project.compositions[0]!.layers[0]!.kind, 'text');
	assert.ok(partial.report.some(entry => entry.code === 'text-layer-control' && entry.status === 'unsupported'));
});

test('Motion AE text rebasing retains masked local geometry and refuses changing inherited child coordinates', () => {
	const source = motionAeTextFixture(), comp = source.compositions[0]!, original = comp.layers[0]!;
	const parented = { ...source, compositions: [{ ...comp, layers: [original, { ...original, id: 'child', kind: 'null' as const, properties: [], parentId: original.id }] }] };
	const refused = convertMotionscaperAeExchange(parented, options());
	assert.equal(refused.project.compositions[0]!.layers[0]!.kind, 'null');
	assert.ok(refused.report.some(entry => entry.code === 'text-parent-origin'));
	const mapped = convertMotionscaperAeExchange(source, options()).project.compositions[0]!.layers[0]!;
	const vertices = [[0, 0], [10, 0], [0, 10]].map(point => ({ point: point as [number, number], inTangent: [0, 0] as const, outTangent: [0, 0] as const }));
	const path = { closed: true, vertices };
	const mask = { id: 'mask', name: 'Original mask', operation: 'add' as const, inverted: false, opacity: { kind: 'scalar' as const, value: 1, curve: null, expression: null }, feather: motionVector([0, 0]), expansion: { kind: 'scalar' as const, value: 0, curve: null, expression: null },
		path: { kind: 'path' as const, value: path, keyframes: [{ position: { num: 0, den: 1 }, value: path }], segments: [], expression: null } };
	const rebased = rebaseMotionAeTextLayer({ ...mapped, masks: [mask] }, [-10, -30], original.id, []);
	assert.deepEqual(rebased.masks[0]!.path.value.vertices[0]!.point, [10, 30]);
	assert.deepEqual(rebased.masks[0]!.path.keyframes[0]!.value.vertices[0]!.point, [10, 30]);
	assert.deepEqual(mask.path.value.vertices[0]!.point, [0, 0]);
});
