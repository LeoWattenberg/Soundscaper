/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
	createNativeChildIsolationLauncher,
	type NativeChildIsolationArtifactDescriptor,
} from '../desktop/native-child-isolation-launcher.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, 'native/milestone-5-native-isolation-launcher/profiles/linux-v1.json');
const BROKER = resolve(ROOT, 'native/milestone-5-native-isolation-launcher/profiles/linux-broker-v1.json');

test('accepted enforcement cannot turn hostile child stderr into launcher diagnostics', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async () => {
	const [launcherArtifact, profile, broker] = await Promise.all([
		descriptor(process.execPath), descriptor(PROFILE), descriptor(BROKER),
	]);
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const enforcementHandshake = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		pid: 0, stdin: null, stdout, stderr, stdio: [null, stdout, stderr, enforcementHandshake], kill: () => true,
	}) as unknown as ChildProcess;
	const launcher = createNativeChildIsolationLauncher({
		target: 'linux-x64',
		machineWorkload: Object.freeze({
			kind: 'soundscaper' as const, payloads: Object.freeze([launcherArtifact]),
			runtimeClosure: Object.freeze([]),
		}),
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
		spawn: (() => {
			queueMicrotask(() => {
				enforcementHandshake.end('M5_NATIVE_ISOLATION_ENFORCED_V1\n');
				stdout.end();
				stderr.end('M5_NATIVE_ISOLATION_FAILURE_V1 windows create-process 2\nsecret');
				child.emit('close', 125, null);
			});
			return child;
		}) as never,
	});
	await assert.rejects(launcher.launch({
		executable: launcherArtifact, arguments: [], readOnly: [], readExecute: [], writeOnly: [],
		resourcePolicy: { maximumJobDurationMs: 5_000, maximumRssBytes: 128 * 1024 ** 2 },
		framedControl: null,
	}), (error: Error) => {
		assert.match(error.message, /no process identity/iu);
		assert.doesNotMatch(error.message, /diagnostic|create-process|secret/iu);
		return true;
	});
});

async function descriptor(path: string): Promise<NativeChildIsolationArtifactDescriptor> {
	const canonical = await realpath(path);
	const [bytes, metadata] = await Promise.all([readFile(canonical), stat(canonical, { bigint: true })]);
	return Object.freeze({
		path: canonical, byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: Object.freeze({
			dev: BigInt.asUintN(64, metadata.dev).toString(10),
			ino: BigInt.asUintN(64, metadata.ino).toString(10),
		}),
	});
}
