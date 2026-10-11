/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { parseMotionAeExchange } from '../src/common/editor/motion-ae-exchange.ts';

async function script(sampled = false, rendered = false): Promise<string> {
	const root = new URL('../src/motionscaper/ae-bridge/', import.meta.url);
	const entry = await readFile(new URL(rendered ? 'Motionscaper-Export-Rendered.jsx.txt' : sampled ? 'Motionscaper-Export-Sampled.jsx.txt' : 'Motionscaper-Export.jsx.txt', root), 'utf8'), parts: string[] = [];
	for (const line of entry.split('\n')) {
		const include = /^#include "([A-Za-z0-9.-]+)"$/.exec(line);
		if (include) parts.push(await readFile(new URL(include[1]!, root), 'utf8')); else if (!line.startsWith('#target ')) parts.push(line);
	}
	return parts.join('\n');
}
function host(writeFailure = false, evaluate = false, confirmed = true, includeMask = false, includeScene = false) {
	const files = new Map<string, string>([['/source/Original.aep', 'original-project-bytes'], ['/source/Clip.mp4', 'original-media-bytes']]);
	const folders = new Set(['/destination']), alerts: string[] = [], preExpression: boolean[] = [];
	class HostFile {
		encoding = ''; fsName: string; constructor(path: string) { this.fsName = path; } get name() { return this.fsName.split('/').at(-1)!; }
		get exists() { return files.has(this.fsName); } get length() { return this.name.endsWith('.png') ? (files.get(this.fsName) ?? '').length : Buffer.byteLength(files.get(this.fsName) ?? ''); }
		open(mode: string) { if (mode === 'r') return this.exists; files.set(this.fsName, ''); return true; } read(count: number) { return files.get(this.fsName)!.slice(0, count); } close() { return true; }
		write(value: string) { if (writeFailure) return false; files.set(this.fsName, value); return true; }
		copy(destination: string) { if (files.has(destination)) return false; files.set(destination, files.get(this.fsName)!); return true; }
		rename(name: string) { const target = this.fsName.replace(/[^/]+$/u, name); if (files.has(target)) return false; files.set(target, files.get(this.fsName)!); files.delete(this.fsName); this.fsName = target; return true; }
		remove() { return files.delete(this.fsName); }
	}
	class HostFolder {
		readonly fsName: string; constructor(path: string) { this.fsName = path; } get exists() { return folders.has(this.fsName); }
		create() { if (folders.has(this.fsName)) return false; folders.add(this.fsName); return true; }
		remove() { if ([...files.keys(), ...folders].some((path) => path.startsWith(this.fsName + '/'))) return false; return folders.delete(this.fsName); }
		getFiles() { return [...files.keys()].filter(path => path.startsWith(this.fsName + '/')).map(path => new HostFile(path)); }
		static selectDialog() { return new HostFolder('/destination'); }
	}
	const position = { name: 'Position', matchName: 'ADBE Position', propertyType: 'property', propertyValueType: 'twoDSpatial', numKeys: 0,
		isSpatial: true, expression: 'throw new Error("do not execute")', expressionEnabled: true,
		valueAtTime: (time: number, before: boolean) => { preExpression.push(before); if (!before && !evaluate) throw new Error('Expression executed'); return before ? [32, 32] : [32 + time, 32]; },
	};
	const transform = { name: 'Transform', matchName: 'ADBE Transform Group', propertyType: 'group', numProperties: 1, property: () => position };
	const mask = { name: 'Mask', matchName: 'ADBE Mask Atom', propertyType: 'group', numProperties: 0,
		maskMode: 'subtract', inverted: true, rotoBezier: false, maskFeatherFalloff: 'smooth', maskMotionBlur: 'off' };
	const masks = { name: 'Masks', matchName: 'ADBE Mask Parade', propertyType: 'group', numProperties: 1, property: () => mask };
	class FootageItem {
		id = 2; name = 'Clip.mp4'; file = new HostFile('/source/Clip.mp4'); width = 64; height = 64; pixelAspect = 1; frameRate = 24; duration = 1;
		hasVideo = true; hasAudio = false; mainSource = { isStill: false };
	}
	const footage = new FootageItem();
	const layer = { index: 1, name: 'Clip layer', parent: null, source: footage, startTime: 0, inPoint: 0, outPoint: 1, stretch: 100, enabled: true,
		threeDLayer: false, adjustmentLayer: false, blendingMode: 'normal', trackMatteType: 'none', property: (name: string) => name === 'ADBE Transform Group' ? transform : name === 'ADBE Mask Parade' && includeMask ? masks : null };
	class CameraLayer { index = 1; name = 'Camera'; parent = null; startTime = 0; inPoint = 0; outPoint = 1; stretch = 100; enabled = true; autoOrient = 71; property() { return null; } }
	class LightLayer { index = 2; name = 'Ambient'; parent = null; startTime = 0; inPoint = 0; outPoint = 1; stretch = 100; enabled = true; autoOrient = 71; lightType = 91; property() { return null; } }
	const camera = new CameraLayer(), light = new LightLayer();
	class CompItem {
		id = 1; name = 'Composition'; width = 64; height = 64; pixelAspect = 1; frameRate = 24; duration = 1; numLayers = includeScene ? 2 : 1; displayStartTime = 0; bgColor = [0, 0, 0];
		layer(index: number) { return includeScene ? index === 1 ? camera : light : layer; }
	}
	const comp = new CompItem(), items = [comp, footage];
	const output = { templates: ['User PNG Alpha'], file: new HostFile('/unset'), postRenderAction: 'import', applyTemplate: (name: string) => assert.equal(name, 'User PNG Alpha') };
	const settings = new Map<string, string>();
	const queueItem = { timeSpanStart: 42, timeSpanDuration: 0, skipFrames: 4, render: false, numOutputModules: 1,
		setSetting: (name: string, value: string) => settings.set(name, value), getSetting: (name: string) => settings.get(name), outputModule: () => output,
		remove: () => { renderQueue.numItems--; },
	};
	const renderQueue = { numItems: 0, rendering: false, items: { add: () => { renderQueue.numItems++; return queueItem; } }, item: () => queueItem, render: () => {
		assert.equal(queueItem.skipFrames, 0); assert.equal(queueItem.timeSpanStart, 0); assert.equal(queueItem.timeSpanDuration, 1); assert.equal(output.postRenderAction, 'none');
		const bytes = Buffer.alloc(40); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(64, 16); bytes.writeUInt32BE(64, 20); bytes[24] = 8; bytes[25] = 6;
		for (let frame = 0; frame < 24; frame++) files.set(output.file.fsName.replace('[#####]', String(frame)), bytes.toString('latin1'));
	} };
	const project = { activeItem: comp, renderQueue, numItems: 2, file: new HostFile('/source/Original.aep'), workingSpace: '', linearBlending: false, bitsPerChannel: 8, item: (index: number) => items[index - 1] };
	return { layer, files, folders, alerts, preExpression, project, sandbox: { app: { version: 'synthetic-host-not-AE', project }, File: HostFile, Folder: HostFolder, CompItem, FootageItem,
		CameraLayer, LightLayer, AutoOrientType: { NO_AUTO_ORIENT: 71, CAMERA_OR_POINT_OF_INTEREST: 72 }, LightType: { AMBIENT: 91, POINT: 92 }, TextLayer: class {}, ShapeLayer: class {},
		PropertyType: { PROPERTY: 'property' }, PropertyValueType: { OneD: 'oneD', TwoD: 'twoD', ThreeD: 'threeD', TwoD_SPATIAL: 'twoDSpatial', ThreeD_SPATIAL: 'threeDSpatial', COLOR: 'color', SHAPE: 'shape', TEXT_DOCUMENT: 'text' },
		BlendingMode: { NORMAL: 'normal' }, TrackMatteType: { NO_TRACK_MATTE: 'none' }, alert: (message: string) => alerts.push(message),
		MaskMode: { SUBTRACT: 'subtract' }, MaskFeatherFalloff: { FFO_LINEAR: 'linear', FFO_SMOOTH: 'smooth' }, MaskMotionBlur: { SAME_AS_LAYER: 'same', ON: 'on', OFF: 'off' },
		confirm: () => confirmed, prompt: () => 'User PNG Alpha', PostRenderAction: { NONE: 'none' },
		JSON: undefined,
	} };
}
test('readable AE exporter artifact preserves source files and captures authored values without evaluating expression source', async () => {
	execFileSync(process.execPath, ['scripts/build-motionscaper-ae-bridge.mjs', '--check'], { cwd: new URL('../', import.meta.url) });
	const fixture = host(); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange written/u); assert.deepEqual(fixture.preExpression, [true]);
	const manifest = [...fixture.files].find(([path]) => path.endsWith('/motionae.json')); assert.ok(manifest);
	const exchange = parseMotionAeExchange(manifest[1]); assert.equal(exchange.producer.version, 'synthetic-host-not-AE');
	assert.equal(exchange.compositions[0]!.layers[0]!.properties[0]!.kind, 'group'); assert.ok(exchange.report.some((entry) => entry.code === 'expression'));
	assert.equal(fixture.files.get('/source/Original.aep'), 'original-project-bytes'); assert.equal(fixture.files.get('/source/Clip.mp4'), 'original-media-bytes');
	assert.equal(fixture.project.numItems, 2); assert.equal([...fixture.files.keys()].filter((path) => path.endsWith('/footage-2.mp4')).length, 1);
});
test('readable AE exporter captures mask mode, inversion, feather and motion-blur authority', async () => {
	const fixture = host(false, false, true, true); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange written/u);
	const exchange = parseMotionAeExchange([...fixture.files].find(([path]) => path.endsWith('/motionae.json'))![1]);
	const group = exchange.compositions[0]!.layers[0]!.properties[1]!; assert.equal(group.kind, 'group'); if (group.kind !== 'group') throw new Error('Expected masks');
	const mask = group.children[0]!; assert.equal(mask.kind, 'group'); if (mask.kind !== 'group') throw new Error('Expected mask');
	assert.deepEqual(mask.mask, { mode: 'subtract', inverted: true, rotoBezier: false, featherFalloff: 'smooth', motionBlur: 'off' });
});
test('readable AE exporter removes only its newly created package after a manifest write failure', async () => {
	const fixture = host(true); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /did not complete/u); assert.equal(fixture.files.size, 2); assert.deepEqual([...fixture.folders], ['/destination']);
});
test('sampled JSX requires explicit confirmation and retains original expression data beside evaluated frame values', async () => {
	const cancelled = host(false, true, false); vm.runInNewContext(await script(true), cancelled.sandbox, { timeout: 5000 });
	assert.deepEqual(cancelled.preExpression, []); assert.deepEqual([...cancelled.folders], ['/destination']);
	const fixture = host(false, true); vm.runInNewContext(await script(true), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange written/u); assert.equal(fixture.preExpression.filter((value) => !value).length, 25);
	const manifest = [...fixture.files].find(([path]) => path.endsWith('/motionae.json'))!;
	const exchange = parseMotionAeExchange(manifest[1]), group = exchange.compositions[0]!.layers[0]!.properties[0]!;
	assert.equal(group.kind, 'group'); if (group.kind !== 'group') throw new Error('Expected transform group');
	const position = group.children[0]!; assert.equal(position.kind, 'numeric'); if (position.kind !== 'numeric') throw new Error('Expected position');
	assert.deepEqual(position.keys, []); assert.equal(position.expression?.source, 'throw new Error("do not execute")');
	assert.equal(position.expression?.disposition, 'sampled'); assert.deepEqual(position.samples?.values.at(-1), [33, 32]);
	assert.equal(fixture.files.get('/source/Original.aep'), 'original-project-bytes');
});
test('failed native expression evaluation preserves authored custody and reports the sampling failure', async () => {
	const fixture = host(); vm.runInNewContext(await script(true), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange written/u);
	const exchange = parseMotionAeExchange([...fixture.files].find(([path]) => path.endsWith('/motionae.json'))![1]);
	assert.ok(exchange.report.some((entry) => entry.code === 'sampling-failed' && entry.status === 'unsupported'));
	assert.ok(exchange.report.some((entry) => entry.code === 'expression' && entry.status === 'unsupported'));
});
test('rendered JSX retains full original exchange and copies every full-composition frame before publishing', async () => {
	const fixture = host(); vm.runInNewContext(await script(false, true), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange written/u);
	const exchange = parseMotionAeExchange([...fixture.files].find(([path]) => path.endsWith('/motionae.json'))![1]);
	assert.equal(exchange.footage.length, 25); assert.equal(exchange.report.filter(entry => entry.code === 'composition-render-frame').length, 24);
	assert.equal(exchange.compositions[0]!.layers[0]!.properties[0]!.kind, 'group'); assert.equal(fixture.project.renderQueue.numItems, 0);
	assert.equal(fixture.files.get('/source/Original.aep'), 'original-project-bytes'); assert.equal(fixture.files.get('/source/Clip.mp4'), 'original-media-bytes');
	assert.equal([...fixture.files.keys()].filter(path => path.endsWith('.png')).length, 24);
	assert.equal([...fixture.folders].some(path => path.endsWith('/render-stage')), false);
});
test('rendered JSX requires confirmation and refuses to mutate an existing AE render queue', async () => {
	const cancelled = host(false, false, false); vm.runInNewContext(await script(false, true), cancelled.sandbox, { timeout: 5000 }); assert.equal(cancelled.files.size, 2);
	const fixture = host(); fixture.project.renderQueue.numItems = 1; vm.runInNewContext(await script(false, true), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /empty render queue/u); assert.equal(fixture.project.renderQueue.numItems, 1); assert.equal(fixture.files.size, 2);
	assert.deepEqual([...fixture.folders], ['/destination']);
});

