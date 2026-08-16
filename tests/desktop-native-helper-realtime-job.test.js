/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The helper end of the real-time port, and the seam where main stops being in
 * the path. What these assert is ownership: who creates the channel, who keeps
 * which end, and that main never subscribes to the end it forwards.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopNativeRealtimeBroker } from '../desktop/native-realtime-broker.ts';
import {
	NATIVE_REALTIME_PROTOCOL_VERSION as HELPER_PROTOCOL_VERSION,
	createNativeRealtimeStreamer,
	realtimeHandshake,
} from '../desktop/native-helper-realtime-job.js';
import { NATIVE_REALTIME_PROTOCOL_VERSION } from '../src/common/editor/native-realtime-protocol.ts';

const FORMAT = Object.freeze({ sampleRate: 48_000, channelCount: 2, frameCount: 1_024, queueCapacity: 8 });

function fakeChannel(closed) {
	const port = (label) => ({
		label,
		posted: [],
		closed: false,
		postMessage(message, transfer) { this.posted.push({ message, transfer }); },
		close() { this.closed = true; closed.push(label); },
	});
	return { port1: port('helper'), port2: port('main') };
}

function streamer({ channels = [], posted = [], closed = [] } = {}) {
	return {
		posted,
		closed,
		channels,
		streamer: createNativeRealtimeStreamer({
			post: (message, transfer) => posted.push({ message, transfer }),
			createChannel: () => {
				const channel = fakeChannel(closed);
				channels.push(channel);
				return channel;
			},
			createEngine: ({ generation }) => ({
				render: (startFrame, frameCount, planes) => {
					for (const [index, plane] of planes.entries()) {
						plane.fill(generation * 100 + index, 0, frameCount);
					}
				},
			}),
		}),
	};
}

test('the helper protocol version is pinned to the transport it speaks', () => {
	assert.equal(HELPER_PROTOCOL_VERSION, NATIVE_REALTIME_PROTOCOL_VERSION);
});

test('the handshake carries exactly the closed key set main validates', () => {
	const handshake = realtimeHandshake({ generation: 3, format: FORMAT, startFrame: 0 });
	assert.deepEqual(Object.keys(handshake).sort(), [
		'channelCount', 'frameCount', 'generation', 'protocolVersion',
		'queueCapacity', 'sampleFormat', 'sampleRate', 'startFrame',
	]);
	assert.equal(handshake.sampleFormat, 'f32-planar');
});

test('the helper creates the channel, keeps one end, and transfers the other', () => {
	const harness = streamer();
	harness.streamer.open({ generation: 1, format: FORMAT });
	assert.equal(harness.channels.length, 1);
	assert.equal(harness.posted.length, 1);
	const [offer] = harness.posted;
	assert.deepEqual(offer.transfer, [harness.channels[0].port2], 'main receives port2 as a transfer');
	assert.equal(offer.message.generation, 1);
	// Audio goes out on the end the helper kept, never on the one main got.
	harness.streamer.pump();
	assert.equal(harness.channels[0].port1.posted.length, 1);
	assert.equal(harness.channels[0].port2.posted.length, 0);
});

test('packets are contiguous, generation-scoped and transfer their own buffers', () => {
	const harness = streamer();
	harness.streamer.open({ generation: 2, format: FORMAT });
	const first = harness.streamer.pump();
	const second = harness.streamer.pump();
	assert.equal(first.startFrame, 0);
	assert.equal(second.startFrame, FORMAT.frameCount);
	assert.equal(second.sequence, 1);
	assert.equal(first.generation, 2);
	const [sent] = harness.channels[0].port1.posted;
	assert.equal(sent.transfer.length, FORMAT.channelCount, 'every plane is transferred, not copied');
	assert.equal(first.channels[0][0], 200, 'the engine renders for its own generation');
});

test('opening a new generation closes the previous port exactly once', () => {
	const harness = streamer();
	harness.streamer.open({ generation: 1, format: FORMAT });
	harness.streamer.open({ generation: 2, format: FORMAT });
	assert.deepEqual(harness.closed, ['helper'], 'the superseded generation closes its own end');
	assert.equal(harness.streamer.generation, 2);
	harness.streamer.close('cancelled');
	assert.deepEqual(harness.closed, ['helper', 'helper']);
	// Closing twice must not close a third port.
	assert.equal(harness.streamer.close('cancelled'), null);
	assert.deepEqual(harness.closed, ['helper', 'helper']);
});

test('a closed generation produces no further packets', () => {
	const harness = streamer();
	harness.streamer.open({ generation: 1, format: FORMAT });
	harness.streamer.close('cancelled');
	assert.equal(harness.streamer.pump(), null);
	assert.equal(harness.streamer.generation, null);
});

test('main forwards the helper offer to the owner and never subscribes to the port', () => {
	const forwarded = [];
	const owner = { postMessage: (channel, message, transfer) => forwarded.push({ channel, message, transfer }) };
	const broker = new DesktopNativeRealtimeBroker({ isEnabled: () => true });
	const authorization = broker.authorize({ owner, ...FORMAT, sampleFormat: 'f32-planar' });
	assert.equal(authorization.status, 'authorized');

	const port = { closed: false, close() { this.closed = true; } };
	const outcome = broker.acceptHelperPort(
		realtimeHandshake({ generation: authorization.generation, format: FORMAT }),
		[port],
	);
	assert.equal(outcome.status, 'delivered');
	assert.equal(forwarded.length, 1);
	assert.deepEqual(forwarded[0].transfer, [port]);
	// The only property main ever names on a transferred port is `close`.
	assert.deepEqual(Object.keys(port).filter((key) => key.startsWith('on')), []);
});
