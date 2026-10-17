/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertMotionAeShapes, exportMotionAeShapes } from '../src/common/editor/motion-ae-shape-conversion.ts';
import { normalizeMotionAeProperties } from '../src/common/editor/motion-ae-property-custody.ts';
import type { MotionAeLayer, MotionAeProperty, MotionAeReportEntry } from '../src/common/editor/motion-ae-exchange-types.ts';
import { createMotionShapeOperator } from '../src/common/editor/motion-authoring-operators.ts';
import CanvasKitInit from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { motionColor, motionPropertyOfKind, motionScalar } from '../src/common/editor/motion-property.ts';
const rate = { num: 24, den: 1 };
const num = (matchName: string, value: readonly number[]): MotionAeProperty => ({ kind: 'numeric', matchName, name: matchName, value, keys: [], spatial: false, expression: null });
const group = (matchName: string, children: readonly MotionAeProperty[], enabled?: boolean): Extract<MotionAeProperty, { kind: 'group' }> => ({ kind: 'group', matchName, name: matchName, children, ...(enabled === undefined ? {} : { enabled }) });
const triangle = { closed: true, vertices: [{ point: [1, 2], inTangent: [0, 0], outTangent: [2, 0] }, { point: [5, 2], inTangent: [-1, 0], outTangent: [0, 0] }, { point: [3, 6], inTangent: [0, 0], outTangent: [0, 0] }] };
const path = motionPropertyOfKind({ kind: 'path', value: triangle, keyframes: [], segments: [], expression: null }, 'path');
const shape = { id: 'shape', path, fill: motionColor([0.2, 0.4, 0.6, 0.5]), stroke: { color: motionColor([0.8, 0.1, 0.2, 0.7]), width: motionScalar(3), lineCap: 'round' as const, lineJoin: 'bevel' as const } };
const layerCandidate = createMotionLayer({ id: 'layer', name: 'Shapes', durationFrames: 48, content: { kind: 'shapes', shapes: [shape] } });
if (layerCandidate.kind !== 'shapes') throw new Error('Expected shapes.');
const layer = layerCandidate;
const aeLayer = (root: MotionAeProperty): MotionAeLayer => ({ id: 'layer', name: 'Shapes', kind: 'shape', sourceId: null, parentId: null, matte: null,
	startTime: 0, inPoint: 0, outPoint: 2, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [root] });
