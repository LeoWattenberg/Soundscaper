/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamingRecorderProcessor } from '../src/common/editor/recording-worklet.js';

for (const width of [1, 2, 6]) test(`input inspection reports ${String(width)} native channels without recording or monitoring`, () => {
	const processor = new StreamingRecorderProcessor();
	const messages: unknown[] = [];
	processor.port.postMessage = (message: unknown) => { messages.push(message); };
	const receive = processor.port.onmessage;
	assert.ok(receive);
	receive({ data: { type: 'inspect-input-channel-count' } });
	const output = Float32Array.from({ length: 128 }, () => 1);
	processor.process([[]], [[output]]);
	assert.deepEqual(messages, []);
	assert.equal(processor.recording, false);
	processor.process([Array.from({ length: width }, () => Float32Array.from({ length: 128 }, () => .5))], [[output]]);
	assert.deepEqual(messages, [{ type: 'input-channel-count', channelCount: width }]);
	assert.equal(processor.recording, false);
	assert.equal(processor.writeOffset, 0);
	assert.ok(output.every(sample => sample === 0));
	processor.process([Array.from({ length: width }, () => new Float32Array(128))], [[output]]);
	assert.equal(messages.length, 1);
});
