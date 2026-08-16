/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	runDesktopProjectLibraryLeaseRendererSmoke,
} from '../desktop/project-library-lease-smoke.js';
import {
	createDesktopProjectLibraryLeaseMatrixDocument,
} from '../scripts/lib/desktop-project-library-lease-matrix.mjs';
import {
	createSoundscaperDesktopProjectLibraryV10Handshake,
} from '../desktop/soundscaper-project-library-v10-contract.ts';
import { SoundscaperDesktopProjectLibraryV10Main } from '../desktop/soundscaper-project-library-v10-main.ts';

const PROJECT_ID = 'lease-matrix-renderer';

// The packaged matrix reaches main through the preload bridge, which forwards
// these exact calls. Driving a real main session proves the publication
// sequence the renderer smoke issues is the one main admits, without needing a
// packaged build to find out.
test('the lease renderer smoke creates, observes, advances, and reports conflict against real main', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-v10-lease-renderer-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const main = await SoundscaperDesktopProjectLibraryV10Main.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 921, instanceId: 'lease-renderer-main' },
		handshake: createSoundscaperDesktopProjectLibraryV10Handshake(),
		qualification: null,
	});
	context.after(() => main.close());
	const session = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	context.after(() => session.close());
	const scope = rendererScope(session);

	const created = await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'commit',
		projectId: PROJECT_ID,
		request: { document: document(1, 'initial'), expectedRevision: null },
	});
	assert.equal(created.status, 'committed', JSON.stringify(created));
	assert.equal(created.projectRevision, 1);
	assert.match(created.projectSha256, /^[a-f0-9]{64}$/u);

	const observed = await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'observe-hold',
		projectId: PROJECT_ID,
		request: null,
	});
	assert.equal(observed.status, 'observed');
	assert.equal(observed.projectRevision, 1);
	assert.equal(observed.projectSha256, created.projectSha256);

	// A coalesced advance over the exact base it read is admitted.
	const advanced = await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'commit',
		projectId: PROJECT_ID,
		request: { document: document(4, 'advanced'), expectedRevision: 1 },
	});
	assert.equal(advanced.status, 'committed', JSON.stringify(advanced));
	assert.equal(advanced.projectRevision, 4);
	assert.notEqual(advanced.projectSha256, created.projectSha256);

	// Republishing the now-superseded base is the losing contender in a race.
	const stale = await runDesktopProjectLibraryLeaseRendererSmoke(
		staleBaseScope(session, created.projectSha256),
		{
			action: 'commit',
			projectId: PROJECT_ID,
			request: { document: document(8, 'stale'), expectedRevision: 1 },
		},
	);
	assert.equal(stale.status, 'conflict');
	assert.equal(conflictReason(stale), 'compare-and-swap');

	// The refused contender must not have moved the catalog.
	const settled = await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'verify',
		projectId: PROJECT_ID,
		request: null,
	});
	assert.equal(settled.projectRevision, 4);
	assert.equal(settled.projectSha256, advanced.projectSha256);
});

test('the lease renderer smoke refuses a create whose destination already exists', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-v10-lease-create-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const main = await SoundscaperDesktopProjectLibraryV10Main.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 922, instanceId: 'lease-renderer-create' },
		handshake: createSoundscaperDesktopProjectLibraryV10Handshake(),
		qualification: null,
	});
	context.after(() => main.close());
	const session = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	context.after(() => session.close());
	const scope = rendererScope(session);

	await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'commit',
		projectId: PROJECT_ID,
		request: { document: document(1, 'initial'), expectedRevision: null },
	});
	const repeated = await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'commit',
		projectId: PROJECT_ID,
		request: { document: document(1, 'repeat'), expectedRevision: null },
	});
	assert.equal(repeated.status, 'conflict');
	assert.equal(conflictReason(repeated), 'destination-presence');
});

