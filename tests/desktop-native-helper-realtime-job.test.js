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
	realtimeOpenMessage,
} from '../desktop/native-helper-realtime-job.js';
import {
	NATIVE_REALTIME_PROTOCOL_VERSION,
	validateNativeRealtimeMessage,
} from '../src/common/editor/native-realtime-protocol.ts';
import { createNativeRealtimeReceiver } from '../src/common/editor/native-realtime-transport.ts';

const FORMAT = Object.freeze({ sampleRate: 48_000, channelCount: 2, frameCount: 1_024, queueCapacity: 8 });

/**
 * A channel whose ends actually reach each other, because the credit contract
 * only exists once the far end can hand a buffer back. Delivery waits for a
 * listener the way a real port queues until its peer starts reading.
 */
function fakeChannel(closed) {
	const port = (label) => ({
		label,
		peer: null,
		posted: [],
		inbox: [],
		closed: false,
		started: false,
		onmessage: null,
		start() { this.started = true; },
		postMessage(message, transfer) {
			this.posted.push({ message, transfer });
			this.peer?.deliver({ data: message, ports: [] });
		},
		deliver(event) {
			this.inbox.push(event);
			this.flush();
		},
		flush() {
			while (this.inbox.length > 0 && typeof this.onmessage === 'function') this.onmessage(this.inbox.shift());
		},
		listen(handler) {
			this.onmessage = handler;
			this.flush();
		},
		close() { this.closed = true; closed.push(label); },
	});
	const port1 = port('helper');
	const port2 = port('main');
	port1.peer = port2;
	port2.peer = port1;
	return { port1, port2 };
}

/** The return a worklet sends once it has finished with a packet. */
function returnFor(packet) {
	return {
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
		kind: 'return',
		generation: packet.generation,
		packetId: packet.packetId,
		sequence: packet.sequence,
		channels: packet.channels,
	};
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
	assert.deepEqual(harness.channels[0].port1.posted.map(({ message }) => message.kind), ['open', 'audio']);
	assert.equal(harness.channels[0].port2.posted.length, 0);
});

test('the generation is declared on the wire before any audio rides it', () => {
	const harness = streamer();
	harness.streamer.open({ generation: 1, format: FORMAT, startFrame: 2_048 });
	const [declared] = harness.channels[0].port1.posted;
	assert.deepEqual(Object.keys(declared.message).sort(), [
		'channelCount', 'frameCount', 'generation', 'kind', 'protocolVersion', 'queueCapacity', 'startFrame',
	]);
	assert.deepEqual(realtimeOpenMessage({ generation: 1, format: FORMAT, startFrame: 2_048 }), declared.message);
	const opened = validateNativeRealtimeMessage(declared.message);
	assert.equal(opened.kind, 'open');
	assert.equal(opened.generation, 1);
	assert.equal(opened.startFrame, 2_048);
	assert.equal(opened.frameCount, FORMAT.frameCount);
	assert.equal(opened.queueCapacity, FORMAT.queueCapacity);
});

test('a receiver on the far end queues everything the helper pumps', () => {
	const harness = streamer();
	const receiver = createNativeRealtimeReceiver({
		channelCount: FORMAT.channelCount, frameCount: FORMAT.frameCount, queueCapacity: FORMAT.queueCapacity,
	});
	const results = [];
	harness.streamer.open({ generation: 1, format: FORMAT, startFrame: 4_096 });
	harness.channels[0].port2.listen((event) => results.push(receiver.accept(event.data)));
	harness.streamer.pump();
	harness.streamer.pump();
	assert.deepEqual(results.map(({ status }) => status), ['opened', 'queued', 'queued']);
	assert.equal(receiver.queuedPackets, 2);
	assert.equal(receiver.state, 'open');
	assert.equal(receiver.discardedPacketCount, 0);
	assert.equal(receiver.nextExpectedFrame, 4_096 + 2 * FORMAT.frameCount);
});

test('sequence numbers count the generation, not the timeline it started on', () => {
	const harness = streamer();
	harness.streamer.open({ generation: 3, format: FORMAT, startFrame: 512 });
	const first = harness.streamer.pump();
	const second = harness.streamer.pump();
	assert.equal(first.sequence, 0);
	assert.equal(second.sequence, 1);
	assert.equal(first.startFrame, 512);
	assert.equal(second.startFrame, 512 + FORMAT.frameCount);
	// A fractional sequence is refused outright by the validator both ends share.
	assert.equal(validateNativeRealtimeMessage(first).sequence, 0);
	assert.equal(validateNativeRealtimeMessage(second).sequence, 1);
});

test('a fixed pool and a returned buffer are the helper\'s only credit', () => {
	const format = { ...FORMAT, queueCapacity: 2 };
	const harness = streamer();
	harness.streamer.open({ generation: 1, format });
	const helperEnd = harness.channels[0].port1;
	assert.equal(typeof helperEnd.onmessage, 'function', 'the kept end has to read the buffers coming home');

	const first = harness.streamer.pump();
	const second = harness.streamer.pump();
	assert.equal(harness.streamer.pump(), null, 'a helper with no credit has nothing to send');
	const lent = [...first.channels, ...second.channels].map((plane) => plane.buffer);
	assert.equal(new Set(lent).size, 2 * format.channelCount, 'every packet holds its own buffers');

	harness.channels[0].port2.postMessage(returnFor(first));
	assert.equal(helperEnd.inbox.length, 0, 'a return that is never read is credit that never arrives');
	const third = harness.streamer.pump();
	assert.ok(third, 'the returned buffer bought exactly one more packet');
	assert.deepEqual(
		third.channels.map((plane) => plane.buffer),
		first.channels.map((plane) => plane.buffer),
		'the pool is fixed: a later packet reuses the memory that came home',
	);
	assert.equal(harness.streamer.pump(), null);
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
	const [, sent] = harness.channels[0].port1.posted;
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
