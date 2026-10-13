/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { motionSustainedCommand } from '../scripts/performance/motionscaper-sustained-command.ts';

interface Receipt {
	closureObserved: boolean; failure: string; cleanupErrors: string[]; survivingProcesses: unknown[];
	statFailures: { pid: number; path: string; capturedBase64: string; encoding: string; utf8ByteLength: number; sha256: string; truncated: boolean; message: string }[];
	statFailureOverflow: boolean;
}
const pid = 90000000, path = `/proc/${pid}/stat`;
function stat(group: string, session: string, name = 'parentheses ) and space'): string {
	return `${pid} (${name}) S 1 ${group} ${session} ${Array<string>(15).fill('0').join(' ')} 123\n`;
}
for (const [label, text] of [['negative group', stat('-1', '1')], ['non-numeric session', stat('1', 'bad')],
	['malformed identity', 'unparseable stat\n'], ['oversize malformed comm', stat('-1', '1', 'x'.repeat(5000))]] as const) {
	test(`Motion failed command census retains the ${label} observation without accepting it`, async context => {
		const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-stat-evidence-'));
		const read = fs.promises.readFile, readdir = fs.promises.readdir; let injected = 0;
		try {
			context.mock.method(fs.promises, 'readdir', async (value: fs.PathLike) => {
				const names = await readdir(value); return value === '/proc' ? [...names, String(pid)] : names;
			});
			context.mock.method(fs.promises, 'readFile', (value: fs.PathLike) => {
				if (value === path) { injected++; return Promise.resolve(text); }
				return read(value, 'utf8');
			}); syncBuiltinESMExports();
			await assert.rejects(motionSustainedCommand({ command: process.execPath, args: ['-e', 'setTimeout(()=>{},200)'],
				cwd: directory, directory, id: 'invalid', timeoutMs: 2000 }), /Qualification command failed/);
			const receipt = JSON.parse(await read(join(directory, 'invalid-command.json'), 'utf8')) as Receipt;
			assert.ok(injected > 0); assert.equal(receipt.closureObserved, true);
			assert.match(receipt.failure, /Command ownership observation failed: Error: Invalid/);
			assert.deepEqual(receipt.cleanupErrors, []); assert.deepEqual(receipt.survivingProcesses, []);
			assert.ok(Array.isArray(receipt.statFailures), 'failure receipt must retain the actual unaccepted stat');
			assert.ok(receipt.statFailures.length >= 1 && receipt.statFailures.length <= 16);
			const record = receipt.statFailures[0]!;
			assert.equal(record.pid, pid); assert.equal(record.path, path);
			assert.equal(record.utf8ByteLength, Buffer.byteLength(text));
			assert.equal(record.sha256, createHash('sha256').update(text).digest('hex'));
			assert.equal(record.truncated, Buffer.byteLength(text) > 4096);
			assert.equal(record.encoding, 'utf8-read-string');
			const captured = Buffer.from(record.capturedBase64, 'base64');
			assert.ok(captured.length <= 4096);
			assert.deepEqual(captured, Buffer.from(text, 'utf8').subarray(0, 4096));
			assert.match(record.message, /Invalid Linux process stat|Invalid command process group\/session/);
			assert.equal(receipt.statFailureOverflow, false);
		} finally {
			context.mock.restoreAll(); syncBuiltinESMExports();
			await fs.promises.rm(directory, { recursive: true, force: true });
		}
	});
}
