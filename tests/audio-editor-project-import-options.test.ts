/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	linkedOriginalLocatorReferenceFromImportOptions,
	normalizeProjectImportOptions,
	normalizeProjectImportOptionsForUse,
} from '../src/common/editor/controller/project-import-options.ts';

const LOCATOR_ID = 'locator_0000000000000001';
const LOCATOR_REVISION = 'revision_0000000000000001';

test('project import options normalize one exact kind-aware linked original', () => {
	const audio = normalizeProjectImportOptions({
		linkedAudioLocatorId: LOCATOR_ID,
		linkedAudioLocatorRevision: LOCATOR_REVISION,
	}, 'Frames must be finite.');
	assert.deepEqual(audio, {
		destination: 'timeline',
		trackId: null,
		timelineStartFrame: 0,
		linkedAudioLocatorId: LOCATOR_ID,
		linkedAudioLocatorRevision: LOCATOR_REVISION,
	});
	assert.deepEqual(linkedOriginalLocatorReferenceFromImportOptions(audio), {
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	});

	const video = normalizeProjectImportOptions({
		linkedVideoLocatorId: LOCATOR_ID,
		linkedVideoLocatorRevision: LOCATOR_REVISION,
	}, 'Frames must be finite.');
	assert.deepEqual(linkedOriginalLocatorReferenceFromImportOptions(video), {
		kind: 'video', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	});
});

test('project import options reject mixed audio and video locator authority', () => {
	assert.throws(() => normalizeProjectImportOptions({
		linkedAudioLocatorId: LOCATOR_ID,
		linkedAudioLocatorRevision: LOCATOR_REVISION,
		linkedVideoLocatorId: 'locator_0000000000000002',
		linkedVideoLocatorRevision: 'revision_0000000000000002',
	}, 'Frames must be finite.'), /one linked original|audio.*video|video.*audio/iu);
});

test('mixed locator refusal releases both exact kindful capabilities', async () => {
	const released: unknown[] = [];
	await assert.rejects(normalizeProjectImportOptionsForUse({
		linkedAudioLocatorId: LOCATOR_ID,
		linkedAudioLocatorRevision: LOCATOR_REVISION,
		linkedVideoLocatorId: 'locator_0000000000000002',
		linkedVideoLocatorRevision: 'revision_0000000000000002',
	}, 'Frames must be finite.', (reference) => {
		released.push(reference);
	}), /one linked original|audio.*video|video.*audio/iu);
	assert.deepEqual(released, [{
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	}, {
		kind: 'video',
		locatorId: 'locator_0000000000000002',
		locatorRevision: 'revision_0000000000000002',
	}]);
});

test('failed option validation releases the exact kindful linked locator', async () => {
	const released: unknown[] = [];
	await assert.rejects(normalizeProjectImportOptionsForUse({
		destination: 'invalid',
		linkedAudioLocatorId: LOCATOR_ID,
		linkedAudioLocatorRevision: LOCATOR_REVISION,
	}, 'Frames must be finite.', (reference) => {
		released.push(reference);
	}), /Unsupported audio import destination/u);
	assert.deepEqual(released, [{
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	}]);
});

test('caller-forged normalized markers cannot bypass import option validation', async () => {
	const forged = { destination: 'library', timelineStartFrame: Number.POSITIVE_INFINITY };
	Object.defineProperty(forged, 'timelineStartExplicit', {
		enumerable: false,
		value: true,
	});

	await assert.rejects(
		normalizeProjectImportOptionsForUse(forged, 'Frames must be finite.', () => undefined),
		/Unsupported audio import destination/u,
	);
	const forgedFrame = { destination: 'timeline', timelineStartFrame: Number.POSITIVE_INFINITY };
	Object.defineProperty(forgedFrame, 'timelineStartExplicit', {
		enumerable: false,
		value: true,
	});
	await assert.rejects(
		normalizeProjectImportOptionsForUse(forgedFrame, 'Frames must be finite.', () => undefined),
		/Frames must be finite/u,
	);
});
