/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { normalizeMotionscaperProject } from '../src/common/editor/motion-project-validation.ts';
import { motionScalar, motionVector, type MotionExpression } from '../src/common/editor/motion-property.ts';
import { createMotionExpressionBudget } from '../src/common/editor/motion-expression-evaluator.ts';
const r = (num: number, den = 1) => ({ num, den });
const base = () => createMotionscaperProject({ id: 'expressions', title: 'Expressions', compositionId: 'main' });
const layer = (id: string) => createMotionLayer({ id, name: id, durationFrames: 300, content: { kind: 'null' } });
const expression = (source: string, references: MotionExpression['references'] = []): MotionExpression => ({ source, references, enabled: true });
const curve = { anchors: [{ position: r(10), value: 2 }, { position: r(20), value: 12 }], segments: [{ kind: 'linear' as const }] };

test('M08 scene expressions bind composition time, layer-local clocks and references across distinct starts', () => {
	const project = base(); const a = layer('a'), b = layer('b');
	const compiled = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [
		{ ...a, startFrame: r(15), transform: { ...a.transform, position: { ...motionVector([0, 0, 0]), expression: expression('[time, localTime, frame]') } } },
		{ ...b, startFrame: r(3), transform: { ...b.transform, position: { ...motionVector([0, 0, 0]), expression: expression('reference("a") + valueAtTime("a", 0.75)', [{ id: 'a', layerId: 'a', propertyPath: 'transform.position' }]) } } },
	] }] });
	const at = (num: number, den = 1) => compiled.evaluate({ compositionId: 'main', time: r(num, den) });
	assert.deepEqual(at(1).layers[0]!.state.transform.position, [1, 0.5, 15]);
	assert.deepEqual(at(1).layers[1]!.state.transform.position, [1.75, 0.75, 22.5]);
	const expected = at(1); for (const time of [2, 0, 3, 1]) at(time); assert.deepEqual(at(1), expected);
});

test('M08 nested remapping and audio gains share expression clocks and canonical reference bindings', () => {
	const project = base(); const source = layer('source');
	const nested = createMotionLayer({ id: 'nested', name: 'Nested', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } });
	const sha256 = 'a'.repeat(64); const asset = { kind: 'audio', id: 'sound', name: 'Sound', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: 1, mimeType: 'audio/wav', sampleRate: 48000, channels: 1, duration: r(10) };
	const placement = { id: 'voice', assetId: 'sound', startFrame: r(12), inFrame: r(0), outFrame: r(240), sourceStart: r(2), timeScale: r(1), enabled: true, gain: { ...motionScalar(1), expression: expression('reference("opacity") + localTime', [{ id: 'opacity', layerId: 'source', propertyPath: 'transform.opacity' }]) } };
	const compiled = compileMotionscaperProject({ ...project, assets: [asset], compositions: [
		{ ...project.compositions[0], layers: [{ ...nested, timeRemap: { ...motionScalar(0), expression: expression('3 - time') } }] },
		{ ...project.compositions[0], id: 'child', frameRate: r(24), layers: [{ ...source, transform: { ...source.transform, opacity: { ...motionScalar(1), expression: expression('time / 10') } } }], audio: [placement] },
	] });
	const request = { compositionId: 'main', time: r(1) }; const frame = compiled.evaluate(request);
	assert.deepEqual(frame.layers[0]!.sourceTime, r(2));
	assert.equal(frame.layers[0]!.precomposition!.layers[0]!.state.transform.opacity, 0.2);
	assert.equal(frame.layers[0]!.precomposition!.audio[0]!.gain, 1.7);
	assert.equal(compiled.evaluateAudio(request)[0]!.gain, 1.7);
});

test('M08 valueAtTime samples the authored curve before its expression and loop modes use exact key spans', () => {
	const project = base(); const source = layer('source');
	const at = (sourceText: string, frame: number) => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...source, transform: { ...source.transform, opacity: { ...motionScalar(0), curve, expression: expression(sourceText) } } }] }] }).evaluate({ compositionId: 'main', time: r(frame, 30) }).layers[0]!.state.transform.opacity;
	assert.equal(at('valueAtTime(0.5) * 2', 50), 14);
	assert.equal(at('loopOut("cycle")', 25), 7);
	assert.equal(at('loopOut("pingpong")', 35), 7);
	assert.equal(at('loopOut("offset")', 35), 27);
	assert.equal(at('loopOut("continue")', 25), 17);
	assert.equal(at('loopIn("cycle")', 5), 7);
	assert.equal(at('loopIn("offset")', 5), -3);
});

