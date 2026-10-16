/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperWebVcrCaptureAdapter } from '../src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-capture-adapter.ts';

test('the owned Web VCR preview routes its cloned monitor through the shared listening destination', async () => {
	const connections: unknown[] = [];
	const listening = { gain: { value: 0 } };
	const gain = { gain: { value: 1 }, connect(destination: unknown) { connections.push(destination); }, disconnect() {} };
	let recordedStops = 0, cloneStops = 0, released = 0;
	const clone = { kind: 'audio', stop() { cloneStops++; }, clone: () => clone };
	const audio = { kind: 'audio', stop() { recordedStops++; }, clone: () => clone };
	const video = { kind: 'video', stop() {} };
	const stream = (tracks: readonly (typeof audio | typeof video)[]) => ({
		getTracks: () => tracks, getAudioTracks: () => tracks.filter(track => track.kind === 'audio'),
		getVideoTracks: () => tracks.filter(track => track.kind === 'video'),
	});
	const dependencies = {
		sourcePort: {
			probe: async () => ({ status: 'available' as const, sourceRoles: ['display', 'system-audio'] as const }),
			enumerate: async () => ({ devices: [] }),
			openPreview: async () => ({ sources: [
				{ sourceId: 'video', role: 'display' as const, track: video, stream: stream([video]), settings: {}, capabilities: {} },
				{ sourceId: 'audio', role: 'system-audio' as const, track: audio, stream: stream([audio]), settings: {}, capabilities: {} },
			], dispose: async () => { released++; } }),
		},
		baseRecorder: () => { throw new Error('Preview does not allocate a recorder.'); },
		createStream: stream,
		getAudioContext: () => ({ destination: 'raw-speakers', state: 'running',
			createMediaStreamSource: () => ({ connect() {}, disconnect() {} }), createGain: () => gain }),
		getMonitorDestination: () => listening,
		openCrop: () => { throw new Error('Preview does not allocate a crop recorder.'); },
		authority: { prepareCapture: async () => {}, captureSurface: () => ({ width: 640, height: 360 }),
			attachMonitor: () => () => {}, reportDimensions() {}, reportFailure() {} },
	};
	const binding = createFramescaperWebVcrCaptureAdapter(dependencies);
	const lease = await binding.adapter.sourcePort.openPreview({ signal: new AbortController().signal,
		userActionGeneration: 1, roles: ['display', 'system-audio'] });
	try {
		assert.deepEqual(connections, [listening], 'Page audio must not bypass the shared device listening bus.');
		assert.equal(gain.gain.value, 1);
		binding.setMonitorMuted(true);
		assert.equal(gain.gain.value, 0);
		listening.gain.value = 1;
		assert.equal(gain.gain.value, 0, 'Restoring Playback volume cannot unmute the independent local monitor.');
		binding.setMonitorMuted(false);
		assert.equal(gain.gain.value, 1);
		assert.equal(recordedStops, 0);
	} finally { await lease.dispose(); await lease.dispose(); }
	assert.equal(cloneStops, 1);
	assert.equal(recordedStops, 0);
	assert.equal(released, 1);
});
