/* SPDX-License-Identifier: AGPL-3.0-only */

import { deterministicAvMedia } from '../../tests/browser/fixtures/deterministic-av-media.js';

export function createShortSoakTone(variant) {
	return toneWav({
		name: `soak-tone-${String(variant >>> 0)}.wav`,
		frequency: 220 + (variant % 440), frameCount: 12_000, channelCount: 1,
	});
}

/** Decodes beyond the editor's 32 MiB resident-source ceiling. */
export function createStreamedSoakTone(variant) {
	return toneWav({
		name: `soak-stream-${String(variant >>> 0)}.wav`,
		frequency: 330 + (variant % 220), frameCount: 90 * 48_000, channelCount: 2,
	});
}

export async function runDecodedMediaProbe(page) {
	const fixtures = deterministicAvMedia.map(({ id, file }) => ({
		id, mimeType: file.mimeType, base64: file.buffer.toString('base64'),
	}));
	return page.evaluate(async (encodedFixtures) => {
		if (typeof AudioContext !== 'function'
			|| typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== 'function') {
			return {
				decodedMediaAvDriftMaximumMs: null,
				decodedMediaAvDriftUnavailableReason: 'Web Audio or video frame callbacks are unavailable.',
				decodedVideoDroppedFrames: null,
				decodedVideoDroppedFramesUnavailableReason: 'The decoded-media playback probe is unavailable.',
			};
		}
		let maximumDriftMs = 0;
		let droppedFrames = 0;
		let playbackQualitySupported = true;
		for (const fixture of encodedFixtures) {
			const bytes = Uint8Array.from(atob(fixture.base64), (value) => value.charCodeAt(0));
			const audio = new AudioContext({ sampleRate: 48_000 });
			const decoded = await audio.decodeAudioData(bytes.buffer.slice(0));
			const video = document.createElement('video');
			const url = URL.createObjectURL(new Blob([bytes], { type: fixture.mimeType }));
			video.src = url;
			video.muted = true;
			video.playsInline = true;
			video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none';
			document.body.append(video);
			const source = audio.createBufferSource();
			const gain = audio.createGain();
			gain.gain.value = 0;
			source.buffer = decoded;
			source.connect(gain).connect(audio.destination);
			try {
				await new Promise((resolvePromise, reject) => {
					video.oncanplay = resolvePromise;
					video.onerror = () => reject(video.error ?? new Error(`Could not decode ${fixture.id}.`));
					video.load();
				});
				await audio.resume();
				await video.play();
				await observeFrames({ audio, source, video, fixtureId: fixture.id,
					onDrift: (drift) => { maximumDriftMs = Math.max(maximumDriftMs, drift); } });
				const quality = video.getVideoPlaybackQuality?.();
				if (quality && Number.isFinite(quality.droppedVideoFrames)) {
					droppedFrames += quality.droppedVideoFrames;
				} else playbackQualitySupported = false;
			} finally {
				try { source.stop(); } catch { /* The source may already have ended. */ }
				video.remove();
				URL.revokeObjectURL(url);
				await audio.close();
			}
		}
		return {
			decodedMediaAvDriftMaximumMs: maximumDriftMs,
			decodedVideoDroppedFrames: playbackQualitySupported ? droppedFrames : null,
			decodedVideoDroppedFramesUnavailableReason: playbackQualitySupported
				? null : 'Decoded-video playback quality counters are unavailable.',
		};

		function observeFrames({ audio, source, video, fixtureId, onDrift }) {
			return new Promise((resolvePromise, reject) => {
				let firstAudio = null;
				let firstVideo = null;
				let count = 0;
				const timeout = setTimeout(() => reject(new Error(`${fixtureId} timed out.`)), 10_000);
				const frame = (_now, metadata) => {
					const presentationAudio = audio.currentTime
						+ (Number(metadata.expectedDisplayTime) - performance.now()) / 1_000;
					if (firstAudio === null) {
						firstAudio = presentationAudio;
						firstVideo = Number(metadata.mediaTime);
						source.start(audio.currentTime, Math.max(0, firstVideo));
					}
					const audioMediaTime = firstVideo + presentationAudio - firstAudio;
					onDrift(Math.abs(audioMediaTime - Number(metadata.mediaTime)) * 1_000);
					count += 1;
					if (count >= 12) { clearTimeout(timeout); resolvePromise(); return; }
					video.requestVideoFrameCallback(frame);
				};
				video.requestVideoFrameCallback(frame);
			});
		}
	}, fixtures);
}

function toneWav({ name, frequency, frameCount, channelCount }) {
	const sampleRate = 48_000;
	const dataBytes = frameCount * channelCount * 2;
	const buffer = Buffer.alloc(44 + dataBytes);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataBytes, 4);
	buffer.write('WAVEfmt ', 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * channelCount * 2, 28);
	buffer.writeUInt16LE(channelCount * 2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataBytes, 40);
	for (let frame = 0; frame < frameCount; frame += 1) {
		const sample = Math.round(Math.sin(2 * Math.PI * frequency * frame / sampleRate) * 8_000);
		for (let channel = 0; channel < channelCount; channel += 1) {
			buffer.writeInt16LE(sample, 44 + ((frame * channelCount + channel) * 2));
		}
	}
	return { name, mimeType: 'audio/wav', buffer };
}
