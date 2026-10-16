/* SPDX-License-Identifier: AGPL-3.0-only */

export async function installInitialVideoFrameLoader(page) {
	await page.addInitScript(() => {
		globalThis.__loadInitiallyPresentedVideo = async (video, source) => {
			const loaded = new Promise((resolve, reject) => {
				video.addEventListener('loadeddata', resolve, { once: true });
				video.addEventListener('error', () => reject(video.error), { once: true });
			});
			const initiallyPresented = new Promise((resolve, reject) => {
				let deadline = null;
				const id = video.requestVideoFrameCallback(() => {
					clearTimeout(deadline);
					video.removeEventListener('loadeddata', startDeadline);
					resolve();
				});
				const startDeadline = () => {
					deadline = setTimeout(() => {
						video.cancelVideoFrameCallback(id);
						reject(new Error('The initial native video frame was not presented.'));
					}, 2_000);
				};
				video.addEventListener('loadeddata', startDeadline, { once: true });
			});
			video.src = source;
			await Promise.all([loaded, initiallyPresented]);
		};
	});
}
