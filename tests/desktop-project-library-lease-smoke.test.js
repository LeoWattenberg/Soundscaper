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

async function waitFor(path) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try { await access(path); return; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
	}
	throw new Error(`Timed out waiting for ${path}`);
}
