/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

const HELPER_PATH = fileURLToPath(new URL('../scripts/ci-electron-builder.sh', import.meta.url));

test('desktop package jobs route electron-builder through the transient-download retry helper', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const packageJob = extractJob(workflow, 'package');
	const packageWithTestsJob = extractJob(workflow, 'package-with-tests');

	assert.match(packageJob, /bash scripts\/ci-electron-builder\.sh[\s\S]*--publish never/u);
	assert.doesNotMatch(packageJob, /\bnpx electron-builder\b/u);
	assert.equal(
		packageWithTestsJob.match(/bash scripts\/ci-electron-builder\.sh/gu)?.length,
		2,
		'both mutually exclusive nightly-with-tests packaging steps must use the helper',
	);
	assert.doesNotMatch(packageWithTestsJob, /\bnpx electron-builder\b/u);
});

test('electron-builder retries the observed Electron ZIP HTTP 504 and preserves its arguments', () => {
	const harness = createHarness('transient-zip');
	try {
		const result = harness.run(['--config', 'electron-builder.config.cjs', '--win', '--arm64', '--publish', 'never']);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(harness.attempts(), 2);
		assert.deepEqual(harness.calls(), [
			'electron-builder --config electron-builder.config.cjs --win --arm64 --publish never',
			'electron-builder --config electron-builder.config.cjs --win --arm64 --publish never',
		]);
	} finally {
		harness.cleanup();
	}
});

test('electron-builder retries the observed SHASUMS256.txt HTTP 504', () => {
	const harness = createHarness('transient-shasums');
	try {
		const result = harness.run(['--config', 'electron-builder.config.cjs', '--win', '--arm64']);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(harness.attempts(), 2);
	} finally {
		harness.cleanup();
	}
});

test('electron-builder does not retry a functional packaging failure', () => {
	const harness = createHarness('functional');
	try {
		const result = harness.run(['--config', 'electron-builder.config.cjs', '--linux', '--x64']);
		assert.equal(result.status, 23);
		assert.equal(harness.attempts(), 1);
		assert.match(result.stderr, /non-transient packaging error/iu);
	} finally {
		harness.cleanup();
	}
});

test('electron-builder stops after three transient download failures', () => {
	const harness = createHarness('exhausted');
	try {
		const result = harness.run(['--config', 'electron-builder.config.cjs', '--win', '--arm64']);
		assert.equal(result.status, 29);
		assert.equal(harness.attempts(), 3);
		assert.match(result.stderr, /failed after 3 attempts/iu);
	} finally {
		harness.cleanup();
	}
});

function createHarness(mode) {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-electron-builder-retry-'));
	const binary = join(root, 'bin');
	mkdirSync(binary);
	const callsPath = join(root, 'calls.log');
	const counterPath = join(root, 'counter');
	const npxPath = join(binary, 'npx');
	writeFileSync(npxPath, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_NPX_CALLS"
attempt="$(cat "$FAKE_NPX_COUNTER" 2>/dev/null || printf 0)"
attempt=$((attempt + 1))
printf '%s' "$attempt" > "$FAKE_NPX_COUNTER"
case "$FAKE_NPX_MODE" in
  transient-zip)
    if [ "$attempt" -eq 1 ]; then
      echo '  x Response code 504 () for https://github.com/electron/electron/releases/download/v43.1.1/electron-v43.1.1-win32-arm64.zip' >&2
      exit 17
    fi
    ;;
  transient-shasums)
    if [ "$attempt" -eq 1 ]; then
      echo '  x Response code 504 () for https://github.com/electron/electron/releases/download/v43.1.1/SHASUMS256.txt' >&2
      exit 19
    fi
    ;;
  functional)
    echo '  x Invalid configuration object. electron-builder.yml has an unknown property.' >&2
    exit 23
    ;;
  exhausted)
    echo '  x Response code 504 () for https://github.com/electron/electron/releases/download/v43.1.1/SHASUMS256.txt' >&2
    exit 29
    ;;
esac
exit 0
`);
	chmodSync(npxPath, 0o755);

	return {
		run(arguments_) {
			return spawnSync('bash', [HELPER_PATH, ...arguments_], {
				encoding: 'utf8',
				env: {
					...process.env,
					PATH: `${binary}:${process.env.PATH ?? ''}`,
					FAKE_NPX_CALLS: callsPath,
					FAKE_NPX_COUNTER: counterPath,
					FAKE_NPX_MODE: mode,
					SOUNDSCAPER_ELECTRON_BUILDER_RETRY_DELAY_SECONDS: '0',
				},
			});
		},
		attempts() {
			try {
				return Number(readFileSync(counterPath, 'utf8'));
			} catch {
				return 0;
			}
		},
		calls() {
			try {
				return readFileSync(callsPath, 'utf8').split('\n').filter(Boolean);
			} catch {
				return [];
			}
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}
