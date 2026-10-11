/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { prepareMotionAeShapeCalibration, captureMotionAeShapeCalibration, type MotionAeCalibrationProperty, type MotionAeCalibrationComposition } from '../src/common/editor/motion-ae-host-shape-calibration.ts';
class Property implements MotionAeCalibrationProperty {
	name: string; numKeys = 0; value: unknown = 0; expressionEnabled = false; canSetEnabled = true; enabled = true; children: Property[] = [];
	constructor(readonly matchName: string) {
		this.name = matchName;
		const fields = matchName === 'ADBE Vector Group' ? ['ADBE Vectors Group', 'ADBE Vector Blend Mode'] : matchName === 'ADBE Vector Shape - Group' ? ['ADBE Vector Shape', 'ADBE Vector Shape Direction']
			: matchName === 'ADBE Vector Graphic - Fill' ? ['ADBE Vector Blend Mode', 'ADBE Vector Fill Rule'] : matchName === 'ADBE Vector Graphic - Stroke' ? ['ADBE Vector Blend Mode', 'ADBE Vector Stroke Width', 'ADBE Vector Stroke Miter Limit', 'ADBE Vector Stroke Line Cap', 'ADBE Vector Stroke Line Join'] : [];
		for (const field of fields) this.children.push(new Property(field));
	}
	get numProperties() { return this.children.length; }
	property(name: string | number): Property { const item = typeof name === 'number' ? this.children[name - 1] : this.children.find(child => child.matchName === name); if (!item) throw new Error('Missing control: ' + String(name)); return item; }
	addProperty(name: string): Property { const item = new Property(name); this.children.push(item); return item; }
	setValue(value: unknown) { this.value = value; }
}
const identity = { version: '25.0', buildNumber: 71, locale: 'en_US' };
function fixture(fail = false) {
	const root = new Property('ADBE Root Vectors Group'), layer = { name: '', property: (name: string) => { assert.equal(name, root.matchName); return root; } };
	const events: string[] = [];
	const comp: MotionAeCalibrationComposition = { comment: '', numLayers: 1, layers: { addShape: () => layer }, layer: () => layer,
		remove: () => { events.push('remove-owned'); }, openInViewer: () => { events.push('viewer'); } };
	const host = { identity, begin: () => { events.push('begin'); }, end: () => { events.push('end'); }, create: () => { events.push('create-owned'); return comp; },
		shape: () => { if (fail) throw new Error('No Shape constructor'); return { closed: true, vertices: [[32, 32], [160, 32], [96, 160]] }; } };
	return { root, comp, host, events };
}
function reviewed(f: ReturnType<typeof fixture>) {
	for (let index = 0; index < 5; index++) {
		const group = f.root.property(index + 1), content = group.property('ADBE Vectors Group'), path = content.property(1), paint = content.property(2);
		group.property('ADBE Vector Blend Mode').value = 812;
		paint.property('ADBE Vector Blend Mode').value = index < 2 ? 913 : 914;
		if (index < 2) { paint.property('ADBE Vector Fill Rule').value = 52 + index; path.property('ADBE Vector Shape Direction').value = 68 + index; }
		else { paint.property('ADBE Vector Stroke Line Cap').value = 30 + index; paint.property('ADBE Vector Stroke Line Join').value = 40 + index; }
	}
}
test('Motion AE calibration creates only one owned five-group sample and captures only explicitly reviewed distinct choices', () => {
	const f = fixture(); assert.equal(prepareMotionAeShapeCalibration(f.host), f.comp);
	assert.deepEqual(f.events, ['begin', 'create-owned', 'viewer', 'end']); assert.equal(f.root.children.length, 5);
	assert.throws(() => captureMotionAeShapeCalibration(f.comp, identity, false), /review/iu);
	assert.throws(() => captureMotionAeShapeCalibration(f.comp, identity, true), /distinct/iu);
	reviewed(f); const before = JSON.stringify(f.root), profile = captureMotionAeShapeCalibration(f.comp, identity, true);
	assert.equal(JSON.stringify(f.root), before); assert.equal(profile.mapping.groupNormal, 812); assert.equal(profile.mapping.fillEvenodd, 53); assert.equal(profile.mapping.capSquare, 34); assert.equal(profile.mapping.pathForward, 68);
	assert.throws(() => captureMotionAeShapeCalibration(f.comp, { ...identity, buildNumber: 72 }, true), /exact/iu);
	f.root.property(1).property('ADBE Vector Blend Mode').numKeys = 1;
	assert.throws(() => captureMotionAeShapeCalibration(f.comp, identity, true), /animated/iu);
	f.root.property(1).property('ADBE Vector Blend Mode').numKeys = 0; f.root.addProperty('ADBE Vector Group');
	assert.throws(() => captureMotionAeShapeCalibration(f.comp, identity, true), /inventory/iu);
});
test('Motion AE calibration rollback removes only its new composition and preserves primary plus cleanup failures', () => {
	const f = fixture(true); assert.throws(() => prepareMotionAeShapeCalibration(f.host), /No Shape constructor/u);
	assert.deepEqual(f.events, ['begin', 'create-owned', 'remove-owned', 'end']);
	const broken = fixture(true); broken.comp.remove = () => { throw new Error('owned remove failed'); };
	assert.throws(() => prepareMotionAeShapeCalibration(broken.host), /No Shape constructor.*owned remove failed/u);
});