test('M08 saved invalid source stays editable while evaluation reports the exact property and source range', () => {
	const project = base(); const source = layer('source'); const text = 'value + window.location';
	const intent = normalizeMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...source, transform: { ...source.transform, opacity: { ...motionScalar(1), expression: expression(text) } } }] }] });
	const compiled = compileMotionscaperProject(intent);
	assert.throws(() => compiled.evaluate({ compositionId: 'main', time: r(0) }), (error: unknown) => {
		assert.ok(error instanceof Error); assert.equal(Reflect.get(error, 'compositionId'), 'main'); assert.equal(Reflect.get(error, 'layerId'), 'source'); assert.equal(Reflect.get(error, 'propertyPath'), 'transform.opacity');
		const diagnostic = Reflect.get(error, 'diagnostic') as { start: number; end: number }; assert.ok(diagnostic.start >= 8); assert.ok(diagnostic.end > diagnostic.start); return true;
	});
	assert.equal(intent.compositions[0]!.layers[0]!.transform.opacity.expression!.source, text);
});

test('M08 scene expressions enforce shared budgets, cancellation, typed output and unavailable prepared audio', () => {
	const project = base(); const source = layer('source');
	const compiled = (text: string) => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...source, transform: { ...source.transform, opacity: { ...motionScalar(1), expression: expression(text) } } }] }] });
	const request = { compositionId: 'main', time: r(0) };
	assert.throws(() => compiled('1 + 2').evaluate(request, { expressionBudget: createMotionExpressionBudget({ maximumOperations: 2 }) }), /budget/iu);
	const controller = new AbortController(); controller.abort(); assert.throws(() => compiled('value').evaluate(request, { signal: controller.signal }), { name: 'AbortError' });
	assert.throws(() => compiled('[1, 2]').evaluate(request), /scalar|numeric/iu);
	assert.throws(() => compiled('audioAmplitude("sound")').evaluate(request), /prepared|amplitude|unavailable/iu);
});

test('M08 gain references participate in graph validation and visual expression dependency cycles', () => {
	const project = base(); const visual = layer('source'); const sha256 = 'a'.repeat(64);
	const asset = { kind: 'audio', id: 'sound', name: 'Sound', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: 1, mimeType: 'audio/wav', sampleRate: 48000, channels: 1, duration: r(10) };
	const placement = { id: 'voice', assetId: 'sound', startFrame: r(0), inFrame: r(0), outFrame: r(300), sourceStart: r(0), timeScale: r(1), enabled: true, gain: { ...motionScalar(0.5), expression: expression('reference("target")', [{ id: 'target', layerId: 'missing', propertyPath: 'transform.opacity' }]) } };
	const intent = { ...project, assets: [asset], compositions: [{ ...project.compositions[0], layers: [visual], audio: [placement] }] };
	assert.throws(() => normalizeMotionscaperProject(intent), /reference.*missing/iu);
	const gain = { ...placement.gain, expression: expression('reference("target")', [{ id: 'target', layerId: 'source', propertyPath: 'transform.opacity' }]) };
	const opacity = { ...visual.transform.opacity, expression: expression('reference("gain")', [{ id: 'gain', layerId: 'voice', propertyPath: 'gain' }]) };
	assert.throws(() => normalizeMotionscaperProject({ ...intent, compositions: [{ ...intent.compositions[0], layers: [{ ...visual, transform: { ...visual.transform, opacity } }], audio: [{ ...placement, gain }] }] }), /cycle/iu);
	const compiled = compileMotionscaperProject({ ...intent, compositions: [{ ...intent.compositions[0], layers: [{ ...visual, transform: { ...visual.transform, opacity } }], audio: [{ ...placement, gain: motionScalar(0.25) }] }] });
	assert.equal(compiled.evaluate({ compositionId: 'main', time: r(0) }).layers[0]!.state.transform.opacity, 0.25);
});
