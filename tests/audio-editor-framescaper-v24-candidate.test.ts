/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts';
import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import {
	FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import {
	createFramescaperVisualClipboardV8,
	normalizeFramescaperVisualClipboardV8,
} from '../src/framescaper/editor-session-clipboard-v8.ts';
import { createFramescaperScapeNativeRuntimeV24 } from '../src/framescaper/editor-scape-native-v24.ts';
import {
	cloneFramescaperProjectV24,
	createFramescaperProjectV24,
	loadFramescaperProjectV24,
	validateFramescaperProjectV24,
	type FramescaperProjectV24,
} from '../src/framescaper/editor-project-v24.ts';
import {
	FRAMESCAPER_V24_COMPATIBILITY_CONTRACT,
	framescaperDesktopProjectTransportV24,
} from '../src/framescaper/desktop-project-transport-v24.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE;
const DIGEST_A = 'aa'.repeat(32);
const DIGEST_B = 'bb'.repeat(32);
const DIGEST_C = 'cc'.repeat(32);
const DIGEST_D = 'dd'.repeat(32);

test('V24 candidate freezes the V14/SQLite16/v14, clipboard V8, render V10 identity', () => {
	assert.deepEqual(FRAMESCAPER_V24_COMPATIBILITY_CONTRACT, {
		projectSchemaVersion: 24,
		desktopLibrarySchemaVersion: 14,
		desktopDatabaseUserVersion: 16,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v14'],
		clipboardSchemaVersion: 8,
		renderPlanVersion: 10,
		activation: 'dormant-candidate',
	});
	const registrations = editorProjectFeatureCapabilityProfileDefinition(
		editorProjectRuntimeProfileDefinition(PROFILE).capabilityProfile,
	).registrations;
	for (const key of [
		'videoStills', 'videoGenerators', 'videoAdjustmentLayers', 'videoMasksMattes', 'videoFreeze',
	]) assert.equal(registrations.find((registration) => registration.key === key)?.available, true, key);
	assert.deepEqual(Object.keys(createFramescaperScapeNativeRuntimeV24(PROFILE)), [
		'inspectScapeProject', 'importScapeProject', 'exportScapeProject', 'copyScapeArchive',
	]);
});

test('V24 cumulatively persists still, generator, adjustment, preset, mask/matte, and freeze models', () => {
	const project = visualProject();
	assert.equal(project.schemaVersion, 24);
	assert.equal(validateFramescaperProjectV24(PROFILE, project), true);
	assert.equal(project.sources.some(({ kind }) => kind === 'still'), true);
	assert.equal(project.sources.some(({ kind }) => kind === 'generator'), true);
	assert.equal(project.clips.some(({ kind }) => kind === 'still'), true);
	assert.equal(project.videoAdjustmentLayers.length, 1);
	assert.equal(project.videoVisualPresets.length, 1);
	assert.equal(project.videoMaskMattes.length, 1);
	assert.equal(project.videoFreezeFallbacks.length, 1);
	for (const id of [
		'framescaper.video-stills',
		'framescaper.video-generators',
		'framescaper.video-adjustment-layers',
		'framescaper.video-masks-mattes',
		'framescaper.video-freeze',
	]) assert.equal(project.featureRequirements.requirements.some((requirement) => requirement.id === id), true, id);
	const clone = cloneFramescaperProjectV24(PROFILE, project);
	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone.videoMaskMattes, project.videoMaskMattes);
	assert.deepEqual(framescaperDesktopProjectTransportV24(PROFILE).decode(
		framescaperDesktopProjectTransportV24(PROFILE).encode(project),
	), project);
	const clipboard = createFramescaperVisualClipboardV8(PROFILE, project);
	assert.equal(clipboard.schemaVersion, 8);
	assert.deepEqual(normalizeFramescaperVisualClipboardV8(structuredClone(clipboard)), clipboard);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({ ...clipboard, schemaVersion: 7 }),
		/V8|recopy/iu,
	);
});

