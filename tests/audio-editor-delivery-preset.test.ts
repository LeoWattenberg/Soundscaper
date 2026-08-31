/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import {
	DeliveryPresetError,
	resolveDeliveryPresetAvailability,
	resolveDeliveryPresetPlanOptions,
	validateDeliveryPreset,
} from '../src/common/editor/delivery-preset.ts';

const licensingUrl = new URL('../config/production-licensing-matrix.json', import.meta.url);
const RANGE = { startFrame: 0, endFrame: 48_000 };

function audioProject() {
	return {
		id: 'preset-project',
		title: 'Preset',
		sampleRate: 48_000,
		masterChannels: 2,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [],
		clips: [],
		tracks: [{
			type: 'audio', id: 'track-a', name: 'Audio', clipIds: [],
			mute: false, solo: false, hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}],
	};
}

function preset(overrides: Record<string, unknown> = {}) {
	return validateDeliveryPreset({
		schemaVersion: 1,
		id: 'cd-master',
		label: 'CD master',
		kind: 'audio',
		format: 'wav',
		settings: { sampleRate: 44_100, sampleFormat: 'int16', dither: 'triangular' },
		...overrides,
	});
}

test('unknown preset fields and settings are rejected rather than ignored', () => {
	assert.throws(() => validateDeliveryPreset({
		schemaVersion: 1, id: 'p', label: 'P', kind: 'audio', format: 'wav', loudnessTarget: -16,
	}), /Unknown delivery preset field: loudnessTarget/u);

	assert.throws(() => validateDeliveryPreset({
		schemaVersion: 1, id: 'p', label: 'P', kind: 'audio', format: 'wav',
		settings: { normalize: true },
	}), /Unknown audio delivery setting: normalize/u);

	assert.throws(() => validateDeliveryPreset({
		schemaVersion: 1, id: 'p', label: 'P', kind: 'audio', format: 'not-a-format',
	}), /unknown audio format/u);

	assert.throws(() => validateDeliveryPreset({
		schemaVersion: 2, id: 'p', label: 'P', kind: 'audio', format: 'wav',
	}), /schemaVersion 1/u);

	assert.throws(() => validateDeliveryPreset({
		schemaVersion: 1, id: 'p', label: 'P', kind: 'midi', format: 'wav',
	}), /Unsupported delivery preset kind/u);
});

test('a video preset validates against the video format table', () => {
	const video = validateDeliveryPreset({
		schemaVersion: 1, id: 'web-1080', label: 'Web 1080p', kind: 'video', format: 'mp4',
		settings: { maximumWidth: 1_920, maximumHeight: 1_080 },
	});
	assert.equal(video.format, 'mp4');
	assert.throws(() => validateDeliveryPreset({
		schemaVersion: 1, id: 'x', label: 'X', kind: 'video', format: 'wav',
	}), /unknown video format/u);
	assert.throws(() => validateDeliveryPreset({
		schemaVersion: 1, id: 'x', label: 'X', kind: 'video', format: 'mp4',
		settings: { sampleFormat: 'int24' },
	}), /Unknown video delivery setting/u);
});

test('a preset resolves to the same plan as the equivalent dialog settings', () => {
	const dialogSettings = { format: 'wav', sampleRate: 44_100, sampleFormat: 'int16', dither: 'triangular' };
	const fromDialog = createExportPlan(audioProject(), { ...dialogSettings, range: RANGE });
	const fromPreset = createExportPlan(audioProject(), {
		...resolveDeliveryPresetPlanOptions(preset()),
		range: RANGE,
	});
	assert.deepEqual(
		JSON.parse(JSON.stringify(fromPreset)),
		JSON.parse(JSON.stringify(fromDialog)),
		'the preset path and the dialog path must produce one identical plan',
	);
	assert.equal(fromPreset.sampleRate, 44_100);
	assert.equal(fromPreset.encoding.bitDepth, 16);
});

test('a preset never bypasses plan validation', () => {
	const impossible = preset({
		id: 'too-many-channels',
		format: 'mp3',
		settings: { channelMapping: { channels: Array.from({ length: 8 }, () => ({ inputs: [{ channel: 0, gain: 1 }] })) } },
	});
	assert.throws(
		() => createExportPlan(audioProject(), { ...resolveDeliveryPresetPlanOptions(impossible), range: RANGE }),
		/channel/iu,
		'the plan builder rejects what the preset asked for; the preset gets no way around it',
	);
});

test('a preset with no licensing row rides what the product already ships', () => {
	const availability = resolveDeliveryPresetAvailability(preset(), {});
	assert.deepEqual(availability, {
		available: true, status: 'implemented', licensingRowId: null,
		licensingStatus: 'not-required', licensingPending: false,
	});
});

