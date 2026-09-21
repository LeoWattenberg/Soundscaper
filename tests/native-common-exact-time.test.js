/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	boostClosureIncludeArguments,
	exactRetimeClosureAvailable,
} from './helpers/framescaper-boost-closure.js';

const ROOT = resolve(import.meta.dirname, '..');

test('native media and OpenFX consumers contain no private exact-time kernel', () => {
	const common = readFileSync(join(ROOT, 'native/common/exact_time.hpp'), 'utf8');
	const media = readFileSync(join(
		ROOT, 'native/framescaper-media-host/src/unified_plan_common.hpp',
	), 'utf8');
	const transition = readFileSync(join(
		ROOT, 'native/framescaper-openfx-host/src/v12_transition_authority.cpp',
	), 'utf8');
	const retime = readFileSync(join(
		ROOT, 'native/framescaper-openfx-host/src/v12_retime_authority.cpp',
	), 'utf8');
	assert.match(common, /compare_rationals[\s\S]*left_whole/u);
	assert.match(common, /sequence_frame_at_sample[\s\S]*round_nonnegative_ratio/u);
	for (const consumer of [media, transition, retime]) {
		assert.match(consumer, /common\/exact_time\.hpp/u);
		assert.doesNotMatch(consumer, /left_whole\s*=|remainder\s*\*\s*2\s*>=\s*denominator/u);
	}
	assert.match(transition, /exact transition cadence is invalid/u);
	assert.match(retime, /exact sequence cadence is invalid/u);
});

test('the neutral exact-time kernel preserves rational order and cadence boundaries', (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return;
	}
	const directory = mkdtempSync(join(tmpdir(), 'native-common-exact-time-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const executable = join(directory, 'exact-time-fixture');
	const compiled = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		...boostClosureIncludeArguments(),
		...(exactRetimeClosureAvailable() ? ['-DSCAPE_EXPECT_EXACT_CADENCE=1'] : []),
		join(ROOT, 'tests/fixtures/native-common-exact-time.cpp'),
		'-o', executable,
	], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
	const run = spawnSync(executable, [], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(run.status, 0, run.stderr || run.stdout);
});