const convert = (root: MotionAeProperty) => { const report: MotionAeReportEntry[] = []; let index = 0; return { result: convertMotionAeShapes(aeLayer(root), rate, () => `shape-${index++}`, report), report }; };
const exportRoot = () => { const report: MotionAeReportEntry[] = []; const root = exportMotionAeShapes(layer, rate, report); assert.ok(root); return root; };
test('Motion AE shape paints stay ordered and editable without flattening fill/stroke blending', () => {
	const root = exportRoot(); assert.equal(root.children.length, 2);
	const { result, report } = convert(root); assert.ok(result); assert.equal(result.shapes.length, 2);
	assert.deepEqual(result.shapes[0]!.path, path); assert.deepEqual(result.shapes[0]!.fill, shape.fill); assert.equal(result.shapes[0]!.stroke, null);
	assert.deepEqual(result.shapes[1]!.path, path); assert.equal(result.shapes[1]!.fill, null); const stroke = result.shapes[1]!.stroke!; assert.deepEqual({ ...stroke, color: shape.stroke.color }, shape.stroke);
	stroke.color.value.forEach((value, index) => assert.ok(Math.abs(value - shape.stroke.color.value[index]!) < 1e-14));
	assert.ok(report.every(entry => entry.status === 'editable')); assert.ok(report.some(entry => /reference/iu.test(entry.message)));
});
test('Motion AE shape path keys retain topology and exact layer start mapping', () => {
	const next = { ...path.value, vertices: path.value.vertices.map(vertex => ({ ...vertex, point: [vertex.point[0] + 10, vertex.point[1]] })) };
	const animated = motionPropertyOfKind({ ...path, keyframes: [{ position: { num: 0, den: 1 }, value: path.value }, { position: { num: 24, den: 1 }, value: next }], segments: ['linear'] }, 'path');
	const authored = { ...layer, startFrame: { num: 12, den: 1 }, shapes: [{ ...shape, path: animated, stroke: null }] };
	const root = exportMotionAeShapes(authored, rate, []); assert.ok(root); const { result } = convert(root); assert.ok(result);
	assert.deepEqual(result.shapes[0]!.path.keyframes.map(key => key.position), [{ num: 12, den: 1 }, { num: 36, den: 1 }]);
	assert.deepEqual(result.shapes[0]!.path.segments, ['linear']);
});
test('Motion AE static similarity group transforms apply to base/key vertices, handles and stroke width', () => {
	const root = exportRoot(), original = root.children[0]!; if (original.kind !== 'group') throw new Error('Expected group.');
	const transform = group('ADBE Vector Transform Group', [num('ADBE Vector Anchor', [1, 2]), num('ADBE Vector Position', [10, 20]), num('ADBE Vector Scale', [200, 200]),
		num('ADBE Vector Rotation', [90]), num('ADBE Vector Skew', [0]), num('ADBE Vector Skew Axis', [0]), num('ADBE Vector Group Opacity', [100])]);
	const modified = { ...original, children: original.children.map(child => child.matchName === transform.matchName ? transform : child) };
	const { result, report } = convert({ ...root, children: [modified] }); assert.ok(result);
	const first = result.shapes[0]!.path.value.vertices[0]!; assert.deepEqual(first.point, [10, 20]);
	assert.ok(Math.abs(first.outTangent[0]) < 1e-12); assert.equal(first.outTangent[1], 4); assert.equal(result.shapes[0]!.stroke!.width.value, 6);
	assert.ok(report.some(entry => entry.code === 'shape-group-transform'));
});
test('Motion AE shapes refuse unknown operators, unqualified styles, nested/ambiguous paths and missing switches atomically', () => {
	const root = exportRoot(), first = root.children[0]!; if (first.kind !== 'group') throw new Error('Expected group.');
	for (const candidate of [
		{ ...root, children: [first, group('ADBE Vector Filter - Repeater', [], true)] },
		{ ...root, children: [{ ...first, enabled: undefined }] },
		{ ...root, children: [{ ...first, vectorStyle: undefined }] },
		{ ...root, children: [{ ...first, children: [...first.children, num('unknown-authoring', [1])] }] },
	]) { const { result, report } = convert(candidate); assert.equal(result, null); assert.ok(report.some(entry => entry.status === 'unsupported')); }
	const muted = { ...root, children: [{ ...first, enabled: false }, root.children[1]!] }; const output = convert(muted); assert.equal(output.result!.shapes.length, 1);
	assert.ok(output.report.some(entry => entry.code === 'shape-disabled'));
});
test('Motion AE shape export refuses gradients, active operators and animated RGB rather than omitting them', () => {
	const gradient = { kind: 'linear-gradient' as const, start: { kind: 'vector2' as const, value: [0, 0] as const, curves: [null, null] as const, expression: null }, end: { kind: 'vector2' as const, value: [10, 0] as const, curves: [null, null] as const, expression: null }, stops: [{ id: 'a', offset: motionScalar(0), color: motionColor([1, 0, 0, 1]) }, { id: 'b', offset: motionScalar(1), color: motionColor([0, 1, 0, 1]) }] };
	assert.equal(exportMotionAeShapes({ ...layer, operators: [createMotionShapeOperator({ id: 'repeater', kind: 'repeater' })] }, rate, []), null);
	const report: MotionAeReportEntry[] = []; assert.equal(exportMotionAeShapes({ ...layer, shapes: [{ ...shape, fill: gradient }] }, rate, report), null);
	assert.ok(report.some(entry => entry.status === 'unsupported'));
	const curve = { anchors: [{ position: { num: 0, den: 1 }, value: 0.2 }], segments: [] };
	assert.equal(exportMotionAeShapes({ ...layer, shapes: [{ ...shape, fill: { ...shape.fill, curves: [curve, null, null, null] } }] }, rate, []), null);
});
test('Motion AE vector enable custody preserves absent legacy bytes and refuses non-vector misuse', () => {
	const legacy = group('ADBE Vector Group', []), normalize = (value: unknown) => normalizeMotionAeProperties([value], { properties: 0, keys: 0 })[0];
	assert.deepEqual(normalize(legacy), legacy); assert.deepEqual(normalize({ ...legacy, enabled: false }), { ...legacy, enabled: false });
	assert.throws(() => normalize({ ...legacy, enabled: 'yes' }), /boolean/iu);
	assert.throws(() => normalize({ ...legacy, vectorStyle: { blendMode: 'auto' } }), /blend/iu);
	assert.throws(() => normalize({ ...legacy, vectorStyle: { blendMode: 'normal', rawEnum: 1 } }), /unsupported/iu);
	assert.throws(() => normalize({ ...legacy, matchName: 'ADBE Mask Atom', enabled: false }), /vector/iu);
});

