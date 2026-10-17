/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMotionAeInstalledComposition, readMotionAePngHeader, type MotionAeOwnedRenderEntry } from '../src/common/editor/motion-ae-installed-render.ts';
function png(width = 64, depth = 8, type = 6): string {
	const bytes = Buffer.alloc(40); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(64, 20); bytes[24] = depth; bytes[25] = type;
	return bytes.toString('latin1');
}
const composition = { id: 'comp', name: 'Full scene', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 2 / 24 };
function host(options: { count?: number; queueLength?: number; renderFailure?: boolean; moduleFailure?: boolean; cleanupFailure?: boolean; template?: string | null } = {}) {
	const files = new Map<string, string>([['/source/Original.aep', 'original']]), folders = new Set(['/package/media']);
	const owned: MotionAeOwnedRenderEntry[] = []; let removed = 0, renderCalls = 0;
	class File {
		encoding = ''; readonly fsName: string; constructor(path: string) { this.fsName = path; } get name() { return this.fsName.split('/').at(-1)!; } get exists() { return files.has(this.fsName); } get length() { return files.get(this.fsName)?.length ?? 0; }
		open() { return this.exists; } read(count: number) { return files.get(this.fsName)!.slice(0, count); } close() { return true; }
		copy(path: string) { if (files.has(path)) return false; files.set(path, files.get(this.fsName)!); return true; } remove() { return files.delete(this.fsName); }
	}
	class Folder {
		readonly fsName: string; constructor(path: string) { this.fsName = path; } get exists() { return folders.has(this.fsName); } create() { folders.add(this.fsName); return true; }
		getFiles() { return [...files.keys()].filter(path => path.startsWith(this.fsName + '/')).map(path => new File(path)); }
		remove() { if (this.getFiles().length) return false; return folders.delete(this.fsName); }
	}
	const settings = new Map<string, string>(), output = { templates: ['User PNG Alpha'], file: new File('/unset'), postRenderAction: 'import', applyTemplate: (name: string) => assert.equal(name, 'User PNG Alpha') };
	const item = { timeSpanStart: 42, timeSpanDuration: 1, skipFrames: 2, render: false, numOutputModules: 1,
		setSetting: (name: string, value: string) => settings.set(name, value), getSetting: (name: string) => settings.get(name),
		outputModule: () => { if (options.moduleFailure) throw new Error('Output module unavailable'); return output; },
		remove: () => { removed++; if (options.cleanupFailure) throw new Error('Queue removal failed'); },
	};
	const queue = { numItems: options.queueLength ?? 0, rendering: false, items: { add: () => { queue.numItems++; return item; } }, item: () => item, render: () => {
		renderCalls++; assert.equal(item.skipFrames, 0); assert.equal(item.timeSpanStart, 0); assert.equal(item.timeSpanDuration, composition.duration); assert.equal(output.postRenderAction, 'none');
		for (let index = 0; index < (options.count ?? 2); index++) files.set(output.file.fsName.replace('[#####]', String(100 + index)), png());
		if (options.renderFailure) throw new Error('Native render stopped');
	} };
	const globals = globalThis as unknown as Record<string, unknown>, previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [name, value] of Object.entries({ File, Folder, app: { project: { renderQueue: queue } }, PostRenderAction: { NONE: 'none' }, prompt: () => options.template === undefined ? 'User PNG Alpha' : options.template })) {
		previous.set(name, Object.getOwnPropertyDescriptor(globals, name)); Object.defineProperty(globals, name, { value, configurable: true, writable: true });
	}
	return { files, folders, owned, render: () => renderMotionAeInstalledComposition(composition, {}, '/package/media', entry => owned.push(entry)),
		get removed() { return removed; }, get renderCalls() { return renderCalls; }, rollback: () => { for (const entry of owned.slice().reverse()) if (entry.exists) assert.equal(entry.remove(), true); },
		dispose: () => { for (const [name, descriptor] of previous) if (descriptor) Object.defineProperty(globals, name, descriptor); else delete globals[name]; },
	};
}
test('AE installed render adapter owns one queue item and complete portable PNG copies without altering originals', () => {
	const fixture = host(); try {
		const result = fixture.render(); assert.equal(result.footage.length, 2); assert.equal(fixture.removed, 1); assert.equal(fixture.renderCalls, 1);
		assert.deepEqual(result.footage.map(item => item.path), ['media/render-comp-frame-0.png', 'media/render-comp-frame-1.png']);
		assert.equal(fixture.files.get('/source/Original.aep'), 'original'); assert.equal(fixture.folders.has('/package/media/render-stage'), false);
		fixture.rollback(); assert.deepEqual([...fixture.files.keys()], ['/source/Original.aep']);
	} finally { fixture.dispose(); }
});
test('AE installed render refuses a populated queue and rolls back native failure, cancellation or incomplete frames', () => {
	for (const options of [{ queueLength: 1 }, { template: null }, { count: 1 }, { renderFailure: true }, { moduleFailure: true }]) {
		const fixture = host(options); try {
			assert.throws(fixture.render); assert.equal(fixture.removed, options.queueLength ? 0 : 1); fixture.rollback(); assert.deepEqual([...fixture.files.keys()], ['/source/Original.aep']);
		} finally { fixture.dispose(); }
	}
	const fixture = host({ renderFailure: true, cleanupFailure: true }); try { assert.throws(fixture.render, /Native render stopped.*Queue removal failed/u); fixture.rollback(); } finally { fixture.dispose(); }
});
test('AE PNG header admission refuses other formats and carries explicit bit depth and alpha metadata', () => {
	assert.deepEqual(readMotionAePngHeader(png().slice(0, 33), 40, 5), { index: 5, byteLength: 40, width: 64, height: 64, bitDepth: 8, alphaChannels: true });
	assert.equal(readMotionAePngHeader(png(64, 16, 2).slice(0, 33), 40, 0).alphaChannels, false);
	assert.throws(() => readMotionAePngHeader('x'.repeat(33), 40, 0), /PNG/u);
	assert.throws(() => readMotionAePngHeader(png().slice(0, 20), 40, 0), /PNG/u);
});
