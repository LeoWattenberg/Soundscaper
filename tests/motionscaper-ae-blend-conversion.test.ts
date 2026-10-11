/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { motionAeLayerBlend } from '../src/common/editor/motion-ae-layer-blend.ts';
import { normalizeMotionAeExchange } from '../src/common/editor/motion-ae-exchange.ts';
import { prepareMotionAeHostImport } from '../src/common/editor/motion-ae-host-import-plan.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import type { MotionLayer } from '../src/common/editor/motion-composition.ts';
import { shapeHostFixture } from './helpers/motionscaper-ae-shape-host-fixture.ts';
const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'] as const;
function source(blendMode: MotionLayer['blendMode'] = 'multiply') {
	const project = createMotionscaperProject({ id: 'blend-project', compositionId: 'blend-comp', title: 'Blend review', width: 64, height: 64 });
	const layer = createMotionLayer({ id: 'blend-layer', name: 'Blend', durationFrames: 300, content: { kind: 'null' } });
	return { ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer, blendMode }] }] };
}
function exchange(blend: MotionLayer['blendMode'] = 'multiply') { return prepareMotionscaperAeExport(source(blend)).exchange; }
async function script() {
	const root = new URL('../src/motionscaper/ae-bridge/', import.meta.url), entry = await readFile(new URL('Motionscaper-Import.jsx.txt', root), 'utf8'), parts: string[] = [];
	for (const line of entry.split('\n')) { const include = /^#include "([A-Za-z0-9.-]+)"$/u.exec(line); if (include) parts.push(await readFile(new URL(include[1]!, root), 'utf8')); else if (!line.startsWith('#target ')) parts.push(line); } return parts.join('\n');
}
test('Motion AE named layer blend subset roundtrips structurally with retained source switches and explicit parity report', () => {
	for (const mode of modes) {
		const output = exchange(mode), layer = output.compositions[0]!.layers[0]!;
		assert.equal(layer.blendMode, mode); assert.deepEqual(layer.compositing, { preserveTransparency: false, collapseTransformation: false });
		assert.equal(prepareMotionAeHostImport(JSON.stringify(output)).compositions[0]!.layers[0]!.blendMode, mode);
		let id = 0; const restored = convertMotionscaperAeExchange(output, { projectId: 'restored', bindings: [], allocateId: () => `restored-${String(id++)}` });
		assert.equal(restored.project.compositions[0]!.layers[0]!.blendMode, mode);
		if (mode !== 'normal') assert.ok(output.report.some(entry => entry.code === 'blend-mode' && entry.status === 'editable' && /unqualified/u.test(entry.message)));
	}
	for (const mode of ['add', 'exclusion'] as const) { const output = exchange(mode); assert.equal(output.compositions[0]!.layers[0]!.blendMode, 'normal'); assert.ok(output.report.some(entry => entry.code === 'blend-mode' && entry.status === 'unsupported')); }
});
test('Motion AE blending refuses missing or non-neutral compositing switches without rewriting original custody', () => {
	const original = exchange(), layer = original.compositions[0]!.layers[0]!;
	for (const compositing of [undefined, { preserveTransparency: true, collapseTransformation: false }, { preserveTransparency: false, collapseTransformation: true }]) {
		const changed = { ...original, compositions: [{ ...original.compositions[0]!, layers: [{ ...layer, compositing }] }] };
		let id = 0; const result = convertMotionscaperAeExchange(changed, { projectId: 'restored', bindings: [], allocateId: () => `restored-${String(id++)}` });
		assert.equal(result.project.compositions[0]!.layers[0]!.blendMode, 'normal'); assert.deepEqual(result.exchange.compositions[0]!.layers[0]!.compositing, compositing);
		assert.ok(result.report.some(entry => entry.code === 'blend-mode' && entry.status === 'unsupported'));
		assert.equal(prepareMotionAeHostImport(JSON.stringify(changed)).compositions[0]!.layers[0]!.blendMode, 'normal');
	}
	const legacy = { ...original, compositions: [{ ...original.compositions[0]!, layers: [{ ...layer, compositing: undefined }] }] };
	assert.equal(Object.hasOwn(normalizeMotionAeExchange(legacy).compositions[0]!.layers[0]!, 'compositing'), false);
	for (const compositing of [{ preserveTransparency: 0, collapseTransformation: false }, { preserveTransparency: false, collapseTransformation: false, native: true }]) {
		assert.throws(() => normalizeMotionAeExchange({ ...original, compositions: [{ ...original.compositions[0]!, layers: [{ ...layer, compositing }] }] }), /compositing|boolean|unsupported/iu);
	}
	assert.equal(motionAeLayerBlend({ blendMode: 'multiply', adjustment: true, threeD: false, compositing: layer.compositing }), null);
});
test('Motion AE generated importer uses named SDK blend enums, verifies readback, and rolls back only owned items', async () => {
	const code = await script();
	for (const mode of modes.filter(value => value !== 'normal')) {
		const fixture = shapeHostFixture(JSON.stringify(exchange(mode))); Object.assign(fixture.sandbox, { BlendingMode: Object.fromEntries(modes.map((name, index) => [name.toUpperCase(), 701 + index])) });
		vm.runInNewContext(code, fixture.sandbox, { timeout: 2000 }); assert.match(fixture.alerts.at(-1)!, /Exchange imported/u);
		const comp = fixture.items.find((item): item is InstanceType<typeof fixture.Composition> => item instanceof fixture.Composition)!;
		assert.equal(Reflect.get(comp.authored[0]!, 'blendingMode'), 701 + modes.indexOf(mode));
	}
	const failed = shapeHostFixture(JSON.stringify(exchange())); Object.assign(failed.sandbox, { BlendingMode: { MULTIPLY: 991 } });
	const add = failed.Composition.prototype.add; failed.Composition.prototype.add = function () { const layer = add.call(this); Object.defineProperty(layer, 'blendingMode', { get: () => 0, set: () => undefined }); return layer; };
	vm.runInNewContext(code, failed.sandbox, { timeout: 2000 }); assert.match(failed.alerts.at(-1)!, /blend/iu); assert.deepEqual(failed.items, [failed.existing]);
	const missing = shapeHostFixture(JSON.stringify(exchange())); Object.assign(missing.sandbox, { BlendingMode: {} }); vm.runInNewContext(code, missing.sandbox, { timeout: 2000 });
	assert.deepEqual(missing.calls, []); assert.match(missing.alerts.at(-1)!, /blend/iu);
});

test('Motion AE blend importer leaves neutral read-only collapse untouched and refuses non-neutral immutable collapse', async () => {
	const code = await script();
	for (const collapsed of [false, true]) {
		const fixture = shapeHostFixture(JSON.stringify(exchange())); Object.assign(fixture.sandbox, { BlendingMode: { MULTIPLY: 501 } });
		const add = fixture.Composition.prototype.add; fixture.Composition.prototype.add = function () { const layer = add.call(this); Object.defineProperty(layer, 'collapseTransformation', { get: () => collapsed, set: () => { throw new Error('Illegal collapse write'); } }); return layer; };
		vm.runInNewContext(code, fixture.sandbox, { timeout: 2000 });
		if (!collapsed) assert.match(fixture.alerts.at(-1)!, /Exchange imported/u);
		else { assert.match(fixture.alerts.at(-1)!, /collapse/iu); assert.deepEqual(fixture.items, [fixture.existing]); }
	}
});
