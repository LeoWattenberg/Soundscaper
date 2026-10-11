/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { parseMotionAeExchange } from '../src/common/editor/motion-ae-exchange.ts';

async function script(): Promise<string> {
	const root = new URL('../src/motionscaper/ae-bridge/', import.meta.url);
	const entry = await readFile(new URL('Motionscaper-Export.jsx.txt', root), 'utf8'), parts: string[] = [];
	for (const line of entry.split('\n')) {
		const include = /^#include "([A-Za-z0-9.-]+)"$/.exec(line);
		if (include) parts.push(await readFile(new URL(include[1]!, root), 'utf8')); else if (!line.startsWith('#target ')) parts.push(line);
	}
	return parts.join('\n');
}
function host(writeFailure = false) {
	const files = new Map<string, string>([['/source/Original.aep', 'original-project-bytes'], ['/source/Clip.mp4', 'original-media-bytes']]);
	const folders = new Set(['/destination']), alerts: string[] = [], preExpression: boolean[] = [];
	class HostFile {
		encoding = ''; fsName: string; constructor(path: string) { this.fsName = path; } get name() { return this.fsName.split('/').at(-1)!; }
		get exists() { return files.has(this.fsName); } get length() { return Buffer.byteLength(files.get(this.fsName) ?? ''); }
		open() { files.set(this.fsName, ''); return true; } close() { return true; }
		write(value: string) { if (writeFailure) return false; files.set(this.fsName, value); return true; }
		copy(destination: string) { if (files.has(destination)) return false; files.set(destination, files.get(this.fsName)!); return true; }
		rename(name: string) { const target = this.fsName.replace(/[^/]+$/u, name); if (files.has(target)) return false; files.set(target, files.get(this.fsName)!); files.delete(this.fsName); this.fsName = target; return true; }
		remove() { return files.delete(this.fsName); }
	}
	class HostFolder {
		readonly fsName: string; constructor(path: string) { this.fsName = path; } get exists() { return folders.has(this.fsName); }
		create() { if (folders.has(this.fsName)) return false; folders.add(this.fsName); return true; }
		remove() { if ([...files.keys(), ...folders].some((path) => path.startsWith(this.fsName + '/'))) return false; return folders.delete(this.fsName); }
		static selectDialog() { return new HostFolder('/destination'); }
	}
	const position = { name: 'Position', matchName: 'ADBE Position', propertyType: 'property', propertyValueType: 'twoDSpatial', numKeys: 0,
		isSpatial: true, expression: 'throw new Error("do not execute")', expressionEnabled: true,
		valueAtTime: (_time: number, before: boolean) => { preExpression.push(before); if (!before) throw new Error('Expression executed'); return [32, 32]; },
	};
	const transform = { name: 'Transform', matchName: 'ADBE Transform Group', propertyType: 'group', numProperties: 1, property: () => position };
	class FootageItem {
		id = 2; name = 'Clip.mp4'; file = new HostFile('/source/Clip.mp4'); width = 64; height = 64; pixelAspect = 1; frameRate = 24; duration = 1;
		hasVideo = true; hasAudio = false; mainSource = { isStill: false };
	}
	const footage = new FootageItem();
	const layer = { index: 1, name: 'Clip layer', parent: null, source: footage, startTime: 0, inPoint: 0, outPoint: 1, stretch: 100, enabled: true,
		threeDLayer: false, adjustmentLayer: false, blendingMode: 'normal', trackMatteType: 'none', property: (name: string) => name === 'ADBE Transform Group' ? transform : null };
	class CompItem {
		id = 1; name = 'Composition'; width = 64; height = 64; pixelAspect = 1; frameRate = 24; duration = 1; numLayers = 1; displayStartTime = 0; bgColor = [0, 0, 0];
		layer() { return layer; }
	}
	const comp = new CompItem(), items = [comp, footage];
	const project = { numItems: 2, file: new HostFile('/source/Original.aep'), workingSpace: '', linearBlending: false, bitsPerChannel: 8, item: (index: number) => items[index - 1] };
	return { files, folders, alerts, preExpression, project, sandbox: { app: { version: 'synthetic-host-not-AE', project }, File: HostFile, Folder: HostFolder, CompItem, FootageItem,
		CameraLayer: class {}, LightLayer: class {}, TextLayer: class {}, ShapeLayer: class {},
		PropertyType: { PROPERTY: 'property' }, PropertyValueType: { OneD: 'oneD', TwoD: 'twoD', ThreeD: 'threeD', TwoD_SPATIAL: 'twoDSpatial', ThreeD_SPATIAL: 'threeDSpatial', COLOR: 'color', SHAPE: 'shape', TEXT_DOCUMENT: 'text' },
		BlendingMode: { NORMAL: 'normal' }, TrackMatteType: { NO_TRACK_MATTE: 'none' }, alert: (message: string) => alerts.push(message),
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
test('readable AE exporter removes only its newly created package after a manifest write failure', async () => {
	const fixture = host(true); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /did not complete/u); assert.equal(fixture.files.size, 2); assert.deepEqual([...fixture.folders], ['/destination']);
});
