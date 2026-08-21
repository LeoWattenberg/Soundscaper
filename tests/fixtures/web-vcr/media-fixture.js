/* SPDX-License-Identifier: AGPL-3.0-only */

const body = document.body;
const video = document.querySelector('#fixture-video');
const button = document.querySelector('#fixture-media-action');
const status = document.querySelector('#fixture-media-status');
const loop = body.dataset.loop === 'true';
const durationMs = Number(body.dataset.durationMs);
let objectUrl = null;
let preparing = false;
let endedCount = 0;

video.loop = loop;
video.addEventListener('ended', () => {
	location.hash = 'ended';
	endedCount += 1;
	document.documentElement.dataset.endedCount = String(endedCount);
	status.textContent = `ended:${String(endedCount)}`;
});
video.addEventListener('playing', () => {
	location.hash = 'playing';
	document.documentElement.dataset.mediaState = 'playing';
	status.textContent = loop ? 'playing:loop' : 'playing:ended';
});
video.addEventListener('pause', () => {
	if (!video.ended) document.documentElement.dataset.mediaState = 'paused';
});

button.addEventListener('mousedown', () => {
	location.hash = 'clicked';
	void activateFixtureMedia();
});

async function activateFixtureMedia() {
	if (preparing) return;
	if (objectUrl !== null) {
		await video.play();
		return;
	}
	preparing = true;
	location.hash = 'preparing';
	button.disabled = true;
	status.textContent = 'preparing';
	try {
		const blob = await generateDeterministicMedia(durationMs);
		objectUrl = URL.createObjectURL(blob);
		video.src = objectUrl;
		video.load();
		document.documentElement.dataset.mediaState = 'ready';
		location.hash = 'ready';
		status.textContent = 'ready';
		button.textContent = loop ? 'Play looping fixture' : 'Play ended fixture';
		await video.play();
	} catch (error) {
		location.hash = 'failed';
		document.documentElement.dataset.mediaState = 'failed';
		status.textContent = error instanceof Error ? error.message : 'media generation failed';
	} finally {
		preparing = false;
		button.disabled = false;
	}
}

async function generateDeterministicMedia(milliseconds) {
	const canvas = document.createElement('canvas');
	canvas.width = 640;
	canvas.height = 360;
	const context = canvas.getContext('2d', { alpha: false });
	if (!context) throw new Error('2D fixture canvas is unavailable.');
	drawFrame(context, 0);
	const canvasStream = canvas.captureStream(30);
	const audioContext = new AudioContext({ sampleRate: 48_000 });
	await audioContext.resume();
	const toneDestination = audioContext.createMediaStreamDestination();
	const oscillator = audioContext.createOscillator();
	const gain = audioContext.createGain();
	oscillator.type = 'sine';
	oscillator.frequency.value = 440;
	gain.gain.value = 0.125;
	oscillator.connect(gain);
	gain.connect(toneDestination);
	const stream = new MediaStream([
		...canvasStream.getVideoTracks(),
		...toneDestination.stream.getAudioTracks(),
	]);
	const mimeType = [
		'video/webm;codecs=vp9,opus',
		'video/webm;codecs=vp8,opus',
		'video/webm',
	].find((candidate) => MediaRecorder.isTypeSupported(candidate));
	if (!mimeType) throw new Error('No deterministic WebM recorder is available.');
	const chunks = [];
	const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000 });
	recorder.addEventListener('dataavailable', (event) => {
		if (event.data.size > 0) chunks.push(event.data);
	});
	const stopped = new Promise((resolve, reject) => {
		recorder.addEventListener('stop', resolve, { once: true });
		recorder.addEventListener('error', (event) => reject(event.error), { once: true });
	});
	recorder.start(100);
	oscillator.start();
	let frame = 1;
	const timer = setInterval(() => {
		drawFrame(context, frame);
		frame += 1;
	}, 1_000 / 30);
	try {
		await delay(milliseconds);
	} finally {
		clearInterval(timer);
		oscillator.stop();
		recorder.stop();
		await stopped;
		for (const track of stream.getTracks()) track.stop();
		await audioContext.close();
	}
	return new Blob(chunks, { type: mimeType });
}

function drawFrame(context, frame) {
	const phase = frame % 120;
	context.fillStyle = phase < 60 ? '#16324f' : '#8f2d56';
	context.fillRect(0, 0, 640, 360);
	context.fillStyle = '#f5f7fa';
	context.fillRect((frame * 7) % 560, 120, 80, 80);
	context.font = '32px monospace';
	context.fillText(`WEB VCR ${String(frame).padStart(4, '0')}`, 24, 52);
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

window.addEventListener('pagehide', () => {
	if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
}, { once: true });
