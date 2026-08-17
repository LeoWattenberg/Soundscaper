/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
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
		available: true, status: 'shipped', licensingRowId: null, blocker: null, fallbackPresetId: null,
	});
});

test('a preset naming a gated codec reports the real recorded status and its fallback', async () => {
	const matrix = JSON.parse(await readFile(licensingUrl, 'utf8'));
	const gated = preset({
		id: 'hevc-master',
		label: 'HEVC master',
		licensingRowId: 'codec-hevc-and-av1',
		fallbackPresetId: 'cd-master',
	});
	const availability = resolveDeliveryPresetAvailability(gated, matrix);
	assert.equal(availability.available, false, 'every codec row is blocked today');
	assert.equal(availability.status, 'blocked');
	assert.equal(availability.fallbackPresetId, 'cd-master', 'an unavailable preset degrades visibly');
	assert.ok(
		availability.blocker && availability.blocker.length > 0,
		'the recorded blocker is shown rather than a generic refusal',
	);
});

test('a preset whose licensing row does not exist is unavailable, not assumed fine', () => {
	const orphan = preset({ id: 'orphan', licensingRowId: 'codec-invented', fallbackPresetId: 'cd-master' });
	const availability = resolveDeliveryPresetAvailability(orphan, { nativeFormatPolicies: [] });
	assert.equal(availability.available, false);
	assert.equal(availability.status, 'unknown-row');
	assert.match(availability.blocker ?? '', /No licensing row codec-invented is recorded/u);
});

test('validated presets are frozen data and round-trip through JSON', () => {
	const value = preset();
	assert.ok(Object.isFrozen(value) && Object.isFrozen(value.settings));
	const roundTripped = validateDeliveryPreset(JSON.parse(JSON.stringify(value)));
	assert.deepEqual(roundTripped, value, 'presets import and export as plain data');
	assert.throws(() => resolveDeliveryPresetPlanOptions({} as never), DeliveryPresetError);
});
