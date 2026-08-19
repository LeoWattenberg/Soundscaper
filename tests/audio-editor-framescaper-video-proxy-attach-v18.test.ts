/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import {
	createFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from '../src/framescaper/editor-project-environment-v18.ts';
import { attachFramescaperVideoProxyV18 } from '../src/framescaper/editor-video-proxy-attach-v18.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import {
	ORIGINAL_SOURCE_ID,
	RATE,
	createVideoProxyFixture,
} from './helpers/video-proxy-relationship-fixtures.ts';

test('one call generates a proxy and installs it as the source attachment', async (context) => {
	const environment = await createEnvironment(context);
	const fixture = createVideoProxyFixture();
	const base = v18Base(environment, fixture.project());
	await environment.createProjectIfAbsent(base);
	const session = environment.runtime.createSessionController();
	session.openProject(base);

	const result = await attachFramescaperVideoProxyV18(
		ports(environment, session, fixture),
		{ sourceId: ORIGINAL_SOURCE_ID },
	);

	assert.equal(result.committed, true);
	const source = result.project.sources.find((candidate) => candidate.id === ORIGINAL_SOURCE_ID)!;
	const attachment = source.kind === 'video' ? source.proxyAttachment : null;
	assert.ok(attachment);
	assert.equal(attachment.sha256, await digestMediaContent(fixture.candidate()));
	// The generator ran once, over the original this source names. The observer
	// canonicalises the Blob on the way in, so the body is compared rather than
	// the reference.
	assert.equal(fixture.counters.generatorCalls, 1);
	assert.equal(fixture.seen.generatorOriginal?.size, fixture.original.size);
	session.dispose();
});

test('the encode happens before the tab is reserved, not while it is held', async (context) => {
	const environment = await createEnvironment(context);
	const fixture = createVideoProxyFixture();
	const base = v18Base(environment, fixture.project());
	await environment.createProjectIfAbsent(base);
	const session = environment.runtime.createSessionController();
	session.openProject(base);

	// While the generator is still running the session must remain editable: a
	// proxy encode is minutes of work, and the gate blocks every mutation for as
	// long as it is held. Proving the encode is outside the gate means proving an
	// ordinary edit lands while it runs.
	const gate = deferredGate();
	const slow = createVideoProxyFixture({ generatorGate: gate });
	const pending = attachFramescaperVideoProxyV18(
		ports(environment, session, slow),
		{ sourceId: ORIGINAL_SOURCE_ID },
	);
	await Promise.resolve();
	assert.doesNotThrow(() => session.updateProject(base.id, { ...base, title: 'Still editable' }));
	gate.resolve();

	// And the edit made during the encode is what the attachment lands on: the
	// source did not change, so the work was not wasted.
	const result = await pending;
	assert.equal(result.committed, true);
	assert.equal(result.project.title, 'Still editable');
	session.dispose();
});

test('a source that already carries a proxy is told to detach, not failed at the wire', async (context) => {
	const environment = await createEnvironment(context);
	const fixture = createVideoProxyFixture();
	const base = v18Base(environment, fixture.project());
	await environment.createProjectIfAbsent(base);
	const session = environment.runtime.createSessionController();
	session.openProject(base);
	const attached = await attachFramescaperVideoProxyV18(
		ports(environment, session, fixture),
		{ sourceId: ORIGINAL_SOURCE_ID },
	);

	await assert.rejects(
		attachFramescaperVideoProxyV18(
			ports(environment, session, fixture, () => attached.project),
			{ sourceId: ORIGINAL_SOURCE_ID },
		),
		/already has a proxy/u,
	);
	// And nothing was encoded for the refused second attempt.
	assert.equal(fixture.counters.generatorCalls, 1);
	session.dispose();
});

test('a source that cannot take a proxy is refused before anything runs', async (context) => {
	const environment = await createEnvironment(context);
	const fixture = createVideoProxyFixture();
	const base = v18Base(environment, fixture.project());
	await environment.createProjectIfAbsent(base);
	const session = environment.runtime.createSessionController();
	session.openProject(base);

	for (const [sourceId, message] of [
		['no-such-source', /not in the open project/u],
		['', /source ID is required/u],
	] as const) {
		await assert.rejects(
			attachFramescaperVideoProxyV18(ports(environment, session, fixture), { sourceId }),
			message,
		);
	}
	assert.equal(fixture.counters.generatorCalls, 0);

	// A build that cannot encode says so rather than failing somewhere inside.
	await assert.rejects(
		attachFramescaperVideoProxyV18(
			{ ...ports(environment, session, fixture), candidateObserver: null as never },
			{ sourceId: ORIGINAL_SOURCE_ID },
		),
		/cannot generate video proxies/u,
	);
	session.dispose();
});

function ports(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
	session: ReturnType<FramescaperEditorProjectEnvironmentV18['runtime']['createSessionController']>,
	fixture: ReturnType<typeof createVideoProxyFixture>,
	getProject?: () => unknown,
) {
	const dependencies = fixture.relationshipDependencies;
	return {
		environment,
		session,
		candidateObserver: fixture.candidateObserver,
		getProject: getProject ?? dependencies.getProject,
		captureTask: dependencies.captureTask,
		assertTaskCurrent: dependencies.assertTaskCurrent,
		observeOriginal: dependencies.observeOriginal,
		// The fixture's sources are constant-rate, so the shared resolver's answer
		// is stated here directly rather than registering an index for it.
		getTimingViews: (project: unknown) => new Map(
			((project as { sources?: readonly Record<string, unknown>[] })?.sources ?? [])
				.filter((source) => source.kind === 'video')
				.map((source) => [String(source.id), Object.freeze({
					kind: 'cfr' as const,
					rate: RATE,
					frameCount: Number(source.sourceFrameCount),
				})]),
		),
	};
}

function deferredGate() {
	let resolve!: () => void;
	const promise = new Promise<void>((pass) => { resolve = pass; });
	return { promise, resolve, reject: () => {} };
}

async function createEnvironment(
	context: TestContext,
): Promise<Readonly<FramescaperEditorProjectEnvironmentV18>> {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
			storageManager: {
				estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
				persisted: async () => true,
				persist: async () => true,
			} as unknown as StorageManager,
		},
	});
	context.after(() => environment.close());
	return environment;
}

function v18Base(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
	v17: Record<string, unknown>,
): FramescaperProjectV18 {
	return environment.runtime.createProject({
		...v17,
		sources: (v17.sources as Record<string, unknown>[]).filter((source) => source.kind === 'video'),
		takeGroups: [],
	} as never);
}
