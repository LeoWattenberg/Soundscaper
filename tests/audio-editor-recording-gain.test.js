import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createRecordingController,
	normalizeRecordingInputGain,
	RECORDING_INPUT_GAIN_DEFAULT,
	RECORDING_INPUT_GAIN_MAXIMUM,
	RECORDING_INPUT_GAIN_MINIMUM,
} from '../src/lib/tools/audio-editor/recording.js';
import { StreamingRecorderProcessor } from '../src/lib/tools/audio-editor/recording-worklet.js';

test('recording input gain contract is a bounded linear multiplier', () => {
	assert.equal(RECORDING_INPUT_GAIN_MINIMUM, 0);
	assert.equal(RECORDING_INPUT_GAIN_DEFAULT, 1);
	assert.equal(RECORDING_INPUT_GAIN_MAXIMUM, 2);
	assert.equal(normalizeRecordingInputGain(-1), 0);
	assert.equal(normalizeRecordingInputGain(0.75), 0.75);
	assert.equal(normalizeRecordingInputGain(8), 2);
	assert.throws(() => normalizeRecordingInputGain(null), /finite number/);
});

test('recording worklet applies input gain equally to capture, monitoring, and meter source samples', () => {
	const processor = new StreamingRecorderProcessor({
		processorOptions: { channelCount: 1, chunkFrames: 128, monitor: true, inputGain: 2 },
	});
	const messages = [];
	processor.port.postMessage = (message) => messages.push(message);
	processor.port.onmessage({ data: { type: 'start', startFrame: 0, stopFrame: 128 } });

	const input = Float32Array.from({ length: 128 }, (_, index) => index % 2 ? -0.25 : 0.125);
	const output = new Float32Array(128);
	processor.process([[input]], [[output]]);

	const chunk = messages.find((message) => message.type === 'audio-chunk');
	assert.deepEqual([...output], [...input].map((sample) => sample * 2));
	assert.deepEqual([...chunk.channels[0]], [...output]);
	assert.equal(Math.max(...chunk.channels[0].map(Math.abs)), 0.5);
});

test('recording worklet clamps gain changes and ignores malformed values without poisoning samples', () => {
	const processor = new StreamingRecorderProcessor({
		processorOptions: { channelCount: 1, chunkFrames: 128, monitor: true, inputGain: -4 },
	});
	assert.equal(processor.inputGain, 0);
	processor.port.onmessage({ data: { type: 'input-gain', value: 8 } });
	assert.equal(processor.inputGain, 2);
	processor.port.onmessage({ data: { type: 'input-gain', value: Number.NaN } });
	processor.port.onmessage({ data: { type: 'input-gain', value: '1' } });
	assert.equal(processor.inputGain, 2);

	const output = new Float32Array(128);
	processor.process([[new Float32Array(128).fill(0.25)]], [[output]]);
	assert.ok(output.every((sample) => sample === 0.5));
});

test('recording controller passes initial input gain and exposes a validated live setter', async () => {
	const posted = [];
	const node = createMockNode();
	let nodeOptions = null;
	const controller = await createRecordingController({
		context: {
			destination: createMockNode(),
			audioWorklet: { async addModule() {} },
			createMediaStreamSource: () => createMockNode(),
		},
		stream: { getTracks: () => [] },
		inputGain: 7,
		nodeFactory: (_context, _name, options) => {
			nodeOptions = options;
			node.port.postMessage = (message) => posted.push(message);
			return node;
		},
	});

	assert.equal(nodeOptions.processorOptions.inputGain, 2);
	assert.equal(controller.inputGain, 2);
	assert.equal(controller.setInputGain(0.25), 0.25);
	assert.equal(controller.inputGain, 0.25);
	assert.deepEqual(posted.at(-1), { type: 'input-gain', value: 0.25 });
	assert.equal(controller.setInputGain(-10), 0);
	assert.equal(controller.setInputGain(10), 2);
	assert.throws(() => controller.setInputGain(Number.NaN), /finite number/);
	assert.throws(() => controller.setInputGain('1'), /finite number/);
	assert.equal(controller.inputGain, 2, 'invalid changes retain the last valid gain');

	await controller.dispose();
	assert.throws(() => controller.setInputGain(1), /disposed/);
});

test('recording controller rejects a malformed initial input gain before constructing the worklet node', async () => {
	let constructed = false;
	await assert.rejects(createRecordingController({
		context: {
			destination: createMockNode(),
			audioWorklet: { async addModule() {} },
			createMediaStreamSource: () => createMockNode(),
		},
		stream: { getTracks: () => [] },
		inputGain: Infinity,
		nodeFactory: () => {
			constructed = true;
			return createMockNode();
		},
	}), /finite number/);
	assert.equal(constructed, false);
});

function createMockNode() {
	return {
		connected: false,
		disconnected: false,
		port: { onmessage: null, start() {}, postMessage() {} },
		connect() { this.connected = true; },
		disconnect() { this.disconnected = true; },
	};
}
