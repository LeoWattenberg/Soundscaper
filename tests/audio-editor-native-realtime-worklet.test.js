/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { NATIVE_REALTIME_PROTOCOL_VERSION } from '../src/common/editor/native-realtime-transport.ts';
import {
	createNativeRealtimeWorkletNode,
	ensureNativeRealtimeWorklet,
} from '../src/common/editor/native-realtime-worklet-node.js';
import {
	NATIVE_REALTIME_CONTROL,
	NativeRealtimeTransportProcessor,
	normalizeCloseReason,
} from '../src/common/editor/native-realtime-worklet.js';

test('native realtime worklet loading coalesces per context and remains retryable', async () => {
	const pending = Promise.withResolvers();
	let loads = 0;
	const context = { audioWorklet: { addModule() { loads += 1; return pending.promise; } } };
	const first = ensureNativeRealtimeWorklet(context);
	const second = ensureNativeRealtimeWorklet(context);
	await Promise.resolve();
	assert.equal(loads, 1);
	pending.resolve();
	await Promise.all([first, second]);
	await ensureNativeRealtimeWorklet(context);
	assert.equal(loads, 1);

	let attempts = 0;
	const retryContext = {
		audioWorklet: {
			async addModule() {
				if ((attempts += 1) === 1) throw new Error('temporary worklet failure');
			},
		},
	};
	await assert.rejects(ensureNativeRealtimeWorklet(retryContext), /temporary worklet failure/);
	await ensureNativeRealtimeWorklet(retryContext);
	assert.equal(attempts, 2);
	await assert.rejects(ensureNativeRealtimeWorklet({}), TypeError);
});

test('attach transfers the helper port instead of copying it into the message', async () => {
	const handle = await setup();
	const [, worklet] = createPortPair();
	const generation = handle.attach(worklet);

	const [sent] = handle.node.port.sent;
	assert.equal(sent.message.type, NATIVE_REALTIME_CONTROL.attach);
	assert.deepEqual(sent.transfer, [worklet]);
	assert.ok(!Object.values(sent.message).includes(worklet), 'the port must not ride in the message body');
	assert.equal(handle.generation, generation);
	assert.equal(worklet.started, true);

	const [attached] = controls(handle, NATIVE_REALTIME_CONTROL.attached);
	assert.equal(attached.generation, generation);
	assert.equal(attached.channelCount, 2);
	assert.equal(attached.frameCount, 8);
	assert.deepEqual(handle.node.options.outputChannelCount, [2]);
	assert.equal(handle.node.options.processorOptions.prebufferPackets, 1);
	assert.throws(() => handle.attach(createPortPair()[1], { generation }), RangeError);
});

test('packets land in the render quantum exactly and every consumed buffer goes back', async () => {
	const handle = await setup();
	const { helper, worklet } = attachChannel(handle);
	open(helper, { generation: 1 });
	for (let sequence = 0; sequence < 3; sequence += 1) send(helper, audio({ sequence, startFrame: sequence * 8 }));

	for (let quantum = 0; quantum < 6; quantum += 1) {
		const output = render(handle, 4);
		for (let frame = 0; frame < 4; frame += 1) {
			const absolute = quantum * 4 + frame;
			assert.equal(output[0][frame], absolute + 1);
			assert.equal(output[1][frame], absolute + 101);
		}
	}

	const processor = handle.node.processor;
	assert.equal(processor.consumedPackets, 3);
	assert.equal(processor.releasedBuffers, 6);
	const returned = returns(helper);
	assert.deepEqual(returned.map((message) => message.packetId), [0, 1, 2]);
	// The credit accounting the milestone rests on: buffers back == buffers used.
	const buffers = returned.flatMap((message) => message.channels);
	assert.equal(buffers.length, processor.releasedBuffers);
	assert.equal(new Set(buffers).size, 6);
	// Credit is the memory itself, so a return that merely copied the samples
	// would leave the sender's pool empty however many messages it received.
	assert.deepEqual(
		worklet.sent.filter((post) => post.message.kind === 'return').map((post) => [...post.transfer]),
		returned.map((message) => message.channels.map((channel) => channel.buffer)),
	);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.underrun).length, 0);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.closed).length, 0);
});

