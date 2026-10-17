/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Script } from 'node:vm';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { prepareMotionscaperAeImport } from '../src/motionscaper/editor-ae-import.ts';
import { createMotionExpressionRuntime } from '../src/common/editor/motion-expression-runtime.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import { compileInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import { readMotionAeHostScalarExpression } from '../src/common/editor/motion-ae-host-scalar-expression.ts';
import type { MotionAeProperty } from '../src/common/editor/motion-ae-exchange-types.ts';
function fixture() {
	const project = createMotionscaperProject({ id: 'expression-project', compositionId: 'expression-comp', title: 'Expression units', frameRate: { num: 24, den: 1 }, durationFrames: 48 });
	const layer = createMotionLayer({ id: 'expression-layer', name: 'Expression opacity', durationFrames: 48, content: { kind: 'null' } });
	const opacity = { ...motionScalar(.25), curve: compileInterpolationCurve({ anchors: [{ position: { num: 0, den: 1 }, value: .25 }, { position: { num: 24, den: 1 }, value: .5 }], segments: [{ kind: 'linear' }] }), expression: { source: 'value + time*.25', enabled: true, references: [] } };
	return { ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer, transform: { ...layer.transform, opacity } }] }] };
}
function opacity(properties: readonly MotionAeProperty[]) {
	const group = properties.find(property => property.matchName === 'ADBE Transform Group'); if (group?.kind !== 'group') throw new Error('Expected transform');
	const property = group.children.find(property => property.matchName === 'ADBE Opacity'); if (property?.kind !== 'numeric') throw new Error('Expected opacity'); return property;
}
test('opt-in Motion opacity expressions round trip with underlying keys and exact original source custody', async () => {
	const original = fixture(), defaultExport = prepareMotionscaperAeExport(original);
	assert.equal(opacity(defaultExport.exchange.compositions[0]!.layers[0]!.properties).expression?.disposition, 'unsupported');
	const exported = prepareMotionscaperAeExport(original, { translateScalarExpressions: true });
	const property = opacity(exported.exchange.compositions[0]!.layers[0]!.properties);
	assert.equal(property.expression?.disposition, 'translated'); assert.ok(property.expression?.source);
	assert.equal(readMotionAeHostScalarExpression(property.expression.source), property.expression.source);
	assert.deepEqual(property.keys.map(key => key.value), [[25], [50]]);
	const ae: unknown = new Script(property.expression.source).runInNewContext({ value: 37.5, time: .5 }, { timeout: 100 }); assert.equal(ae, 50);
	let serial = 0; const options = { projectId: 'imported-expression', allocateId: () => `imported-${String(++serial)}` };
	const manifest = new Blob([JSON.stringify(exported.exchange)]);
	const inert = await prepareMotionscaperAeImport(manifest, [], options);
	assert.equal(inert.project.compositions[0]!.layers[0]!.transform.opacity.expression, null);
	const active = await prepareMotionscaperAeImport(manifest, [], { ...options, translateScalarExpressions: true });
	const comp = active.project.compositions[0]!, layer = comp.layers[0]!;
	const runtime = createMotionExpressionRuntime([comp]).createSession();
	assert.equal(runtime.sample({ compositionId: comp.id, layerId: layer.id, propertyPath: 'transform.opacity', frame: { num: 12, den: 1 } }), .5);
	assert.deepEqual(active.project.interchangeCustody?.exchange, exported.exchange);
	assert.equal(exported.revision.project.compositions[0]!.layers[0]!.transform.opacity.expression?.source, 'value + time*.25');
	assert.equal(original.compositions[0]!.layers[0]!.transform.opacity.expression.source, 'value + time*.25');
	assert.ok(exported.exchange.report.some(entry => entry.code === 'expression' && entry.status === 'editable'));
});
test('opt-in transfer refuses unsupported expressions and underlying interpolation without activating a partial value', async () => {
	const original = fixture(), comp = original.compositions[0]!, layer = comp.layers[0]!;
	for (const source of ['wiggle(2,.2)', 'value[0]', 'thisComp.layer(1).opacity']) {
		const exported = prepareMotionscaperAeExport({ ...original, compositions: [{ ...comp, layers: [{ ...layer, transform: { ...layer.transform, opacity: { ...layer.transform.opacity, expression: { ...layer.transform.opacity.expression, source } } } }] }] }, { translateScalarExpressions: true });
		assert.equal(opacity(exported.exchange.compositions[0]!.layers[0]!.properties).expression?.disposition, 'unsupported');
		assert.ok(exported.exchange.report.some(entry => entry.code === 'expression' && entry.status === 'unsupported' && /sampl|render/iu.test(entry.message)));
	}
	const exported = prepareMotionscaperAeExport(original, { translateScalarExpressions: true }), transform = exported.exchange.compositions[0]!.layers[0]!.properties[0]!;
	if (transform.kind !== 'group') throw new Error('Expected transform');
	const changed = { ...exported.exchange, compositions: exported.exchange.compositions.map(comp => ({ ...comp, layers: comp.layers.map(layer => ({ ...layer, properties: [{ ...transform, children: transform.children.map(property => property.kind === 'numeric' && property.matchName === 'ADBE Opacity' ? { ...property, keys: property.keys.map(key => ({ ...key, outInterpolation: 'bezier' as const })) } : property) }] })) })) };
	let serial = 0; const result = await prepareMotionscaperAeImport(new Blob([JSON.stringify(changed)]), [], { projectId: 'refused-curve', allocateId: () => `refused-${String(++serial)}`, translateScalarExpressions: true });
	assert.equal(result.project.compositions[0]!.layers[0]!.transform.opacity.expression, null);
	assert.ok(result.report.some(entry => entry.code === 'numeric-mapping' && entry.status === 'unsupported' && /temporal Bezier/u.test(entry.message)));
});
