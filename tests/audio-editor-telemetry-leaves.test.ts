/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const UI = new URL('../src/common/editor/ui/', import.meta.url);

test('toolbar playback telemetry is owned by focused leaf controls', async () => {
	const [toolbar, transport, meter, sequence] = await Promise.all([
		readFile(new URL('toolbar/EditorToolToolbar.jsx', UI), 'utf8'),
		readFile(new URL('toolbar/AudioEditorTransportControls.jsx', UI), 'utf8'),
		readFile(new URL('toolbar/AudioEditorMeterControls.jsx', UI), 'utf8'),
		readFile(new URL('toolbar/SequenceTimingControls.jsx', UI), 'utf8'),
	]);

	assert.doesNotMatch(toolbar, /useAudioEditorTelemetrySelector/u);
	assert.match(toolbar, /<TelemetryPlayTransportControl/u);
	assert.match(toolbar, /<TelemetryTimeCode/u);
	assert.match(toolbar, /<PlaybackMeterToolbarGroup/u);
	assert.doesNotMatch(toolbar, /telemetry=\{telemetry\}/u);
	assert.match(transport, /function TelemetryPlayTransportControl/u);
	assert.match(transport, /function TelemetryTimeCode/u);
	assert.match(meter, /function PlaybackMeterToolbarGroup/u);
	assert.match(sequence, /useAudioEditorTelemetrySelector/u);
});

test('track and output control panels delegate meters to telemetry leaves', async () => {
	const [trackControls, outputRows, meters] = await Promise.all([
		readFile(new URL('timeline/TrackControls.jsx', UI), 'utf8'),
		readFile(new URL('timeline/OutputTrackRows.jsx', UI), 'utf8'),
		readFile(new URL('timeline/TrackTelemetryMeters.tsx', UI), 'utf8'),
	]);
	const outputControls = outputRows.slice(outputRows.indexOf('export function OutputTrackControls'));

	assert.doesNotMatch(trackControls, /useAudioEditorTelemetrySelector/u);
	assert.doesNotMatch(outputControls, /useAudioEditorTelemetrySelector/u);
	assert.match(trackControls, /meterContent=\{<TrackTelemetryMeters/u);
	assert.match(outputControls, /meterContent=\{<OutputTelemetryMeters/u);
	assert.match(meters, /useAudioEditorTelemetrySelector/u);
	assert.match(meters, /<TrackMeter/u);
});

test('mixer channel shells delegate high-frequency meters to focused leaves', async () => {
	const [panel, meters, mixerChannel] = await Promise.all([
		readFile(new URL('workspace/AudioEditorMixerPanel.jsx', UI), 'utf8'),
		readFile(new URL('workspace/MixerTelemetryMeters.tsx', UI), 'utf8'),
		readFile(new URL('../../../../vendor/audacity-design-system/components/src/MixerChannel/MixerChannel.tsx', UI), 'utf8'),
	]);

	assert.doesNotMatch(panel, /useAudioEditorTelemetrySelector/u);
	assert.doesNotMatch(panel, /telemetry\.meters/u);
	assert.match(panel, /meterContent: <MixerTelemetryMeters/u);
	assert.match(meters, /useAudioEditorTelemetrySelector/u);
	assert.match(meters, /telemetry\.meters\?\.tracks\?\.\[targetId\]/u);
	assert.match(meters, /telemetry\.meters\?\.master/u);
	assert.match(meters, /telemetry\.meters\?\.\[`\$\{scope\}s`\]\?\.\[targetId\]/u);
	assert.match(mixerChannel, /meterContent\?: React\.ReactNode;/u);
	assert.match(mixerChannel, /meterContent !== undefined \? meterContent/u);
});
