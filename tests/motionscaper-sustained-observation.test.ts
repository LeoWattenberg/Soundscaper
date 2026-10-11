/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createMotionSustainedFixture } from '../scripts/performance/motionscaper-sustained-project.ts';
import { readMotionProcessIdentity, sampleMotionOwnedProcesses, hashMotionSustainedFile } from '../scripts/performance/motionscaper-sustained-observation.ts';
import { installMotionWasmObservation, motionWasmObservationSource } from '../scripts/performance/motionscaper-sustained-wasm-observation.ts';

test('Motion sustained durations share exact project/assets and changing full-span animation', async () => {
	const font = new Uint8Array(await readFile(new URL('../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2', import.meta.url)));
	const first = createMotionSustainedFixture(font), again = createMotionSustainedFixture(font);
	assert.equal(first.revision.digest, again.revision.digest);
	assert.equal(first.revision.project.compositions[0]!.durationFrames, 1200);
	assert.deepEqual(first.revision.project.compositions[0]!.frameRate, { num: 30, den: 1 });
	assert.deepEqual(first.revision.project.assets.map(asset => asset.sha256), again.revision.project.assets.map(asset => asset.sha256));
	const wav = first.bodies.get('sound')!; assert.equal(wav.byteLength, 44 + 1920000 * 4);
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	for (const index of [0, 479999, 1919999]) {
		assert.equal(view.getInt16(44 + index * 4, true), (index % 127 - 63) * 256);
		assert.equal(view.getInt16(46 + index * 4, true), -(index % 127 - 63) * 256);
	}
	assert.notEqual(first.revision.project.compositions[0]!.layers[1]!.transform.position.curves[0], null);
	assert.throws(() => createMotionSustainedFixture(new Uint8Array()), /font/u);
});

test('Motion sustained /proc sampler binds actual current process and rechecks start identity', async () => {
	const owner = await readMotionProcessIdentity(process.pid);
	const observed = await sampleMotionOwnedProcesses(owner, []);
	const self = observed.processes.find(value => value.identity.pid === process.pid)!;
	assert.equal(self.identity.startTicks, owner.startTicks); assert.ok(self.rssBytes > 0); assert.ok(self.pssBytes > 0);
	assert.ok(observed.rssBytes >= self.rssBytes); assert.ok(observed.pssBytes >= self.pssBytes);
	assert.match(observed.observedAt, /^\d{4}-\d{2}-\d{2}T/u);
	const replaced = await sampleMotionOwnedProcesses({ ...owner, startTicks: `${owner.startTicks}0` }, []);
	assert.equal(replaced.processes.length, 0);
});

test('Motion sustained evidence hashes bounded streaming windows and refuses oversized output', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-sustained-hash-'));
	try {
		const bytes = new Uint8Array(150000).map((_, index) => index % 251), path = join(directory, 'output');
		await writeFile(path, bytes); const actual = await hashMotionSustainedFile(path, bytes.length);
		assert.equal(actual.sha256, createHash('sha256').update(bytes).digest('hex'));
		assert.equal(actual.byteLength, bytes.length); assert.ok(actual.maximumReadBytes <= 65536);
		await assert.rejects(hashMotionSustainedFile(path, bytes.length - 1), /admission/u);
		await symlink(path, join(directory, 'alias'));
		await assert.rejects(hashMotionSustainedFile(join(directory, 'alias')), /regular file|symbolic/u);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('Motion external WASM observation forwards constructor/grow semantics and reports capacity without strong ownership', () => {
	const OriginalMemory = WebAssembly.Memory;
	const observation = installMotionWasmObservation();
	try {
		const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
		assert.ok(memory instanceof OriginalMemory); assert.equal(memory.grow(1), 1);
		assert.deepEqual(observation.snapshot(), { observedMemories: 1, capacityBytes: [131072], weakOwnership: true, errors: [], workerName: '', frames: 0, backend: null, revision: null });
		assert.throws(() => memory.grow(1), RangeError);
	} finally { observation.restore(); }
	assert.equal(WebAssembly.Memory, OriginalMemory);
});

test('Motion CDP observer serializes without capturing Node or TS transform scope', () => {
	const result: unknown = runInNewContext(`${motionWasmObservationSource()}; JSON.stringify(globalThis.__motionSustainedObservation.snapshot())`);
	assert.equal(typeof result, 'string');
	assert.deepEqual(JSON.parse(String(result)), { observedMemories: 0, capacityBytes: [], weakOwnership: true, errors: [], workerName: '', frames: 0, backend: null, revision: null });
});

test('Motion external observation failure never replaces a native promise or rejects application allocation', async () => {
	const original = WebAssembly.instantiate;
	const pending = Promise.resolve({ module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])), instance: {} });
	// Exercise the call forwarding seam with one known promise, without running browser workloads.
	Object.defineProperty(WebAssembly, 'instantiate', { value: () => pending, configurable: true, writable: true });
	const observation = installMotionWasmObservation();
	try {
		assert.equal(WebAssembly.instantiate(new Uint8Array()), pending);
		for (let index = 0; index < 35; index++) assert.ok(new WebAssembly.Memory({ initial: 0 }) instanceof WebAssembly.Memory);
		await pending;
		assert.match(observation.snapshot().errors.join(' '), /observation count/u);
	} finally { observation.restore(); WebAssembly.instantiate = original; }
});

test('Motion external observation preserves native rejection and synchronous constructor exceptions', async () => {
	const original = WebAssembly.instantiate, failure = new Error('native failure'), pending = Promise.reject(failure);
	void pending.catch(() => undefined);
	Object.defineProperty(WebAssembly, 'instantiate', { value: () => pending, configurable: true, writable: true });
	const observation = installMotionWasmObservation();
	try {
		const result = WebAssembly.instantiate(new Uint8Array()); assert.equal(result, pending);
		await assert.rejects(result, error => error === failure);
		assert.throws(() => new WebAssembly.Memory({ initial: 2, maximum: 1 }), RangeError);
		assert.deepEqual(observation.snapshot().errors, []);
	} finally { observation.restore(); WebAssembly.instantiate = original; }
});
