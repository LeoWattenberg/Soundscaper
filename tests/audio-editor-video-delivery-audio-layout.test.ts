/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { applyMediaChannelMapping } from '../src/common/editor/media-export.js';
import { assertNativeMediaGraphPlan } from '../src/common/editor/native-media-graph-plan-admission.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import {
	dialogSettingsFromPreset,
	presetSettingsFromDialog,
} from '../src/common/editor/ui/export-preset-model.ts';
import {
	resolveDeliveryPresetPlanOptions,
	validateDeliveryPreset,
} from '../src/common/editor/delivery-preset.ts';

test('a delivery that states no layout stages the project channels it always staged', () => {
	assert.equal(stagedAudio(exportPlan()).channelLayout, 'preserve');
});

test('a stated layout is carried by the staged audio input, not left to an encoder', () => {
	const plan = exportPlan({ audioLayout: 'mono' });

	assert.equal(stagedAudio(plan).channelLayout, 'mono');
	// The layout must reach the file both delivery paths read, so nothing in the
	// plan asks an encoder to downmix on its own.
	assert.equal(JSON.stringify(plan).includes('-ac'), false);
});

test('an unrecognized layout is a refusal at plan build', () => {
	assert.throws(() => exportPlan({ audioLayout: '5.1' }), /audioLayout must be one of preserve, mono, stereo/u);
	assert.throws(() => exportPlan({ audioLayout: 2 }), /audioLayout must be one of/u);
});

test('the layout the plan states is the downmix the staged mix actually receives', () => {
	const left = Float32Array.from([1, 1, 1]);
	const right = Float32Array.from([-1, 0, 1]);

	assert.deepEqual(
		applyMediaChannelMapping([left, right], stagedAudio(exportPlan({ audioLayout: 'mono' })).channelLayout)
			.map((channel: Float32Array) => [...channel]),
		[[0, 0.5, 1]],
	);
	// Preserve must hand back the very channels it was given, so an untouched
	// delivery stages the bytes it always staged.
	assert.deepEqual(
		applyMediaChannelMapping([left, right], stagedAudio(exportPlan()).channelLayout)
			.map((channel: Float32Array) => [...channel]),
		[[1, 1, 1], [-1, 0, 1]],
	);
});

test('a tampered layout is refused by native admission rather than downmixed on trust', () => {
	const plan = exportPlan() as Record<string, unknown>;
	const inputs = (plan.inputs as Record<string, unknown>[]).map((input) => (
		input.kind === 'staged-audio-mix' ? { ...input, channelLayout: 'atmos' } : input
	));

	assert.throws(
		() => assertNativeMediaGraphPlan(JSON.parse(JSON.stringify({ ...plan, inputs }))),
		/unsupported channel layout/u,
	);
	assertNativeMediaGraphPlan(JSON.parse(JSON.stringify(exportPlan({ audioLayout: 'stereo' }))));
});

test('a video delivery without audio has no layout to state', () => {
	const plan = exportPlan({ includeAudio: false });

	assert.equal(plan.inputs.some((input: { kind: string }) => input.kind === 'staged-audio-mix'), false);
});

test('the layout rides a preset and the dialog request only once it leaves preserve', () => {
	const dialog = {
		mode: 'mix', range: 'project', format: 'video-mp4',
		canvasWidth: '', canvasHeight: '', canvasFit: 'contain',
		canvasFrameRate: '', canvasBackgroundColor: '',
		videoQuality: 'balanced', videoAudioLayout: 'preserve',
	};

	assert.deepEqual(presetSettingsFromDialog(dialog, 'video'), {});
	assert.equal(Object.hasOwn(createExportDialogRequest(dialog, { metadata: {} }), 'audioLayout'), false);
	assert.deepEqual(presetSettingsFromDialog({ ...dialog, videoAudioLayout: 'mono' }, 'video'), {
		audioLayout: 'mono',
	});
	assert.equal(
		createExportDialogRequest({ ...dialog, videoAudioLayout: 'mono' }, { metadata: {} }).audioLayout,
		'mono',
	);
});

test('a preset layout resolves as a top-level plan option and patches the dialog back', () => {
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'v', label: 'Mono cut', kind: 'video', format: 'mp4',
		settings: { audioLayout: 'mono' },
	});

	assert.deepEqual(resolveDeliveryPresetPlanOptions(preset), { format: 'mp4', audioLayout: 'mono' });
	assert.equal(dialogSettingsFromPreset(preset).videoAudioLayout, 'mono');
	assert.equal(
		stagedAudio(exportPlan(resolveDeliveryPresetPlanOptions(preset))).channelLayout,
		'mono',
		'a preset must reach the plan it claims to describe',
	);
});

function exportPlan(options: Readonly<Record<string, unknown>> = {}) {
	return createVideoExportPlan(project(), {
		range: { startFrame: 0, endFrame: 1_000 },
		...options,
	}) as Record<string, never> & { inputs: Record<string, unknown>[] };
}

function stagedAudio(plan: { inputs: Record<string, unknown>[] }) {
	const audio = plan.inputs.find((input) => input.kind === 'staged-audio-mix');
	assert.ok(audio, 'this delivery stages an audio mix');
	return audio;
}

function project() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video',
			id: 'source-1',
			name: 'Source',
			mimeType: 'video/mp4',
			storageKey: 'media/source-1',
			frameCount: 10_000,
			sampleRate: 1_000,
			width: 1_920,
			height: 1_080,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: 'aac',
			hasAudio: false,
			posterStorageKey: null,
			thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video',
			id: 'clip-1',
			sourceId: 'source-1',
			title: 'Clip',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 10_000,
			durationFrames: 10_000,
		}],
		tracks: [{ id: 'track-1', type: 'video', clipIds: ['clip-1'] }],
	};
}
