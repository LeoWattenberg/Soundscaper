/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperWebVcrCaptureAdapter } from '../src/common/editor/controller/framescaper-web-vcr-capture-adapter.ts';

test('Web VCR adapter requires the owned display and page-audio grant and monitors only a clone', async () => {
	const events: string[] = [];
	let displayVideoConstraints: unknown;
	const video = track('video', events);
	const audioClone = track('audio-clone', events);
	const audio = { ...track('audio', events), clone: () => audioClone };
	const sources = [
		{ sourceId: 'video', role: 'display' as const, track: video, stream: stream([video]), settings: {}, capabilities: {} },
		{ sourceId: 'audio', role: 'system-audio' as const, track: audio, stream: stream([audio]), settings: {}, capabilities: {} },
	];
	let detached = 0;
	const binding = createFramescaperWebVcrCaptureAdapter({
		sourcePort: {
			async probe() { return { status: 'available', sourceRoles: ['display', 'system-audio'] }; },
			async enumerate() { return { devices: [] }; },
			async openPreview(request) { displayVideoConstraints = request.displayVideoConstraints; events.push('open'); return {
				sources,
				async dispose() { events.push('source-dispose'); },
			}; },
		},
		baseRecorder: () => recorder(),
		createStream: stream,
		getAudioContext: () => ({
			destination: 'speakers',
			state: 'running',
			async resume() { events.push('resume'); },
			createMediaStreamSource: () => node(events, 'source'),
			createGain: () => ({ ...node(events, 'gain'), gain: { value: 1 } }),
		}),
		openCrop: () => ({
			track: video,
			firstFrame: Promise.resolve({ inputSize: { width: 1920, height: 1080 }, outputSize: { width: 1920, height: 1080 } }),
			async dispose() {},
		}),
		authority: {
			async prepareCapture() { events.push('grant'); },
			captureSurface: () => ({ width: 1_920, height: 1_080 }),
			attachMonitor() { events.push('attach'); return () => { detached += 1; }; },
			reportDimensions() {},
			reportFailure() {},
		},
	});
	assert.equal(binding.adapter.displaySelection?.mode, 'owned-source');
	await binding.adapter.displaySelection?.authorize({
		generation: 4, roles: ['display', 'system-audio'], sourceToken: null,
	});
	const lease = await binding.adapter.sourcePort.openPreview({
		signal: new AbortController().signal, userActionGeneration: 4,
		roles: ['display', 'system-audio'],
	});
	binding.setMonitorMuted(true);
	await lease.dispose();
	await lease.dispose();
	assert.equal(detached, 1);
	assert.equal(events.filter((value) => value === 'stop:audio-clone').length, 1);
	assert.equal(events.includes('stop:audio'), false);
	assert.deepEqual(displayVideoConstraints, {
		width: { ideal: 1_920, max: 1_920 }, height: { ideal: 1_080, max: 1_080 },
	});
	assert.deepEqual(events.slice(0, 5), ['grant', 'open', 'resume', 'source:connect', 'gain:connect']);
	assert.equal(events.at(-1), 'source-dispose');
});

test('Web VCR adapter rejects a grant or preview without both owned roles', async () => {
	const binding = createFramescaperWebVcrCaptureAdapter({
		sourcePort: {
			async probe() { return { status: 'available', sourceRoles: ['display'] }; },
			async enumerate() { return { devices: [] }; },
			async openPreview() { return {
				sources: [{ sourceId: 'video', role: 'display' as const, track: track('video', []), stream: stream([]), settings: {}, capabilities: {} }],
				async dispose() {},
			}; },
		},
		baseRecorder: () => recorder(),
		createStream: stream,
		getAudioContext: () => { throw new Error('not reached'); },
		openCrop: () => { throw new Error('not reached'); },
		authority: {
			async prepareCapture() {}, captureSurface: () => ({ width: 1_280, height: 720 }),
			attachMonitor: () => () => undefined,
			reportDimensions() {}, reportFailure() {},
		},
	});
	await assert.rejects(() => Promise.resolve(binding.adapter.displaySelection?.authorize({
		generation: 1, roles: ['display'], sourceToken: null,
	})), /display and page audio/iu);
	await binding.adapter.displaySelection?.authorize({
		generation: 2, roles: ['display', 'system-audio'], sourceToken: null,
	});
	await assert.rejects(() => binding.adapter.sourcePort.openPreview({
		signal: new AbortController().signal, userActionGeneration: 2,
		roles: ['display', 'system-audio'],
	}), /page-audio/iu);
});

