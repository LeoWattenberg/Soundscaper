/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSoundscaperDesktopProjectLibraryHandshake } from
	'../desktop/soundscaper-project-library-contract.ts';
import { SoundscaperDesktopProjectLibraryMain } from
	'../desktop/soundscaper-project-library-main.ts';
import { registerSoundscaperDesktopProjectLibraryMainIpc } from
	'../desktop/soundscaper-project-library-main-ipc.ts';
import { createSoundscaperDesktopProjectLibraryMainPreloadBridge } from
	'../desktop/soundscaper-project-library-main-preload.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('Soundscaper preload and main reject stale and changed-document fenced publications', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-fence-ipc-'));
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	let replaceAtCommit = false;
	let replacement: Promise<string> | null = null;
	let rival: ReturnType<SoundscaperDesktopProjectLibraryMain['openSession']> | null = null;
	const projectId = 'fenced-ipc-project';
	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 981, instanceId: 'fenced-ipc' },
		handshake,
		onLeaseLost: () => undefined,
		testControl: {
			leaseTtlMs: 30_000,
			renewIntervalMs: 5_000,
			checkpoint: (phase: 'prepared' | 'materialized' | 'committed' | 'complete') => {
				if (phase === 'materialized' && replaceAtCommit && rival) {
					replaceAtCommit = false;
					replacement = rival.claimProjectWriteFence(projectId);
				}
			},
		},
	});
	rival = main.openSession(handshake);
	const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
	const rendererOwner = {};
	const event = {};
	const registration = registerSoundscaperDesktopProjectLibraryMainIpc({
		handle: (channel: string, handler: (event: unknown, request?: unknown) => unknown) => {
			handlers.set(channel, handler);
		},
		removeHandler: (channel: string) => { handlers.delete(channel); },
		ownerFor: () => rendererOwner,
		main,
	});
	const bridge = createSoundscaperDesktopProjectLibraryMainPreloadBridge({
		invoke: async (channel: string, request?: unknown) => {
			const handler = handlers.get(channel);
			if (!handler) throw new Error(`Missing desktop IPC handler: ${channel}`);
			return handler(event, request);
		},
	});
	try {
		await bridge.connect();
		const base = createSoundscaperProject({ id: projectId, title: 'Base' });
		await bridge.beginPublication({
			publicationId: '31'.repeat(24), expectedMetadataRevision: 0,
			expectedProject: null, project: base, bodies: [],
		});
		await bridge.finishPublication({ publicationId: '31'.repeat(24) });
		const oldFence = await bridge.claimProjectWriteFence(projectId);
		const currentFence = await bridge.claimProjectWriteFence(projectId);
		const next = { ...base, revision: 1, title: 'Next', updatedAt: new Date().toISOString() };
		assert.notEqual(oldFence, currentFence);
		assert.equal(await bridge.checkProjectWriteFence({
			projectId, writeFence: oldFence, expectedDocument: base,
		}), false);
		assert.equal(await bridge.checkProjectWriteFence({
			projectId, writeFence: currentFence, expectedDocument: base,
		}), true);
		await assert.rejects(() => beginFenced(bridge, '32'.repeat(24), base, next, oldFence), /write-fence/u);
		await assert.rejects(() => beginFenced(bridge, '33'.repeat(24),
			{ ...base, title: 'Same revision, different data' }, next, currentFence), /write-fence/u);
		assert.equal((await bridge.readProjectBundle(projectId))?.document, JSON.stringify(base));
		replaceAtCommit = true;
		await assert.rejects(() => beginFenced(bridge, '34'.repeat(24), base, next, currentFence), /write-fence/u);
		assert.ok(replacement);
		const replacementFence = await replacement;
		assert.notEqual(replacementFence, currentFence);
		assert.equal((await bridge.readProjectBundle(projectId))?.document, JSON.stringify(base));
		await beginFenced(bridge, '35'.repeat(24), base, next, replacementFence);
		const committed = await bridge.finishPublication({ publicationId: '35'.repeat(24) });
		assert.equal(committed.document, JSON.stringify(next));
		const deleted = await bridge.deleteProject({
			projectId,
			expectedMetadataRevision: committed.metadataRevision,
			expectedProject: {
				projectRevision: committed.project.projectRevision,
				projectSha256: committed.project.sha256,
			},
		});
		assert.equal(deleted.deleted, true);
		assert.equal(await bridge.checkProjectWriteFence({
			projectId, writeFence: replacementFence, expectedDocument: next,
		}), false);
	} finally {
		await registration.dispose();
		await rival.close();
		await main.close();
		await rm(root, { recursive: true, force: true });
	}
});

async function beginFenced(
	bridge: ReturnType<typeof createSoundscaperDesktopProjectLibraryMainPreloadBridge>,
	publicationId: string,
	expectedDocument: unknown,
	project: unknown,
	writeFence: string,
) {
	const current = await bridge.readProjectBundle(String((project as { id: unknown }).id));
	assert.ok(current);
	return bridge.beginPublication({
		publicationId,
		expectedMetadataRevision: current.metadataRevision,
		expectedProject: {
			projectRevision: current.project.projectRevision,
			projectSha256: current.project.sha256,
		},
		project,
		bodies: [],
		writeFence,
		expectedDocument,
	});
}
