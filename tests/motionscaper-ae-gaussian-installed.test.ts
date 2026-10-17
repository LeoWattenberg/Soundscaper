/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { shapeHostFixture } from './helpers/motionscaper-ae-shape-host-fixture.ts';
import { gaussianExchange } from './helpers/motionscaper-ae-gaussian-exchange-fixture.ts';
import { motionAeGaussianHostFixture } from './helpers/motionscaper-ae-gaussian-host-fixture.ts';
import { motionAeGaussianProfileFixture } from './helpers/motionscaper-ae-gaussian-fixture.ts';
async function script(entry = 'Motionscaper-Import.jsx.txt'): Promise<string> {
	const root = new URL('../src/motionscaper/ae-bridge/', import.meta.url), source = await readFile(new URL(entry, root), 'utf8'), parts: string[] = [];
	for (const line of source.split('\n')) { const include = /^#include "([A-Za-z0-9.-]+)"$/u.exec(line); if (include) parts.push(await readFile(new URL(include[1]!, root), 'utf8')); else if (!line.startsWith('#target ')) parts.push(line); } return parts.join('\n');
}
function fixture(clamp = false, nonNeutral = false) {
	const profile = motionAeGaussianProfileFixture(), fixture = shapeHostFixture(JSON.stringify(gaussianExchange())), effects: ReturnType<typeof motionAeGaussianHostFixture>[] = [];
	fixture.files.set('/profile.json', JSON.stringify(profile)); fixture.sandbox.app.buildNumber = profile.host.buildNumber;
	const add = fixture.Composition.prototype.add;
	fixture.Composition.prototype.add = function () {
		const layer = add.call(this); Reflect.set(layer, 'adjustmentLayer', false); layer.preserveTransparency = nonNeutral; const fields: ReturnType<typeof motionAeGaussianHostFixture>['root'][] = [];
		const property = layer.property.bind(layer), group = { get numProperties() { return fields.length; }, canAddProperty: () => true,
			addProperty: () => { const effect = motionAeGaussianHostFixture(clamp); effects.push(effect); fields.push(effect.root); return effect.root; }, property: (index: number) => fields[index - 1] ?? null };
		Object.defineProperty(layer, 'property', { value: (name: string) => name === 'ADBE Effect Parade' ? group : property(name) }); return layer;
	};
	return { ...fixture, effects, sandbox: { ...fixture.sandbox, PropertyType: { PROPERTY: 'scalar' }, PropertyValueType: { OneD: 'scalar' } } };
}
test('Motion AE generated Gaussian importer selects exact host profile and applies reviewed effect with readback on newly owned layers', async () => {
	const value = fixture(); vm.runInNewContext(await script(), value.sandbox, { timeout: 2000 });
	assert.match(value.alerts.at(-1)!, /Exchange imported/u); assert.equal(value.effects.length, 1);
	assert.equal(value.effects[0]!.root.children[0]!.value, 6); assert.deepEqual(value.effects[0]!.writes, ['reviewed-radius']); assert.ok(value.items.includes(value.existing));
});
test('Motion AE generated Gaussian importer refuses mismatched profiles before mutation and rolls back failed readback', async () => {
	const compiled = await script();
	for (const source of ['wrong-version', 'changed-scale']) {
		const value = fixture(), profile = motionAeGaussianProfileFixture(); value.files.set('/profile.json', JSON.stringify(source === 'wrong-version' ? { ...profile, host: { ...profile.host, version: '99.0' } } : { ...profile, blurrinessPerSigma: 3 }));
		vm.runInNewContext(compiled, value.sandbox, { timeout: 2000 }); assert.deepEqual(value.items, [value.existing]); assert.deepEqual(value.calls, []); assert.match(value.alerts.at(-1)!, /profile|host/iu);
	}
	const failed = fixture(true); vm.runInNewContext(compiled, failed.sandbox, { timeout: 2000 }); assert.deepEqual(failed.items, [failed.existing]); assert.match(failed.alerts.at(-1)!, /clamped|changed/iu); assert.ok(failed.calls.some(call => call.startsWith('remove:')));
});
test('Motion AE generated Gaussian calibration refuses cancellation and unknown actions without project mutations', async () => {
	const compiled = await script('Motionscaper-Gaussian-Profile.jsx.txt');
	for (const answer of [null, 'overwrite']) {
		const value = fixture(), sandbox = { ...value.sandbox, prompt: () => answer }; vm.runInNewContext(compiled, sandbox, { timeout: 2000 });
		assert.deepEqual(value.items, [value.existing]); assert.deepEqual(value.calls, []); if (answer) assert.match(value.alerts.at(-1)!, /prepare or capture/u); else assert.deepEqual(value.alerts, []);
	}
});

test('Motion AE generated calibration creates only an owned sample then captures selected exact paths into a new profile', async () => {
	const profile = motionAeGaussianProfileFixture(), controls = motionAeGaussianHostFixture(), calls: string[] = [], files = new Map<string, string>(), alerts: string[] = [];
	const parade = { matchName: 'ADBE Effect Parade', propertyIndex: 1, parentProperty: null };
	const effect = { matchName: 'ADBE Gaussian Blur 2', propertyIndex: 1, parentProperty: parade };
	const compositing = { matchName: 'reviewed-compositing', propertyIndex: 4, parentProperty: effect };
	let count = 0;
	const effects = { get numProperties() { return count; }, canAddProperty: () => true, addProperty: () => { count++; }, property: () => controls.root };
	const layer = { name: '', enabled: false, effectsActive: false, property: (name: string) => name === parade.matchName ? effects : { numProperties: 0 } };
	class Sample {
		comment = ''; numLayers = 0; layers = { addShape: () => { this.numLayers++; return layer; } }; layer() { return layer; }
		openInViewer() { calls.push('open'); } remove() { calls.push('remove'); }
		selectedProperties = [{ matchName: 'reviewed-radius', propertyIndex: 1, parentProperty: effect }, { matchName: 'reviewed-opacity', propertyIndex: 1, parentProperty: compositing }];
	}
	const sample = new Sample(), answers: (string | null)[] = ['prepare'];
	class File {
		encoding = ''; readonly alias = false; get exists() { return files.has('/new-profile.json'); } open(mode: string) { calls.push(mode); return true; }
		write(text: string) { files.set('/new-profile.json', text); return true; } close() { return true; } remove() { return files.delete('/new-profile.json'); }
		static saveDialog() { return new File(); }
	}
	const sandbox = { app: { version: profile.host.version, buildNumber: profile.host.buildNumber, isoLanguage: profile.host.locale,
		project: { activeItem: sample, items: { addComp: () => { calls.push('new-composition'); return sample; } } }, beginUndoGroup: () => { calls.push('begin'); }, endUndoGroup: () => { calls.push('end'); } },
		CompItem: Sample, File, PropertyType: { PROPERTY: 'scalar' }, PropertyValueType: { OneD: 'scalar' }, prompt: () => answers.shift(), confirm: () => true, alert: (value: string) => { alerts.push(value); }, JSON: undefined };
	const compiled = await script('Motionscaper-Gaussian-Profile.jsx.txt'); vm.runInNewContext(compiled, sandbox, { timeout: 2000 });
	assert.deepEqual(calls, ['begin', 'new-composition', 'open', 'end']); assert.equal(files.size, 0);
	answers.push('capture', '2'); vm.runInNewContext(compiled, sandbox, { timeout: 2000 });
	assert.deepEqual(JSON.parse(files.get('/new-profile.json')!) as unknown, profile); assert.deepEqual(controls.writes, []); assert.match(alerts.at(-1)!, /unqualified/u);
	const retained = files.get('/new-profile.json'); answers.push('capture', '2'); vm.runInNewContext(compiled, sandbox, { timeout: 2000 });
	assert.match(alerts.at(-1)!, /new non-aliased/u); assert.equal(files.get('/new-profile.json'), retained); assert.equal(calls.filter(value => value === 'new-composition').length, 1);
	files.delete('/new-profile.json'); File.prototype.write = () => { files.set('/new-profile.json', 'partial'); throw new Error('primary write failure'); };
	File.prototype.close = () => { throw new Error('cleanup close failure'); };
	answers.push('capture', '2'); vm.runInNewContext(compiled, sandbox, { timeout: 2000 });
	assert.match(alerts.at(-1)!, /primary write failure.*cleanup close failure/u); assert.equal(files.has('/new-profile.json'), false);
});

test('Motion AE generated Gaussian importer rolls back a fresh target with non-neutral actual compositing before effect creation', async () => {
	const value = fixture(false, true); vm.runInNewContext(await script(), value.sandbox, { timeout: 2000 });
	assert.deepEqual(value.items, [value.existing]); assert.equal(value.effects.length, 0); assert.match(value.alerts.at(-1)!, /neutral/iu);
});
