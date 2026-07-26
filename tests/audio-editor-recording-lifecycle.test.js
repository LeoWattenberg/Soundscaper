import test from 'node:test';
import assert from 'node:assert/strict';

import { createRecordingController } from '../src/common/editor/recording.js';

test('recording disposal is bounded when the worklet never acknowledges stop', async () => {
	const fixture = await createFixture({ stopTimeoutMs: 5 });
	fixture.controller.start();

	const firstDisposal = fixture.controller.dispose();
	const secondDisposal = fixture.controller.dispose();
	assert.strictEqual(secondDisposal, firstDisposal);
	await assert.rejects(firstDisposal, (error) => (
		error.name === 'TimeoutError' && error.code === 'RECORDING_STOP_TIMEOUT'
	));
	assert.equal(fixture.controller.state, 'disposed');
	assert.equal(fixture.source.disconnected, true);
	assert.equal(fixture.node.disconnected, true);
	assert.equal(fixture.track.stopped, true);
	assert.equal(fixture.node.port.onmessage, null);
	assert.equal(fixture.node.onprocessorerror, null);
	assert.throws(() => fixture.controller.setMonitoring(true), /disposed/);
});

test('recording processor failures reject stop exactly once and still release resources', async () => {
	const errors = [];
	const fixture = await createFixture({ onError: (error) => errors.push(error) });
	fixture.controller.start();
	const stopping = fixture.controller.stop();
	const failure = new Error('worklet crashed');
	fixture.node.onprocessorerror({ error: failure });

	await assert.rejects(stopping, /worklet crashed/);
	await assert.rejects(fixture.controller.dispose(), /worklet crashed/);
	assert.deepEqual(errors, [failure]);
	assert.equal(fixture.controller.state, 'disposed');
	assert.equal(fixture.source.disconnected, true);
	assert.equal(fixture.node.disconnected, true);
	assert.equal(fixture.track.stopped, true);
});

test('a failed stop post rejects asynchronously and disposal completes cleanup', async () => {
	const fixture = await createFixture({
		postMessage(message) {
			if (message.type === 'stop') throw new Error('port closed');
		},
	});
	fixture.controller.start();
	await assert.rejects(fixture.controller.stop(), /port closed/);
	await assert.rejects(fixture.controller.dispose(), /port closed/);
	assert.equal(fixture.controller.state, 'disposed');
	assert.equal(fixture.node.disconnected, true);
	assert.equal(fixture.track.stopped, true);
});

test('successful recording stop waits for the final serialized chunk write', async () => {
	const write = deferred();
	const fixture = await createFixture({ onChunk: () => write.promise });
	fixture.controller.start();
	fixture.node.port.onmessage({
		data: {
			type: 'audio-chunk',
			frameStart: 0,
			frames: 1,
			channels: [Float32Array.of(0.5)],
		},
	});
	const stopping = fixture.controller.stop();
	fixture.node.port.onmessage({ data: { type: 'stopped', frame: 1 } });
	let settled = false;
	stopping.finally(() => { settled = true; });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(settled, false);
	write.resolve();
	assert.deepEqual(await stopping, { frame: 1 });
	await fixture.controller.dispose();
});

async function createFixture(options = {}) {
	const node = createMockNode(options.postMessage);
	const source = createMockNode();
	const track = { stopped: false, stop() { this.stopped = true; } };
	const controller = await createRecordingController({
		context: {
			destination: createMockNode(),
			audioWorklet: { async addModule() {} },
			createMediaStreamSource: () => source,
		},
		stream: { getTracks: () => [track] },
		nodeFactory: () => node,
		stopTimeoutMs: options.stopTimeoutMs,
		onChunk: options.onChunk,
		onError: options.onError,
	});
	return { controller, node, source, track };
}

function createMockNode(postMessage) {
	return {
		disconnected: false,
		onprocessorerror: null,
		port: {
			onmessage: null,
			onmessageerror: null,
			start() {},
			postMessage: postMessage || (() => {}),
		},
		connect() {},
		disconnect() { this.disconnected = true; },
	};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
