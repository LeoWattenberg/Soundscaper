/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createDesktopProjectLibraryLeaseSmokeSession,
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
} from '../desktop/project-library-lease-smoke.js';

test('lease smoke keeps fault paths in main and records catalog descriptor evidence', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-lease-smoke-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const control = Object.freeze({
		ready: join(root, 'ready.json'),
		release: join(root, 'release'),
		result: join(root, 'result.json'),
		start: join(root, 'start'),
	});
	const document = '{}';
	const plan = {
		action: 'commit',
		control,
		leaseTtlMs: 1_000,
		mode: DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
		productId: 'soundscaper',
		projectId: 'lease-smoke-project',
		request: { document, expectedRevision: null },
		schemaVersion: 1,
	};
	const executed = [];
	const session = createDesktopProjectLibraryLeaseSmokeSession({
		plan,
		productId: 'soundscaper',
		projectLibraryEvidence: async () => ({
			host: { product: 'soundscaper', closed: false, fenced: false, activePublication: false },
			project: {
				projectId: plan.projectId,
				title: 'Lease smoke',
				projectSchemaVersion: 21,
				projectRevision: 4,
				byteLength: 2,
				sha256: 'a'.repeat(64),
				bodyCount: 0,
			},
		}),
		projectLibrarySnapshot: () => ({
			closed: false,
			fenced: false,
			owner: { product: 'soundscaper' },
			activeSessions: 0,
			activePublication: false,
			writer: { fencingToken: 3, tookOverStaleLease: false, recovery: { outcome: 'clean' } },
		}),
	});
	const pending = session.rendererReady({
		async executeJavaScript(source) {
			executed.push(source);
			return { status: 'committed', document };
		},
	});
	await waitFor(control.ready);
	await writeFile(control.start, '', { flag: 'wx' });
	const payload = await pending;

	assert.deepEqual(payload.catalog, {
		revision: 4,
		projectSha256: 'a'.repeat(64),
		managedMediaBodyCount: 0,
	});
	assert.equal(payload.host.writer.fencingToken, 3);
	assert.equal(JSON.parse(await readFile(control.result, 'utf8')).catalog.projectSha256, 'a'.repeat(64));
	assert.equal(executed.length, 1);
	assert.doesNotMatch(executed[0], new RegExp(root.replaceAll('\\', '\\\\'), 'u'));
	assert.doesNotMatch(executed[0], /ready\.json|result\.json|leaseTtlMs/iu);
});

test('the crash checkpoint ignores publications the plan never drove', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-lease-smoke-checkpoint-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const control = Object.freeze({
		ready: join(root, 'ready.json'),
		release: join(root, 'release'),
		result: join(root, 'result.json'),
		start: join(root, 'start'),
	});
	const document = '{}';
	// renderer-loss shares the 'prepared' target with crash-prepared but crashes
	// the renderer instead of parking main forever, so the same gate is
	// observable here without deadlocking the test runner.
	const session = leaseSession({ action: 'renderer-loss', control, document });
	let crashes = 0;
	session.attach({
		isDestroyed: () => false,
		webContents: {
			on() { /* The reload wiring is asserted by the workflow's own test. */ },
			forcefullyCrashRenderer() { crashes += 1; },
			reload() { /* Unreached: this test never lets the process go. */ },
		},
	});

	// The packaged application publishes while it boots — its editor autosaves
	// the project it opens — so a 'prepared' phase arrives before the matrix has
	// even been told this process is ready. Crashing there strands the matrix
	// waiting on a ready signal main can no longer send.
	session.v10Qualification.checkpoint('prepared');
	await assert.rejects(access(control.result), { code: 'ENOENT' });
	await assert.rejects(access(control.ready), { code: 'ENOENT' });
	assert.equal(crashes, 0);

	let checkpointsDuringPlan = 0;
	const pending = session.rendererReady({
		async executeJavaScript() {
			session.v10Qualification.checkpoint('prepared');
			checkpointsDuringPlan += 1;
			return { status: 'committed', document };
		},
	});
	await waitFor(control.ready);
	await writeFile(control.start, '', { flag: 'wx' });

	assert.equal(await pending, null);
	assert.equal(checkpointsDuringPlan, 1);
	assert.equal(crashes, 1);
	assert.equal(JSON.parse(await readFile(control.result, 'utf8')).phase, 'prepared');
});

test('the staged renderer crash is followed by the reload its recovery needs', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-lease-smoke-reload-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const control = Object.freeze({
		ready: join(root, 'ready.json'),
		release: join(root, 'release'),
		result: join(root, 'result.json'),
		start: join(root, 'start'),
	});
	const document = '{}';
	const session = leaseSession({ action: 'renderer-loss', control, document });
	const listeners = new Map();
	let crashes = 0;
	let reloads = 0;
	session.attach({
		isDestroyed: () => false,
		webContents: {
			on(event, listener) { listeners.set(event, listener); },
			forcefullyCrashRenderer() { crashes += 1; },
			reload() { reloads += 1; },
		},
	});

	const pending = session.rendererReady({
		async executeJavaScript() {
			session.v10Qualification.checkpoint('prepared');
			return { status: 'committed', document };
		},
	});
	await waitFor(control.ready);
	await writeFile(control.start, '', { flag: 'wx' });
	assert.equal(await pending, null);
	assert.equal(crashes, 1);

	// Electron leaves a crashed WebContents blank, so the recovery commit has no
	// renderer to run in until this reload happens. Without it the workflow waits
	// out the packaged watchdog with nothing alive left to signal ready.
	assert.equal(reloads, 0, 'the reload belongs after the process is gone, not before');
	listeners.get('render-process-gone')?.({}, { reason: 'crashed' });
	assert.equal(reloads, 1);

	// The recovered renderer commits, and its own loss is not staged a second time.
	const recovered = await session.rendererReady({
		async executeJavaScript() {
			session.v10Qualification.checkpoint('prepared');
			return { status: 'committed', document };
		},
	});
	assert.equal(recovered.renderer.status, 'committed');
	assert.equal(crashes, 1);
	listeners.get('render-process-gone')?.({}, { reason: 'crashed' });
	assert.equal(reloads, 1, 'a recovered workflow must not reload again');
});

function leaseSession({ action, control, document }) {
	const projectId = 'lease-smoke-project';
	return createDesktopProjectLibraryLeaseSmokeSession({
		plan: {
			action,
			control,
			leaseTtlMs: 1_000,
			mode: DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
			productId: 'soundscaper',
			projectId,
			request: { document, expectedRevision: null },
			schemaVersion: 1,
		},
		productId: 'soundscaper',
		projectLibraryEvidence: async () => ({
			host: { product: 'soundscaper', closed: false, fenced: false, activePublication: false },
			project: {
				projectId,
				title: 'Lease smoke',
				projectSchemaVersion: 21,
				projectRevision: 4,
				byteLength: 2,
				sha256: 'a'.repeat(64),
				bodyCount: 0,
			},
		}),
		projectLibrarySnapshot: () => ({
			closed: false,
			fenced: false,
			owner: { product: 'soundscaper' },
			activeSessions: 0,
			activePublication: false,
			writer: { fencingToken: 3, tookOverStaleLease: false, recovery: { outcome: 'clean' } },
		}),
	});
}

async function waitFor(path) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try { await access(path); return; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
	}
	throw new Error(`Timed out waiting for ${path}`);
}
