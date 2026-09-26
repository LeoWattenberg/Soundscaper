/* SPDX-License-Identifier: AGPL-3.0-only */

import { openNativePreferences } from './helpers/assistance-task-menu.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	chooseCommandAction,
	getMenuItem,
	openNestedCommandMenu,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';

test('Framescaper v1 exposes native work only through menus and retains its watch target', async ({ page }) => {
	await installNativeServicesFixture(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind]) => kind === 'snapshot').length)).toBeGreaterThan(0);

	await expect(page.locator('[data-framescaper-native-services-dialog="true"]')).toHaveCount(0);
	await expect(editor.getByRole('button', { name: /native|OpenFX|proxy/iu })).toHaveCount(0);

	let fileExport = await openNestedCommandMenu(page, editor, 'File', ['Export other']);
	await expect(getMenuItem(fileExport, 'Add to render queue')).toBeDisabled();
	await page.keyboard.press('Escape');

	let tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	await expect(getMenuItem(tools, 'Background jobs')).toBeDisabled();
	await expect(getMenuItem(tools, 'Watch folders')).toBeDisabled();
	await page.keyboard.press('Escape');
	await openNativePreferences(page, editor, 'Media', 'Native media and scratch');

	let dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await expect(dialog).toBeVisible();
	const master = dialog.locator('[data-native-service-preference="native-media"]');
	await expect(master).not.toBeChecked();
	await master.check();
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls)).toContainEqual([
		'setPreference', 'native-media', true,
	]);
	await expect(master).toBeChecked();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await expect(dialog).toBeHidden();

	fileExport = await openNestedCommandMenu(page, editor, 'File', ['Export other']);
	await expect(getMenuItem(fileExport, 'Add to render queue')).toBeEnabled();
	await page.keyboard.press('Escape');

	tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	const jobs = getMenuItem(tools, 'Background jobs');
	await expect(jobs).toBeEnabled();
	await jobs.click();
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const queueRow = dialog.locator(`[data-native-queue-job="${'12'.repeat(20)}"]`);
	await expect(queueRow).toContainText('exports/reel.mov');
	await queueRow.getByRole('button', { name: 'Pause', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls)).toContainEqual([
		'control', 'pause',
	]);
	await expect(queueRow).toContainText('paused');
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();

	tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	const watchFolders = getMenuItem(tools, 'Watch folders');
	await expect(watchFolders).toBeEnabled();
	await watchFolders.click();
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const proxies = dialog.getByRole('checkbox', { name: 'Generate proxies', exact: true });
	await expect(proxies).toBeVisible();
	await proxies.check();
	await dialog.getByRole('button', { name: 'Add watch folder', exact: true }).click();
	const projectId = await editor.getAttribute('data-project-id');
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls
		.find(([kind]) => kind === 'createWatch'))).toEqual([
		'createWatch', {
			schemaFamily: 'framescaper', schemaVersion: 1,
			grantId: 'ab'.repeat(16), projectId, binId: 'project-bin',
			extensions: ['wav', 'mp3', 'mp4', 'mov'], importMode: 'link', generateProxies: true,
		},
	]);
	await expect(dialog.getByRole('list', { name: 'Watch folders' })).toContainText('Generate');
});

