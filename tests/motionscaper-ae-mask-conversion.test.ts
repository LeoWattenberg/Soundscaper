/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
import { motionPropertyOfKind, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
const path = motionPropertyOfKind({ kind: 'path', value: { closed: true, vertices: [[0, 0], [20, 0], [10, 20]].map(point => ({ point, inTangent: [0, 0], outTangent: [0, 0] })) }, keyframes: [], segments: [], expression: null }, 'path');
function fixture() {
	const project = createMotionscaperProject({ id: 'p', title: 'Masks', compositionId: 'c', frameRate: { num: 24, den: 1 }, durationFrames: 48 });
	const layer = createMotionLayer({ id: 'l', name: 'Masked null', durationFrames: 48, content: { kind: 'null' } });
	return { ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer, masks: [{ id: 'mask', path, opacity: motionScalar(0.75), feather: motionVector([0, 0]), expansion: motionScalar(0), inverted: true, operation: 'subtract' as const }] }] }] };
}
function importExchange(exchange: unknown) { let id = 0; return convertMotionscaperAeExchange(exchange, { projectId: 'new', allocateId: () => `new-${String(++id)}`, bindings: [] }); }
test('Motion AE editable masks roundtrip local path, opacity, inversion and operation through actual project converters', () => {
	const source = fixture(), exported = prepareMotionscaperAeExport(source), masks = exported.exchange.compositions[0]!.layers[0]!.properties.find(property => property.matchName === 'ADBE Mask Parade');
	assert.ok(masks); const imported = importExchange(exported.exchange), layer = imported.project.compositions[0]!.layers[0]!;
	assert.equal(layer.masks.length, 1); assert.deepEqual({ ...layer.masks[0], id: 'mask' }, source.compositions[0]!.layers[0]!.masks[0]);
	assert.ok(imported.report.some(entry => entry.code === 'mask-mapping' && entry.status === 'editable'));
	assert.equal(imported.report.some(entry => entry.code === 'property-mapping' && entry.propertyPath.endsWith('ADBE Mask Parade')), false);
});
test('Motion AE masks never infer missing mode authority or equate Gaussian feather to AE feather radius', () => {
	const source = fixture(), layer = source.compositions[0]!.layers[0]!;
	const feathered = prepareMotionscaperAeExport({ ...source, compositions: [{ ...source.compositions[0]!, layers: [{ ...layer, masks: [{ ...layer.masks[0]!, feather: motionVector([2, 3]) }] }] }] });
	assert.ok(feathered.exchange.report.some(entry => entry.code === 'mask-mapping' && entry.status === 'unsupported'));
	const exported = prepareMotionscaperAeExport(source), comp = exported.exchange.compositions[0]!, item = comp.layers[0]!;
	const properties = item.properties.map(property => property.kind === 'group' && property.matchName === 'ADBE Mask Parade' ? { ...property, children: property.children.map(mask => {
		if (mask.kind !== 'group') return mask; const { mask: metadata, ...rest } = mask; assert.ok(metadata); return rest;
	}) } : property);
	const imported = importExchange({ ...exported.exchange, compositions: [{ ...comp, layers: [{ ...item, properties }] }] });
	assert.equal(imported.project.compositions[0]!.layers[0]!.masks.length, 0); assert.ok(imported.report.some(entry => /mask.*metadata/iu.test(entry.message)));
});
