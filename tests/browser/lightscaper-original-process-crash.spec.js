/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { collectNativePhotoOriginalProcessCrashCoverage, installNativePhotoOriginalProcessCrashRuntime } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { captureOwnedBrowserProcessV1, killAndJoinOwnedBrowserProcessV1 } from './helpers/lightscaper-owned-browser-process.ts';

const CURRENT_SHA256 = 'fdfe0f7d2f827ae8200625a0d5f4c21ee47a2e037b6f6a22fcd36c5012e5614c';
const PRIOR_SHA256 = '6b7133bd00dcce5a18b890560894cb0524df4047c04d1d7fd9a64d2a12d2689b';
const UNROOTED_SHA256 = '5c3905ed1e0396352b4083ee09e70f4f2db50e5f1bb1a0be5f025325c1f1c357';
const HOST = '/__original_process_crash_host.html';

test('native browser crash after original flush recovers the same persistent Lightscaper profile', async ({ playwright, browserName }, testInfo) => {
	test.skip(browserName === 'webkit', 'Native OPFS recovery is maintained for Chromium and Firefox.');
	test.skip(process.platform !== 'linux', 'Native process ownership uses Linux /proc evidence.');
	test.setTimeout(90000);
	const type = playwright[browserName], executablePath = type.executablePath();
	const profilePath = testInfo.outputPath('persistent-profile');
	await mkdir(profilePath, { recursive: false });
	const origin = browserProductSiteForBuild('lightscaper').origin;
	let context = null, prepared, recovered, processIdentity;
	let failed = false, primary;
	const cleanupFailures = [];
	try {
		context = await type.launchPersistentContext(profilePath, { executablePath, headless: true, serviceWorkers: 'block' });
		const page = await openQualificationPage(context, origin);
		processIdentity = await captureOwnedBrowserProcessV1({ browserName, executablePath, profilePath });
		prepared = await page.evaluate(async () => (await import('/__original_process_crash_native.js')).prepareOriginalProcessCrashNativeV1());
		expect(prepared.schemaVersion).toBe(1);
		expect(prepared.native).toEqual({ writeBlobReturnedTrue: true, operationId: 'media-asset-chunk-write', path: prepared.identity.currentPath,
			writeBytes: 85, writerOpens: 1, writeAcks: 1, closeAcks: 1, companionJoined: true, importPending: true, signalAborted: false, closeCallsBeforeKill: 0 });
		expect(prepared.prefix.current).toEqual({ filePresent: true, sha256: CURRENT_SHA256, byteLength: 85, leaseCount: 1, bindingCount: 1,
			bindingSameDirectory: true, metadataCount: 0, photoCount: 0, rootCount: 0, intentPresent: true });
		expect(prepared.prefix.donor).toEqual(prepared.baseline.donor);
		expect(prepared.prefix.unrooted).toEqual(prepared.baseline.unrooted);
		expect(prepared.prefix.donor.file.sha256).toBe(PRIOR_SHA256);
		expect(prepared.prefix.unrooted.file).toEqual({ present: true, sha256: UNROOTED_SHA256, byteLength: 7 });
		expect(prepared.prefix.unrooted.custodyJson).toBe('[]');
		expect(new Set([prepared.identity.currentPath, prepared.prefix.donor.path, prepared.prefix.unrooted.path]).size).toBe(3);
		await collectNativePhotoOriginalProcessCrashCoverage(page, `${testInfo.title} before crash`);
		const browser = context.browser();
		expect(browser).not.toBeNull();
		// The supervisor authenticates our worker ancestry, exact executable,
		// profile argument, PID start identity and native process-group leader.
		// It installs the real disconnect listener before SIGKILL and joins both
		// Playwright's disconnect and absence of live native group members.
		await killAndJoinOwnedBrowserProcessV1(processIdentity, browser);
		expect(browser.isConnected()).toBe(false);
		context = null;

		context = await type.launchPersistentContext(profilePath, { executablePath, headless: true, serviceWorkers: 'block' });
		const reopened = await openQualificationPage(context, origin);
		const retained = await reopened.evaluate(async expected => (await import('/__original_process_crash_native.js'))
			.readOriginalProcessCrashPrefixNativeV1(expected), prepared);
		// Read-only native inspection runs before any PhotoMedia.ready call.
		expect(retained).toEqual(prepared.prefix);
		recovered = await reopened.evaluate(async expected => (await import('/__original_process_crash_native.js'))
			.recoverOriginalProcessCrashNativeV1(expected), prepared);
		expect(recovered).toMatchObject({ schemaVersion: 1, orphanGone: true, leaseConsumed: true, bindingConsumed: true,
			intentRetired: true, donorExact: true, unrootedExact: true, catalogExact: true, idempotent: true, pagePhotoCount: 1 });
		expect(recovered.before).toEqual(prepared.prefix);
		expect(recovered.after.current).toEqual({ filePresent: false, sha256: null, byteLength: null, leaseCount: 0, bindingCount: 0,
			bindingSameDirectory: null, metadataCount: 0, photoCount: 0, rootCount: 0, intentPresent: false });
		expect(recovered.after.donor).toEqual(prepared.baseline.donor);
		expect(recovered.after.unrooted).toEqual(prepared.baseline.unrooted);
		await collectNativePhotoOriginalProcessCrashCoverage(reopened, `${testInfo.title} first reopen`);
		await context.close(); context = null;

		context = await type.launchPersistentContext(profilePath, { executablePath, headless: true, serviceWorkers: 'block' });
		const second = await openQualificationPage(context, origin);
		const secondPrefix = await second.evaluate(async expected => (await import('/__original_process_crash_native.js'))
			.readOriginalProcessCrashPrefixNativeV1(expected), prepared);
		expect(secondPrefix).toEqual(recovered.after);
		const secondRecovery = await second.evaluate(async expected => (await import('/__original_process_crash_native.js'))
			.recoverOriginalProcessCrashNativeV1(expected), prepared);
		expect(secondRecovery.before).toEqual(recovered.after);
		expect(secondRecovery.after).toEqual(recovered.after);
		expect(secondRecovery.idempotent).toBe(true);
		await collectNativePhotoOriginalProcessCrashCoverage(second, `${testInfo.title} second reopen`);
		await testInfo.attach('native-process-crash.json', { body: JSON.stringify({ browserName, processIdentity, prepared, recovered, secondRecovery }), contentType: 'application/json' });
	} catch (error) { failed = true; primary = error; }
	finally {
		if (context?.browser()?.isConnected()) {
			const cleanupPage = context.pages()[0];
			if (cleanupPage) {
				try { await collectNativePhotoOriginalProcessCrashCoverage(cleanupPage, `${testInfo.title} cleanup`); }
				catch (error) { cleanupFailures.push(error); }
			}
			try { await context.close(); } catch (error) { cleanupFailures.push(error); }
		}
	}
	if (failed) {
		const failures = [primary, ...cleanupFailures.filter(error => !Object.is(error, primary))];
		if (failures.length > 1) throw new AggregateError(failures, 'Native process crash qualification and cleanup failed.', { cause: primary });
		throw primary;
	}
	if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Native process crash qualification cleanup failed.');
});

async function openQualificationPage(context, origin) {
	const page = context.pages()[0] ?? await context.newPage();
	await installNativePhotoOriginalProcessCrashRuntime(page);
	await page.route(`**${HOST}`, async route => {
		const response = await route.fetch({ url: `${origin}/en/` }), headers = response.headers();
		delete headers['content-length']; delete headers['content-encoding']; headers['content-type'] = 'text/html';
		try { await route.fulfill({ status: 200, headers, body: '<!doctype html><title>Lightscaper crash recovery qualification</title><main>Lightscaper crash recovery qualification</main>' }); }
		finally { await response.dispose(); }
	});
	await page.goto(`${origin}${HOST}`);
	await expect(page.getByRole('main')).toHaveText('Lightscaper crash recovery qualification');
	expect(await page.evaluate(() => isSecureContext && crossOriginIsolated)).toBe(true);
	return page;
}
