/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Page stubs that remove or replace browser capabilities before a spec boots
 * the editor. They only ever touch `page.addInitScript`, which is why they sit
 * apart from the helpers that drive an editor that is already running.
 */

export async function disableNativeSavePicker(page) {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined });
	});
}

export async function disableOfflineAudio(page) {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: undefined });
		Object.defineProperty(globalThis, 'webkitOfflineAudioContext', { configurable: true, value: undefined });
	});
}

export async function stubDisplayCapture(page) {
	await page.addInitScript(() => {
		globalThis.__soundscaperDisplayCaptureRequests = 0;
		const mediaDevices = navigator.mediaDevices ?? {};
		const createTrack = (kind) => {
			const target = new EventTarget();
			let readyState = 'live';
			Object.defineProperties(target, {
				kind: { value: kind },
				readyState: { get: () => readyState },
				getSettings: { value: () => kind === 'audio' ? { channelCount: 2 } : {} },
				stop: { value: () => {
					if (readyState === 'ended') return;
					readyState = 'ended';
					target.dispatchEvent(new Event('ended'));
				} },
			});
			return target;
		};
		Object.defineProperty(mediaDevices, 'getDisplayMedia', {
			configurable: true,
			value: async () => {
				globalThis.__soundscaperDisplayCaptureRequests += 1;
				const audioTrack = createTrack('audio');
				const videoTrack = createTrack('video');
				return {
					getAudioTracks: () => [audioTrack],
					getVideoTracks: () => [videoTrack],
					getTracks: () => [audioTrack, videoTrack],
				};
			},
		});
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: mediaDevices,
		});
	});
}

export async function stubStorageEstimate(page, estimate) {
	await page.addInitScript((value) => {
		const storage = navigator.storage ?? {};
		Object.defineProperty(storage, 'estimate', {
			configurable: true,
			value: () => Promise.resolve(value),
		});
		Object.defineProperty(navigator, 'storage', {
			configurable: true,
			value: storage,
		});
	}, estimate);
}
