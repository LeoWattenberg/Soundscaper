/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createFramescaperDesktopProjectLibraryHandshake } from
	'../desktop/framescaper-project-library-contract.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS } from
	'../desktop/framescaper-project-library-main-channels.ts';
import { FramescaperDesktopProjectLibraryMain } from
	'../desktop/framescaper-project-library-main.ts';
import { registerFramescaperDesktopProjectLibraryExactGenerationMainIpc } from
	'../desktop/project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

type Handler = (event: unknown, value?: unknown) => Promise<unknown> | unknown;
type RendererEvent = Readonly<{ sender: object }>;

test('exact-generation IPC isolates renderer sessions across revocation and disposal', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-library-ipc-'));
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	const main = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'framescaper', processId: 995, instanceId: 'ipc-composition' },
		handshake,
		onLeaseLost: () => undefined,
		testControl: null,
	});
	const handlers = new Map<string, Handler>();
	const removed: string[] = [];
	const registration = registerFramescaperDesktopProjectLibraryExactGenerationMainIpc({
		handle: (channel: string, handler: Handler) => {
			assert.equal(handlers.has(channel), false, `duplicate handler for ${channel}`);
			handlers.set(channel, handler);
		},
		removeHandler: (channel: string) => {
			assert.equal(handlers.delete(channel), true, `missing handler for ${channel}`);
			removed.push(channel);
		},
		ownerFor: (event: unknown) => (event as RendererEvent).sender,
		main,
	}, {
		label: 'Framescaper 1.0',
		channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS,
		isMain: (value): value is FramescaperDesktopProjectLibraryMain => value === main,
	});
	context.after(async () => {
		await registration.dispose();
		await main.close();
		await rm(root, { recursive: true, force: true });
	});

	const firstOwner = {};
	const secondOwner = {};
	const firstEvent = Object.freeze({ sender: firstOwner });
	const secondEvent = Object.freeze({ sender: secondOwner });
	await assert.rejects(
		invoke(handlers, firstEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.listProjects),
		/handshake is required before operational IPC/u,
	);

	assert.deepEqual(await invoke(
		handlers, firstEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.handshake,
		structuredClone(handshake),
	), handshake);
	assert.deepEqual(await invoke(
		handlers, secondEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.handshake,
		structuredClone(handshake),
	), handshake);
	assert.equal(main.snapshot().activeSessions, 2);

	const firstPublicationId = '11'.repeat(24);
	assert.ok(await invoke(
		handlers, firstEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.beginPublication,
		publicationRequest(firstPublicationId, 'revoked-project', 'Revoked project'),
	));
	assert.deepEqual(await invoke(
		handlers, secondEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.listProjects,
	), { metadataRevision: 0, projects: [] });
	assert.equal(main.snapshot().activePublication, true);

	const finishing = invoke(
		handlers, firstEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.finishPublication,
		{ publicationId: firstPublicationId },
	);
	void finishing.catch(() => undefined);
	const revoking = registration.revokeOwner(firstOwner);
	await assert.rejects(finishing, /publication is not active/u);
	await revoking;
	assert.equal(main.snapshot().activeSessions, 1);
	assert.equal(main.snapshot().activePublication, false);
	await registration.revokeOwner(firstOwner);
	assert.equal(main.snapshot().activeSessions, 1, 'revocation retires its session exactly once');
	await assert.rejects(invoke(
		handlers, firstEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.finishPublication,
		{ publicationId: firstPublicationId },
	), /renderer handshake was refused/u);

	const secondPublicationId = '22'.repeat(24);
	assert.ok(await invoke(
		handlers, secondEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.beginPublication,
		publicationRequest(secondPublicationId, 'published-project', 'Published project'),
	));
	const published = await invoke(
		handlers, secondEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.finishPublication,
		{ publicationId: secondPublicationId },
	) as Readonly<{ metadataRevision: number; document: string }>;
	assert.equal(published.metadataRevision, 1);
	assert.equal(JSON.parse(published.document).id, 'published-project');
	assert.equal(await invoke(
		handlers, secondEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readProjectBundle,
		'revoked-project',
	), null);
	const stored = await invoke(
		handlers, secondEvent, FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readProjectBundle,
		'published-project',
	) as Readonly<{ document: string }>;
	assert.equal(stored.document, published.document);
	assert.equal(main.snapshot().activeSessions, 1);

	await Promise.all([registration.dispose(), registration.dispose()]);
	assert.equal(handlers.size, 0);
	assert.deepEqual(
		[...removed].sort(),
		[...Object.values(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS)].sort(),
	);
	assert.equal(removed.length, new Set(removed).size, 'every handler is removed exactly once');
	assert.equal(main.snapshot().activeSessions, 0);
	await registration.dispose();
	assert.equal(removed.length, Object.keys(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS).length);
});

async function invoke(
	handlers: ReadonlyMap<string, Handler>,
	event: RendererEvent,
	channel: string,
	value?: unknown,
): Promise<unknown> {
	const handler = handlers.get(channel);
	if (!handler) throw new Error(`Missing fake Electron handler for ${channel}`);
	return handler(event, value);
}

function publicationRequest(publicationId: string, id: string, title: string): unknown {
	return {
		publicationId,
		expectedMetadataRevision: 0,
		expectedProject: null,
		project: createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
			id,
			title,
			now: '2026-09-27T12:00:00.000Z',
		}),
		bodies: [],
	};
}
