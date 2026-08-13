/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';
import {
	FramescaperDesktopProjectLibraryV10Main,
} from '../desktop/project-library-v10-main.ts';
import {
	FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS,
	registerFramescaperDesktopProjectLibraryV10MainIpc,
} from '../desktop/project-library-v10-main-ipc.ts';
import {
	createFramescaperDesktopProjectLibraryV10MainPreloadBridge,
} from '../desktop/project-library-v10-main-preload.ts';
import {
	connectFramescaperDesktopProjectLibraryV10Renderer,
	type FramescaperDesktopProjectLibraryV10Renderer,
} from '../src/framescaper/desktop-project-library-v10-renderer.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { FramescaperScapeArchiveV18 } from '../src/framescaper/scape-project-preservation-v18.ts';
import {
	createFramescaperV18ArchiveFixture,
} from './helpers/framescaper-v18-archive-fixture.ts';
import {
	uploadV10MainPublication,
	V10_MAIN_PROJECT_ID,
} from './helpers/desktop-project-library-v10-main-fixture.ts';
import { projectFixture } from './helpers/framescaper-desktop-v10-store-fixture.ts';

const OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 86,
	instanceId: 'framescaper-v10-renderer-recovery',
});

test('lost zero-body begin reply recovers the commit and releases the main mutation slot', async (context) => {
	let loseBegin = true;
	const fixture = await realRendererFixture(context, async ({ channel, result }) => {
		if (channel === FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.beginPublication
			&& loseBegin) {
			loseBegin = false;
			throw new Error('lost zero-body begin reply');
		}
		return result;
	});
	const project = projectFixture({ id: 'lost-begin-project', revision: 0 });
	assert.equal(await fixture.renderer.readProject(project.id), null);
	assert.deepEqual(await fixture.renderer.publishProject({ project }), project);
	assert.equal(fixture.main.snapshot().activePublication, false);

	const next = { ...project, revision: 1, title: 'Mutation slot recovered' };
	assert.deepEqual(await fixture.renderer.publishProject({ project: next }), next);
	assert.equal((await fixture.renderer.listProjects()).find(({ id }) => id === project.id)?.revision, 1);
});

test('lost final-body chunk reply rolls forward, recovers exactly, and permits a later save', async (context) => {
	let loseFinalChunk = true;
	const fixture = await realRendererFixture(context, async ({ channel, value, result, invokeRaw }) => {
		const request = value as Readonly<Record<string, unknown>> | undefined;
		const acknowledgement = result as Readonly<Record<string, unknown>> | undefined;
		if (channel === FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.writePublicationChunk
			&& loseFinalChunk && request?.bodyIndex === 1 && acknowledgement?.complete === true) {
			loseFinalChunk = false;
			await waitForRevision(invokeRaw, V10_MAIN_PROJECT_ID, 2);
			throw new Error('lost final body chunk reply');
		}
		return result;
	}, true);
	const current = await fixture.renderer.readProject(V10_MAIN_PROJECT_ID);
	assert.ok(current);
	const revisionTwo = revise(current, 2, 'Recovered final chunk');
	assert.deepEqual(await fixture.renderer.publishProject({ project: revisionTwo }), revisionTwo);
	assert.equal(fixture.main.snapshot().activePublication, false);

	const revisionThree = revise(revisionTwo, 3, 'Subsequent save');
	assert.deepEqual(await fixture.renderer.publishProject({ project: revisionThree }), revisionThree);
	assert.equal((await fixture.renderer.listProjects())[0]?.revision, 3);
});

type Handler = (event: unknown, value?: unknown) => Promise<unknown> | unknown;
type InvokeRaw = (channel: string, value?: unknown) => Promise<unknown>;
type AfterInvoke = (context: Readonly<{
	channel: string;
	value: unknown;
	result: unknown;
	invokeRaw: InvokeRaw;
}>) => Promise<unknown> | unknown;

async function realRendererFixture(
	context: TestContext,
	afterInvoke: AfterInvoke,
	seedAttached = false,
): Promise<Readonly<{
	renderer: FramescaperDesktopProjectLibraryV10Renderer;
	main: FramescaperDesktopProjectLibraryV10Main;
}>> {
	const appDataPath = await mkdtemp(join(tmpdir(), 'soundscaper-v10-renderer-recovery-'));
	context.after(() => rm(appDataPath, { force: true, recursive: true }));
	const main = await FramescaperDesktopProjectLibraryV10Main.start({
		appDataPath,
		owner: OWNER,
		handshake: createFramescaperDesktopProjectLibraryV10Handshake(),
	});
	context.after(() => main.close());
	if (seedAttached) {
		const seed = main.openSession(createFramescaperDesktopProjectLibraryV10Handshake());
		await uploadV10MainPublication(seed);
		await seed.close();
	}
	const handlers = new Map<string, Handler>();
	const registration = registerFramescaperDesktopProjectLibraryV10MainIpc({
		handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
		removeHandler: (channel: string) => { handlers.delete(channel); },
		ownerFor: (event: object) => event,
		main,
	});
	context.after(() => registration.dispose());
	const event = {};
	const invokeRaw: InvokeRaw = async (channel, value) => {
		const handler = handlers.get(channel);
		if (!handler) throw new Error(`Missing V10 IPC handler: ${channel}`);
		return handler(event, value);
	};
	const bridge = createFramescaperDesktopProjectLibraryV10MainPreloadBridge({
		invoke: async (channel: string, value?: unknown) => afterInvoke({
			channel,
			value,
			result: await invokeRaw(channel, value),
			invokeRaw,
		}),
	});
	installBridge(context, bridge);
	const archiveFixture = await createFramescaperV18ArchiveFixture(context);
	const archive = new FramescaperScapeArchiveV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		store: archiveFixture.store,
		port: archiveFixture.port,
		opfs: archiveFixture.opfs,
	});
	const renderer = await connectFramescaperDesktopProjectLibraryV10Renderer(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ store: archiveFixture.store, archive },
	);
	assert.ok(renderer);
	return { renderer, main };
}

async function waitForRevision(invoke: InvokeRaw, projectId: string, revision: number): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const result = await invoke(
			FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.readProjectBundle,
			projectId,
		) as Readonly<{ project?: Readonly<{ projectRevision?: unknown }> }> | null;
		if (result?.project?.projectRevision === revision) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	throw new Error('The real V10 main did not publish the expected revision.');
}

function revise(project: FramescaperProjectV18, revision: number, title: string): FramescaperProjectV18 {
	return { ...structuredClone(project), revision, title };
}

function installBridge(context: TestContext, api: unknown): void {
	const name = 'framescaperProjectLibraryDesktop';
	const prior = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, {
		configurable: true,
		enumerable: true,
		writable: false,
		value: Object.freeze({ v10: api }),
	});
	context.after(() => {
		if (prior) Object.defineProperty(globalThis, name, prior);
		else Reflect.deleteProperty(globalThis, name);
	});
}
