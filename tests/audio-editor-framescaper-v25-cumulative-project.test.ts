/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeNativeMediaImageSequenceSourceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import {
	FRAMESCAPER_V25_COMPATIBILITY_CONTRACT,
	framescaperDesktopProjectTransportV25,
} from '../src/framescaper/desktop-project-transport-v25.ts';
import {
	createFramescaperProjectV25,
	cloneFramescaperProjectV25,
	loadFramescaperProjectV25,
	normalizeFramescaperProjectProfessionalMediaV25,
	validateFramescaperProjectV25,
	type FramescaperProfessionalVideoSourceV25,
	type FramescaperProjectV25,
} from '../src/framescaper/editor-project-v25.ts';
import {
	createFramescaperProfessionalMediaArchivePlanV25,
	rebindFramescaperProfessionalMediaSourceIdentitiesV25,
} from '../src/framescaper/editor-project-v25-source-rebind.ts';
import {
	FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import { createFramescaperScapeNativeRuntimeV25 } from '../src/framescaper/editor-scape-native-v25.ts';
import {
	createFramescaperProfessionalMediaClipboardV9,
	normalizeFramescaperProfessionalMediaClipboardV9,
} from '../src/framescaper/editor-session-clipboard-v9.ts';
import { framescaperDesktopProjectTransportV26 } from '../src/framescaper/desktop-project-transport-v26.ts';
import { rebindFramescaperOpenFxSourceIdentitiesV26 } from '../src/framescaper/editor-project-v26-source-rebind.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import { createFramescaperScapeNativeRuntimeV26 } from '../src/framescaper/editor-scape-native-v26.ts';
import {
	cloneFramescaperProjectV26,
	createFramescaperProjectV26,
	validateFramescaperProjectV26,
} from '../src/framescaper/editor-project-v26.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE;
const ORIGINAL_SHA = 'aa'.repeat(32);
const INVENTORY_SHA = 'bb'.repeat(32);
const TIMING_SHA = 'cc'.repeat(32);
const PROXY_SHA = 'dd'.repeat(32);

test('V25 creates, normalizes, validates, clones, and loads cumulative professional state', () => {
	const project = projectWithProxy();
	const videoSource = project.sources[0] as FramescaperProfessionalVideoSourceV25;
	assert.equal(project.schemaVersion, 25);
	assert.equal(validateFramescaperProjectV25(PROFILE, project), true);
	assert.equal(videoSource.characteristics.bitDepth, 16);
	assert.equal(videoSource.imageSequence?.inventory.sha256, INVENTORY_SHA);
	assert.equal(videoSource.proxyAttachment?.sha256, PROXY_SHA);
	assert.ok((project.tracks as readonly Readonly<Record<string, unknown>>[])
		.some((track) => track.type === 'video' && Array.isArray(track.videoTransitions)));
	assert.deepEqual(project.videoAdjustmentLayers, []);
	assert.equal(project.featureRequirements.requirements.some(
		({ id }) => id === 'framescaper.source-characteristics',
	), true);

	const clone = cloneFramescaperProjectV25(PROFILE, project);
	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone.sources, project.sources);
	assert.notStrictEqual(clone.sources[0]?.characteristics, project.sources[0]?.characteristics);
	assert.deepEqual(loadFramescaperProjectV25(PROFILE, project), {
		project: clone,
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	});

	const repairable = structuredClone(project) as unknown as Record<string, unknown>;
	const source = (repairable.sources as Array<Record<string, unknown>>)[0]!;
	(source.characteristics as unknown as Record<string, unknown>).pixelAspectRatio = { num: 2, den: 2 };
	normalizeFramescaperProjectProfessionalMediaV25(PROFILE, repairable);
	assert.deepEqual(
		((source.characteristics as unknown as Record<string, unknown>).pixelAspectRatio),
		{ num: 1, den: 1 },
	);
	assert.equal(validateFramescaperProjectV25(PROFILE, repairable), true);
});