test('a native watch claim imports one video into the Project Bin and acknowledges its committed revision', async ({ page }) => {
	test.setTimeout(90_000);
	const media = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
	const watchedVideo = {
		name: 'watched-inbox.mp4', mimeType: media.file.mimeType,
		size: media.file.buffer.byteLength, contentSha256: media.sourceSha256,
	};
	await page.route('**/__e2e-watch-file', (route) => route.fulfill({
		body: media.file.buffer,
		contentType: watchedVideo.mimeType,
		headers: { 'Content-Length': String(watchedVideo.size) },
	}));
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await installNativeServicesFixture(page, { watchedVideo });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	await openNativePreferences(page, editor, 'Media', 'Native media and scratch');
	let dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.locator('[data-native-service-preference="native-media"]').check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	await getMenuItem(tools, 'Watch folders').click();
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await expect(dialog.getByRole('checkbox', { name: 'Generate proxies', exact: true })).not.toBeChecked();
	await dialog.getByRole('button', { name: 'Add watch folder', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind]) => kind === 'completeWatchImport'))).toHaveLength(1);
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	const card = editor.locator('[data-project-bin-item][data-project-bin-media-kind="video"]');
	await expect(card).toHaveCount(1);
	await expect(card).toBeVisible();
	await expect(card).toHaveAttribute('aria-label', 'Project bin: watched-inbox');
	const sourceId = await card.getAttribute('data-source-id');
	expect(sourceId).toBeTruthy();
	const calls = await page.evaluate(() => globalThis.__framescaperNativeCalls);
	const claim = calls.find(([kind]) => kind === 'offeredWatchImport')[1];
	const completion = calls.find(([kind]) => kind === 'completeWatchImport')[1];
	expect(Number.isSafeInteger(claim.projectRevision)).toBe(true);
	expect(claim).toMatchObject({
		schemaFamily: 'framescaper', schemaVersion: 1, projectId,
		claimId: 'de'.repeat(16), name: watchedVideo.name,
		contentSha256: watchedVideo.contentSha256,
	});
	expect(completion).toEqual({
		schemaFamily: 'framescaper', schemaVersion: 1,
		claimId: 'de'.repeat(16), projectId, binId: 'project-bin', sourceId,
		contentSha256: watchedVideo.contentSha256,
		expectedProjectRevision: claim.projectRevision,
		committedProjectRevision: claim.projectRevision + 1,
		success: true,
	});
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const reopened = await bootEditor(page, `/framescaper/embed/en/?project=${encodeURIComponent(projectId)}`);
	await expect(reopened).toHaveAttribute('data-project-id', projectId);
	const persisted = reopened.locator('[data-project-bin-item][data-project-bin-media-kind="video"]');
	await expect(persisted).toHaveCount(1);
	await expect(persisted).toBeVisible();
	await expect(persisted).toHaveAttribute('data-source-id', sourceId);
	await expect(persisted).toHaveAttribute('aria-label', 'Project bin: watched-inbox');
});

test('a Framescaper bridge cannot surface Framescaper native menus in Soundscaper', async ({ page }) => {
	await installNativeServicesFixture(page);
	const editor = await bootEditor(page, '/embed/en/');

	const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	for (const label of ['Background jobs', 'Watch folders', 'Native media and scratch']) {
		await expect(getMenuItem(tools, label)).toHaveCount(0);
	}
	await page.keyboard.press('Escape');
	const effect = await openNestedCommandMenu(page, editor, 'Effect', []);
	await expect(getMenuItem(effect, 'Video effects')).toHaveCount(0);
	await expect(page.locator('[data-framescaper-native-services-dialog="true"]')).toHaveCount(0);
});

// Menu-driven OpenFX workflows render the whole editor between steps; under a
// loaded CI worker every interaction runs several times slower than local, so
// their budgets are sized from measured worst cases rather than defaults.
const SLOW_WORKFLOW = { timeout: 120_000 };

test('Framescaper v1 authors typed OpenFX state only from the opted-in Effect menu', async ({ page }) => {
	test.setTimeout(240_000);
	await installNativeServicesFixture(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid'], SLOW_WORKFLOW);
	await expect(editor.getByRole('group', { name: 'Video clip: Solid', exact: true })).toHaveCount(1, SLOW_WORKFLOW);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', SLOW_WORKFLOW);
	await openNativePreferences(page, editor, 'Media', 'Native media and scratch');
	let dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.locator('[data-native-service-preference="native-media"]').check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.getByText('Scanning & Settings', { exact: true }).click();
	await dialog.getByRole('checkbox', { name: 'Allow OpenFX plugin scanning and execution' }).check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();

	const effects = await openNestedCommandMenu(page, editor, 'Effect', ['Video effects'], SLOW_WORKFLOW);
	const add = getMenuItem(effects, 'Add OFX');
	await expect(add).toBeEnabled();
	await add.click();
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const form = dialog.locator('[data-framescaper-openfx-add-form="true"]');
	await expect(form).toBeVisible();
	await form.locator('[data-openfx-parameter-type="boolean"] input').check();
	await form.getByLabel('customState', { exact: true }).fill('opaque-state');
	await form.getByLabel('Custom encoding for customState', { exact: true }).fill('vendor-v1');
	await form.getByRole('button', { name: 'Add OpenFX effect', exact: true }).click();
	await expect(form.getByRole('status')).toContainText('OpenFX effect added.', SLOW_WORKFLOW);
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls)).toContainEqual([
		'listOpenFxPlugins',
	]);
});