test('Web VCR adapter releases a staged monitor when authority attachment fails', async () => {
	const events: string[] = [];
	const video = track('video', events);
	const audioClone = track('audio-clone', events);
	const audio = { ...track('audio', events), clone: () => audioClone };
	const binding = createFramescaperWebVcrCaptureAdapter({
		sourcePort: {
			async probe() { return { status: 'available', sourceRoles: ['display', 'system-audio'] }; },
			async enumerate() { return { devices: [] }; },
			async openPreview() { return {
				sources: [
					{ sourceId: 'video', role: 'display' as const, track: video, stream: stream([video]), settings: {}, capabilities: {} },
					{ sourceId: 'audio', role: 'system-audio' as const, track: audio, stream: stream([audio]), settings: {}, capabilities: {} },
				],
				async dispose() { events.push('source-dispose'); throw new Error('lease cleanup failed'); },
			}; },
		},
		baseRecorder: () => recorder(),
		createStream: stream,
		getAudioContext: () => ({
			destination: 'speakers', state: 'running',
			createMediaStreamSource: () => node(events, 'source'),
			createGain: () => ({ ...node(events, 'gain'), gain: { value: 1 } }),
		}),
		openCrop: () => { throw new Error('not reached'); },
		authority: {
			async prepareCapture() {},
			captureSurface: () => ({ width: 1_280, height: 720 }),
			attachMonitor() { events.push('attach'); throw new Error('attach failed'); },
			reportDimensions() {}, reportFailure() {},
		},
	});

	await assert.rejects(() => binding.adapter.sourcePort.openPreview({
		signal: new AbortController().signal, userActionGeneration: 1,
		roles: ['display', 'system-audio'],
	}), /attach failed/iu);
	assert.equal(events.filter((value) => value === 'stop:audio-clone').length, 1);
	assert.equal(events.includes('stop:audio'), false);
	assert.equal(events.filter((value) => value === 'source:disconnect').length, 1);
	assert.equal(events.filter((value) => value === 'gain:disconnect').length, 1);
	assert.equal(events.filter((value) => value === 'source-dispose').length, 1);
});

test('Web VCR preview disposal aggregates detach failure without skipping owned cleanup', async () => {
	const events: string[] = [];
	const video = track('video', events);
	const audioClone = track('audio-clone', events);
	const audio = { ...track('audio', events), clone: () => audioClone };
	const binding = createFramescaperWebVcrCaptureAdapter({
		sourcePort: {
			async probe() { return { status: 'available', sourceRoles: ['display', 'system-audio'] }; },
			async enumerate() { return { devices: [] }; },
			async openPreview() { return {
				sources: [
					{ sourceId: 'video', role: 'display' as const, track: video, stream: stream([video]), settings: {}, capabilities: {} },
					{ sourceId: 'audio', role: 'system-audio' as const, track: audio, stream: stream([audio]), settings: {}, capabilities: {} },
				],
				async dispose() { events.push('source-dispose'); },
			}; },
		},
		baseRecorder: () => recorder(), createStream: stream,
		getAudioContext: () => ({
			destination: 'speakers', state: 'running',
			createMediaStreamSource: () => node(events, 'source'),
			createGain: () => ({ ...node(events, 'gain'), gain: { value: 1 } }),
		}),
		openCrop: () => { throw new Error('not reached'); },
		authority: {
			async prepareCapture() {},
			captureSurface: () => ({ width: 1_280, height: 720 }),
			attachMonitor() { return () => { events.push('detach'); throw new Error('detach failed'); }; },
			reportDimensions() {}, reportFailure() {},
		},
	});
	const lease = await binding.adapter.sourcePort.openPreview({
		signal: new AbortController().signal, userActionGeneration: 1,
		roles: ['display', 'system-audio'],
	});

	await assert.rejects(() => lease.dispose(), /did not dispose cleanly/iu);
	assert.equal(events.filter((value) => value === 'detach').length, 1);
	assert.equal(events.filter((value) => value === 'stop:audio-clone').length, 1);
	assert.equal(events.filter((value) => value === 'source-dispose').length, 1);
});

function track(kind: string, events: string[]) {
	return { kind, stop() { events.push(`stop:${kind}`); } };
}

function stream(tracks: readonly ReturnType<typeof track>[]) {
	return {
		getTracks: () => tracks,
		getVideoTracks: () => tracks.filter(({ kind }) => kind === 'video'),
		getAudioTracks: () => tracks.filter(({ kind }) => kind.includes('audio')),
	};
}

function node(events: string[], name: string) {
	return {
		connect() { events.push(`${name}:connect`); },
		disconnect() { events.push(`${name}:disconnect`); },
	};
}

function recorder() {
	return {
		format: { kind: 'encoded-media' as const, mimeType: 'video/webm' },
		start() {}, pause: () => true, resume: () => true, stop() {}, dispose() {},
	};
}
