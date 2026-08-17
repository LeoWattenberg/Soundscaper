/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The generation ledger renderer main keeps for the transport node. A number is
 * spent for good the moment it is issued, so it may only be spent on an attach
 * the processor actually received: an authorization the worklet never heard
 * would leave main revoking a generation that does not exist and unable to
 * offer that number again.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { NATIVE_REALTIME_PROTOCOL_VERSION } from '../src/common/editor/native-realtime-transport.ts';
import { createNativeRealtimeWorkletNode } from '../src/common/editor/native-realtime-worklet-node.js';
import { NATIVE_REALTIME_CONTROL } from '../src/common/editor/native-realtime-worklet.js';

test('an attach whose post never left keeps its generation unspent', async () => {
	const handle = await setup();
	const port = createHelperPort();
	handle.node.port.failNextPost = 'DataCloneError: the port is already neutered';
	assert.throws(() => handle.attach(port, { generation: 1 }), /DataCloneError/u);

	assert.equal(handle.generation, 0, 'nothing is authorized while nothing was posted');
	assert.equal(handle.revoke(), 0, 'a generation the processor never had is never revoked');
	assert.deepEqual(handle.node.port.sent, []);

	// The number never reached the worklet, so the retry may still offer it.
	assert.equal(handle.attach(port, { generation: 1 }), 1);
	assert.equal(handle.generation, 1);
	assert.deepEqual(handle.node.port.sent.map(({ message }) => message.type), [NATIVE_REALTIME_CONTROL.attach]);
	assert.deepEqual(handle.node.port.sent[0].transfer, [port]);
	assert.equal(handle.revoke(), 1);
});

test('a generation that did reach the processor is never offered twice', async () => {
	const handle = await setup();
	assert.equal(handle.attach(createHelperPort(), { generation: 4 }), 4);
	assert.throws(() => handle.attach(createHelperPort(), { generation: 4 }), RangeError);
	handle.revoke();
	assert.throws(() => handle.attach(createHelperPort(), { generation: 4 }), RangeError);
	assert.equal(handle.attach(createHelperPort(), { generation: 5 }), 5);
});

async function setup(options = {}) {
	return createNativeRealtimeWorkletNode(fakeContext(), {
		AudioWorkletNode: FakeAudioWorkletNode, channelCount: 2, packetFrames: 8, ...options,
	});
}

function fakeContext() {
	return { sampleRate: 48_000, audioWorklet: { addModule: async () => {} } };
}

function createHelperPort() {
	return { postMessage() {}, close() {} };
}

/** A node whose control port can refuse one post, the way a neutered port does. */
class FakeAudioWorkletNode {
	constructor(context, name, options) {
		Object.assign(this, { context, name, options, disconnected: false });
		this.port = {
			sent: [],
			failNextPost: null,
			onmessage: null,
			start() {},
			postMessage(message, transfer = []) {
				const failure = this.failNextPost;
				if (failure) {
					this.failNextPost = null;
					throw new Error(failure);
				}
				this.sent.push({ message, transfer, protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION });
			},
		};
	}

	disconnect() { this.disconnected = true; }
}