test('V25 rejects detached, mismatched, or noncanonical professional source state', () => {
	const project = projectWithProxy();
	const mismatchedPack = structuredClone(project) as unknown as Record<string, unknown>;
	const source = (mismatchedPack.sources as Array<Record<string, unknown>>)[0]!;
	((source.imageSequence as Record<string, unknown>).sourcePack as Record<string, unknown>).sha256 = 'ef'.repeat(32);
	assert.throws(() => validateFramescaperProjectV25(PROFILE, mismatchedPack), /source pack|digest|storage key/iu);

	const audioProfessional = structuredClone(project) as unknown as Record<string, unknown>;
	(audioProfessional.sources as Array<Record<string, unknown>>)[1]!.imageSequence = null;
	assert.throws(() => validateFramescaperProjectV25(PROFILE, audioProfessional), /audio.*imageSequence/iu);

	const missingField = structuredClone(project) as unknown as Record<string, unknown>;
	delete (missingField.sources as Array<Record<string, unknown>>)[0]!.imageSequence;
	assert.throws(() => validateFramescaperProjectV25(PROFILE, missingField), /imageSequence.*required/iu);
});

test('V25 refuses every earlier candidate and preserves future project custody opaquely', () => {
	const project = projectWithProxy();
	for (const schemaVersion of [18, 19, 20, 22, 24]) {
		assert.throws(
			() => loadFramescaperProjectV25(PROFILE, { ...project, schemaVersion }),
			/re-import|reimport/iu,
			`schema ${String(schemaVersion)}`,
		);
	}
	assert.deepEqual(loadFramescaperProjectV25(PROFILE, { schemaVersion: 26, opaque: true }), {
		project: { schemaVersion: 26, opaque: true },
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'newer-schema',
	});
});

test('clipboard V9 preserves selected characteristics, image sequence, and proxy state exactly', () => {
	const project = projectWithProxy();
	const clipboard = createFramescaperProfessionalMediaClipboardV9(
		PROFILE,
		project,
		['video-source'],
	);
	assert.equal(clipboard.schemaVersion, 9);
	assert.equal(clipboard.sources[0]?.characteristics.bitDepth, 16);
	assert.equal(clipboard.sources[0]?.imageSequence?.sourcePack.sha256, ORIGINAL_SHA);
	assert.equal(clipboard.sources[0]?.proxyAttachment?.sha256, PROXY_SHA);
	assert.deepEqual(
		normalizeFramescaperProfessionalMediaClipboardV9(structuredClone(clipboard)),
		clipboard,
	);
	assert.throws(
		() => normalizeFramescaperProfessionalMediaClipboardV9({ ...clipboard, schemaVersion: 8 }),
		/V9|re-copy|recopy/iu,
	);
});

test('Scape rebinding follows image-sequence source IDs and archive custody binds every external root', () => {
	const project = structuredClone(projectWithProxy()) as unknown as Record<string, unknown>;
	const source = (project.sources as Array<Record<string, unknown>>)[0]!;
	source.id = 'video-source-imported';
	for (const clip of project.clips as Array<Record<string, unknown>>) {
		if (clip.sourceId === 'video-source') clip.sourceId = 'video-source-imported';
	}
	rebindFramescaperProfessionalMediaSourceIdentitiesV25(project, new Map([
		['video-source', 'video-source-imported'],
	]));
	assert.equal(((source.imageSequence as Record<string, unknown>).id), 'video-source-imported');

	const plan = createFramescaperProfessionalMediaArchivePlanV25(project);
	assert.deepEqual(plan.assets.map(({ kind }) => kind), [
		'image-sequence-inventory',
		'image-sequence-source-pack',
		'video-proxy',
		'video-timing',
	]);
	assert.deepEqual(Object.keys(createFramescaperScapeNativeRuntimeV25(PROFILE)), [
		'inspectScapeProject', 'importScapeProject', 'exportScapeProject', 'copyScapeArchive',
	]);
});

test('V25 desktop transport freezes the exact V15/SQLite17/v15, clipboard V9, render V11 contract', () => {
	assert.deepEqual(FRAMESCAPER_V25_COMPATIBILITY_CONTRACT, {
		projectSchemaVersion: 25,
		desktopLibrarySchemaVersion: 15,
		desktopDatabaseUserVersion: 17,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v15'],
		clipboardSchemaVersion: 9,
		renderPlanVersion: 11,
		activation: 'dormant-candidate',
	});
	const project = projectWithProxy();
	const transport = framescaperDesktopProjectTransportV25(PROFILE);
	assert.deepEqual(transport.decode(transport.encode(project)), project);
});

