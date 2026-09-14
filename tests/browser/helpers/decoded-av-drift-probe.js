/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Measure decoded media clocks in the page. This function must remain
 * self-contained because Playwright serializes it into the renderer.
 */
export async function collectDecodedAvDriftSamples(encodedFixtures) {
	const samples = [];
	for (const fixture of encodedFixtures) {
		const binary = atob(fixture.base64);
		const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
		const context = new AudioContext({ sampleRate: 48_000 });
		const decoded = await context.decodeAudioData(bytes.buffer.slice(0));
		if (decoded.sampleRate !== 48_000 || decoded.numberOfChannels < 1 || decoded.length < 1) {
			throw new Error(`Decoded A/V probe ${fixture.id} has invalid audio geometry.`);
		}
		const video = document.createElement('video');
		const url = URL.createObjectURL(new Blob([bytes], { type: fixture.mimeType }));
		video.src = url;
		video.muted = true;
		video.playsInline = true;
		video.preload = 'auto';
		video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none';
		document.body.append(video);
		const source = context.createBufferSource();
		const silent = context.createGain();
		silent.gain.value = 0;
		source.buffer = decoded;
		source.connect(silent);
		silent.connect(context.destination);
		try {
			await new Promise((resolve, reject) => {
				video.oncanplay = resolve;
				video.onerror = () => reject(video.error ?? new Error(`Could not decode ${fixture.id}.`));
				video.load();
			});
			await context.resume();
			await video.play();
			await new Promise((resolve, reject) => {
				let originAudioSeconds = null;
				let originVideoSeconds = null;
				const timeout = setTimeout(() => reject(new Error(`Decoded A/V probe ${fixture.id} timed out.`)), 10_000);
				const frame = (_now, metadata) => {
					const outputTimestamp = context.getOutputTimestamp();
					const presentationAudioSeconds = Number(outputTimestamp.contextTime)
						+ (Number(metadata.expectedDisplayTime) - Number(outputTimestamp.performanceTime)) / 1_000;
					if (originAudioSeconds === null) {
						originAudioSeconds = presentationAudioSeconds;
						originVideoSeconds = Number(metadata.mediaTime);
						source.start(context.currentTime, Math.max(0, originVideoSeconds));
					}
					const audioMediaTimeSeconds = originVideoSeconds
						+ presentationAudioSeconds - originAudioSeconds;
					samples.push({
						fixtureId: fixture.id,
						audioMediaTimeSeconds,
						videoMediaTimeSeconds: Number(metadata.mediaTime),
						driftMs: Math.abs(audioMediaTimeSeconds - Number(metadata.mediaTime)) * 1_000,
					});
					if (samples.filter(({ fixtureId }) => fixtureId === fixture.id).length >= 12) {
						clearTimeout(timeout);
						resolve();
						return;
					}
					video.requestVideoFrameCallback(frame);
				};
				video.requestVideoFrameCallback(frame);
			});
		} finally {
			try { source.stop(); } catch { /* The source may already have ended. */ }
			video.pause();
			video.removeAttribute('src');
			video.load();
			video.remove();
			URL.revokeObjectURL(url);
			await context.close();
		}
	}
	return samples;
}
