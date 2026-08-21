/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { app, dialog } from 'electron/main';

import { readDesktopNightlyTestsSourceRevision } from './nightly-tests-manifest.mjs';
import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';

void startNightlyTests();

async function startNightlyTests() {
	await app.whenReady();
	try {
		const applicationVersion = app.getVersion();
		const payloadRoot = resolve(process.resourcesPath, 'nightly-tests');
		const sourceRevision = await readDesktopNightlyTestsSourceRevision({
			payloadRoot,
			applicationVersion,
		});
		const run = await runDesktopNightlyTests({
			executablePath: process.execPath,
			payloadRoot,
			product: {
				id: 'soundscaper-nightly-tests',
				name: 'Soundscaper Nightly Tests',
				version: applicationVersion,
			},
			environment: process.env,
			platform: process.platform,
			arch: process.arch,
			sourceRevision,
		});
		await dialog.showMessageBox({
			type: run.exitCode === 0 ? 'info' : 'error',
			title: 'Soundscaper Nightly Tests',
			message: run.exitCode === 0
				? 'Playwright tests and diagnostic metric gates passed.'
				: 'Playwright tests or diagnostic metric gates did not pass.',
			detail: `Browser and packaged-runtime results were written to:\n${run.runRoot}`,
		});
		app.exit(run.exitCode);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('Soundscaper nightly tests failed to start:', message);
		await dialog.showMessageBox({
			type: 'error',
			title: 'Soundscaper Nightly Tests',
			message: 'Playwright tests could not start.',
			detail: message,
		});
		app.exit(2);
	}
}
