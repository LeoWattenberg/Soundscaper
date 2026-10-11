/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
import { prepareMotionAeHostImport } from '../src/common/editor/motion-ae-host-import-plan.ts';
import type { MotionAeExchange } from '../src/common/editor/motion-ae-exchange-types.ts';
import { trackingProject } from './helpers/motionscaper-tracking-fixture.ts';
test('Motion AE export maps matte identity independently from stacking order and requires explicit modern host binding', () => {
	const source = trackingProject(), comp = source.compositions[0]!, sourceLayer = comp.layers[0]!, consumer = comp.layers[1]!;
	const result = prepareMotionscaperAeExport({ ...source, compositions: [{ ...comp, layers: [sourceLayer, { ...consumer, matte: { layerId: sourceLayer.id, mode: 'alpha-inverted' } }] }] });
	const layers = result.exchange.compositions[0]!.layers;
	assert.deepEqual(layers[1]!.matte, { layerId: layers[0]!.id, type: 'alpha-inverted' }); assert.equal(layers[0]!.enabled, false);
	const plan = prepareMotionAeHostImport(JSON.stringify(result.exchange)); assert.deepEqual(plan.compositions[0]!.layers[1]!.matte, layers[1]!.matte);
	assert.ok(result.exchange.report.some(entry => entry.code === 'matte-mapping' && entry.status === 'editable'));
	const composition = result.exchange.compositions[0]!;
	assert.throws(() => prepareMotionAeHostImport(JSON.stringify({ ...result.exchange, compositions: [{ ...composition, layers: [{ ...layers[0]!, matte: { layerId: layers[1]!.id, type: 'alpha' } }, layers[1]] }] })), /matte cycle/u);
	assert.throws(() => prepareMotionAeHostImport(JSON.stringify({ ...result.exchange, compositions: [{ ...composition, layers: [{ ...layers[0]!, matte: { layerId: 'missing', type: 'alpha' } }, layers[1]] }] })), /matte source.*unresolved/u);
});
test('AE matte materialization refuses amplification beyond its bounded layer closure', () => {
	const project = createMotionscaperProject({ id: 'p', title: 'Bounded', compositionId: 'c', durationFrames: 48 });
	const source = createMotionLayer({ id: 'source', name: 'Source', durationFrames: 48, content: { kind: 'null' } });
	const exported = prepareMotionscaperAeExport({ ...project, compositions: [{ ...project.compositions[0]!, layers: [source] }] }).exchange;
	const comp = exported.compositions[0]!, base = comp.layers[0]!;
	const layers = Array.from({ length: 24 }, (_, index) => ({ ...base, id: `layer-${String(index)}`, matte: index === 0 ? null : { layerId: `layer-${String(index - 1)}`, type: 'alpha' as const } }));
	let serial = 0; assert.throws(() => convertMotionscaperAeExchange({ ...exported, compositions: [{ ...comp, layers }] }, { projectId: 'new', allocateId: () => `new-${String(++serial)}`, bindings: [] }), /matte copies.*budget/u);
	assert.equal(layers.length, 24); assert.equal(layers[0]!.id, 'layer-0');
});
test('Motion AE export refuses an always-hidden source when the authored matte source also composites outside consumer spans', () => {
	const source = trackingProject(), comp = source.compositions[0]!, sourceLayer = comp.layers[0]!, consumer = comp.layers[1]!;
	const result = prepareMotionscaperAeExport({ ...source, compositions: [{ ...comp, layers: [sourceLayer, { ...consumer, inFrame: { num: 2, den: 1 }, matte: { layerId: sourceLayer.id, mode: 'alpha' } }] }] });
	assert.equal(result.exchange.compositions[0]!.layers[1]!.matte, null); assert.equal(result.exchange.compositions[0]!.layers[0]!.enabled, true);
	assert.ok(result.exchange.report.some(entry => entry.code === 'matte-mapping' && entry.status === 'unsupported'));
});
test('AE import keeps disabled source visibility and binds a separate matte source clipped to its consumer span', () => {
	const project = createMotionscaperProject({ id: 'p', title: 'Matte', compositionId: 'c', durationFrames: 48 });
	const source = createMotionLayer({ id: 'source', name: 'Matte source', durationFrames: 48, content: { kind: 'null' } });
	const consumer = createMotionLayer({ id: 'consumer', name: 'Consumer', durationFrames: 48, content: { kind: 'null' } });
	const exported = prepareMotionscaperAeExport({ ...project, compositions: [{ ...project.compositions[0]!, layers: [source, consumer] }] });
	const comp = exported.exchange.compositions[0]!, layers = comp.layers;
	const exchange: MotionAeExchange = { ...exported.exchange, compositions: [{ ...comp, layers: [{ ...layers[0]!, enabled: false }, { ...layers[1]!, inPoint: 0.5, matte: { layerId: layers[0]!.id, type: 'alpha' } }] }] };
	let serial = 0; const imported = convertMotionscaperAeExchange(exchange, { projectId: 'new', allocateId: () => `new-${String(++serial)}`, bindings: [] }).project.compositions[0]!;
	const original = imported.layers[0]!, target = imported.layers[1]!, matte = imported.layers.find(layer => layer.id === target.matte?.layerId)!;
	assert.equal(original.enabled, false); assert.notEqual(matte.id, original.id); assert.equal(matte.enabled, true); assert.deepEqual(matte.inFrame, target.inFrame); assert.deepEqual(matte.outFrame, target.outFrame);
});
