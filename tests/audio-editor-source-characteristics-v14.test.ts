/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand, createAddSourceCommand } from '../src/common/editor/commands.js';
import { createProjectFeatureCompatibilityService } from '../src/common/editor/controller/project-feature-compatibility-service.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	PROJECT_FEATURE_AUDIO_CAPABILITY_IDS,
	PROJECT_FEATURE_CAPABILITY_IDS,
	PROJECT_FEATURE_VIDEO_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
import {
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { PROJECT_SCHEMA_VERSION } from '../src/common/editor/project-schema-identity.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { createUnreportedVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';
import {
	asBaselineSoundscaperProject,
	importBaselineScapeProject,
} from './helpers/baseline-scape-runtime.ts';

const NOW = '2026-08-10T09:00:00.000Z';
const RATE = { num: 30_000, den: 1_001 };
const REPORTED = Object.freeze({
	backend: 'ffmpeg',
	codedWidth: 1_920,
	codedHeight: 1_080,
	rotationDegrees: 90,
	pixelAspectRatio: { num: 1, den: 1 },
	fieldOrder: 'progressive',
	hasAlpha: false,
	videoCodec: 'h264',
	colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited' },
	audioStreams: [{ index: 1, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'eng' }],
	extractedAudioStreamIndex: 1,
	startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 2, dropFrame: true },
});

function videoSource(characteristics: unknown = REPORTED): Record<string, unknown> {
	return createVideoSource({
		id: 'video-source',
		name: 'Take 1',
		storageKey: 'video-source',
		mimeType: 'video/mp4',
		frameCount: 48_000,
		sampleRate: 48_000,
		width: 1_080,
		height: 1_920,
		frameRate: RATE,
		sourceFrameCount: 30,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: RATE },
		characteristics,
	}, 48_000);
}

function sourceProject(characteristics: unknown = REPORTED): AudioEditorProjectCurrent {
	return createCurrentAudioEditorProject({
		id: 'characteristics-project',
		title: 'Characteristics project',
		now: NOW,
		sampleRate: 48_000,
		sources: [videoSource(characteristics)],
	});
}

function currentSourceProject(characteristics: unknown = REPORTED) {
	return sourceProject(characteristics);
}

function persistedCharacteristics(project: Record<string, unknown>): Record<string, unknown> {
	const sources = project.sources as readonly Record<string, unknown>[];
	return sources[0].characteristics as Record<string, unknown>;
}

test('every video source carries a stated record even when nothing was probed', () => {
	const project = sourceProject(null);
	assert.deepEqual(persistedCharacteristics(project), createUnreportedVideoSourceCharacteristics());
	assert.equal(validateCurrentAudioEditorProject(project), true);
	assert.equal(
		project.featureRequirements.requirements.some(({ id }) => (
			id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sourceCharacteristics
		)),
		false,
		'an unreported record is not owned state',
	);
});

test('probed characteristics survive create, clone, and JSON byte-identically', () => {
	const project = sourceProject();
	assert.deepEqual(persistedCharacteristics(project), REPORTED);
	const cloned = cloneCurrentAudioEditorProject(project);
	assert.deepEqual(persistedCharacteristics(cloned), REPORTED);
	assert.equal(
		JSON.stringify(JSON.parse(JSON.stringify(project))),
		JSON.stringify(project),
		'a saved and reloaded document is byte-identical',
	);
});

test('probed characteristics survive an edit and its undo', () => {
	const history = createEditorHistory(currentSourceProject());
	const edited = executeEditorCommand(history, {
		type: 'project/rename',
		title: 'Renamed',
	});
	assert.deepEqual(persistedCharacteristics(edited.present), REPORTED);
	assert.equal(validateCurrentAudioEditorProject(edited.present), true);
	const undone = undoEditorCommand(edited);
	assert.deepEqual(persistedCharacteristics(undone.present), REPORTED);
});

test('a command-added source is canonicalized rather than persisted as given', () => {
	const project = createCurrentAudioEditorProject({ id: 'empty', title: 'Empty', now: NOW, sampleRate: 48_000 });
	const added = applyEditorCommand(project, createAddSourceCommand(videoSource({
		backend: 'ffmpeg',
		pixelAspectRatio: { num: 128, den: 90 },
	})));
	assert.deepEqual(persistedCharacteristics(added), {
		...createUnreportedVideoSourceCharacteristics(),
		backend: 'ffmpeg',
		pixelAspectRatio: { num: 64, den: 45 },
	});
	assert.equal(validateCurrentAudioEditorProject(added), true);
});

