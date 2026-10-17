/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
import { prepareMotionscaperAeImport, createMotionscaperAeImportCustody } from '../src/motionscaper/editor-ae-import.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import { compileInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import { motionAeGaussianProfileFixture } from './helpers/motionscaper-ae-gaussian-fixture.ts';
function project() {
	const source = createMotionscaperProject({ id: 'gaussian-project', compositionId: 'gaussian-comp', title: 'Reviewed Gaussian', width: 64, height: 64, frameRate: { num: 24, den: 1 }, durationFrames: 48 });
	const layer = createMotionLayer({ id: 'gaussian-layer', name: 'Blur controls', durationFrames: 48, content: { kind: 'null' } });
	return { ...source, compositions: [{ ...source.compositions[0]!, layers: [{ ...layer, effects: [{ id: 'blur', type: 'gaussian-blur', enabled: true, parameters: [{ id: 'sigma', value: { ...motionScalar(2), curve: compileInterpolationCurve({ anchors: [{ position: { num: 0, den: 1 }, value: 2 }, { position: { num: 24, den: 1 }, value: 6 }], segments: [{ kind: 'linear' }] }) } }] }] }] }] };
}
const options = () => { let next = 0; return { projectId: 'imported', allocateId: () => `import-${String(++next)}`, bindings: [] }; };
test('Motion AE project conversion maps reviewed Gaussian with exact retained profile and rejects mismatched explicit review', () => {
	const source = project(), gaussianProfile = motionAeGaussianProfileFixture(), before = JSON.stringify(source);
	const prepared = prepareMotionscaperAeExport(source, { gaussianProfile });
	assert.deepEqual(prepared.exchange.gaussianProfile, gaussianProfile);
	assert.equal(prepared.exchange.compositions[0]!.layers[0]!.effectsActive, true);
	const imported = convertMotionscaperAeExchange(prepared.exchange, { ...options(), gaussianProfile });
	assert.deepEqual(imported.project.compositions[0]!.layers[0]!.effects[0]!.parameters, source.compositions[0]!.layers[0]!.effects[0]!.parameters);
	assert.equal(imported.report.filter(entry => entry.code === 'effect-mapping' && entry.status === 'editable').length, 2);
	assert.ok(!imported.report.some(entry => entry.code === 'property-mapping' && entry.propertyPath.includes('ADBE Effect Parade')));
	assert.throws(() => convertMotionscaperAeExchange(prepared.exchange, { ...options(), gaussianProfile: { ...gaussianProfile, blurrinessPerSigma: 3 } }), /profile.*match/iu);
	assert.equal(JSON.stringify(source), before);
});
test('Motion AE project Gaussian opt-in is never inferred from inert custody; unmapped effects keep report entries', () => {
	const gaussianProfile = motionAeGaussianProfileFixture(), prepared = prepareMotionscaperAeExport(project(), { gaussianProfile });
	const missing = convertMotionscaperAeExchange(prepared.exchange, options());
	assert.deepEqual(missing.project.compositions[0]!.layers[0]!.effects, []);
	assert.ok(missing.report.some(entry => entry.code === 'effect-mapping' && entry.status === 'unsupported' && /profile/iu.test(entry.message)));
	const unreviewed = prepareMotionscaperAeExport(project()); assert.equal(unreviewed.exchange.gaussianProfile, undefined);
	assert.ok(unreviewed.exchange.report.some(entry => entry.code === 'effect-mapping' && entry.status === 'unsupported'));
	assert.throws(() => convertMotionscaperAeExchange(unreviewed.exchange, { ...options(), gaussianProfile }), /profile.*match/iu);
	const source = project(), comp = source.compositions[0]!, layer = comp.layers[0]!;
	const mixed = prepareMotionscaperAeExport({ ...source, compositions: [{ ...comp, layers: [{ ...layer, effects: [...layer.effects, { id: 'unmapped', type: 'brightness-contrast', enabled: true, parameters: [] }] }] }] }, { gaussianProfile });
	assert.ok(mixed.exchange.report.some(entry => entry.propertyPath === 'effects/unmapped' && entry.status === 'unsupported'));
});
test('Motion AE importer forwards only explicit Gaussian review and retains exact source profile in project and downloadable custody', async () => {
	const gaussianProfile = motionAeGaussianProfileFixture(), source = prepareMotionscaperAeExport(project(), { gaussianProfile }).exchange;
	const prepared = await prepareMotionscaperAeImport(new Blob([JSON.stringify(source)]), [], { ...options(), gaussianProfile });
	assert.equal(prepared.project.compositions[0]!.layers[0]!.effects[0]!.type, 'gaussian-blur');
	assert.deepEqual(prepared.project.interchangeCustody?.exchange, source);
	const custody: unknown = JSON.parse(await createMotionscaperAeImportCustody(prepared).text());
	assert.deepEqual((custody as { sourceExchange: unknown }).sourceExchange, source);
});