test('a missed deadline reports one underrun and closes the generation exactly once', async () => {
	const handle = await setup();
	const { helper, worklet } = attachChannel(handle);
	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	render(handle, 4);
	render(handle, 4);

	assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0]);
	const underruns = controls(handle, NATIVE_REALTIME_CONTROL.underrun);
	assert.equal(underruns.length, 1);
	assert.equal(underruns[0].startFrame, 8);
	assert.equal(underruns[0].frameCount, 4);

	for (let quantum = 0; quantum < 3; quantum += 1) assert.deepEqual([...render(handle, 4)[1]], [0, 0, 0, 0]);
	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'underrun');
	assert.equal(closed[0].generation, 1);
	assert.equal(closed[0].consumedPackets, 1);
	assert.equal(closed[0].releasedBuffers, 2);
	// A live peer is told, so it stops spending credit on a dead generation.
	assert.deepEqual(closures(helper).map((message) => message.reason), ['underrun']);
	// Main authorizes one generation per port, so the port dies with it.
	assert.equal(worklet.closed, true);
});

test('re-attaching revokes the previous generation and stale packets cannot revive it', async () => {
	const handle = await setup();
	const first = attachChannel(handle);
	open(first.helper, { generation: 1 });
	send(first.helper, audio({ sequence: 0, startFrame: 0 }));
	render(handle, 4);

	const second = attachChannel(handle);
	const revoked = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(revoked.length, 1);
	assert.equal(revoked[0].reason, 'cancelled');
	assert.equal(revoked[0].generation, 1);
	assert.equal(first.worklet.closed, true, 'the revoked port is closed, not merely ignored');
	assert.deepEqual(closures(first.helper).map((message) => message.reason), ['cancelled']);
	assert.equal(second.generation, 2);

	// The retired port is detached: its helper can shout into it forever.
	const before = handle.node.port.received.length;
	send(first.helper, audio({ sequence: 1, startFrame: 8 }));
	assert.equal(handle.node.port.received.length, before);

	// A retired generation number cannot re-open on the fresh port either.
	open(second.helper, { generation: 1 });
	send(second.helper, audio({ sequence: 0, startFrame: 0, value: 500 }));
	const discarded = controls(handle, NATIVE_REALTIME_CONTROL.discarded);
	assert.deepEqual(discarded.map((message) => message.reason), ['unauthorized-generation', 'closed-generation']);
	assert.equal(handle.node.processor.running, false);
	assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0]);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.underrun).length, 0);

	open(second.helper, { generation: 2 });
	send(second.helper, audio({ generation: 2, sequence: 0, startFrame: 0 }));
	assert.deepEqual([...render(handle, 4)[0]], [1, 2, 3, 4]);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.closed).length, 1);
});

test('non-contiguous packets close the generation and are never time-shifted into output', async () => {
	const handle = await setup();
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	assert.deepEqual([...render(handle, 4)[0]], [1, 2, 3, 4]);
	assert.deepEqual([...render(handle, 4)[0]], [5, 6, 7, 8]);

	send(helper, audio({ sequence: 1, startFrame: 16, value: 900 }));
	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'non-contiguous');
	assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0]);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.underrun).length, 0);
	assert.equal(returns(helper).length, 1);
	assert.deepEqual(closures(helper).map((message) => message.reason), ['non-contiguous']);
});

test('a replayed sequence closes the generation instead of playing already-heard audio', async () => {
	const handle = await setup();
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	send(helper, audio({ sequence: 1, startFrame: 8 }));
	render(handle, 8);

	send(helper, audio({ sequence: 0, startFrame: 0, value: 700 }));
	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'protocol-violation');
	assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0]);
});

test('peer loss closes the generation exactly once with peer-loss', async () => {
	const handle = await setup();
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	render(handle, 4);

	helper.close();
	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'peer-loss');
	assert.equal(closed[0].startFrame, 4);
	assert.equal(closures(helper).length, 0, 'a lost peer is not told about its own loss');

	// Whichever signal lands second must be inert.
	assert.equal(handle.notifyPeerLoss(), 0);
	postControl(handle, NATIVE_REALTIME_CONTROL.peerLost, 1);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.closed).length, 1);
	assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0]);
});

test('main can report peer loss it observed before the port did', async () => {
	const handle = await setup();
	const { helper, worklet } = attachChannel(handle);
	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	assert.equal(handle.notifyPeerLoss(), 1);
	assert.equal(handle.notifyPeerLoss(), 0);

	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'peer-loss');
	assert.equal(handle.generation, 0);
	// The port here is still deliverable, which is what makes the rule visible:
	// a peer main has declared lost is never sent a closure, only dropped.
	assert.equal(closures(helper).length, 0);
	assert.equal(worklet.closed, true);
});

