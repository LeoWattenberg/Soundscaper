/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { compileInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import { motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { prepareMotionAeHostImport } from '../src/common/editor/motion-ae-host-import-plan.ts';
import type { MotionAeProperty } from '../src/common/editor/motion-ae-exchange-types.ts';
import { trackingProject } from './helpers/motionscaper-tracking-fixture.ts';
function numeric(properties: readonly MotionAeProperty[], name: string) {
	const group = properties[0]!; if (group.kind !== 'group') throw new Error('Expected transform');
	const result = group.children.find(property => property.matchName === name); if (result?.kind !== 'numeric') throw new Error('Expected numeric property'); return result;
}
const curve = (kind: 'linear' | 'hold' | 'eased' = 'linear') => compileInterpolationCurve({ anchors: [{ position: { num: 0, den: 1 }, value: 0 }, { position: { num: 24, den: 1 }, value: 1 }], segments: [{ kind }] });
test('Motion AE export pins source identity, preserves layer order, maps parent links and rational source timing', () => {
	const source = trackingProject(), comp = source.compositions[0]!, front = comp.layers[0]!, back = comp.layers[1]!;
	const altered = { ...source, compositions: [{ ...comp, layers: [{ ...front, parentId: back.id }, { ...back,
		startFrame: { num: 12, den: 1 }, sourceStart: { num: 1, den: 4 }, timeScale: { num: 2, den: 1 },
		transform: { ...back.transform, rotation: motionVector([0, 0, 37]), scale: motionVector([0.5, 1.5, 1]) },
	}] }] };
	const result = prepareMotionscaperAeExport(altered), exchange = result.exchange, layers = exchange.compositions[0]!.layers;
	assert.equal(exchange.source.revisionDigest, result.revision.digest); assert.equal(exchange.producer.application, 'motionscaper');
	assert.equal(layers[0]!.name, front.name); assert.equal(layers[0]!.parentId, layers[1]!.id); assert.equal(layers[1]!.startTime, 0.375); assert.equal(layers[1]!.stretch, 50);
	assert.deepEqual(numeric(layers[1]!.properties, 'ADBE Scale').value, [50, 150]); assert.deepEqual(numeric(layers[1]!.properties, 'ADBE Rotate Z').value, [37]);
	assert.equal(result.media[0]!.asset.id, 'video'); assert.equal(result.media[0]!.path, exchange.footage[0]!.path);
	assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.revision.project));
	const plan = prepareMotionAeHostImport(JSON.stringify(exchange)); assert.equal(plan.compositions[0]!.layers.length, 2);
});
test('Motion AE export converts scalar temporal curves and aligned vector keys with composition seconds', () => {
	const project = createMotionscaperProject({ id: 'p', title: 'Keys', compositionId: 'c', frameRate: { num: 24, den: 1 }, durationFrames: 48 });
	const layer = createMotionLayer({ id: 'l', name: 'Null', durationFrames: 48, content: { kind: 'null' } });
	const result = prepareMotionscaperAeExport({ ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer, startFrame: { num: 12, den: 1 }, transform: {
		...layer.transform, opacity: { ...motionScalar(0), curve: curve('eased') }, position: { ...motionVector([0, 0, 0]), curves: [curve(), null, null] },
	} }] }] });
	const props = result.exchange.compositions[0]!.layers[0]!.properties, opacity = numeric(props, 'ADBE Opacity'), position = numeric(props, 'ADBE Position');
	assert.deepEqual(opacity.keys.map(key => key.time), [0.5, 1.5]); assert.equal(opacity.keys[0]!.outInterpolation, 'bezier');
	assert.deepEqual(opacity.keys[0]!.outEase, [{ speed: 0, influence: 100 / 3 }]);
	assert.deepEqual(position.keys.map(key => key.value), [[0, 0], [1, 0]]); assert.deepEqual(position.keys[0]!.outSpatialTangent, [0, 0]);
	prepareMotionAeHostImport(JSON.stringify(result.exchange));
});
test('Motion AE export preserves unsupported curves and expressions only in source custody and reports omissions', () => {
	const project = createMotionscaperProject({ id: 'p', title: 'Unsupported', compositionId: 'c' });
	const layer = createMotionLayer({ id: 'l', name: 'Null', durationFrames: 300, content: { kind: 'null' } });
	const result = prepareMotionscaperAeExport({ ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer,
		transform: { ...layer.transform, position: { ...motionVector([4, 5, 0]), curves: [curve('eased'), null, null] }, opacity: { ...motionScalar(0.5), expression: { source: 'value * 2', enabled: true, references: [] } } },
	}] }] });
	const props = result.exchange.compositions[0]!.layers[0]!.properties;
	assert.deepEqual(numeric(props, 'ADBE Position').keys, []); assert.equal(numeric(props, 'ADBE Opacity').expression?.disposition, 'unsupported');
	assert.ok(result.exchange.report.some(entry => entry.code === 'expression' && entry.status === 'unsupported'));
	assert.ok(result.exchange.report.some(entry => entry.code === 'curve-mapping' && entry.status === 'unsupported'));
	assert.equal(result.revision.project.compositions[0]!.layers[0]!.transform.opacity.expression?.source, 'value * 2');
});
test('Motion AE export leaves unsupported content as named nulls and reports audio, 3D and advanced rendering', () => {
	const source = trackingProject(), comp = source.compositions[0]!;
	const result = prepareMotionscaperAeExport({ ...source, compositions: [{ ...comp, temporal: { samples: 4, shutterOpenFrames: { num: 0, den: 1 }, shutterCloseFrames: { num: 1, den: 2 } }, layers: comp.layers.map(layer => ({ ...layer, is3D: true })) }] });
	assert.ok(result.exchange.compositions[0]!.layers.every(layer => layer.kind === 'null' && !layer.enabled));
	assert.ok(result.exchange.report.some(entry => entry.code === '3d' && entry.status === 'unsupported'));
	assert.ok(result.exchange.report.some(entry => entry.code === 'audio-policy'));
	assert.ok(result.exchange.report.some(entry => entry.code === 'qualification'));
	assert.equal(result.revision.project.compositions[0]!.layers[0]!.is3D, true);
});
test('Motion AE export preserves precomposition references and reports independent axis clocks', () => {
	const project = createMotionscaperProject({ id: 'p', title: 'Nested', compositionId: 'c' }), comp = project.compositions[0]!;
	const child = { ...comp, id: 'nested' }, layer = createMotionLayer({ id: 'l', name: 'Nested layer', durationFrames: 300, content: { kind: 'precomp', compositionId: child.id } });
	const later = compileInterpolationCurve({ anchors: [{ position: { num: 0, den: 1 }, value: 3 }, { position: { num: 48, den: 1 }, value: 9 }], segments: [{ kind: 'hold' }] });
	const result = prepareMotionscaperAeExport({ ...project, compositions: [{ ...comp, layers: [{ ...layer, transform: { ...layer.transform, scale: { ...motionVector([1, 1, 1]), curves: [curve(), later, null] } } }] }, child] });
	const exported = result.exchange.compositions[0]!.layers[0]!;
	assert.equal(exported.kind, 'composition'); assert.equal(exported.sourceId, result.exchange.compositions[1]!.id);
	assert.deepEqual(numeric(exported.properties, 'ADBE Scale').keys, []); assert.ok(result.exchange.report.some(entry => /Independent axis key times/u.test(entry.message)));
});
test('Motion AE scalar Bezier conversion preserves handle slope in seconds and refuses unrepresentable vertical handles', () => {
	const project = createMotionscaperProject({ id: 'p', title: 'Bezier', compositionId: 'c', frameRate: { num: 24, den: 1 } }), comp = project.compositions[0]!;
	const layer = createMotionLayer({ id: 'l', name: 'Null', durationFrames: 300, content: { kind: 'null' } });
	const make = (controlFrame: number) => compileInterpolationCurve({ anchors: [{ position: { num: 0, den: 1 }, value: 0.2 }, { position: { num: 24, den: 1 }, value: 0.8 }], segments: [{ kind: 'bezier', control1: { position: { num: controlFrame, den: 1 }, value: 0.3 }, control2: { position: { num: 18, den: 1 }, value: 0.6 } }] });
	const convert = (controlFrame: number) => prepareMotionscaperAeExport({ ...project, compositions: [{ ...comp, layers: [{ ...layer, transform: { ...layer.transform, opacity: { ...motionScalar(0.2), curve: make(controlFrame) } } }] }] });
	const result = convert(6), opacity = numeric(result.exchange.compositions[0]!.layers[0]!.properties, 'ADBE Opacity');
	assert.equal(opacity.keys[0]!.outEase[0]!.influence, 25); assert.ok(Math.abs(opacity.keys[0]!.outEase[0]!.speed - 40) < 1e-10);
	assert.ok(Math.abs(opacity.keys[1]!.inEase[0]!.speed - 80) < 1e-10);
	const rejected = convert(0); assert.deepEqual(numeric(rejected.exchange.compositions[0]!.layers[0]!.properties, 'ADBE Opacity').keys, []);
	assert.ok(rejected.exchange.report.some(entry => /without changing its curve/u.test(entry.message)));
});
