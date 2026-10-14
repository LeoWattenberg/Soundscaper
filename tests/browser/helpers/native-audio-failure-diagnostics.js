/* SPDX-License-Identifier: AGPL-3.0-only */

const OBJECT_GROUP = 'scape-native-audio-failure';

// Heap inspection runs only after failure. It observes the native instances
// without wrapping constructors, retaining contexts, or altering their sinks.
export async function sampleNativeAudioFailure(page, browserName, pause = sampleInterval) {
	if (browserName !== 'chromium') return { available: false, reason: 'Native heap inspection requires Chromium CDP.' };
	let session;
	try {
		session = await page.context().newCDPSession(page);
		const { result: prototype } = await session.send('Runtime.evaluate', {
			expression: 'globalThis.AudioContext?.prototype', objectGroup: OBJECT_GROUP,
		});
		if (!prototype.objectId) return { available: false, reason: 'No native AudioContext prototype.' };
		const { objects } = await session.send('Runtime.queryObjects', {
			prototypeObjectId: prototype.objectId, objectGroup: OBJECT_GROUP,
		});
		const samples = [];
		for (let index = 0; index < 2; index += 1) {
			if (index) await pause();
			const { result } = await session.send('Runtime.callFunctionOn', {
				objectId: objects.objectId, returnByValue: true,
				functionDeclaration: `function() {
					const preview = document.querySelector('[data-video-preview]');
					const root = preview || document.querySelector('[data-audio-editor]');
					const key = root && Object.keys(root).find(key => key.startsWith('__reactFiber$'));
					let fiber = key ? root[key] : null;
					let engine = null;
					while (fiber && !engine) {
						engine = fiber.memoizedProps?.controller?.engine;
						fiber = fiber.return;
					}
					return {
						at: performance.now(),
						contexts: this.map(context => ({
							state: context.state, currentTime: context.currentTime,
							sampleRate: context.sampleRate, baseLatency: context.baseLatency,
							outputLatency: context.outputLatency, sinkId: context.sinkId,
							timestamp: context.getOutputTimestamp?.(),
						})),
						transport: engine ? {
							state: engine.state, nativeTime: engine.context?.currentTime,
							positionFrame: engine.positionFrame,
							playbackStartFrame: engine.playbackStartFrame,
							playbackStartTime: engine.playbackStartTime,
							playEndFrame: engine.playEndFrame,
							playbackDurationFrames: engine.playbackDurationFrames,
							graphLatencyFrames: engine.graph?.latencyFrames,
							pendingPlayRequest: engine.pendingPlayRequest,
						} : null,
						sequence: document.querySelector('[data-sequence-timecode]')?.dataset,
						preview: preview?.dataset,
						media: [...document.querySelectorAll('video, audio')].map(element => ({
							tag: element.tagName, readyState: element.readyState,
							currentTime: element.currentTime, paused: element.paused,
							networkState: element.networkState, ended: element.ended,
							error: element.error?.message,
						})),
					};
				}`,
			});
			if (result.subtype === 'error') throw new Error(result.description);
			samples.push(result.value);
		}
		return { available: true, samples };
	} catch (error) {
		return { available: false, error: String(error) };
	} finally {
		if (session) {
			await session.send('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP }).catch(() => {});
			await session.detach().catch(() => {});
		}
	}
}

// A measured interval distinguishes a stopped native clock from a snapshot
// taken between render quanta. Passing workflows never pay for this interval.
async function sampleInterval() {
	await new Promise(resolve => setTimeout(resolve, 100));
}