test('revoke and dispose close the generation with a bounded reason', async () => {
	const handle = await setup();
	const { helper, worklet } = attachChannel(handle);
	open(helper, { generation: 1 });
	worklet.close = () => { throw new Error('the platform refused to close the port'); };
	assert.equal(handle.revoke('not-a-reason'), 1);
	assert.equal(handle.revoke(), 0);
	const revoked = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(revoked.length, 1);
	assert.equal(revoked[0].reason, 'cancelled');
	assert.equal(normalizeCloseReason('peer-loss'), 'peer-loss');

	// Closing the port can fail; letting go of it must not depend on that.
	const quiet = handle.node.port.received.length;
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	assert.equal(handle.node.port.received.length, quiet);

	const next = attachChannel(handle);
	open(next.helper, { generation: 2 });
	handle.dispose();
	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 2);
	assert.equal(closed[1].reason, 'cancelled');
	assert.equal(closed[1].generation, 2);
	assert.equal(handle.node.disconnected, true);
	handle.dispose();
	assert.throws(() => handle.attach(createPortPair()[1]), /disposed/);
});

test('attach rejects replayed generations, version drift and a missing port', async () => {
	const handle = await setup();
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1 });
	const rejected = createPortPair()[1];
	postControl(handle, NATIVE_REALTIME_CONTROL.attach, 1, [rejected]);
	assert.equal(rejected.closed, true);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.rejected).length, 1);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.closed).length, 0, 'the live generation survives a rejected attach');

	handle.node.port.postMessage({
		type: NATIVE_REALTIME_CONTROL.attach,
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION + 1,
		generation: 9,
	}, [createPortPair()[1]]);
	postControl(handle, NATIVE_REALTIME_CONTROL.attach, 9);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.rejected).length, 3);
	assert.throws(() => handle.attach(null), TypeError);
});

test('malformed packets close the generation instead of reaching the render quantum', async () => {
	const cases = [
		['an unknown wire key', (message) => ({ ...message, streamId: 'x' })],
		['a missing field', ({ sequence: _sequence, ...rest }) => rest],
		['a channel count the open never promised', (message) => ({ ...message, channels: [message.channels[0]] })],
		['a non-planar channel', (message) => ({ ...message, channels: [message.channels[0], [0]] })],
		['a declared length that lies', (message) => ({ ...message, frameCount: 4 })],
		['an unknown wire kind', (message) => ({ ...message, kind: 'audio-v2' })],
		['a packet id outside the pool', (message) => ({ ...message, packetId: 64 })],
	];
	for (const [label, mutate] of cases) {
		const handle = await setup();
		const { helper } = attachChannel(handle);
		open(helper, { generation: 1 });
		send(helper, mutate(audio({ sequence: 0, startFrame: 0 })));
		const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
		assert.equal(closed.length, 1, label);
		assert.equal(closed[0].reason, 'protocol-violation', label);
		assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0], label);
	}
});

test('shared memory is refused at the wire boundary', { skip: typeof SharedArrayBuffer !== 'function' }, async () => {
	const handle = await setup();
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1 });
	const shared = new SharedArrayBuffer(8 * Float32Array.BYTES_PER_ELEMENT);
	send(helper, {
		...audio({ sequence: 0, startFrame: 0 }),
		channels: [new Float32Array(shared), new Float32Array(shared)],
	});
	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'protocol-violation');
});

test('an overflowing queue closes the generation rather than growing without bound', async () => {
	const handle = await setup({ maxQueuePackets: 2 });
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1, queueCapacity: 2 });
	for (let sequence = 0; sequence < 3; sequence += 1) send(helper, audio({ sequence, startFrame: sequence * 8, packetId: sequence }));
	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'queue-overflow');
	assert.equal(closed[0].consumedPackets, 0);
	assert.equal(closed[0].releasedBuffers, 0);
});

test('an open the worklet cannot honour is discarded without disturbing the output', async () => {
	const handle = await setup();
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1, frameCount: 4096 });
	assert.deepEqual(
		controls(handle, NATIVE_REALTIME_CONTROL.discarded).map((message) => message.reason),
		['rejected-open'],
	);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.opened).length, 0);

	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	assert.deepEqual([...render(handle, 4)[0]], [1, 2, 3, 4]);
});

test('the processor stays silent and blameless until the prebuffer is met', async () => {
	const handle = await setup({ prebufferPackets: 2 });
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1, startFrame: 64 });
	const [opened] = controls(handle, NATIVE_REALTIME_CONTROL.opened);
	assert.equal(opened.startFrame, 64);
	assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0]);

	send(helper, audio({ sequence: 0, startFrame: 64 }));
	assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0]);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.primed).length, 0);

	send(helper, audio({ sequence: 1, startFrame: 72 }));
	const [primed] = controls(handle, NATIVE_REALTIME_CONTROL.primed);
	assert.equal(primed.queuedPackets, 2);
	assert.equal(primed.startFrame, 64);
	// One quantum spanning both packets: returning the first mid-quantum must
	// not interrupt the run of samples that continues out of the second.
	assert.deepEqual([...render(handle, 16)[0]], Array.from({ length: 16 }, (_sample, frame) => 65 + frame));
	assert.equal(returns(helper).length, 2);
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.underrun).length, 0);
});

