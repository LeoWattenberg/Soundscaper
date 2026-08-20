/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createBrowserFramescaperCaptureSourcePort,
	selectFramescaperVideoMimeType,
} from '../src/common/editor/controller/framescaper-browser-capture-source.ts';

interface FakeTrack {
	readonly id: string;
	readonly kind: 'audio' | 'video';
	readonly label: string;
	readonly stops: { count: number };
	getCapabilities(): Readonly<Record<string, unknown>>;
	getSettings(): Readonly<Record<string, unknown>>;
	stop(): void;
}

function track(id: string, kind: 'audio' | 'video', settings: Readonly<Record<string, unknown>> = {}): FakeTrack {
	const stops = { count: 0 };
	return {
		id, kind, label: `${id} label`, stops,
		getCapabilities: () => ({ facingMode: kind === 'video' ? ['user'] : undefined }),
		getSettings: () => ({ deviceId: id, ...settings }),
		stop: () => { stops.count += 1; },
	};
}

function stream(tracks: readonly FakeTrack[]) {
	return {
		getTracks: () => [...tracks],
		getAudioTracks: () => tracks.filter(({ kind }) => kind === 'audio'),
		getVideoTracks: () => tracks.filter(({ kind }) => kind === 'video'),
	};
}

test('combined preview requests display first and exposes optional system audio separately', async () => {
	const calls: string[] = [];
	const displayVideo = track('display-video', 'video', { width: 1_920, height: 1_080 });
	const systemAudio = track('display-audio', 'audio', { sampleRate: 48_000, channelCount: 2 });
	const cameraVideo = track('camera-video', 'video', { width: 1_280, height: 720 });
	const microphone = track('microphone', 'audio', { sampleRate: 48_000, channelCount: 1 });
	const consumed: number[] = [];
	const port = createBrowserFramescaperCaptureSourcePort({
		mediaDevices: {
			async getDisplayMedia(constraints) {
				calls.push(`display:${String(constraints.audio)}`);
				return stream([displayVideo, systemAudio]);
			},
			async getUserMedia(constraints) {
				calls.push(`user:${Boolean(constraints.video)}:${Boolean(constraints.audio)}`);
				return stream([cameraVideo, microphone]);
			},
			async enumerateDevices() { return []; },
		},
		consumeUserAction(generation) { consumed.push(generation); return generation === 7; },
		createStream: (tracks) => stream(tracks as FakeTrack[]),
	});
	const lease = await port.openPreview({
		signal: new AbortController().signal,
		userActionGeneration: 7,
		roles: ['camera', 'microphone', 'display', 'system-audio'],
		cameraDeviceId: 'camera-choice',
		microphoneDeviceId: 'microphone-choice',
	});

	assert.deepEqual(calls, ['display:true', 'user:true:true']);
	assert.deepEqual(consumed, [7]);
	assert.deepEqual(lease.sources.map(({ role }) => role), [
		'camera', 'microphone', 'display', 'system-audio',
	]);
	assert.equal(lease.sources.every(({ stream: sourceStream }) => sourceStream.getTracks().length === 1), true);
	assert.equal(lease.sources.find(({ role }) => role === 'display')?.settings.width, 1_920);
	await lease.dispose();
	await lease.dispose();
	for (const sourceTrack of [displayVideo, systemAudio, cameraVideo, microphone]) {
		assert.equal(sourceTrack.stops.count, 1);
	}
});

test('a later camera denial releases the already granted display stream', async () => {
	const displayVideo = track('display-video', 'video');
	const refusal = new DOMException('No camera', 'NotAllowedError');
	const port = createBrowserFramescaperCaptureSourcePort({
		mediaDevices: {
			async getDisplayMedia() { return stream([displayVideo]); },
			async getUserMedia() { throw refusal; },
			async enumerateDevices() { return []; },
		},
		consumeUserAction: () => true,
		createStream: (tracks) => stream(tracks as FakeTrack[]),
	});
	await assert.rejects(port.openPreview({
		signal: new AbortController().signal,
		userActionGeneration: 1,
		roles: ['camera', 'display'],
	}), refusal);
	assert.equal(displayVideo.stops.count, 1);
});

test('preview requires a fresh controller-issued action and all required returned tracks', async () => {
	let opens = 0;
	const port = createBrowserFramescaperCaptureSourcePort({
		mediaDevices: {
			async getDisplayMedia() { opens += 1; return stream([]); },
			async getUserMedia() { opens += 1; return stream([]); },
			async enumerateDevices() { return []; },
		},
		consumeUserAction: () => false,
		createStream: (tracks) => stream(tracks as FakeTrack[]),
	});
	await assert.rejects(port.openPreview({
		signal: new AbortController().signal,
		userActionGeneration: 4,
		roles: ['camera'],
	}), /fresh direct user action/iu);
	assert.equal(opens, 0);

	const missing = createBrowserFramescaperCaptureSourcePort({
		mediaDevices: {
			async getDisplayMedia() { return stream([]); },
			async getUserMedia() { return stream([]); },
			async enumerateDevices() { return []; },
		},
		consumeUserAction: () => true,
		createStream: (tracks) => stream(tracks as FakeTrack[]),
	});
	await assert.rejects(missing.openPreview({
		signal: new AbortController().signal,
		userActionGeneration: 5,
		roles: ['microphone'],
	}), /did not return.*microphone/iu);
});

test('device inventory is permission-aware and never invents labels', async () => {
	let enumerations = 0;
	const port = createBrowserFramescaperCaptureSourcePort({
		mediaDevices: {
			async getDisplayMedia() { return stream([]); },
			async getUserMedia() { return stream([]); },
			async enumerateDevices() {
				enumerations += 1;
				return [
					{ deviceId: 'mic', groupId: 'group', kind: 'audioinput', label: 'Studio Mic' },
					{ deviceId: 'cam', groupId: 'group', kind: 'videoinput', label: 'Camera' },
					{ deviceId: 'speaker', groupId: 'group', kind: 'audiooutput', label: 'Speaker' },
				];
			},
		},
		consumeUserAction: () => true,
		createStream: (tracks) => stream(tracks as FakeTrack[]),
	});
	assert.deepEqual(await port.enumerate({
		signal: new AbortController().signal,
		permissionGranted: false,
	}), { devices: [] });
	assert.equal(enumerations, 0);
	assert.deepEqual(await port.enumerate({
		signal: new AbortController().signal,
		permissionGranted: true,
	}), {
		devices: [
			{ id: 'mic', kind: 'microphone', label: 'Studio Mic' },
			{ id: 'cam', kind: 'camera', label: 'Camera' },
		],
	});
});

test('video MIME selection is capability based and preserves the recorder default', () => {
	assert.equal(selectFramescaperVideoMimeType({
		isTypeSupported: (mimeType: string) => mimeType === 'video/webm;codecs=vp8',
	}), 'video/webm;codecs=vp8');
	assert.equal(selectFramescaperVideoMimeType({ isTypeSupported: () => false }), '');
	assert.equal(selectFramescaperVideoMimeType(null), null);
});
