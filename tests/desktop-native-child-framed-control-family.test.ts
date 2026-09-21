/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
	bindNativeChildProcess,
	type NativeChildFramedControlBinding,
} from '../desktop/native-child-framed-control.ts';

test('native-child framed control binds each admitted protocol family and version to its own magic', async () => {
	const bindings = [
		{ protocolFamily: 'M5F' as const, protocolVersion: 1 as const, magic: 'M5F1' },
		{ protocolFamily: 'M5F' as const, protocolVersion: 2 as const, magic: 'M5F2' },
		{ protocolFamily: 'M5A' as const, protocolVersion: 1 as const, magic: 'M5A1' },
	] as const;
	for (const binding of bindings) {
		const fixture = child();
		const bound = bindNativeChildProcess(fixture.process, Object.freeze({
			protocolFamily: binding.protocolFamily,
			protocolVersion: binding.protocolVersion,
			maximumMessageBytes: 4_096,
			maximumInFlightMessages: 1,
		}) as NativeChildFramedControlBinding);
		const sent = once(fixture.stdin, 'data');
		await bound.control!.send(Uint8Array.of(3, 5, 7));
		const frame = Buffer.from((await sent)[0] as Buffer);
		assert.equal(frame.subarray(0, 4).toString('ascii'), binding.magic);
		assert.equal(frame.readUInt32LE(4), 3);
		fixture.stdout.write(frame);
		assert.deepEqual(await bound.control!.receive(), Uint8Array.of(3, 5, 7));
		fixture.stdout.end();
		fixture.stderr.end();
		fixture.process.emit('close', 0, null);
		assert.equal((await bound.completion).exitCode, 0);
	}
});

test('native-child framed control rejects unbound or cross-family protocol versions', () => {
	for (const binding of [
		{ protocolVersion: 1, maximumMessageBytes: 4_096, maximumInFlightMessages: 1 },
		{ protocolFamily: 'M5A', protocolVersion: 2, maximumMessageBytes: 4_096, maximumInFlightMessages: 1 },
		{ protocolFamily: 'M5X', protocolVersion: 1, maximumMessageBytes: 4_096, maximumInFlightMessages: 1 },
		{ protocolFamily: 'M5F', protocolVersion: 2, maximumMessageBytes: 4_096,
			maximumInFlightMessages: 1, magic: 'M5F1' },
	]) {
		assert.throws(() => bindNativeChildProcess(child().process, binding as never), /closed bounded.*binding/iu);
	}
});

function child() {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const process = Object.assign(new EventEmitter(), {
		stdin, stdout, stderr, kill: () => true,
	}) as unknown as ChildProcess;
	return { process, stdin, stdout, stderr };
}
