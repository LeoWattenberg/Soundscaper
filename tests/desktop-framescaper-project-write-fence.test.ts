/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { createFramescaperDesktopProjectLibraryHandshake } from
	'../desktop/framescaper-project-library-contract.ts';
import { FramescaperDesktopProjectLibraryMain } from
	'../desktop/framescaper-project-library-main.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

test('Framescaper main refuses stale claims and exact-document mismatches at admission', async (context) => {
	const { main, session } = await setup(context);
	const base = project(0, 'Base');
	await publish(session, base, '11'.repeat(24));
	const candidate = project(1, 'Candidate');
	const current = await bundle(session);
	const token = session.claimProjectWriteFence(String(base.id));
	session.claimProjectWriteFence(String(base.id));
	assert.equal(await session.checkProjectWriteFence({
		projectId: base.id, writeFence: token, expectedDocument: base,
	}), false);
	assert.equal(await session.beginPublication(request(current, candidate, base, token, '22'.repeat(24))), null);
	assert.equal(main.snapshot().activePublication, false);

	const fresh = session.claimProjectWriteFence(String(base.id));
	assert.equal(await session.checkProjectWriteFence({
		projectId: base.id, writeFence: fresh, expectedDocument: { ...base, title: 'Changed' },
	}), false);
	assert.equal(await session.checkProjectWriteFence({
		projectId: base.id, writeFence: fresh, expectedDocument: base,
	}), true);
	assert.equal(await session.beginPublication(request(current, candidate, {
		...base, title: 'A different exact document',
	}, fresh, '33'.repeat(24))), null);
	assert.equal(main.snapshot().activePublication, false);
	assert.equal((await bundle(session)).document, JSON.stringify(base));
});

test('Framescaper main rechecks the claim inside the publication commit transaction', async (context) => {
	let contender: ReturnType<FramescaperDesktopProjectLibraryMain['openSession']> | null = null;
	const { main, session } = await setup(context, (phase) => {
		if (phase === 'materialized') contender?.claimProjectWriteFence('framescaper-write-fence');
	});
	const base = project(0, 'Base');
	await publish(session, base, '44'.repeat(24));
	contender = main.openSession(main.localHandshake);
	context.after(() => contender?.close());
	const current = await bundle(session);
	const token = session.claimProjectWriteFence(String(base.id));
	const publicationId = '55'.repeat(24);
	assert.ok(await session.beginPublication(request(current, project(1, 'Candidate'), base, token, publicationId)));
	assert.equal(await session.finishPublication({ publicationId }), null);
	assert.equal((await bundle(session)).document, JSON.stringify(base));
	assert.equal(main.snapshot().activePublication, false);
});

type Session = ReturnType<FramescaperDesktopProjectLibraryMain['openSession']>;
type Bundle = Readonly<{
	metadataRevision: number;
	project: Readonly<{ projectRevision: number; sha256: string }>;
	document: string;
}>;

async function setup(context: TestContext, checkpoint: ((phase: string) => void) | null = null) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-write-fence-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	const main = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'framescaper', processId: 974, instanceId: 'write-fence-test' },
		handshake, onLeaseLost: () => undefined,
		testControl: checkpoint ? { leaseTtlMs: 30_000, renewIntervalMs: 10_000, checkpoint } : null,
	});
	context.after(() => main.close());
	const session = main.openSession(handshake);
	context.after(() => session.close());
	return { main, session };
}

function project(revision: number, title: string) {
	return Object.freeze({
		...createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
			id: 'framescaper-write-fence', title,
			now: '2026-09-24T12:00:00.000Z',
		}), revision,
	});
}

function request(current: Bundle, candidate: unknown, expectedDocument: unknown, writeFence: string, publicationId: string) {
	return {
		publicationId, expectedMetadataRevision: current.metadataRevision,
		expectedProject: {
			projectRevision: current.project.projectRevision,
			projectSha256: current.project.sha256,
		},
		expectedDocument, writeFence, project: candidate, bodies: [],
	};
}

async function publish(session: Session, candidate: unknown, publicationId: string): Promise<void> {
	const admission = await session.beginPublication({
		publicationId, expectedMetadataRevision: 0, expectedProject: null,
		project: candidate, bodies: [],
	});
	assert.ok(admission);
	assert.ok(await session.finishPublication({ publicationId }));
}

async function bundle(session: Session): Promise<Bundle> {
	const current = await session.readProjectBundle('framescaper-write-fence');
	assert.ok(current);
	return current as Bundle;
}