test('V26 is cumulative over V25 professional state across clone, transport, and Scape rebinding', () => {
	const profile = FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE;
	const project = createFramescaperProjectV26(profile, {
		...professionalV25Options(),
		ofxEffects: [],
	});
	assert.equal(validateFramescaperProjectV26(profile, project), true);
	const source = (project as unknown as {
		readonly sources: readonly FramescaperProfessionalVideoSourceV25[];
	}).sources[0]!;
	assert.equal(source.characteristics.bitDepth, 16);
	assert.equal(source.imageSequence?.inventory.sha256, INVENTORY_SHA);
	assert.deepEqual(cloneFramescaperProjectV26(profile, project), project);
	const transport = framescaperDesktopProjectTransportV26(profile);
	assert.deepEqual(transport.decode(transport.encode(project)), project);
	assert.deepEqual(Object.keys(createFramescaperScapeNativeRuntimeV26(profile)), [
		'inspectScapeProject', 'importScapeProject', 'exportScapeProject', 'copyScapeArchive',
	]);

	const imported = structuredClone(project) as unknown as Record<string, unknown>;
	const importedSource = (imported.sources as Array<Record<string, unknown>>)[0]!;
	importedSource.id = 'video-source-imported';
	rebindFramescaperOpenFxSourceIdentitiesV26(imported, new Map([
		['video-source', 'video-source-imported'],
	]));
	assert.equal(((importedSource.imageSequence as Record<string, unknown>).id), 'video-source-imported');
});

export function professionalV25Options(): Record<string, unknown> {
	const options = framescaperV20Options();
	const source = (options.sources as Array<Record<string, unknown>>)[0]!;
	source.storageKey = `image-sequence-pack-sha256:${ORIGINAL_SHA}`;
	source.contentSha256 = ORIGINAL_SHA;
	source.characteristics = professionalCharacteristics();
	source.imageSequence = imageSequenceSource();
	return { ...options, videoTransitionsByTrackId: { 'video-track': [] } };
}

function projectWithProxy(): FramescaperProjectV25 {
	const project = createFramescaperProjectV25(PROFILE, professionalV25Options());
	const source = (project.sources as unknown as Array<Record<string, unknown>>)[0]!;
	source.proxyAttachment = proxyAttachment();
	normalizeFramescaperProjectProfessionalMediaV25(PROFILE, project as unknown as Record<string, unknown>);
	validateFramescaperProjectV25(PROFILE, project);
	return project;
}

function professionalCharacteristics() {
	return normalizeVideoSourceCharacteristicsV25({
		backend: 'framescaper-media-host',
		codedWidth: 1_920,
		codedHeight: 1_080,
		hasAlpha: true,
		bitDepth: 16,
		pixelFormat: 'rgba64le',
		chromaFormat: '4:4:4',
		alphaMode: 'straight',
		alphaInterpretation: 'transparency',
		colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'full' },
	});
}

function imageSequenceSource() {
	return normalizeNativeMediaImageSequenceSourceV25({
		kind: 'video', sourceType: 'image-sequence', version: 1,
		id: 'video-source', name: 'Video', stem: 'shot_', extension: 'png',
		frameNumberWidth: 4, firstFrameNumber: 1, lastFrameNumber: 10,
		frameCount: 10, frameRate: { num: 10, den: 1 },
		inventory: {
			kind: 'image-sequence-inventory', version: 1,
			storageKey: `image-sequence-inventory-sha256:${INVENTORY_SHA}`,
			sha256: INVENTORY_SHA, byteLength: 512, frameCount: 10,
			firstFrameNumber: 1, lastFrameNumber: 10,
		},
		sourcePack: {
			kind: 'image-sequence-source-pack',
			storageKey: `image-sequence-pack-sha256:${ORIGINAL_SHA}`,
			sha256: ORIGINAL_SHA, byteLength: 8_192,
		},
		characteristics: professionalCharacteristics(),
	});
}

function proxyAttachment() {
	return {
		kind: 'video-proxy-attachment' as const,
		version: 1 as const,
		rule: 'exact-original-generation-proxy-content-and-timing-v1' as const,
		storageKey: `video-proxy-sha256:${PROXY_SHA}`,
		mimeType: 'video/quicktime', byteLength: 4_096, sha256: PROXY_SHA,
		originalSha256: ORIGINAL_SHA, originalAuthorityKind: 'owned' as const,
		generatorId: 'framescaper-media-host', generatorVersion: 1,
		recipeId: 'framescaper-native-prores-proxy-mov-v1', recipeVersion: 1,
		timingBackendId: 'framescaper-media-host',
		timingRule: 'exact-presentation-boundaries-v1' as const,
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1' as const,
			storageKey: `video-timing-sha256:${TIMING_SHA}`, sha256: TIMING_SHA,
			sourceSha256: PROXY_SHA, byteLength: 112, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1' as const,
	};
}
