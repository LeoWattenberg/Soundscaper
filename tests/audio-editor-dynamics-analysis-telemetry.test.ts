/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	attachDynamicsAnalysisTelemetry,
	readDynamicsAnalysisTelemetry,
	releaseDynamicsAnalysisTelemetry,
} from '../src/common/editor/engine/dynamics-analysis-telemetry.ts';

function createNode() {
	let started = 0;
	const port = {
		onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
		start() { started += 1; },
	};
	return {
		node: { port } as unknown as AudioNode,
		port,
		started: () => started,
		deliver(data: unknown) { port.onmessage?.({ data } as MessageEvent<unknown>); },
	};
}

const READING = Object.freeze({
	type: 'analysis',
	sequence: 1,
	effectType: 'audacity-compressor',
	frames: 800,
	seconds: 800 / 48_000,
	inputPeak: 0.9,
	outputPeak: 0.5,
	reductionDb: -6,
});

test('a live dynamics node keeps only its newest reading', () => {
	const fixture = createNode();
	attachDynamicsAnalysisTelemetry(fixture.node);
	assert.equal(fixture.started(), 1);
	assert.equal(readDynamicsAnalysisTelemetry(fixture.node), null);
	fixture.deliver(READING);
	assert.equal(readDynamicsAnalysisTelemetry(fixture.node)?.reductionDb, -6);
	fixture.deliver({ ...READING, sequence: 2, reductionDb: -12 });
	assert.equal(readDynamicsAnalysisTelemetry(fixture.node)?.reductionDb, -12);
	assert.equal(readDynamicsAnalysisTelemetry(fixture.node)?.effectType, 'audacity-compressor');
});

test('attaching twice keeps the first handler and its readings', () => {
	const fixture = createNode();
	attachDynamicsAnalysisTelemetry(fixture.node);
	const handler = fixture.port.onmessage;
	fixture.deliver(READING);
	attachDynamicsAnalysisTelemetry(fixture.node);
	assert.equal(fixture.port.onmessage, handler);
	assert.equal(fixture.started(), 1);
	assert.equal(readDynamicsAnalysisTelemetry(fixture.node)?.frames, 800);
});

test('status, error, and malformed messages leave the reading alone', () => {
	const fixture = createNode();
	attachDynamicsAnalysisTelemetry(fixture.node);
	fixture.deliver(READING);
	for (const message of [
		{ type: 'status', status: 'ready' },
		{ type: 'error', message: 'broken' },
		{ ...READING, sequence: 0 },
		{ ...READING, sequence: 2.5 },
		{ ...READING, frames: 0 },
		{ ...READING, frames: 1.5 },
		{ ...READING, seconds: 0 },
		{ ...READING, inputPeak: Number.NaN },
		{ ...READING, outputPeak: -1 },
		// Reduction is what the curve took off, so a positive value is not a reading.
		{ ...READING, reductionDb: 3 },
		null,
		'analysis',
	]) fixture.deliver(message);
	assert.equal(readDynamicsAnalysisTelemetry(fixture.node)?.reductionDb, -6);
});

test('a reading carries the sequence that identifies it', () => {
	const fixture = createNode();
	attachDynamicsAnalysisTelemetry(fixture.node);
	fixture.deliver(READING);
	assert.equal(readDynamicsAnalysisTelemetry(fixture.node)?.sequence, 1);
	// Windows are a fixed length, so consecutive reports carry the same frame
	// count; only the sequence separates a new reading from a repeated read.
	fixture.deliver({ ...READING, sequence: 2 });
	assert.equal(readDynamicsAnalysisTelemetry(fixture.node)?.sequence, 2);
});

test('releasing a node detaches its handler and forgets its reading', () => {
	const fixture = createNode();
	attachDynamicsAnalysisTelemetry(fixture.node);
	fixture.deliver(READING);
	releaseDynamicsAnalysisTelemetry(fixture.node);
	assert.equal(fixture.port.onmessage, null);
	assert.equal(readDynamicsAnalysisTelemetry(fixture.node), null);
	releaseDynamicsAnalysisTelemetry(fixture.node);
	assert.equal(readDynamicsAnalysisTelemetry(null), null);
	assert.equal(readDynamicsAnalysisTelemetry(undefined), null);
});

test('a node without a port is not tracked', () => {
	const node = {} as AudioNode;
	attachDynamicsAnalysisTelemetry(node);
	assert.equal(readDynamicsAnalysisTelemetry(node), null);
});
