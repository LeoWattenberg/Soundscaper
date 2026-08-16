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
	createSoundscaperDesktopProjectLibraryV10Handshake,
} from '../desktop/soundscaper-project-library-v10-contract.ts';
import { SoundscaperDesktopProjectLibraryV10Main } from '../desktop/soundscaper-project-library-v10-main.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

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
	assert.match(conflictReason(stale), /compare-and-swap|expected project/iu);

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

function conflictReason(result: unknown): string {
	return String((result as { readonly reason?: unknown }).reason);
}

function document(revision: number, title: string): string {
	const base = createSoundscaperProjectV21({ id: PROJECT_ID, title });
	return JSON.stringify({ ...base, revision, metadata: { ...base.metadata, title } });
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
