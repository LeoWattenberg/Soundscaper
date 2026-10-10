/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createPlaybackPreviewEngines } from '../src/common/editor/controller/composition/internal/playback-preview-engines.ts';
import { createControllerResources } from '../src/common/editor/controller/composition/controller-resources.ts';

const callbacks = {
	copy: { staffPadRangeWarning: '{stageCount} stages', ffmpegLoading: 'Loading' },
	onPosition() {}, onMeter() {}, onState() {}, setStatus() {}, updateExportProgress() {},
};

for (const output of ['', 'speakers-a']) test(`controller audition resources inherit the main output ${output || 'default'}`, async () => {
	const resources = createControllerResources({}, callbacks);
	const previews = [];
	try {
		await resources.engine.setOutputDevice(output);
		for (const _kind of ['bin', 'source', 'take']) previews.push(resources.playbackPreviews.create({ onState() {} }));
		await setImmediate();
		for (const preview of previews) assert.equal(preview.getOutputDeviceState().preferredDeviceId, output,
			'the actual independent preview engine inherits the published main engine output');
	} finally {
		for (const preview of previews) await preview.dispose();
		await resources.clipTimePitchCache.dispose();
		await resources.engine.dispose();
		resources.ffmpeg.dispose(); resources.nyquistClient?.dispose();
		await resources.store.close();
	}
});

for (const rapidChoices of [false, true]) test(`audition routing waits for its latest native device and retires cleanly, rapid=${String(rapidChoices)}`, async () => {
	let releaseOutput: (() => void) | undefined;
	const firstOutput = new Promise<void>(resolve => { releaseOutput = resolve; });
	const playedOutputs: string[] = [];
	const routes: string[] = [];
	const previews = createPlaybackPreviewEngines(() => ({
		output: '', gain: 1,
		setPlaybackGain(value: number) { this.gain = value; },
		async setOutputDevice(deviceId: string) {
			routes.push(deviceId); await firstOutput; this.output = deviceId;
		},
		async play() { playedOutputs.push(this.output); },
		dispose() {},
	}), () => .25, () => 'speakers-a');
	const engine = previews.create();
	const playing = engine.play();
	await setImmediate();
	assert.equal(engine.gain, .25);
	assert.deepEqual(playedOutputs, [], 'native output allocation must finish before PCM starts');
	const changes = rapidChoices ? [previews.setOutput('speakers-b'), previews.setOutput('speakers-c')] : [];
	releaseOutput?.();
	await Promise.all([playing, ...changes]);
	assert.deepEqual(playedOutputs, [rapidChoices ? 'speakers-c' : 'speakers-a']);
	await previews.setOutput('');
	await engine.play();
	assert.deepEqual(playedOutputs, [rapidChoices ? 'speakers-c' : 'speakers-a', '']);
	const priorRoutes = [...routes];
	engine.dispose();
	await previews.setOutput('speakers-d');
	assert.deepEqual(routes, priorRoutes, 'retired contexts receive no device selection');
});