test('Framescaper v1 runs one cumulative accessible OpenFX Interact workflow without a vendor window', async ({ page, browserName }) => {
	test.setTimeout(360_000);
	await page.emulateMedia({ forcedColors: 'active' });
	await installNativeServicesFixture(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid'], SLOW_WORKFLOW);
	await expect(editor.getByRole('group', { name: 'Video clip: Solid', exact: true })).toHaveCount(1, SLOW_WORKFLOW);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', SLOW_WORKFLOW);
	await openNativePreferences(page, editor, 'Media', 'Native media and scratch');
	let dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.locator('[data-native-service-preference="native-media"]').check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.getByText('Scanning & Settings', { exact: true }).click();
	await dialog.getByRole('checkbox', { name: 'Allow OpenFX plugin scanning and execution' }).check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	let effects = await openNestedCommandMenu(page, editor, 'Effect', ['Video effects'], SLOW_WORKFLOW);
	await getMenuItem(effects, 'Add OFX').click();
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const form = dialog.locator('[data-framescaper-openfx-add-form="true"]');
	await form.locator('[data-openfx-parameter-type="boolean"] input').check();
	await form.getByLabel('customState', { exact: true }).fill('opaque-state');
	await form.getByLabel('Custom encoding for customState', { exact: true }).fill('vendor-v1');
	await form.getByRole('button', { name: 'Add OpenFX effect', exact: true }).click();
	await expect(form.getByRole('status')).toContainText('OpenFX effect added.', SLOW_WORKFLOW);
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();

	const effectButton = editor.getByRole('menuitem', { name: 'Effect', exact: true });
	effects = await openNestedCommandMenu(page, editor, 'Effect', ['Video effects'], SLOW_WORKFLOW);
	const interact = getMenuItem(effects, 'Open OFX Interact');
	await expect(interact).toBeEnabled();
	await interact.click();
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const canvas = dialog.locator('[data-framescaper-openfx-interact-canvas="64x64"]');
	await expect(canvas).toBeVisible();
	await expect(dialog).toContainText('No vendor window opens.');
	await expect(canvas).toHaveAttribute('role', 'application');
	await expect(canvas).toHaveAttribute('width', '64');
	await expect(canvas).toHaveAttribute('height', '64');
	// WebKit does not implement forced-color-adjust, so its computed value is
	// empty there rather than the authored 'none'.
	if (browserName !== 'webkit') await expect(canvas).toHaveCSS('forced-color-adjust', 'none');
	await expect(canvas).toHaveCSS('border-top-width', '2px');
	await expect(dialog.locator('[data-framescaper-openfx-interact-instance="true"] option')).toHaveCount(1);

	await canvas.focus();
	await canvas.dispatchEvent('pointerdown', {
		pointerId: 7, clientX: 80, clientY: 96, button: 1, shiftKey: true,
	});
	await canvas.dispatchEvent('pointermove', {
		pointerId: 7, clientX: 144, clientY: 160, button: 1, shiftKey: true,
	});
	await canvas.dispatchEvent('pointerup', {
		pointerId: 7, clientX: 144, clientY: 160, button: 1,
	});
	await canvas.press('Enter');
	await dialog.locator('[data-framescaper-openfx-interact-target="true"]').focus();
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind]) => kind === 'runOpenFxInteract').at(-1)?.[1].events.length), {
		timeout: 120_000,
	}).toBe(7);
	const replay = await page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind]) => kind === 'runOpenFxInteract').at(-1)[1]);
	expect(replay).toMatchObject({
		protocolVersion: 1, context: 'filter', target: 'overlay', parameterName: null,
		effect: { schemaVersion: 1, pluginId: 'net.example.BrowserFilter', context: 'filter' },
	});
	expect(replay.project.revision).toBeGreaterThanOrEqual(0);
	expect(replay.effect.instanceId).toBeTruthy();
	expect(replay.effectStateSha256).toMatch(/^[a-f\d]{64}$/u);
	expect(replay.events.map(({ sequence }) => sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	expect(replay.events.map((event) => event.kind === 'focus'
		? `focus:${event.focused}` : `${event.kind}:${event.phase}`)).toEqual([
		'focus:true', 'pointer:down', 'pointer:motion', 'pointer:up',
		'keyboard:down', 'keyboard:up', 'focus:false',
	]);

	const retainedPixel = await canvas.evaluate((element) => Array.from(
		element.getContext('2d').getImageData(0, 0, 1, 1).data,
	));
	await dialog.locator('[data-framescaper-openfx-interact-target="true"]')
		.selectOption('custom:customState');
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind]) => kind === 'runOpenFxInteract').at(-1)?.[1]), {
		timeout: 120_000,
	}).toMatchObject({
		target: 'custom-parameter', parameterName: 'customState', events: [],
	});
	const committed = await page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind]) => kind === 'runOpenFxInteract').at(-1)[1]);
	expect(committed.project.revision).toBeGreaterThan(replay.project.revision);
	expect(committed.effect.parameters.find(({ name }) => name === 'enabled').value).toBe(false);
	const afterRetained = await canvas.evaluate((element) => Array.from(
		element.getContext('2d').getImageData(0, 0, 1, 1).data,
	));
	expect(afterRetained).toEqual(retainedPixel);
	await expect(dialog.locator('[data-framescaper-openfx-interact-status="true"]'))
		.toContainText(/ready/iu);
	expect(page.context().pages()).toHaveLength(1);
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await expect(effectButton).toBeFocused();
});

