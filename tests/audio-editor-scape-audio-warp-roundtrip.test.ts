/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
import { evaluateProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { PRODUCT_PROFILES } from '../src/common/products.js';
import { readPcm, writePcm } from './helpers/desktop-project-library-fallback-handoff-fixture.ts';
import {
	createAudioWarpProjectFixture,
	WARP_MAP,
	WARP_SOURCE_ID,
} from './helpers/audio-warp-cross-product-fixture.ts';

interface ScapeImportResult {
	readonly project: AudioEditorProjectCurrent;
	readonly readOnly: boolean;
	readonly collision: 'copy' | 'replace' | null;
}

test('Scape collision copy remaps warped PCM while preserving native map authority', async (context) => {
	const fixture = createAudioWarpProjectFixture();
	const sender = memoryStore(context, 'scape-warp-sender');
	const recipient = memoryStore(context, 'scape-warp-recipient');
	await writePcm(sender, fixture.source, fixture.channels);
	await recipient.saveProject(createCurrentAudioEditorProject({
		id: fixture.project.id,
		title: 'Existing warp collision owner',
		now: '2026-08-12T12:30:00.000Z',
	}));
	const collidingSource = { ...fixture.source, storageKey: fixture.source.id };
	await writePcm(recipient, collidingSource, [[-1, 1, -1, 1, -1, 1, -1, 1]]);

	const exported = await exportScapeProject(fixture.project, sender);
	const copied = await importScapeProject(exported.blob, recipient, { collision: 'copy' }) as ScapeImportResult;
	assert.equal(copied.collision, 'copy');
	assert.notEqual(copied.project.id, fixture.project.id);
	const copiedSource = copied.project.sources[0];
	const copiedClip = copied.project.clips[0];
	assert.ok(copiedSource && copiedClip?.kind === 'audio');
	assert.notEqual(copiedSource.id, WARP_SOURCE_ID);
	assert.equal(copiedClip.sourceId, copiedSource.id);
	assert.deepEqual(copiedClip.warpMap, WARP_MAP);
	assert.deepEqual(await readPcm(recipient, String(copiedSource.storageKey)), fixture.channels);
	assert.deepEqual(await readPcm(recipient, fixture.source.id), [[-1, 1, -1, 1, -1, 1, -1, 1]]);

	const reopened = await recipient.loadProject(copied.project.id);
	assert.ok(reopened);
	assert.equal(serializeScapeProjectDocument(reopened), serializeScapeProjectDocument(copied.project));
	const reopenedClip = (reopened as AudioEditorProjectCurrent).clips[0];
	assert.ok(reopenedClip?.kind === 'audio');
	assert.deepEqual(reopenedClip.warpMap, WARP_MAP);
});

test('Scape handoff keeps audio warp bypass-only in Framescaper and native on Soundscaper return', async (context) => {
	const fixture = createAudioWarpProjectFixture();
	const soundSender = memoryStore(context, 'scape-warp-sound-sender');
	const frameRecipient = memoryStore(context, 'scape-warp-frame-recipient');
	const soundReturn = memoryStore(context, 'scape-warp-sound-return');
	await writePcm(soundSender, fixture.source, fixture.channels);

	const outbound = await exportScapeProject(fixture.project, soundSender);
	const inFrames = await importScapeProject(outbound.blob, frameRecipient) as ScapeImportResult;
	assertWarpRequirement(inFrames.project, false);
	assert.deepEqual((inFrames.project.clips[0] as Record<string, unknown>).warpMap, WARP_MAP);
	assert.deepEqual(await readPcm(frameRecipient, fixture.source.id), fixture.channels);

	const returning = await exportScapeProject(inFrames.project, frameRecipient);
	const home = await importScapeProject(returning.blob, soundReturn) as ScapeImportResult;
	assert.equal(home.readOnly, false);
	assertWarpRequirement(home.project, true);
	assert.equal(serializeScapeProjectDocument(home.project), serializeScapeProjectDocument(inFrames.project));
	assert.deepEqual(await readPcm(soundReturn, fixture.source.id), fixture.channels);
});

function assertWarpRequirement(project: AudioEditorProjectCurrent, available: boolean): void {
	const requirement = project.featureRequirements.requirements.find(
		(candidate) => candidate.id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioWarp,
	);
	assert.ok(requirement);
	const capabilities = (available
		? PRODUCT_PROFILES.soundscaper.capabilities
		: PRODUCT_PROFILES.framescaper.capabilities) as Readonly<Record<string, unknown>>;
	const entries = Object.entries(PROJECT_FEATURE_CAPABILITY_IDS);
	const report = evaluateProjectFeatureRequirements(project.featureRequirements, {
		knownFeatureIds: new Set(entries.map(([, featureId]) => featureId)),
		availableFeatureIds: new Set(entries
			.filter(([key]) => capabilities[key] === true)
			.map(([, featureId]) => featureId)),
		sources: project.sources,
		clips: project.clips,
		tracks: project.tracks,
	});
	const item = report.items.find(({ requirementId }) => requirementId === requirement.id);
	assert.ok(item);
	assert.equal(item.availability, available ? 'available' : 'unavailable');
	assert.equal(item.disposition, available ? 'native' : 'bypassed');
	assert.equal(report.compatible, available);
}

function memoryStore(context: TestContext, label: string): AudioEditorProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${label}-${String(Date.now())}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}
