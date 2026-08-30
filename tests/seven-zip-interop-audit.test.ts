/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('7-Zip extraction defects fail the audit instead of reporting an unavailable tool', async (context) => {
	if (process.platform === 'win32') return context.skip('The fake executable uses a POSIX shebang.');
	const root = await mkdtemp(join(tmpdir(), 'seven-zip-audit-failure-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const executable = join(root, 'fake-seven-zip.mjs');
	await writeFile(executable, `#!/usr/bin/env node
if (process.argv[2] === 'i') process.stdout.write('Fake 7-Zip 1.0\\n');
// Test and extraction deliberately report success without extracting entries.
`);
	await chmod(executable, 0o755);

	await assert.rejects(
		execFileAsync(process.execPath, [resolve('scripts/audit-seven-zip-interop.mjs')], {
			env: { ...process.env, SEVEN_ZIP_BIN: executable },
		}),
		(error: unknown) => {
			const failure = error as Readonly<{ stderr?: string }>;
			assert.match(failure.stderr ?? '', /ENOENT|no such file/iu);
			assert.doesNotMatch(failure.stderr ?? '', /status.*unavailable/iu);
			return true;
		},
	);
});