test('a preset naming a gated codec reports licensing state without blocking execution', async () => {
	const matrix = JSON.parse(await readFile(licensingUrl, 'utf8'));
	const gated = preset({
		id: 'hevc-master',
		label: 'HEVC master',
		licensingRowId: 'codec-encode-hevc-mp4-main10-hdr10',
		fallbackPresetId: 'cd-master',
	});
	const availability = resolveDeliveryPresetAvailability(gated, matrix);
	assert.equal(availability.available, true);
	assert.equal(availability.status, 'implemented');
	assert.equal(availability.licensingStatus, 'blocked');
	assert.equal(availability.licensingPending, true);
});

test('a preset whose licensing row does not exist remains testable and flags licensing state', () => {
	const orphan = preset({ id: 'orphan', licensingRowId: 'codec-invented', fallbackPresetId: 'cd-master' });
	const availability = resolveDeliveryPresetAvailability(orphan, { nativeFormatPolicies: [] });
	assert.equal(availability.available, true);
	assert.equal(availability.status, 'implemented');
	assert.equal(availability.licensingStatus, 'unrecorded');
	assert.equal(availability.licensingPending, true);
});

test('validated presets are frozen data and round-trip through JSON', () => {
	const value = preset();
	assert.ok(Object.isFrozen(value) && Object.isFrozen(value.settings));
	const roundTripped = validateDeliveryPreset(JSON.parse(JSON.stringify(value)));
	assert.deepEqual(roundTripped, value, 'presets import and export as plain data');
	assert.throws(() => resolveDeliveryPresetPlanOptions({} as never), DeliveryPresetError);
});

test('a video preset canvas setting actually reaches the plan canvas', () => {
	const project = landscapeVideoProject();
	const hd = validateDeliveryPreset({
		schemaVersion: 1, id: 'hd', label: '1080p', kind: 'video', format: 'mp4',
		settings: { maximumWidth: 1_920, maximumHeight: 1_080 },
	});
	const plan = createVideoExportPlan(project, {
		...resolveDeliveryPresetPlanOptions(hd),
		range: { startFrame: 0, endFrame: 10_000 },
	});
	assert.deepEqual(
		{ width: plan.canvas.width, height: plan.canvas.height },
		{ width: 1_920, height: 1_080 },
		'a preset that appears applied but silently delivers 720p is the hidden behaviour this milestone exists to prevent',
	);
});

test('a vertical preset delivers its stated canvas and fit rather than a capped derivation', () => {
	const vertical = validateDeliveryPreset({
		schemaVersion: 1, id: 'social-9x16', label: 'Vertical 1080x1920', kind: 'video', format: 'mp4',
		settings: { size: { width: 1_080, height: 1_920 }, fit: 'cover' },
	});
	assert.deepEqual(resolveDeliveryPresetPlanOptions(vertical), {
		format: 'mp4',
		canvas: { size: { width: 1_080, height: 1_920 }, fit: 'cover' },
	}, 'geometry settings nest under the canvas option the plan builder actually reads');

	const plan = createVideoExportPlan(landscapeVideoProject(), {
		...resolveDeliveryPresetPlanOptions(vertical),
		range: { startFrame: 0, endFrame: 10_000 },
	});
	assert.deepEqual(
		{ width: plan.canvas.width, height: plan.canvas.height, fit: plan.canvas.fit },
		{ width: 1_080, height: 1_920, fit: 'cover' },
		'a preset that asks for a vertical master must not come back as capped 720p landscape',
	);
});

test('a video preset leaves the default ceiling alone when it asks for nothing', () => {
	const bare = validateDeliveryPreset({
		schemaVersion: 1, id: 'plain', label: 'Plain', kind: 'video', format: 'mp4',
	});
	assert.deepEqual(
		resolveDeliveryPresetPlanOptions(bare),
		{ format: 'mp4' },
		'no canvas settings means no canvas option, so existing exports stay byte-stable',
	);
});

/** One 1920x1080 clip: the landscape master a vertical delivery has to reframe. */
function landscapeVideoProject() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video', id: 's', name: 'S', mimeType: 'video/mp4', storageKey: 'm/s',
			frameCount: 20_000, sampleRate: 1_000, width: 1_920, height: 1_080, frameRate: 30,
			videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
			posterStorageKey: null, thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video', id: 'c', sourceId: 's', title: 'V', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 10_000, durationFrames: 10_000,
			trimStartFrames: 0, trimEndFrames: 0, speedRatio: 1,
			groupId: null, avLinkId: null, binItemId: null, color: 'blue',
		}],
		tracks: [{
			type: 'video', id: 't', name: 'V', clipIds: ['c'],
			mute: false, hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}],
	};
}