test('a peer close ends the generation once and is not echoed back', async () => {
	const handle = await setup();
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	render(handle, 4);
	helper.postMessage({
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
		kind: 'close',
		generation: 1,
		reason: 'completed',
	});
	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'completed');
	assert.equal(closures(helper).length, 0);
	assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0]);
});

test('a release that cannot reach the pool closes the generation as a leak', async () => {
	const handle = await setup();
	const { helper, worklet } = attachChannel(handle);
	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	send(helper, audio({ sequence: 1, startFrame: 8 }));
	// Buffers that leave the worklet but never reach the sender's pool are
	// credit that no longer exists anywhere; the generation cannot continue.
	worklet.postMessage = () => { throw new Error('the transfer never landed'); };
	const output = render(handle, 24);

	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'pool-leak');
	assert.equal(returns(helper).length, 0);
	// The generation died eight frames in, so the rest of the quantum belongs to
	// nobody: the packet queued behind it is never drained into the device.
	assert.deepEqual([...output[0]], [1, 2, 3, 4, 5, 6, 7, 8, ...new Array(16).fill(0)]);
	assert.equal(handle.node.processor.consumedPackets, 1);
	// A second cause reported after the first would send main hunting the wrong
	// fault; starvation after a close is the close, not a missed deadline.
	assert.equal(controls(handle, NATIVE_REALTIME_CONTROL.underrun).length, 0);
	// Credit that never left is not credit, least of all in the report whose
	// whole job is to say where the buffers went.
	assert.equal(closed[0].releasedBuffers, 0);
	assert.deepEqual([...render(handle, 4)[0]], [0, 0, 0, 0]);
});

test('the sample loop fills the quantum without allocating on the audio thread', async () => {
	const handle = await setup();
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	const { set, subarray } = Float32Array.prototype;
	// Both of these mint a view or a copy per channel per quantum. The audio
	// callback has no allocator to spare, so the copy stays a plain loop.
	Float32Array.prototype.set = () => { throw new Error('set() allocates in process()'); };
	Float32Array.prototype.subarray = () => { throw new Error('subarray() allocates in process()'); };
	let rendered;
	try {
		rendered = [[...render(handle, 4)[0]], [...render(handle, 4)[0]]];
	} finally {
		Object.assign(Float32Array.prototype, { set, subarray });
	}
	assert.deepEqual(rendered, [[1, 2, 3, 4], [5, 6, 7, 8]]);
	assert.equal(handle.node.processor.releasedBuffers, 2);
});

test('a port without addEventListener still reports peer loss through onclose', async () => {
	const handle = await setup();
	const [helper, worklet] = createPortPair();
	worklet.addEventListener = undefined;
	handle.attach(worklet);
	open(helper, { generation: 1 });
	helper.close();

	const closed = controls(handle, NATIVE_REALTIME_CONTROL.closed);
	assert.equal(closed.length, 1);
	assert.equal(closed[0].reason, 'peer-loss');
});

test('the handle reports every control event it was given an observer for', async () => {
	const seen = [];
	const record = (name) => (data) => seen.push(`${name}:${data.reason ?? data.generation}`);
	const handle = await setup({
		onAttach: record('attach'),
		onOpen: record('open'),
		onUnderrun: record('underrun'),
		onDiscard: record('discard'),
		onReject: record('reject'),
		onClose: record('close'),
	});
	const { helper } = attachChannel(handle);
	open(helper, { generation: 1 });
	open(helper, { generation: 1 });
	send(helper, audio({ sequence: 0, startFrame: 0 }));
	render(handle, 8);
	render(handle, 4);
	postControl(handle, NATIVE_REALTIME_CONTROL.attach, 1, [createPortPair()[1]]);

	assert.deepEqual(seen, [
		'attach:1',
		'open:1',
		'discard:stale-open',
		'underrun:1',
		'close:underrun',
		'reject:protocol-violation',
	]);
});