test('a non-canonical persisted record is rejected rather than repaired', () => {
	const project = sourceProject();
	const withSources = (characteristics: unknown) => ({
		...project,
		sources: (project.sources as readonly Record<string, unknown>[]).map((source) => ({
			...source,
			characteristics,
		})),
	});
	const unreported = sourceProject(null);
	assert.throws(
		() => validateCurrentAudioEditorProject({
			...unreported,
			sources: (unreported.sources as readonly Record<string, unknown>[]).map(({
				characteristics: unused,
				...source
			}) => source),
		}),
		/characteristics is required/,
	);
	assert.throws(
		() => validateCurrentAudioEditorProject(withSources({ backend: 'ffmpeg' })),
		/not in its canonical reported form/,
	);
	assert.throws(
		() => validateCurrentAudioEditorProject(withSources({ ...REPORTED, rotationDegrees: 45 })),
		/rotationDegrees is unsupported/,
	);
});

test('a reported codec must agree with the legacy codec field it duplicates', () => {
	const project = sourceProject();
	const sources = project.sources as readonly Record<string, unknown>[];
	assert.throws(
		() => validateCurrentAudioEditorProject({
			...project,
			sources: sources.map((source) => ({ ...source, videoCodec: 'prores' })),
		}),
		/videoCodec disagrees with its reported source codec/,
	);
	assert.throws(
		() => validateCurrentAudioEditorProject({
			...project,
			sources: sources.map((source) => ({ ...source, audioCodec: 'opus' })),
		}),
		/audioCodec disagrees with the audio stream it was extracted from/,
	);
});

test('an unreported codec leaves the legacy field to the importer that knew it', () => {
	const project = sourceProject({ backend: 'ffmpeg', codedWidth: 1_920, codedHeight: 1_080 });
	assert.equal(validateCurrentAudioEditorProject(project), true);
	assert.equal((project.sources as readonly Record<string, unknown>[])[0].videoCodec, 'h264');
});

test('a current .scape round trip preserves probed characteristics byte-exactly', async () => {
	const project = asBaselineSoundscaperProject(currentSourceProject());
	const sourceStore = new AudioEditorProjectStore({
		indexedDB: null,
		databaseName: 'v14-characteristics-scape-source',
	});
	const targetStore = new AudioEditorProjectStore({
		indexedDB: null,
		databaseName: 'v14-characteristics-scape-target',
	});
	await sourceStore.writeMediaAsset('video-source', new Blob(['video-bytes'], { type: 'video/mp4' }), {
		name: 'Take 1',
		mimeType: 'video/mp4',
	});
	const exported = await exportScapeProject(project, sourceStore);
	assert.equal(exported.manifest.project.schemaFamily, 'soundscaper');
	assert.equal(exported.manifest.project.schemaVersion, PROJECT_SCHEMA_VERSION);
	const imported = await importBaselineScapeProject(exported.blob, targetStore);
	assert.equal(imported.readOnly, false);
	assert.equal(JSON.stringify(imported.project), JSON.stringify(project));
	assert.deepEqual(persistedCharacteristics(imported.project), REPORTED);
	await sourceStore.close();
	await targetStore.close();
});

test('reported characteristics own one bypass-only requirement available in both products', () => {
	const project = currentSourceProject();
	assert.deepEqual(project.featureRequirements.requirements.filter(({ id }) => (
		id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sourceCharacteristics
	)), [{
		id: 'framescaper.source-characteristics',
		featureId: 'org.soundscaper.capability.source-characteristics',
		displayName: 'Probed source characteristics',
		disposition: 'bypass',
		fallback: null,
	}]);
	assert.equal(
		PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics,
		'org.soundscaper.capability.source-characteristics',
	);
	assert.equal(new Set<string>(PROJECT_FEATURE_AUDIO_CAPABILITY_IDS)
		.has(PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics), false);
	assert.equal(new Set<string>(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS)
		.has(PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics), false);
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		assert.equal(PRODUCT_PROFILES[productId].capabilities.sourceCharacteristics, true);
		const report = createProjectFeatureCompatibilityService(
			PRODUCT_PROFILES[productId].capabilities,
		).evaluate(project);
		const item = report?.items.find(({ featureId }) => (
			featureId === PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics
		));
		assert.deepEqual(item && { availability: item.availability, disposition: item.disposition }, {
			availability: 'available',
			disposition: 'native',
		});
	}
});