test('V24 visual ownership is exact, relationship-checked, and keeps fallback media external', () => {
	const project = visualProject();
	const missingStill = structuredClone(project) as unknown as Record<string, unknown>;
	(missingStill.sources as Record<string, unknown>[]) = (missingStill.sources as Record<string, unknown>[])
		.filter(({ id }) => id !== 'still-source');
	assert.throws(() => validateFramescaperProjectV24(PROFILE, missingStill), /still-source|missing.*source/iu);

	const inlineBytes = structuredClone(project) as unknown as Record<string, unknown>;
	(inlineBytes.videoFreezeFallbacks as Record<string, unknown>[])[0]!.bytes = new Uint8Array([1]);
	assert.throws(() => validateFramescaperProjectV24(PROFILE, inlineBytes), /unsupported|field|binary/iu);

	const danglingMask = structuredClone(project) as unknown as Record<string, unknown>;
	((danglingMask.videoMaskMattes as Array<{ inputs: Record<string, unknown>[] }>)[0]!.inputs)[0]!.sourceRef = 'missing';
	assert.throws(() => validateFramescaperProjectV24(PROFILE, danglingMask), /mask|input|missing/iu);

	const duplicateFreeze = structuredClone(project) as unknown as Record<string, unknown>;
	(duplicateFreeze.videoFreezeFallbacks as unknown[]).push(
		structuredClone((duplicateFreeze.videoFreezeFallbacks as unknown[])[0]),
	);
	assert.throws(
		() => validateFramescaperProjectV24(PROFILE, duplicateFreeze),
		/duplicate.*fallback|freeze.*duplicate/iu,
	);

	assert.throws(() => loadFramescaperProjectV24(PROFILE, projectWithVersion(project, 22)), /re-import|reimport/iu);
	assert.deepEqual(loadFramescaperProjectV24(PROFILE, { schemaVersion: 25, opaque: true }), {
		project: { schemaVersion: 25, opaque: true },
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'newer-schema',
	});
});

function visualProject(): FramescaperProjectV24 {
	const options = framescaperV20Options();
	const clips = options.clips as Record<string, unknown>[];
	const tracks = options.tracks as Record<string, unknown>[];
	clips.push(stillClip());
	(tracks[0]!.clipIds as string[]).push('still-clip');
	return createFramescaperProjectV24(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			stillSources: [stillSource()],
			generatorSources: [generatorSource()],
			adjustmentLayers: [adjustmentLayer()],
			presets: [preset()],
			maskMattes: [maskMatte()],
			freezeFallbacks: [freezeFallback()],
		},
	});
}

function stillSource() {
	return {
		schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate',
		mimeType: 'image/png', storageKey: 'still-storage', contentSha256: DIGEST_A,
		width: 1920, height: 1080, hasAlpha: true,
	};
}

function stillClip() {
	return {
		schemaVersion: 1, kind: 'still', id: 'still-clip', sourceId: 'still-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 20, sequenceFrameCount: 10,
	};
}

function generatorSource() {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Title',
		width: 1920, height: 1080, frameRate: { num: 10, den: 1 }, frameCount: 100,
		generator: {
			kind: 'title', text: 'Framescaper', fontFamily: 'soundscaper-sans',
			fontSize: 72, color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle',
		},
	};
}

function adjustmentLayer() {
	return {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment-1',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		targetTrackIds: ['video-track'], effectIds: [],
	};
}

function preset() {
	return {
		schemaVersion: 1, kind: 'video-preset', id: 'preset-1', name: 'Look',
		modelKind: 'adjustment-layer', authoredStateSha256: DIGEST_B,
	};
}

function maskMatte() {
	return {
		schemaVersion: 1, id: 'mask-1', kind: 'mask',
		inputs: [{ name: 'plate', sourceRef: 'still-source', kind: 'alpha' }],
		nodes: [{
			id: 'shape-1', kind: 'vector-shape', shape: 'rectangle',
			x: 0, y: 0, width: 1920, height: 1080,
		}],
		outputNodeId: 'shape-1',
	};
}

function freezeFallback() {
	return createVideoFreezeFallbackV1({
		renderedSourceId: 'video-source', renderedAssetSha256: '12'.repeat(32),
		authoredStateSha256: DIGEST_A, inputIdentitiesSha256: DIGEST_B,
		renderPlanFingerprintSha256: DIGEST_C, nativeEffectFingerprintSha256: DIGEST_D,
	});
}

function projectWithVersion(project: FramescaperProjectV24, schemaVersion: number) {
	return { ...structuredClone(project), schemaVersion };
}
