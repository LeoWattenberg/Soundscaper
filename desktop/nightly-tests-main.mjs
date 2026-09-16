/* SPDX-License-Identifier: AGPL-3.0-only */

// Keep the entry point free of payload imports: even an absent or unloadable
// runner module must leave a log and an acknowledged error, not a disappearing
// Electron exception window inside the portable launcher's temporary directory.
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import * as electron from 'electron/main';

const { app, dialog } = electron;
if (process.argv.includes('--soundscaper-nightly-assistance-host')) {
	// Dynamic imports do not delay Electron readiness. Register this exact
	// host-only scheme synchronously, before loading the assistance host.
	electron.protocol.registerSchemesAsPrivileged([{
		scheme: 'soundscaper-nightly-assistance',
		privileges: { standard: true, secure: true },
	}]);
	void import('./nightly-tests-assistance-host.mjs')
		.then(({ startNightlyAssistanceHost }) => startNightlyAssistanceHost(electron))
		.catch((error) => { console.error(error); app.exit(2); });
} else {
	// Register synchronously: dynamic payload imports can finish after readiness.
	electron.protocol.registerSchemesAsPrivileged([{
		scheme: 'soundscaper-nightly-progress',
		privileges: { standard: true, secure: true },
	}]);
	void startNightlyTests();
}

