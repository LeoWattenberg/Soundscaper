/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile, type ExecFileException } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('the hosted diagnostics npm command loads its product contracts before rejecting an invalid option', async () => {
	const result = await new Promise<Readonly<{ error: ExecFileException | null; stderr: string }>>(resolve => {
		execFile('npm', ['run', 'quality:collect:ci-diagnostics', '--', '--startup-regression'], {
			cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 30_000,
		}, (error, _stdout, stderr) => { resolve({ error, stderr }); });
	});
	assert.ok(result.error, 'The unsupported option must fail before any browser workload starts.');
	assert.equal(result.error.code, 1);
	assert.equal(result.error.signal, null);
	assert.match(result.stderr, /Unknown hosted CI diagnostics option --startup-regression/u);
});
