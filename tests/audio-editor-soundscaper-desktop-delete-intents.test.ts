/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { SoundscaperDesktopRendererBridge } from
	'../src/soundscaper/desktop-project-library-renderer-contract.ts';
import { snapshotSoundscaperDesktopProject } from
	'../src/soundscaper/desktop-project-library-renderer-contract.ts';
import {
	reconcileSoundscaperDesktopDeleteIntents,
	SoundscaperDesktopDeleteIntents,
	type SoundscaperDesktopDeleteIntent,
	type SoundscaperDesktopDeleteIntentShadowStore,
	type SoundscaperDesktopDeleteIntentStore,
} from '../src/soundscaper/desktop-project-library-delete-intents.ts';
import { SOUNDSCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/soundscaper/editor-project-runtime-profile.ts';
import { createSoundscaperProject, type SoundscaperProject } from
	'../src/soundscaper/editor-project.ts';

const PREFIX = 'soundscaper.desktop-v1.delete-intent.v1:';

test('desktop delete intent creation is put-if-absent and retains exact removal authority', async () => {
	const fixture = deletionFixture();
	const first = await fixture.intents.create(fixture.witness);
	await assert.rejects(() => fixture.intents.create(fixture.witness), /already owns/iu);

	fixture.rows.set(intentKey(fixture.project.id), {
		...first, metadataRevision: first.metadataRevision + 1,
	});
	await assert.rejects(() => fixture.intents.remove(first), /changed before cleanup/iu);
	assert.equal(fixture.rows.size, 1);
});

test('desktop delete intent listing refuses a drifted persistence key', async () => {
	const fixture = deletionFixture();
	fixture.rows.set(intentKey('another-project'), fixture.intent);
	await assert.rejects(() => fixture.intents.list(), /key drifted/iu);
});

test('desktop delete intent listing refuses duplicate project rows', async () => {
	const fixture = deletionFixture([
		{ key: intentKey('delete-project'), value: validIntent() },
		{ key: intentKey('delete-project'), value: validIntent() },
	]);
	await assert.rejects(() => fixture.intents.list(), /duplicate project/iu);
});

test('desktop delete intent listing rejects accessors without evaluating them', async () => {
	const value = { ...validIntent() } as Record<string, unknown>;
	let reads = 0;
	Object.defineProperty(value, 'projectSha256', {
		enumerable: true,
		get() { reads += 1; return 'a'.repeat(64); },
	});
	const fixture = deletionFixture([{ key: intentKey('delete-project'), value }]);

	await assert.rejects(() => fixture.intents.list(), /own enumerable data/iu);
	assert.equal(reads, 0);
});

test('desktop delete intent listing refuses sparse store rows', async () => {
	const rows = new Array<Readonly<{ key: string; value: unknown }>>(1);
	const fixture = deletionFixture(rows);
	await assert.rejects(() => fixture.intents.list(), /bounded dense array/iu);
});

test('desktop delete intent listing rejects accessor row slots without evaluating them', async () => {
	const rows = [{ key: intentKey('delete-project'), value: validIntent() }];
	let reads = 0;
	Object.defineProperty(rows, '0', {
		enumerable: true,
		get() { reads += 1; return { key: intentKey('delete-project'), value: validIntent() }; },
	});
	const fixture = deletionFixture(rows);

	await assert.rejects(() => fixture.intents.list(), /row 0 must be an own data property/iu);
	assert.equal(reads, 0);
});

test('desktop delete intent listing accepts the repository project-id projection', async () => {
	const fixture = deletionFixture([{
		key: intentKey('delete-project'), projectId: 'delete-project', value: validIntent(),
	}]);
	assert.deepEqual(await fixture.intents.list(), [validIntent()]);
});

test('desktop delete reconciliation refuses a catalogued project with no readable bundle', async () => {
	const fixture = deletionFixture();
	await fixture.intents.create(fixture.witness);
	await assert.rejects(() => reconcileSoundscaperDesktopDeleteIntents({
		profile: SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
		bridge: bridge({
			metadataRevision: fixture.intent.metadataRevision + 1,
			projects: [projectSummary(fixture.project)],
		}),
		shadow: absentShadow(null),
		intents: fixture.intents,
	}), /catalogued without a readable bundle/iu);
	assert.equal(fixture.rows.size, 1);
});

test('desktop delete reconciliation requires a newer catalog tombstone', async () => {
	const fixture = deletionFixture();
	await fixture.intents.create(fixture.witness);
	await assert.rejects(() => reconcileSoundscaperDesktopDeleteIntents({
		profile: SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
		bridge: bridge({ metadataRevision: fixture.intent.metadataRevision, projects: [] }),
		shadow: absentShadow(null),
		intents: fixture.intents,
	}), /newer authoritative catalog tombstone/iu);
	assert.equal(fixture.rows.size, 1);
});

test('desktop delete reconciliation refuses a changed shadow before exact cleanup', async () => {
	const fixture = deletionFixture();
	await fixture.intents.create(fixture.witness);
	const changed = createSoundscaperProject({
		id: fixture.project.id, title: 'Changed shadow', revision: fixture.project.revision + 1,
		now: '2026-09-30T12:01:00.000Z',
	});
	let deleteCalls = 0;
	await assert.rejects(() => reconcileSoundscaperDesktopDeleteIntents({
		profile: SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
		bridge: bridge({ metadataRevision: fixture.intent.metadataRevision + 1, projects: [] }),
		shadow: shadowStore(() => changed, () => { deleteCalls += 1; return true; }),
		intents: fixture.intents,
	}), /shadow changed before exact cleanup/iu);
	assert.equal(deleteCalls, 0);
	assert.equal(fixture.rows.size, 1);
});

test('desktop delete reconciliation requires deleteExact to confirm cleanup', async () => {
	const fixture = deletionFixture();
	await fixture.intents.create(fixture.witness);
	let deleteCalls = 0;
	await assert.rejects(() => reconcileSoundscaperDesktopDeleteIntents({
		profile: SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
		bridge: bridge({ metadataRevision: fixture.intent.metadataRevision + 1, projects: [] }),
		shadow: shadowStore(() => fixture.project, () => { deleteCalls += 1; return false; }),
		intents: fixture.intents,
	}), /shadow changed before exact cleanup/iu);
	assert.equal(deleteCalls, 1);
	assert.equal(fixture.rows.size, 1);
});

test('desktop delete reconciliation accepts undefined as an absent shadow after restart', async () => {
	const fixture = deletionFixture();
	await fixture.intents.create(fixture.witness);
	let deleteCalls = 0;
	await reconcileSoundscaperDesktopDeleteIntents({
		profile: SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
		bridge: bridge({ metadataRevision: fixture.intent.metadataRevision + 1, projects: [] }),
		shadow: shadowStore(() => undefined, () => { deleteCalls += 1; return true; }),
		intents: fixture.intents,
	});
	assert.equal(deleteCalls, 0);
	assert.equal(fixture.rows.size, 0);
});

function deletionFixture(
	listedRows?: readonly Readonly<{ key: string; projectId?: string; value: unknown }>[],
): Readonly<{
	project: SoundscaperProject;
	intent: SoundscaperDesktopDeleteIntent;
	witness: Parameters<SoundscaperDesktopDeleteIntents['create']>[0];
	rows: Map<string, unknown>;
	intents: SoundscaperDesktopDeleteIntents;
}> {
	const project = createSoundscaperProject({
		id: 'delete-project', title: 'Delete project', revision: 3,
		now: '2026-09-30T12:00:00.000Z',
	});
	const snapshot = snapshotSoundscaperDesktopProject(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE, project);
	const intent = Object.freeze({
		kind: 'soundscaper-desktop-v1-delete-intent' as const,
		version: 1 as const,
		projectId: String(project.id),
		metadataRevision: 4,
		projectRevision: Number(project.revision),
		projectSha256: snapshot.sha256,
	});
	const witness = Object.freeze({
		kind: 'current' as const,
		expectedMetadataRevision: intent.metadataRevision,
		expectedProject: Object.freeze({
			projectRevision: intent.projectRevision,
			projectSha256: intent.projectSha256,
		}),
		project,
	});
	const rows = new Map<string, unknown>();
	const store: SoundscaperDesktopDeleteIntentStore = {
		putIfAbsent(key, value) {
			if (rows.has(key)) return false;
			rows.set(key, value);
			return true;
		},
		deleteIfCurrent(key, expected) {
			if (JSON.stringify(rows.get(key)) !== JSON.stringify(expected)) return false;
			rows.delete(key);
			return true;
		},
		listByPrefix(prefix) {
			if (listedRows !== undefined) return listedRows;
			return [...rows]
				.filter(([key]) => key.startsWith(prefix))
				.map(([key, value]) => ({ key, value }));
		},
	};
	return Object.freeze({
		project, intent, witness, rows,
		intents: new SoundscaperDesktopDeleteIntents(store),
	});
}

function validIntent(): SoundscaperDesktopDeleteIntent {
	return deletionFixture().intent;
}

function intentKey(projectId: string): string {
	return `${PREFIX}${encodeURIComponent(projectId)}`;
}

function bridge(catalog: unknown): SoundscaperDesktopRendererBridge {
	return {
		readProjectBundle: async () => null,
		listProjects: async () => catalog,
	} as unknown as SoundscaperDesktopRendererBridge;
}

function projectSummary(project: SoundscaperProject) {
	return {
		schemaFamily: 'soundscaper', schemaVersion: 1,
		id: String(project.id), title: String(project.title), revision: Number(project.revision),
		updatedAt: String(project.updatedAt),
	};
}

function absentShadow(value: null | undefined): SoundscaperDesktopDeleteIntentShadowStore {
	return shadowStore(() => value, () => { throw new Error('deleteExact must not be called'); });
}

function shadowStore(
	loadProject: () => unknown,
	deleteExact: (project: unknown) => boolean,
): SoundscaperDesktopDeleteIntentShadowStore {
	return {
		loadProject,
		projectRepository: { deleteExact },
		linkedOriginalStoreService: {
			deleteProject: async (_projectId, operation) => operation(),
		},
	};
}