async function script(capture: boolean): Promise<string> {
	const root = new URL('../src/motionscaper/ae-bridge/', import.meta.url);
	const entry = await readFile(new URL(capture ? 'Motionscaper-Capture-Shape-Profile.jsx.txt' : 'Motionscaper-Prepare-Shape-Profile.jsx.txt', root), 'utf8'), result: string[] = [];
	for (const line of entry.split('\n')) { const include = /^#include "([A-Za-z0-9.-]+)"$/u.exec(line); if (include) result.push(await readFile(new URL(include[1]!, root), 'utf8')); else if (!line.startsWith('#target ')) result.push(line); }
	return result.join('\n');
}
test('Motion AE readable calibration scripts require separate review, refuse overwrite and preserve only bounded profile data', async () => {
	const f = fixture(), files = new Map<string, string>(), alerts: string[] = []; let consent = false, target = '/new-profile.json';
	class CompItem {} Object.setPrototypeOf(f.comp, CompItem.prototype);
	class File {
		encoding = ''; readonly alias = false; constructor(readonly fsName: string) {} get exists() { return files.has(this.fsName); } get length() { return files.get(this.fsName)?.length ?? 0; }
		open(mode: string) { if (mode === 'w') files.set(this.fsName, ''); return true; } read() { return files.get(this.fsName)!; } write(value: string) { files.set(this.fsName, value); return true; } close() { return true; } remove() { return files.delete(this.fsName); }
		static saveDialog() { return new File(target); } static openDialog() { return new File(target); }
	}
	const sandbox = { app: { version: identity.version, buildNumber: identity.buildNumber, isoLanguage: identity.locale, beginUndoGroup: f.host.begin, endUndoGroup: f.host.end,
		project: { activeItem: f.comp, items: { addComp: f.host.create } } }, CompItem, File, Shape: class {}, confirm: () => consent, alert: (message: string) => alerts.push(message), JSON: undefined };
	vm.runInNewContext(await script(false), sandbox, { timeout: 1000 }); assert.deepEqual(f.events, []);
	consent = true; vm.runInNewContext(await script(false), sandbox, { timeout: 1000 }); assert.equal(f.root.children.length, 5);
	vm.runInNewContext(await script(true), sandbox, { timeout: 1000 }); assert.equal(files.size, 0); assert.match(alerts.at(-1)!, /distinct/u);
	reviewed(f); vm.runInNewContext(await script(true), sandbox, { timeout: 1000 }); assert.equal(files.size, 1); assert.equal(JSON.parse(files.get(target)!).mapping.groupNormal, 812);
	const original = files.get(target); vm.runInNewContext(await script(true), sandbox, { timeout: 1000 }); assert.equal(files.get(target), original); assert.match(alerts.at(-1)!, /never overwritten/u);
	target = '/other.json'; consent = false; vm.runInNewContext(await script(true), sandbox, { timeout: 1000 }); assert.equal(files.size, 1);
});
