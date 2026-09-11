/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import * as electron from 'electron/main';

import { readDesktopNightlyTestsSourceRevision } from './nightly-tests-manifest.mjs';
import {
	formatDesktopNightlyTestsSummary,
	resolveDesktopNightlyTestsPresentation,
} from '../scripts/lib/desktop-nightly-tests-presentation.mjs';
import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import { NIGHTLY_ASSISTANCE_HOST_FLAG, startNightlyAssistanceHost } from './nightly-tests-assistance-host.mjs';

const { app, dialog } = electron;
if (process.argv.includes(NIGHTLY_ASSISTANCE_HOST_FLAG)) {
	void startNightlyAssistanceHost(electron).catch((error) => { console.error(error); app.exit(2); });
} else void startNightlyTests();

async function startNightlyTests() {
	const { unattended } = resolveDesktopNightlyTestsPresentation({
		argv: process.argv,
		environment: process.env,
	});
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
		if (unattended) {
			console.log(formatDesktopNightlyTestsSummary({
				status: run.result?.status ?? (run.exitCode === 0 ? 'passed' : 'failed'),
				exitCode: run.exitCode,
				runRoot: run.runRoot,
			}));
		} else {
			await dialog.showMessageBox({
				type: run.exitCode === 0 ? 'info' : 'error',
				title: 'Soundscaper Nightly Tests',
				message: run.exitCode === 0
					? 'Browser tests, diagnostic metrics, and real model tests passed.'
					: 'Browser tests, diagnostic metrics, or real model tests did not pass.',
				detail: `Browser, packaged-runtime, and local assistance results were written to:\n${run.runRoot}`,
			});
		}
		app.exit(run.exitCode);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('Soundscaper nightly tests failed to start:', message);
		if (unattended) {
			console.log(formatDesktopNightlyTestsSummary({
				status: 'error',
				exitCode: 2,
				runRoot: null,
				failure: message,
			}));
		} else {
			await dialog.showMessageBox({
				type: 'error',
				title: 'Soundscaper Nightly Tests',
				message: 'Playwright tests could not start.',
				detail: message,
			});
		}
		app.exit(2);
	}
}