// The matrix hands both canonical contenders the same base revision. Whichever
// arrives second publishes against a base main has already superseded.
test('the lease renderer smoke publishes a contender against the base it was handed', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-v10-lease-contend-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const main = await SoundscaperDesktopProjectLibraryV10Main.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 923, instanceId: 'lease-renderer-contend' },
		handshake: createSoundscaperDesktopProjectLibraryV10Handshake(),
		qualification: null,
	});
	context.after(() => main.close());
	const session = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	context.after(() => session.close());
	const scope = rendererScope(session);

	await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'commit',
		projectId: PROJECT_ID,
		request: { document: document(1, 'seed'), expectedRevision: null },
	});
	const winner = await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'commit-contend',
		projectId: PROJECT_ID,
		request: { document: document(8, 'left'), expectedRevision: 1 },
	});
	assert.equal(winner.status, 'committed', JSON.stringify(winner));
	assert.equal(winner.projectRevision, 8);
	const loser = await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'commit-contend',
		projectId: PROJECT_ID,
		request: { document: document(8, 'right'), expectedRevision: 1 },
	});
	assert.equal(loser.status, 'conflict');
	assert.equal(conflictReason(loser), 'compare-and-swap');

	const settled = await runDesktopProjectLibraryLeaseRendererSmoke(scope, {
		action: 'verify',
		projectId: PROJECT_ID,
		request: null,
	});
	assert.equal(settled.projectSha256, winner.projectSha256);
});

test('the lease renderer smoke rethrows failures that are not a refusal by main', async () => {
	const closed = failingBridge(new Error('Soundscaper V10 main session is closed'));
	await assert.rejects(runDesktopProjectLibraryLeaseRendererSmoke(closed, {
		action: 'commit',
		projectId: PROJECT_ID,
		request: { document: document(1, 'closed'), expectedRevision: null },
	}), /session is closed/u);
	const refused = await runDesktopProjectLibraryLeaseRendererSmoke(
		failingBridge(new Error(
			"Error invoking remote method 'soundscaper:v10:projects:publication:begin': "
			+ 'Error: Soundscaper V10 expected project failed compare-and-swap',
		)),
		{
			action: 'commit',
			projectId: PROJECT_ID,
			request: { document: document(1, 'refused'), expectedRevision: null },
		},
	);
	assert.equal(refused.status, 'conflict');
	assert.equal(conflictReason(refused), 'compare-and-swap');
});

function failingBridge(failure: Error): Record<string, unknown> {
	return {
		crypto: globalThis.crypto,
		soundscaperProjectLibraryDesktop: {
			v10: {
				connect: async () => createSoundscaperDesktopProjectLibraryV10Handshake(),
				listProjects: async () => ({ metadataRevision: 1, projects: [] }),
				readProjectBundle: async () => null,
				beginPublication: async () => { throw failure; },
				finishPublication: async () => { throw failure; },
				abortPublication: async () => true,
			},
		},
	};
}

function conflictReason(result: unknown): string {
	return String((result as { readonly reason?: unknown }).reason);
}

function document(revision: number, title: string): string {
	return createDesktopProjectLibraryLeaseMatrixDocument(PROJECT_ID, revision, title) as string;
}

type MainSession = ReturnType<SoundscaperDesktopProjectLibraryV10Main['openSession']>;

function rendererScope(session: MainSession): Record<string, unknown> {
	return {
		crypto: globalThis.crypto,
		soundscaperProjectLibraryDesktop: {
			v10: {
				connect: async () => createSoundscaperDesktopProjectLibraryV10Handshake(),
				listProjects: () => session.listProjects(),
				readProjectBundle: (projectId: string) => session.readProjectBundle(projectId),
				beginPublication: (value: unknown) => session.beginPublication(value),
				finishPublication: (value: unknown) => session.finishPublication(value),
				abortPublication: (value: unknown) => session.abortPublication(value),
			},
		},
	};
}

/** Reports the base an earlier reader saw, so main arbitrates the losing publication. */
function staleBaseScope(session: MainSession, projectSha256: string): Record<string, unknown> {
	const scope = rendererScope(session) as {
		soundscaperProjectLibraryDesktop: { v10: Record<string, unknown> };
	};
	const bridge = scope.soundscaperProjectLibraryDesktop.v10;
	bridge.readProjectBundle = async (projectId: string) => {
		const bundle = await session.readProjectBundle(projectId);
		if (!bundle) return null;
		return { ...bundle, project: { ...bundle.project, projectRevision: 1, sha256: projectSha256 } };
	};
	return scope as unknown as Record<string, unknown>;
}
