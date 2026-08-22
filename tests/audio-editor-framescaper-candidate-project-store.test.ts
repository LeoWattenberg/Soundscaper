/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectStoreProfile } from '../src/common/editor/storage/project-store-profile-binding.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import type { ProjectDocument } from '../src/common/editor/storage/project-repository.ts';
import {
	FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v22.ts';
import {
	FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import {
	FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import {
	FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import { createFramescaperProjectV22 } from '../src/framescaper/editor-project-v22.ts';
import { createFramescaperProjectV24 } from '../src/framescaper/editor-project-v24.ts';
import { createFramescaperProjectV25 } from '../src/framescaper/editor-project-v25.ts';
import { createFramescaperProjectV26 } from '../src/framescaper/editor-project-v26.ts';
import {
	createFramescaperProjectStoreV22,
	framescaperProjectStoreAuthorityV22,
} from '../src/framescaper/editor-project-store-v22.ts';
import {
	createFramescaperProjectStoreV24,
	framescaperProjectStoreAuthorityV24,
} from '../src/framescaper/editor-project-store-v24.ts';
import {
	createFramescaperProjectStoreV25,
	framescaperProjectStoreAuthorityV25,
} from '../src/framescaper/editor-project-store-v25.ts';
import {
	createFramescaperProjectStoreV26,
	framescaperProjectStoreAuthorityV26,
} from '../src/framescaper/editor-project-store-v26.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const CASES = [{
	version: 22,
	profile: FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
	createProject: createFramescaperProjectV22,
	createStore: createFramescaperProjectStoreV22,
	authority: framescaperProjectStoreAuthorityV22,
}, {
	version: 24,
	profile: FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
	createProject: createFramescaperProjectV24,
	createStore: createFramescaperProjectStoreV24,
	authority: framescaperProjectStoreAuthorityV24,
}, {
	version: 25,
	profile: FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
	createProject: createFramescaperProjectV25,
	createStore: createFramescaperProjectStoreV25,
	authority: framescaperProjectStoreAuthorityV25,
}, {
	version: 26,
	profile: FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE,
	createProject: createFramescaperProjectV26,
	createStore: createFramescaperProjectStoreV26,
	authority: framescaperProjectStoreAuthorityV26,
}] as const;

test('each dormant candidate store round-trips only its exact detached project generation', async () => {
	for (const candidate of CASES) {
		const store = candidate.createStore(candidate.profile, { indexedDB: null });
		assert.deepEqual(editorProjectStorageProfileNames(editorProjectStoreProfile(store)), {
			databaseName: `kw-media-framescaper-editor-v${String(candidate.version)}`,
			opfsDirectoryName: `framescaper-editor-v${String(candidate.version)}-sources`,
			opfsWorkerName: `framescaper-editor-v${String(candidate.version)}-opfs-storage`,
			projectLockPrefix: `kw-media-framescaper-editor-v${String(candidate.version)}-lock:`,
		});
		const project = candidate.createProject(candidate.profile, {
			...framescaperV20Options(), id: `candidate-v${String(candidate.version)}`,
		});
		const created = await store.projectRepository.createIfAbsent!(project);
		assert.deepEqual(created, project);
		assert.notStrictEqual(created, project);
		const loaded = await store.projectRepository.load(project.id);
		assert.deepEqual(loaded, project);
		assert.notStrictEqual(loaded, created);
	}
});

test('candidate stores reject earlier reads and preserve future rows opaquely read-only', async () => {
	for (const candidate of CASES) {
		const store = candidate.createStore(candidate.profile, { indexedDB: null });
		const authority = candidate.authority(candidate.profile, store);
		const earlier = {
			id: `earlier-v${String(candidate.version)}`, schemaVersion: candidate.version - 1,
			revision: 0, title: 'Earlier',
		};
		const future = {
			id: `future-v${String(candidate.version)}`, schemaVersion: candidate.version + 1,
			revision: 0, title: 'Future', opaque: { retained: true },
		};
		authority.port.memory.projects.set(earlier.id, structuredClone(earlier));
		await assert.rejects(
			() => store.projectRepository.load(earlier.id),
			/re-import|reimport/iu,
			`V${String(candidate.version)} earlier refusal`,
		);
		authority.port.memory.projects.delete(earlier.id);
		authority.port.memory.projects.set(future.id, structuredClone(future));
		const loaded = await store.projectRepository.load(future.id);
		assert.deepEqual(loaded, future);
		assert.notStrictEqual(loaded, future);
		await assert.rejects(
			() => store.projectRepository.save(future as ProjectDocument),
			/schema|V\d+|re-import|reimport/iu,
			`V${String(candidate.version)} future write refusal`,
		);
	}
});

test('candidate store authority is exact-generation and cannot be cross-injected', () => {
	const v22 = createFramescaperProjectStoreV22(FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, {
		indexedDB: null,
	});
	assert.throws(
		() => createFramescaperProjectStoreV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, {
			store: v22,
		}),
		/exact.*V24|product-created.*V24/iu,
	);
	assert.throws(
		() => framescaperProjectStoreAuthorityV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, v22),
		/exact.*V24|authority/iu,
	);
});
