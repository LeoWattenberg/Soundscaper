/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { runBoundedDesktopDirectWavChild } from '../scripts/lib/desktop-direct-wav-smoke.mjs';
import { runBoundedDesktopScapeOpenChild } from '../scripts/lib/desktop-scape-open-smoke.mjs';

for (const [label, runChild, frozen] of [
	['direct-WAV', runBoundedDesktopDirectWavChild, false],
	['Scape-open', runBoundedDesktopScapeOpenChild, true],
]) {
	const options = { cwd: process.cwd(), environment: process.env, timeoutMs: 2_000 };
	test(`${label} child keeps output separate, its exit code, and result mutability`, async () => {
		const result = await runChild(process.execPath, ['-e',
			'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 7;',
		], options);
		assert.deepEqual(result, { code: 7, stdout: 'out', stderr: 'err' });
		assert.equal(Object.isFrozen(result), frozen);
	});
	test(`${label} child rejects signals and keeps the original spawn failure`, async () => {
		await assert.rejects(runChild(resolve('missing-smoke-executable'), [], options), { code: 'ENOENT' });
		if (process.platform !== 'win32') {
			await assert.rejects(runChild(process.execPath, ['-e',
				'process.kill(process.pid, "SIGTERM");',
			], options), { message: `Packaged ${label} child exited with signal SIGTERM` });
		}
	});
	test(`${label} child retains exact command, argument, and limit diagnostics`, () => {
		assert.throws(() => runChild('', [], options), { message: `Packaged ${label} child command is required` });
		assert.throws(() => runChild(process.execPath, ['\0'], options), {
			message: `Packaged ${label} child arguments must be strings without NUL bytes`,
		});
		assert.throws(() => runChild(process.execPath, [], { ...options, maximumOutputBytes: 0 }), {
			message: `Desktop ${label} child output limit must be an integer from 1 to 1048576`,
		});
	});
}
