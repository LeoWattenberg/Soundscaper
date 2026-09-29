/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { bindNativeChildProcess } from '../desktop/native-child-framed-control.ts';

const BINDING = Object.freeze({
	protocolFamily: 'M5F' as const,
	protocolVersion: 1 as const,
	maximumMessageBytes: 16,
	maximumInFlightMessages: 2,
});

function child() {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let kills = 0;
	const process = Object.assign(new EventEmitter(), {
		stdin, stdout, stderr, kill: () => { kills += 1; return true; },
	}) as unknown as ChildProcess;
	return {
		process, stdin, stdout, stderr,
		get kills() { return kills; },
		finish() { stdout.end(); stderr.end(); process.emit('close', 0, null); },
	};
}

function frame(bytes: readonly number[]): Buffer {
	const result = Buffer.alloc(8 + bytes.length);
	result.write('M5F1', 0, 'ascii');
	result.writeUInt32LE(bytes.length, 4);
	for (const [index, value] of bytes.entries()) result[8 + index] = value;
	return result;
}

test('framed send snapshots caller bytes before its queued write', async () => {
	const fixture = child();
	const bound = bindNativeChildProcess(fixture.process, BINDING);
	const written = once(fixture.stdin, 'data');
	const source = Uint8Array.of(1, 2, 3);
	const sending = bound.control!.send(source);
	source.fill(9);
	await sending;
	assert.deepEqual(Buffer.from((await written)[0] as Buffer), frame([1, 2, 3]));
	fixture.finish();
	await bound.completion;
});

test('framed receive joins a split header and payload', async () => {
	const fixture = child();
	const bound = bindNativeChildProcess(fixture.process, BINDING);
	await bound.control!.send(Uint8Array.of(1));
	const answer = frame([7, 8, 9]);
	const received = bound.control!.receive();
	fixture.stdout.write(answer.subarray(0, 3));
	fixture.stdout.write(answer.subarray(3, 9));
	fixture.stdout.write(answer.subarray(9));
	assert.deepEqual(await received, Uint8Array.of(7, 8, 9));
	fixture.finish();
	await bound.completion;
});

test('framed receive preserves answer order when two frames arrive together', async () => {
	const fixture = child();
	const bound = bindNativeChildProcess(fixture.process, BINDING);
	await bound.control!.send(Uint8Array.of(1));
	await bound.control!.send(Uint8Array.of(2));
	fixture.stdout.write(Buffer.concat([frame([11]), frame([22])]));
	assert.deepEqual(await bound.control!.receive(), Uint8Array.of(11));
	assert.deepEqual(await bound.control!.receive(), Uint8Array.of(22));
	fixture.finish();
	await bound.completion;
});

test('framed control kills a child that sends an unsolicited answer', async () => {
	const fixture = child();
	const bound = bindNativeChildProcess(fixture.process, BINDING);
	fixture.stdout.write(frame([1]));
	assert.equal(fixture.kills, 1);
	fixture.finish();
	await assert.rejects(bound.completion, /unsolicited/iu);
});

test('framed control kills a child with a corrupt preamble', async () => {
	const fixture = child();
	const bound = bindNativeChildProcess(fixture.process, BINDING);
	await bound.control!.send(Uint8Array.of(1));
	const malformed = frame([1]);
	malformed[0] = 0;
	fixture.stdout.write(malformed);
	assert.equal(fixture.kills, 1);
	fixture.finish();
	await assert.rejects(bound.completion, /preamble/iu);
});

test('framed control kills a child that ends in a partial answer', async () => {
	const fixture = child();
	const bound = bindNativeChildProcess(fixture.process, BINDING);
	await bound.control!.send(Uint8Array.of(1));
	fixture.stdout.write(frame([1, 2]).subarray(0, 9));
	const ended = once(fixture.stdout, 'end');
	fixture.stdout.end();
	fixture.stdout.resume();
	await ended;
	assert.equal(fixture.kills, 1);
	fixture.stderr.end();
	fixture.process.emit('close', 0, null);
	await assert.rejects(bound.completion, /inside a framed answer/iu);
});
