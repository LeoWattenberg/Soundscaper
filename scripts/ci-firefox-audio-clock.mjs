#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { firefox } from '@playwright/test';

const browser = await firefox.launch({ headless: true });
try {
	const page = await browser.newPage();
	await page.setContent(`
		<button id="start" type="button">Start audio</button>
		<script>
			document.querySelector('#start').addEventListener('click', () => {
				globalThis.__soundscaperAudioClockProbe = (async () => {
					const context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 });
					const oscillator = context.createOscillator();
					const gain = context.createGain();
					gain.gain.value = 0;
					oscillator.connect(gain).connect(context.destination);
					oscillator.start();
					const initialTime = context.currentTime;
					const resumeResult = await Promise.race([
						context.resume().then(() => 'resumed'),
						new Promise((resolve) => setTimeout(() => resolve('timed-out'), 5_000)),
					]);
					const deadline = performance.now() + 5_000;
					while (context.currentTime - initialTime < 0.05 && performance.now() < deadline) {
						await new Promise((resolve) => setTimeout(resolve, 50));
					}
					const result = {
						advance: context.currentTime - initialTime,
						resumeResult,
						state: context.state,
					};
					oscillator.stop();
					await context.close();
					return result;
				})();
			});
		</script>
	`);
	await page.getByRole('button', { name: 'Start audio', exact: true }).click();
	const result = await withTimeout(
		page.evaluate(() => globalThis.__soundscaperAudioClockProbe),
		15_000,
		'Firefox AudioContext clock probe timed out.',
	);
	if (result.resumeResult !== 'resumed' || result.state !== 'running' || result.advance < 0.05) {
		throw new Error(
			`Firefox AudioContext clock did not advance on PulseAudio: ${JSON.stringify(result)}`,
		);
	}
	console.log(`Firefox AudioContext advanced ${result.advance.toFixed(3)} seconds on PulseAudio.`);
} finally {
	await browser.close();
}

async function withTimeout(operation, milliseconds, message) {
	let timeoutId;
	const timeout = new Promise((_resolve, reject) => {
		timeoutId = setTimeout(() => reject(new Error(message)), milliseconds);
	});
	try {
		return await Promise.race([operation, timeout]);
	} finally {
		clearTimeout(timeoutId);
	}
}
