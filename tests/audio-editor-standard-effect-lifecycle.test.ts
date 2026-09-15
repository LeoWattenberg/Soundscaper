/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { disposeEffectNodeBindings } from '../src/common/editor/engine/effect-rack.ts';
import { createStandardEffectNode, disposeStandardEffectNode, ensureStandardEffectWorklet } from '../src/common/editor/engine/standard-effect-node.ts';
import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';
import { MockAudioBuffer, MockAudioContext, MockNode } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode, createRackProject } from './helpers/audio-editor-runtime-harness.js';

type Message = Readonly<Record<string, unknown>>;
class ProcessorHost {
	readonly port = { onmessage: null as ((event: { data: Message }) => void) | null, postMessage(): void {} };
}
interface HostedProcessor extends ProcessorHost {
	process(inputs: readonly (readonly Float32Array[])[], outputs: readonly (readonly Float32Array[])[]): boolean;
}

function installGlobal(name: string, value: unknown): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	return () => {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	};
}

test('standard node disposal posts exactly once and graph cleanup ignores unrelated nodes', async () => {
	const context = new MockAudioContext() as unknown as BaseAudioContext;
	await ensureStandardEffectWorklet(context);
	const node = createStandardEffectNode(context, MockAudioWorkletNode as unknown as typeof AudioWorkletNode, 'noise-gate', {}, 2);
	const messages = (node as unknown as { readonly messages: unknown[] }).messages;
	disposeEffectNodeBindings(node);
	disposeStandardEffectNode(node);
	assert.deepEqual(messages, [{ type: 'dispose' }]);
	assert.doesNotThrow(() => disposeEffectNodeBindings(new MockNode() as unknown as AudioNode));
});

test('stopping playback explicitly disposes standard processors before rebuilding a rack', async () => {
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as AudioContext, meterInterval: 1000 });
	try {
		engine.loadProject(createRackProject({ tracks: [{ id: 'track-1', effects: [
			{ id: 'gate-1', type: 'noise-gate', params: {} },
		] }] }), new Map([['source-1', new MockAudioBuffer(2, 4800, 48000) as unknown as AudioBuffer]]));
		await engine.play();
		const node = context.workletNodes[0];
		assert.ok(node);
		engine.stop();
		assert.deepEqual(node.messages, [{ type: 'dispose' }]);
		assert.equal(node.disconnected, true);
	} finally { await engine.dispose(); restoreNode(); }
});

test('a disposed standard worklet stops processing and ignores subsequent configure messages', async () => {
	const restoreHost = installGlobal('AudioWorkletProcessor', ProcessorHost);
	const restoreRate = installGlobal('sampleRate', 8000);
	try {
		const { StandardEffectProcessor } = await import('../src/common/editor/first-party-effects/standard/worklet.js');
		const processor = new StandardEffectProcessor({ processorOptions: { type: 'multi-tap-delay', channelCount: 1 } }) as unknown as HostedProcessor;
		const input = [new Float32Array(128).fill(.5)];
		const output = [new Float32Array(128)];
		assert.equal(processor.process([input], [output]), true);
		assert.ok(output[0].some(sample => sample !== 0));
		processor.port.onmessage?.({ data: { type: 'dispose' } });
		processor.port.onmessage?.({ data: { type: 'configure', params: { pitchShift: 2 } } });
		output[0].fill(1);
		assert.equal(processor.process([input], [output]), false);
		assert.ok(output[0].every(sample => sample === 0));
	} finally { restoreRate(); restoreHost(); }
});

test('selection processing destroys every StaffPad echo session when it completes', async () => {
	const runtime = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
	const createSession = runtime.createSession.bind(runtime);
	let created = 0;
	let destroyed = 0;
	runtime.createSession = (...args: Parameters<typeof runtime.createSession>) => {
		const session = createSession(...args);
		created += 1;
		const destroy = session.destroy.bind(session);
		session.destroy = () => { destroyed += 1; destroy(); };
		return session;
	};
	const channels = [new Float32Array(1024).fill(.1), new Float32Array(1024).fill(-.1), new Float32Array(1024).fill(.05)];
	const output = applyStandardEffect('multi-tap-delay', channels, 8000, { pitchShift: 2, echoes: 2 }, runtime);
	assert.equal(output.length, 3);
	assert.equal(created, 4);
	assert.equal(destroyed, created);
});