test('Motion AE shape roundtrip preserves actual CanvasKit alpha and painter order', async () => {
	const expanded = motionPropertyOfKind({ ...path, value: { ...path.value, vertices: path.value.vertices.map(vertex => ({ point: [vertex.point[0] * 6 + 8, vertex.point[1] * 6 + 4], inTangent: vertex.inTangent.map(value => value * 6), outTangent: vertex.outTangent.map(value => value * 6) })) } }, 'path');
	const authored = { ...layer, shapes: [{ ...shape, path: expanded }, { ...shape, id: 'top', path: expanded, fill: motionColor([0.1, 0.9, 0.2, 0.3]), stroke: null }] };
	const root = exportMotionAeShapes(authored, rate, []); assert.ok(root); const converted = convert(root).result; assert.ok(converted);
	const project = createMotionscaperProject({ id: 'paint', compositionId: 'main', title: 'Paint', width: 64, height: 64 });
	const kit = await CanvasKitInit(), rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], loadAsset: () => Promise.reject(new Error('No assets expected.')) });
	const render = async (shapes: typeof authored.shapes | typeof converted.shapes) => {
		const scene = { ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer, shapes }] }] };
		return motionSurfaceToRgba8(await renderMotionCompositionFrame(compileMotionscaperProject(scene).evaluate({ compositionId: 'main', time: 0 }), { rasterizer }), 'srgb');
	};
	const before = await render(authored.shapes), after = await render(converted.shapes);
	assert.ok(before.some((value, index) => index % 4 === 3 && value > 0)); assert.deepEqual(after, before);
});

test('Motion AE shape opacity and stroke width retain authored hold/linear keys', () => {
	const curve = { anchors: [{ position: { num: 0, den: 1 }, value: 0.5 }, { position: { num: 24, den: 1 }, value: 0.8 }], segments: [{ kind: 'hold' as const }] };
	const color = { ...shape.stroke.color, value: [0.8, 0.1, 0.2, 0.5] as const, curves: [null, null, null, curve] as const };
	const width = { ...shape.stroke.width, curve: { anchors: [{ position: { num: 0, den: 1 }, value: 3 }, { position: { num: 24, den: 1 }, value: 9 }], segments: [{ kind: 'linear' as const }] } };
	const source = { ...layer, shapes: [{ ...shape, fill: null, stroke: { ...shape.stroke, color, width } }] };
	const root = exportMotionAeShapes(source, rate, []); assert.ok(root); const converted = convert(root).result; assert.ok(converted);
	assert.deepEqual(converted.shapes[0]!.stroke!.color.curves[3], curve); assert.deepEqual(converted.shapes[0]!.stroke!.width, width);
});
test('Motion AE shape transforms refuse nonuniform scale, group opacity and skew', () => {
	const root = exportRoot(), original = root.children[0]!; if (original.kind !== 'group') throw new Error('Expected group.');
	for (const change of [num('ADBE Vector Scale', [100, 200]), num('ADBE Vector Group Opacity', [50]), num('ADBE Vector Skew', [1])]) {
		const modified = { ...original, children: original.children.map(child => child.kind === 'group' && child.matchName === 'ADBE Vector Transform Group' ? { ...child, children: child.children.map(property => property.matchName === change.matchName ? change : property) } : child) };
		const result = convert({ ...root, children: [modified] }); assert.equal(result.result, null); assert.ok(result.report.some(entry => entry.status === 'unsupported'));
	}
});

test('Motion AE path direction requires captured forward semantics when a raw popup is present', () => {
	const root = exportRoot();
	const direction = (meaning: 'forward' | 'reversed' | 'unavailable', animated = false): MotionAeProperty => {
		const walk = (item: MotionAeProperty): MotionAeProperty => item.kind !== 'group' ? item : { ...item,
			...(item.matchName === 'ADBE Vector Shape - Group' ? { vectorStyle: { blendMode: 'unavailable' as const, pathDirection: meaning } } : {}),
			children: [...item.children.map(walk), ...(item.matchName === 'ADBE Vector Shape - Group' ? [{ ...num('ADBE Vector Shape Direction', [618]), ...(animated ? { expression: { enabled: true, source: '618', disposition: 'unsupported' as const } } : {}) }] : [])] };
		return walk(root);
	};
	assert.ok(convert(direction('forward')).result);
	for (const candidate of [direction('reversed'), direction('unavailable'), direction('forward', true)]) assert.equal(convert(candidate).result, null);
});

test('Motion AE neutral modern stroke taper/wave controls preserve paint while active or animated controls refuse', () => {
	const root = exportRoot();
	const modified = (amount: number): MotionAeProperty => {
		const walk = (item: MotionAeProperty): MotionAeProperty => item.kind !== 'group' ? item : { ...item, children: [...item.children.map(walk),
			...(item.matchName === 'ADBE Vector Graphic - Stroke' ? [group('ADBE Vector Stroke Taper', [num('ADBE Vector Taper Start Length', [0]), num('ADBE Vector Taper End Length', [0])]), group('ADBE Vector Stroke Wave', [num('ADBE Vector Taper Wave Amount', [amount])])] : [])] };
		return walk(root);
	};
	assert.ok(convert(modified(0)).result); assert.equal(convert(modified(10)).result, null);
});
