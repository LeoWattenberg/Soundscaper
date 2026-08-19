/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';

for (const phase of ['prepared', 'committed'] as const) {
	test(`real child termination after ${phase} is recovered after stale takeover`, { timeout: 10_000 }, async (context) => {
		const appDataPath = await mkdtemp(join(tmpdir(), `scape-crash-${phase}-`));
		context.after(() => rm(appDataPath, { recursive: true, force: true }));
		const readyPath = join(appDataPath, 'checkpoint.json');
		const child = spawn(process.execPath, [
			'--import',
			'tsx',
			fileURLToPath(new URL('fixtures/desktop-project-library-crash.ts', import.meta.url)),
			appDataPath,
			phase,
			readyPath,
		], { stdio: ['ignore', 'ignore', 'pipe'] });
		let stderr = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => { stderr += chunk; });
		context.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
		const ready = await readCheckpoint(readyPath, child, () => stderr);
		// Give the child long enough to end on its own if it can. It must not be
		// able to: a fixture that exits while waiting would leave this test
		// asserting a crash that never happened, and under load it did.
		await delay(250);
		assert.equal(child.exitCode, null, 'the crash fixture must survive until it is killed');
		const childExit = once(child, 'exit');
		assert.equal(child.kill('SIGKILL'), true);
		const [code, signal] = await childExit;
		assert.equal(code, null);
		assert.ok(signal, 'the child must terminate through the process-kill path');

		const host = await DesktopProjectLibraryHost.start({
			appDataPath,
			owner: {
				product: 'framescaper',
				processId: process.pid,
				instanceId: `crash-recovery-${phase}`,
			},
			leaseTtlMs: 1_000,
			renewIntervalMs: 100,
		});
		context.after(() => host.close());
		assert.equal(host.snapshot().lastWriter, null, 'unexpired crashed holder leaves startup in observer mode');
		const evidence = await waitForWriterEvidence(host);
		assert.ok(evidence.fencingToken > ready.fencingToken);
		assert.equal(evidence.tookOverStaleLease, true);
		assert.equal(evidence.recovery.outcome, phase === 'prepared' ? 'interrupted' : 'committed');
		assert.equal(host.readCatalog().revision, phase === 'prepared' ? 0 : 1);
	});
}

async function readCheckpoint(
	path: string,
	child: Readonly<{ exitCode: number | null }>,
	stderr: () => string,
): Promise<Readonly<{ phase: string; fencingToken: number }>> {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		try {
			return JSON.parse(await readFile(path, 'utf8')) as { phase: string; fencingToken: number };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			if (child.exitCode !== null) throw new Error(`Crash fixture exited before its checkpoint: ${stderr()}`);
			await delay(10);
		}
	}
	throw new Error(`Crash fixture did not reach its checkpoint: ${stderr()}`);
}

async function waitForWriterEvidence(host: DesktopProjectLibraryHost) {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		const evidence = host.snapshot().lastWriter;
		if (evidence) return evidence;
		await delay(10);
	}
	throw new Error('Observer did not take over the crashed writer lease');
}