async function startNightlyTests() {
	const unattended = process.argv.includes('--unattended')
		|| process.env.SOUNDSCAPER_NIGHTLY_TESTS_UNATTENDED === '1';
	const startupLog = createStartupLog();
	const log = (value) => {
		if (!startupLog) return;
		try { appendFileSync(startupLog, `${new Date().toISOString()} ${value}\n`); }
		catch (_error) { /* Logging failure must not suppress the native error dialog. */ }
	};
	let progress = null;
	let progressWindow = null;
	let latestProgress = { completed: 0, total: 4, label: 'Application launched' };
	let reportingFailure = false;
	const updateWindow = (operation) => {
		try { operation(progressWindow); }
		catch (error) { log(`Progress window failed: ${errorDetails(error)}`); }
	};
	const reportProgress = (value) => {
		if (reportingFailure) return;
		latestProgress = value;
		log(value.label);
		progress?.update(value);
		updateWindow((window) => window?.update(value));
	};
	const showMessage = (options) => progressWindow && !progressWindow.window.isDestroyed()
		? dialog.showMessageBox(progressWindow.window, options) : dialog.showMessageBox(options);
	const writeSummary = (summary) => {
		try {
			process.stdout.write(`SOUNDSCAPER_NIGHTLY_TESTS_RESULT ${JSON.stringify({
				schemaVersion: 1, failure: null, ...summary,
			})}\n`);
		} catch (error) { log(`Summary stdout failed: ${errorDetails(error)}`); }
	};
	const fail = async (error) => {
		log(`Nightly tests failed: ${errorDetails(error)}`);
		if (reportingFailure) return;
		reportingFailure = true;
		const message = error instanceof Error ? error.message : String(error);
		const terminalProgress = { ...latestProgress, label: 'Tests could not complete' };
		progress?.finish(terminalProgress);
		updateWindow((window) => window?.finish(terminalProgress, 'error'));
		if (unattended) {
			writeSummary({ status: 'error', exitCode: 2, runRoot: null, failure: message });
		} else {
			const detail = `${message}\n\nStartup diagnostics:\n${startupLog ?? 'Could not create a startup log.'}`;
			try {
				await app.whenReady();
				await showMessage({
					type: 'error', title: 'Soundscaper Nightly Tests',
					message: 'Nightly tests could not complete.', detail,
				});
			} catch (dialogError) {
				log(`Error dialog failed: ${errorDetails(dialogError)}`);
				try { dialog.showErrorBox('Soundscaper Nightly Tests', detail); }
				catch (fallbackError) { log(`Fallback dialog failed: ${errorDetails(fallbackError)}`); }
			}
		}
		app.exit(2);
	};
	// Destroying a failed-to-load window otherwise requests app quit before the
	// error dialog can be acknowledged. This runner owns its explicit exit.
	app.on('window-all-closed', () => undefined);
	process.on('uncaughtException', (error) => { void fail(error); });
	process.on('unhandledRejection', (error) => { void fail(error); });
	process.stdout.on('error', (error) => { log(`stdout unavailable: ${errorDetails(error)}`); });
	process.stderr.on('error', (error) => { log(`stderr unavailable: ${errorDetails(error)}`); });
	reportProgress(latestProgress);
	try {
		log(`Version ${app.getVersion()}; ${process.platform}/${process.arch}; resources ${process.resourcesPath}`);
		const { createDesktopNightlyTestsProgressBar } = await import('../scripts/lib/desktop-nightly-tests-presentation.mjs');
		progress = createDesktopNightlyTestsProgressBar({
			onError: (error) => { log(`CLI progress unavailable: ${errorDetails(error)}`); },
		});
		progress.update(latestProgress);
		await app.whenReady();
		if (reportingFailure) return;
		if (!unattended) {
			const { createDesktopNightlyTestsProgressWindow } = await import('./nightly-tests-progress-window.mjs');
			progressWindow = await createDesktopNightlyTestsProgressWindow({
				BrowserWindow: electron.BrowserWindow,
				protocol: electron.session.defaultSession.protocol,
				initialProgress: latestProgress,
				onError: (error) => { log(`Progress renderer failed: ${errorDetails(error)}`); },
			});
		}
		if (reportingFailure) return;
		reportProgress({ ...latestProgress, label: 'Loading test runner' });
		const [{ readDesktopNightlyTestsSourceRevision }, { runDesktopNightlyTests }] = await Promise.all([
			import('./nightly-tests-manifest.mjs'),
			import('../scripts/lib/desktop-nightly-tests-runtime.mjs'),
		]);
		if (reportingFailure) return;
		const applicationVersion = app.getVersion();
		const payloadRoot = resolve(process.resourcesPath, 'nightly-tests');
		const sourceRevision = await readDesktopNightlyTestsSourceRevision({ payloadRoot, applicationVersion });
		if (reportingFailure) return;
		log(`Source revision ${sourceRevision}`);
		const run = await runDesktopNightlyTests({
			executablePath: process.execPath, payloadRoot,
			product: { id: 'soundscaper-nightly-tests', name: 'Soundscaper Nightly Tests', version: applicationVersion },
			environment: process.env, platform: process.platform, arch: process.arch,
			sourceRevision, onProgress: reportProgress,
		});
		if (reportingFailure) return;
		const status = run.result?.status ?? (run.exitCode === 0 ? 'passed' : 'failed');
		const terminalProgress = {
			...latestProgress,
			completed: status === 'passed' || status === 'failed' ? latestProgress.total : latestProgress.completed,
			label: status === 'passed' ? 'Tests passed'
				: status === 'failed' ? 'Tests finished with failures'
					: status === 'interrupted' ? 'Tests interrupted' : 'Tests stopped with an error',
		};
		log(`${terminalProgress.label}; exit ${run.exitCode}; results ${run.runRoot}`);
		if (run.result?.failure) log(run.result.failure);
		progress.finish(terminalProgress);
		updateWindow((window) => window?.finish(terminalProgress, status));
		if (unattended) {
			writeSummary({ status, exitCode: run.exitCode, runRoot: run.runRoot });
		} else {
			await showMessage({
				type: run.exitCode === 0 ? 'info' : 'error',
				title: 'Soundscaper Nightly Tests',
				message: run.exitCode === 0
					? 'Browser tests, diagnostic metrics, and real model tests passed.'
					: 'Browser tests, diagnostic metrics, or real model tests did not pass.',
				detail: `${run.result?.failure ? `${run.result.failure}\n\n` : ''}`
					+ `Results:\n${run.runRoot}\n\nStartup diagnostics:\n${startupLog ?? 'Could not create a startup log.'}`,
			});
		}
		if (reportingFailure) return;
		app.exit(run.exitCode);
	} catch (error) {
		await fail(error);
	}
}

function createStartupLog() {
	const portable = process.platform === 'win32'
		? process.env.PORTABLE_EXECUTABLE_DIR ?? (process.env.PORTABLE_EXECUTABLE_FILE ? dirname(process.env.PORTABLE_EXECUTABLE_FILE) : null)
		: null;
	const executable = process.platform === 'linux' ? process.env.APPIMAGE ?? process.execPath : process.execPath;
	let outputRoot = portable ?? dirname(executable);
	if (process.platform === 'darwin' && process.execPath.includes('.app/Contents/MacOS/')) {
		outputRoot = resolve(dirname(process.execPath), '../../..');
	}
	try {
		if (!isAbsolute(outputRoot)) throw new Error('Startup output directory must be absolute.');
		return join(mkdtempSync(join(outputRoot, 'soundscaper-nightly-tests-startup-')), 'startup.log');
	} catch (_error) {
		try { return join(mkdtempSync(join(tmpdir(), 'soundscaper-nightly-tests-startup-')), 'startup.log'); }
		catch (_fallbackError) { return null; }
	}
}

function errorDetails(error) {
	return error instanceof Error ? error.stack ?? error.message : String(error);
}
