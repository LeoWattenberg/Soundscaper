/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const host = join(root, 'native/framescaper-openfx-host/src');

test('one OFX parameter wire ABI preserves authored versus persisted admission and types', async (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return;
	}
	const scratch = await mkdtemp(join(tmpdir(), 'framescaper-openfx-parameter-wire-'));
	context.after(() => rm(scratch, { recursive: true, force: true }));
	const executable = join(scratch, 'hydrate');
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		'-DFRAMESCAPER_OPENFX_CONTRACT_ONLY=1',
		'-I', host,
		join(host, 'host_parameter_wire_hydration.cpp'),
		join(host, 'parameter_values.cpp'),
		join(root, 'native/framescaper-media-host/src/strict_json.cpp'),
		join(root, 'tests/fixtures/framescaper-openfx-parameter-wire.cpp'),
		'-o', executable,
	], { cwd: root, encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr || built.stdout);
	const executed = spawnSync(executable, [], { cwd: root, encoding: 'utf8' });
	assert.equal(executed.status, 0, executed.stderr || `fixture exited ${String(executed.status)}`);
});