test('the node refuses impossible geometry and a missing AudioWorkletNode', async () => {
	const context = fakeContext();
	for (const bad of [{ channelCount: 0 }, { packetFrames: 1 << 20 }, { maxQueuePackets: 65 }]) {
		await assert.rejects(createNativeRealtimeWorkletNode(context, { AudioWorkletNode: FakeAudioWorkletNode, ...bad }), RangeError);
	}
	await assert.rejects(createNativeRealtimeWorkletNode(context, {}), /AudioWorkletNode is not available/);
});

test('a processor built without an injected port still answers on its own port', () => {
	const processor = new NativeRealtimeTransportProcessor();
	assert.equal(typeof processor.port.postMessage, 'function');
	assert.equal(processor.running, false);
	assert.equal(processor.process([], []), true);
	assert.equal(processor.process([], [[]]), true);
});

async function setup(options = {}) {
	return createNativeRealtimeWorkletNode(fakeContext(), {
		AudioWorkletNode: FakeAudioWorkletNode, channelCount: 2, packetFrames: 8, prebufferPackets: 1, ...options,
	});
}

function fakeContext() {
	return { sampleRate: 48_000, audioWorklet: { addModule: async () => {} } };
}

function attachChannel(handle, config = {}) {
	const [helper, worklet] = createPortPair();
	const generation = handle.attach(worklet, config);
	return { helper, worklet, generation };
}

function open(helper, { generation, startFrame = 0, channelCount = 2, frameCount = 8, queueCapacity = 12 }) {
	helper.postMessage({ protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'open', generation, startFrame, channelCount, frameCount, queueCapacity });
}

function audio({ generation = 1, sequence, startFrame, frameCount = 8, channelCount = 2, value = 1, packetId }) {
	const channels = Array.from({ length: channelCount }, (_, channel) => Float32Array.from(
		{ length: frameCount }, (_sample, frame) => startFrame + frame + value + channel * 100,
	));
	return {
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'audio', generation,
		packetId: packetId ?? sequence % 12, sequence, startFrame, frameCount, channels,
	};
}

function send(helper, message) {
	const channels = Array.isArray(message.channels) ? message.channels : [];
	helper.postMessage(message, channels.filter((channel) => channel instanceof Float32Array));
}

function render(handle, frames, channelCount = 2) {
	const output = Array.from({ length: channelCount }, () => new Float32Array(frames));
	handle.node.processor.process([], [output]);
	return output;
}

function controls(handle, type) {
	return handle.node.port.received.map((event) => event.data).filter((data) => !type || data.type === type);
}

/** Posts a raw control message, standing in for a main thread the handle does not police. */
function postControl(handle, type, generation, ports = []) {
	handle.node.port.postMessage({ type, protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, generation }, ports);
}

const peerMessages = (helper, kind) => helper.received.map((event) => event.data).filter((data) => data.kind === kind);
const returns = (helper) => peerMessages(helper, 'return');
const closures = (helper) => peerMessages(helper, 'close');

class FakeAudioWorkletNode {
	constructor(context, name, options) {
		const [nodePort, processorPort] = createPortPair();
		Object.assign(this, { context, name, options, port: nodePort, disconnected: false });
		this.processor = new NativeRealtimeTransportProcessor({
			processorOptions: { ...options.processorOptions, messagePort: processorPort },
		});
	}

	disconnect() { this.disconnected = true; }
}

function createPortPair() {
	const [left, right] = [createFakePort(), createFakePort()];
	left.peer = right;
	right.peer = left;
	return [left, right];
}

function createFakePort() {
	return {
		peer: null, onmessage: null, onmessageerror: null, onclose: null,
		closed: false, started: false, listeners: new Map(), received: [], sent: [],
		addEventListener(type, listener) {
			if (!this.listeners.has(type)) this.listeners.set(type, new Set());
			this.listeners.get(type).add(listener);
		},
		start() { this.started = true; },
		close() {
			if (this.closed) return;
			this.closed = true;
			// Closing one end entangles the other; it does not close it.
			this.peer?.fire('close', { type: 'close' }, this.peer.onclose);
		},
		fire(type, event, handler) {
			handler?.(event);
			for (const listener of this.listeners.get(type) || []) listener(event);
		},
		postMessage(message, transfer = []) {
			this.sent.push({ message, transfer });
			if (!this.peer || this.peer.closed || this.closed) return;
			// The platform snapshots the message synchronously; modelling that
			// keeps each recorded wire message independent of later sends.
			const data = message && typeof message === 'object' ? { ...message } : message;
			const event = { data, ports: [...transfer].filter((item) => item && typeof item.postMessage === 'function') };
			this.peer.received.push(event);
			this.peer.fire('message', event, this.peer.onmessage);
		},
	};
}