test('Motion AE installed exporter captures SDK scene names read-only without assuming popup integers', async () => {
	const fixture = host(false, false, true, false, true); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange written/u);
	const exchange = parseMotionAeExchange([...fixture.files].find(([path]) => path.endsWith('/motionae.json'))![1]), layers = exchange.compositions[0]!.layers;
	assert.deepEqual(layers.map(layer => layer.scene), [{ autoOrient: 'none' }, { autoOrient: 'none', lightType: 'ambient' }]);
	assert.ok(layers.every(layer => layer.threeD && layer.blendMode === 'normal')); assert.equal(fixture.project.numItems, 2);
	assert.equal(fixture.files.get('/source/Original.aep'), 'original-project-bytes');
});

test('Motion AE exporter captures named layer blends and exact AV switches without mutating the source', async () => {
	const fixture = host(); fixture.layer.blendingMode = 'native-multiply'; Object.assign(fixture.sandbox.BlendingMode, { MULTIPLY: 'native-multiply' });
	Object.assign(fixture.layer, { preserveTransparency: true, collapseTransformation: false });
	vm.runInNewContext(await script(), fixture.sandbox, { timeout: 2000 });
	const exchange = parseMotionAeExchange([...fixture.files].find(([path]) => path.endsWith('/motionae.json'))![1]);
	assert.equal(exchange.compositions[0]!.layers[0]!.blendMode, 'multiply'); assert.deepEqual(exchange.compositions[0]!.layers[0]!.compositing, { preserveTransparency: true, collapseTransformation: false });
	assert.equal(fixture.layer.blendingMode, 'native-multiply'); assert.equal(Reflect.get(fixture.layer, 'preserveTransparency'), true);
	const legacy = host(); vm.runInNewContext(await script(), legacy.sandbox, { timeout: 2000 });
	assert.equal(Object.hasOwn(parseMotionAeExchange([...legacy.files].find(([path]) => path.endsWith('/motionae.json'))![1]).compositions[0]!.layers[0]!, 'compositing'), false);
});
