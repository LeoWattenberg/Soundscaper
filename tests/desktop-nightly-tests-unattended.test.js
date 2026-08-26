/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	DESKTOP_NIGHTLY_TESTS_RESULT_MARKER,
	formatDesktopNightlyTestsSummary,
	parseDesktopNightlyTestsSummary,
	resolveDesktopNightlyTestsPresentation,
} from '../scripts/lib/desktop-nightly-tests-presentation.mjs';

const ROOT = new URL('../', import.meta.url);
const RELATIVE_IMPORT = /from '(\.{1,2}\/[\w./-]+\.mjs)'/gu;

test('the launcher reports unattended when asked by flag or by environment', () => {
	assert.deepEqual(
		{ ...resolveDesktopNightlyTestsPresentation({ argv: ['/opt/app', '--unattended'] }) },
		{ unattended: true },
	);
	assert.deepEqual(
		{ ...resolveDesktopNightlyTestsPresentation({ environment: { SOUNDSCAPER_NIGHTLY_TESTS_UNATTENDED: '1' } }) },
		{ unattended: true },
	);
	assert.deepEqual({ ...resolveDesktopNightlyTestsPresentation() }, { unattended: false });
	assert.deepEqual(
		{ ...resolveDesktopNightlyTestsPresentation({ environment: { SOUNDSCAPER_NIGHTLY_TESTS_UNATTENDED: '0' } }) },
		{ unattended: false },
	);
	assert.throws(() => resolveDesktopNightlyTestsPresentation({ argv: [1] }), /argv must be strings/u);
});

test('the summary line round trips through its marker', () => {
	const line = formatDesktopNightlyTestsSummary({
		status: 'failed',
		exitCode: 1,
		runRoot: '/var/run/soundscaper',
	});
	assert.ok(line.startsWith(DESKTOP_NIGHTLY_TESTS_RESULT_MARKER));
	assert.deepEqual({ ...parseDesktopNightlyTestsSummary(`noise\n${line}\nmore noise`) }, {
		schemaVersion: 1,
		status: 'failed',
		exitCode: 1,
		runRoot: '/var/run/soundscaper',
		failure: null,
	});
	assert.throws(() => parseDesktopNightlyTestsSummary('nothing here'), /exactly one nightly tests summary/u);
	assert.throws(() => formatDesktopNightlyTestsSummary({ status: 'passed', exitCode: 256 }), /must be a byte/u);
});

test('the launcher chooses between the dialog and the summary line', async () => {
	const main = await readFile(new URL('desktop/nightly-tests-main.mjs', ROOT), 'utf8');
	assert.match(main, /resolveDesktopNightlyTestsPresentation/u);
	assert.equal((main.match(/if \(unattended\) \{/gu) ?? []).length, 2,
		'both the finished and the failed-to-start path must branch on the unattended decision');
	assert.equal((main.match(/dialog\.showMessageBox/gu) ?? []).length, 2);
	assert.equal((main.match(/formatDesktopNightlyTestsSummary\(/gu) ?? []).length, 2,
		'both paths must print the summary line when unattended');
});

// A module the launcher imports but the package does not list is a crash on
// first launch that no unit test would otherwise see.
test('the package ships every module the launcher imports', async () => {
	const config = JSON.parse(JSON.stringify(
		(await import(new URL('electron-builder.nightly-tests.config.cjs', ROOT).href)).default,
	));
	const seen = new Set();
	const queue = ['desktop/nightly-tests-main.mjs'];
	while (queue.length > 0) {
		const current = queue.pop();
		if (seen.has(current)) continue;
		seen.add(current);
		const source = await readFile(new URL(current, ROOT), 'utf8');
		for (const match of source.matchAll(RELATIVE_IMPORT)) {
			const resolved = new URL(match[1], new URL(current, ROOT)).href.slice(ROOT.href.length);
			if (!resolved.startsWith('node_modules/')) queue.push(resolved);
		}
	}
	const missing = [...seen].filter((path) => !config.files.includes(path));
	assert.deepEqual(missing, [], `Launcher modules missing from the package: ${missing.join(', ')}`);
});
