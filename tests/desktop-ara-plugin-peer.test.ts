/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAraPluginPeerMethods } from '../desktop/ara-plugin-peer.ts';

test('ARA peer uploads source planes, binds the document, and renders through distinct operations', async () => {
	const calls: { operation: number; fields: unknown[] }[] = [];
	let analysisPending = false;
	const instance = {
		latency: 0,
		session: {
			async request(operation: number, build?: (writer: {
				text(value: string): void; number(value: number): void; unsigned32(value: number): void;
				floats(value: Float32Array): void; blob(value: Uint8Array): void;
			}) => void) {
				if (operation === 16 && analysisPending) throw Object.assign(new Error('analyzing'), { code: 'mode-refused' });
				const fields: unknown[] = [];
				build?.({ text: (v) => fields.push(v), number: (v) => fields.push(v), unsigned32: (v) => fields.push(v),
					floats: (v) => fields.push([...v]), blob: (v) => fields.push([...v]) });
				calls.push({ operation, fields });
				let read = 0;
				return { byte: () => 1, unsigned32: () => read++ === 0 ? 5 : 2, floats: (output: Float32Array) => output.fill(0.25),
					blob: () => new Uint8Array([1, 2, 3]), done() {} };
			},
		},
	};
	const peer = createAraPluginPeerMethods((value: typeof instance) => value);
	assert.deepEqual(await peer.araCapabilities(instance), { supported: true });
	await peer.configureAra(instance, { sourceId: 'source-1', name: 'Clip', sampleRate: 48000, channelCount: 2,
		frameCount: 4, sourceStartSeconds: 0, playbackStartSeconds: 3, durationSeconds: 4 / 48000 });
	await peer.writeAraPcm(instance, { startFrame: 0, channels: [new Float32Array([1, 2, 3, 4]), new Float32Array([-1, -2, -3, -4])] });
	await peer.bindAra(instance);
	analysisPending = true;
	await assert.rejects(peer.renderAra(instance, { startFrame: 0, frameCount: 4, channelCount: 2 }),
		(error: unknown) => error instanceof Error && 'code' in error && error.code === 'ara-analysis-incomplete');
	analysisPending = false;
	const output = await peer.renderAra(instance, { startFrame: 0, frameCount: 4, channelCount: 2 });
	assert.equal(output.latencyFrames, 5);
	assert.deepEqual([...output.channels[0]!], [0.25, 0.25, 0.25, 0.25]);
	assert.deepEqual(await peer.saveAraState(instance), new Uint8Array([1, 2, 3]));
	await peer.loadAraState(instance, new Uint8Array([1, 2, 3]));
	assert.deepEqual(calls.map(({ operation }) => operation), [19, 13, 14, 15, 16, 17, 18]);
	assert.deepEqual(calls[1]!.fields, ['source-1', 'Clip', 48000, 2, 4, 0, 3, 4 / 48000]);
	assert.deepEqual(calls[2]!.fields, [0, 4, 2, [1, 2, 3, 4], [-1, -2, -3, -4]]);
	await assert.rejects(peer.writeAraPcm(instance, { startFrame: 0, channels: [new Float32Array(4), new Float32Array(4)] }), /bound/u);
	await assert.rejects(peer.renderAra(instance, { startFrame: 3, frameCount: 2, channelCount: 2 }), /region/u);
});

test('ARA peer rejects oversized and invalid source metadata before contacting native code', async () => {
	const instance = { latency: 0, session: { request() { throw new Error('native request was reached'); } } };
	const peer = createAraPluginPeerMethods((value: typeof instance) => value);
	const config = { sourceId: 'source', name: 'Clip', sampleRate: 48000, channelCount: 2,
		frameCount: 4, sourceStartSeconds: 0, playbackStartSeconds: 0, durationSeconds: 4 / 48000 };
	await assert.rejects(peer.configureAra(instance, { ...config, frameCount: 100_000_000 }), /512/u);
	await assert.rejects(peer.configureAra(instance, { ...config, durationSeconds: 1 }), /region/u);
	await assert.rejects(peer.configureAra(instance, { ...config, name: '\0' }), /text/u);
	await assert.rejects(peer.bindAra(instance), /uploaded/u);
});