async function installNativeServicesFixture(page, { watchedVideo = null } = {}) {
	await page.addInitScript((watchedVideo) => {
		const calls = [];
		const preferences = {
			nativeMediaEnabled: false,
			hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false,
			ofxConsentEnabled: false,
		};
		let queueState = 'queued';
		let watchRules = [];
		let watchClaimed = false;
		const queueRow = () => ({
			jobId: '12'.repeat(20), taskKind: 'encoded-export',
			schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'browser-v28',
			relativeDestination: 'exports/reel.mov', state: queueState,
			position: 0, progress: null, attempt: 0, lastFailureCode: null,
		});
		const capability = (domain, id, userEnabled = preferences.nativeMediaEnabled) => ({
			domain, id,
			state: preferences.nativeMediaEnabled ? 'available' : 'disabled',
			reason: preferences.nativeMediaEnabled ? 'ready' : 'master-switch-off',
			userEnabled, buildFingerprint: null, detail: null,
		});
		const nativeServices = {
			snapshot: async () => {
				calls.push(['snapshot']);
				return {
					snapshotVersion: 1, runtimeAvailable: true,
					nativeMediaEnabled: preferences.nativeMediaEnabled,
					queue: [queueRow()],
					roots: [{ grantId: 'ab'.repeat(16), displayName: 'Media', revoked: false }],
					watchRules,
				};
			},
			control: async ({ action }) => {
				calls.push(['control', action]);
				queueState = action === 'pause' ? 'paused' : queueState;
				return queueRow();
			},
			reorder: async () => [queueRow()],
			remove: async () => false,
			capabilities: async () => ({
				snapshotVersion: 1,
				masterEnabled: preferences.nativeMediaEnabled,
				buildFingerprint: null,
				entries: [
					capability('queue', 'persistent-render-queue'),
					capability('watch', 'watch-folders'),
					capability('codec', 'encode-mov-prores-proxy'),
					capability('operation', 'image-sequence-import'),
					capability('display', 'external-display'),
					capability('ofx', 'isolated-host', preferences.ofxConsentEnabled),
				],
			}),
			preferences: async () => ({ ...preferences }),
			setPreference: async ({ preference, enabled }) => {
				calls.push(['setPreference', preference, enabled]);
				const fields = {
					'native-media': 'nativeMediaEnabled',
					'hardware-decode': 'hardwareDecodeEnabled',
					'hardware-encode': 'hardwareEncodeEnabled',
					'ofx-consent': 'ofxConsentEnabled',
				};
				preferences[fields[preference]] = enabled;
				return enabled;
			},
			createWatch: async (request) => {
				calls.push(['createWatch', structuredClone(request)]);
				const rule = {
					ruleId: 'cd'.repeat(16), ...structuredClone(request), enabled: true,
				};
				watchRules = [rule];
				return rule;
			},
			setWatchEnabled: async ({ ruleId, enabled }) => {
				watchRules = watchRules.map((rule) => rule.ruleId === ruleId ? { ...rule, enabled } : rule);
				return watchRules.find((rule) => rule.ruleId === ruleId);
			},
			removeWatch: async ({ ruleId }) => {
				watchRules = watchRules.filter((rule) => rule.ruleId !== ruleId);
				return true;
			},
			reconcileWatch: async () => ({ reconciled: watchRules.length }),
			claimWatchImport: async (request) => {
				if (!watchedVideo) return null;
				calls.push(['claimWatchImport', structuredClone(request)]);
				if (watchClaimed || !watchRules.some((rule) => rule.projectId === request.projectId)) return null;
				watchClaimed = true;
				const claim = {
					schemaFamily: 'framescaper', schemaVersion: 1,
					claimId: 'de'.repeat(16), projectId: request.projectId,
					projectRevision: request.projectRevision, binId: 'project-bin',
					generateProxies: false, existingSourceId: null, importMode: 'link',
					locatorId: 'ab'.repeat(32), locatorRevision: 'cd'.repeat(32),
					...watchedVideo, lastModified: 123,
				};
				calls.push(['offeredWatchImport', structuredClone(claim)]);
				return claim;
			},
			completeWatchImport: async (request) => {
				calls.push(['completeWatchImport', structuredClone(request)]);
				return true;
			},
			listOpenFxPlugins: async () => {
				calls.push(['listOpenFxPlugins']);
				return [{
					pluginHandle: '12'.repeat(20), pluginId: 'net.example.BrowserFilter',
					vendor: 'Example', version: { major: 1, minor: 0 },
					binarySha256: 'ab'.repeat(32), supportedContexts: ['filter'],
					parameters: [
						{ name: 'enabled', type: 'boolean', animates: false },
						{ name: 'customState', type: 'custom', animates: false },
					],
					components: ['RGBA'], pixelDepths: ['byte'], threading: 'instance-safe',
					state: 'enabled', quarantined: false,
				}];
			},
			runOpenFxInteract: async (request) => {
				const copied = structuredClone(request);
				calls.push(['runOpenFxInteract', copied]);
				const terminal = copied.events.at(-1)?.kind === 'focus'
					&& copied.events.at(-1).focused === false;
				const retained = copied.target === 'custom-parameter' && copied.events.length === 0;
				const enabled = copied.effect.parameters.find(({ name }) => name === 'enabled');
				return {
					protocolVersion: 1, project: copied.project,
					instanceId: copied.effect.instanceId,
					effectStateSha256: copied.effectStateSha256,
					width: 64, height: 64, rowBytes: 256,
					target: copied.target, parameterName: copied.parameterName,
					acceptedSequences: copied.events.map(({ sequence }) => sequence),
					redrawRequested: !retained && copied.events.length > 0,
					surfaceDisposition: retained ? 'retained' : 'drawn',
					parameterMutations: terminal && enabled ? [{
						parameter: { ...enabled, value: false },
					}] : [],
					rgba: new Uint8Array(64 * 64 * 4).fill(retained ? 0 : 0x33),
				};
			},
		};
		Object.defineProperty(globalThis, '__framescaperNativeCalls', {
			configurable: true, value: calls,
		});
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: Object.freeze({
				getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
				nativeServices: Object.freeze(nativeServices),
				...(watchedVideo ? {
					chooseLinkedVideoOriginal: async () => null,
					loadLinkedVideoOriginal: async ({ locatorId, expectedRevision, playback }) => {
						if (playback) return null;
						return locatorId === 'ab'.repeat(32) && expectedRevision === 'cd'.repeat(32)
							? {
								locatorRevision: 'cd'.repeat(32),
								descriptor: {
									id: 'ef'.repeat(32), readProfile: 'materialized-v1',
									url: `${location.origin}/__e2e-watch-file`,
									name: watchedVideo.name, size: watchedVideo.size,
									mimeType: watchedVideo.mimeType, lastModified: 123,
								},
							}
							: null;
					},
					reconcileLinkedVideoOriginals: async () => 0,
					releaseLinkedVideoOriginal: async () => true,
				} : {}),
				readNativeTierControls: async () => ({
					probeHelperEnabled: false, probeHelperQuarantined: false,
					audioHelperEnabled: false, audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: false,
				}),
				applyNativeTierControl: async () => ({
					probeHelperEnabled: false, probeHelperQuarantined: false,
					audioHelperEnabled: false, audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: false,
				}),
			}) }),
		});
	}, watchedVideo);
}
