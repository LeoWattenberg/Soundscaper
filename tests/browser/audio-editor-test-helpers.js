import {
	AxeBuilder,
	createHash,
	expect,
	test,
	TRANSLATIONS_ROOT,
} from './audio-editor-test-fixtures.js';
import { projectFileExtensionForProduct } from '../../src/common/project-file-extensions.ts';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { settleFiniteAnimations } from './helpers/settle-finite-animations.js';
import { closeWorkspacePanel } from './helpers/workspace-panel-chrome.js';
import { openChromeDrawer, openTrackHeaderDrawer } from './helpers/responsive-layout.js';
import { seedWorkspaceOnboardingComplete } from './helpers/browser-environment-stubs.js';

export { resolveBrowserProductTestUrl };

// Re-exported so every spec keeps reaching its page stubs through one helper.
export {
	disableNativeSavePicker,
	disableOfflineAudio,
	seedWorkspaceOnboardingComplete,
	stubDisplayCapture,
	stubStorageEstimate,
} from './helpers/browser-environment-stubs.js';
export { closeWorkspacePanel, dockWorkspacePanel, openWorkspacePanelMenu, workspacePanelMenu, workspacePanelMenuButton } from './helpers/workspace-panel-chrome.js';
export {
	closeChromeDrawer,
	expectSurfaceWithinViewport,
	openChromeDrawer,
	openTrackHeaderDrawer,
	waitForResponsiveEditorLayout,
} from './helpers/responsive-layout.js';

/**
 * The File-menu label for the Scape export, which names the suffix the running
 * product writes. Specs must not hard-code it: Soundscaper offers `.sscape` and
 * Framescaper `.fscape` from the same catalog message.
 */
export function exportProjectFileAction(productId = 'soundscaper') {
	return `Export project file (${projectFileExtensionForProduct(productId)})`;
}

/** Invoke the Scape export under whichever product this editor is running. */
export async function chooseExportProjectFileAction(page, editor) {
	const productId = await editor.getAttribute('data-product');
	await chooseFileAction(page, editor, exportProjectFileAction(productId || 'soundscaper'));
}

export function registerAudioEditorHooks() {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});
}

export async function bootEditor(page, path) {
	await seedWorkspaceOnboardingComplete(page);
	await page.goto(resolveBrowserProductTestUrl(path));
	const editor = await waitForEditor(page);
	const decline = page.getByRole('button', { name: /^(Decline|Ablehnen)$/ });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

export async function serveTranslationFixture(page, locales, { waitForPack } = {}) {
	await page.unroute(`${TRANSLATIONS_ROOT}/**`);
	const packs = new Map();
	const descriptors = {};
	for (const [locale, fixture] of Object.entries(locales)) {
		const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, locale, messages: fixture.messages }));
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		const path = `packs/${sha256}.json`;
		packs.set(path, bytes);
		descriptors[locale] = {
			name: fixture.name,
			direction: fixture.direction,
			eligible: true,
			coverage: 1,
			path,
			sha256,
			byteLength: bytes.byteLength,
		};
	}
	const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, locales: descriptors }));
	await page.route(`${TRANSLATIONS_ROOT}/**`, async (route) => {
		const url = new URL(route.request().url());
		const relativePath = url.pathname.slice(new URL(`${TRANSLATIONS_ROOT}/`).pathname.length);
		const body = relativePath === 'latest.json' ? manifest : packs.get(relativePath);
		if (!body) return route.fulfill({ status: 404, body: 'Not found' });
		if (relativePath !== 'latest.json') await waitForPack?.(relativePath);
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Content-Length': String(body.byteLength),
			},
			body,
		});
	});
}

export async function waitForEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible({ timeout: 20_000 });
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	return editor;
}

export async function fileDataTransfer(page, files) {
	return page.evaluateHandle((entries) => {
		const transfer = new DataTransfer();
		for (const entry of entries) {
			const binary = atob(entry.base64);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			transfer.items.add(new File([bytes], entry.name, { type: entry.mimeType }));
		}
		return transfer;
	}, files.map((file) => ({
		name: file.name,
		mimeType: file.mimeType,
		base64: file.buffer.toString('base64'),
	})));
}

export async function importFiles(editor, files, options = { timeout: 20_000 }) {
	if (await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await closeWorkspacePanel(editor, 'project-bin');
	await editor.locator('[data-import-input]').setInputFiles(files);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', options);
}

export function trackNameText(editor) {
	return editor.locator('.track-control-panel__track-name-text');
}

export { clipByName, clipNameAccessiblePattern } from './audio-editor-clip-locators.js';

export function clipField(editor, name) {
	return editor.locator(`[data-clip-field="${name}"] input`);
}

export async function commitInput(input, value) {
	// Playwright fills a React-controlled input by writing `.value` and then
	// dispatching `input`. A re-render landing between those two steps writes the
	// component's unchanged state back to the node and refreshes React's value
	// tracker, so the event that follows reads as a no-op and the typed value is
	// silently dropped — the input keeps exactly what it held before. A real
	// keystroke cannot interleave that way, but a busy machine makes that window
	// wide enough to hit, which is what made the caption round-trip flaky on
	// WebKit. Retry only that signature, so an input that legitimately reformats
	// what it was given is left alone.
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const before = await input.inputValue();
		await input.fill(value);
		if (before === value || await input.inputValue() !== before) break;
	}
	await input.blur();
}

export async function seekOnRuler(page, editor, x) {
	const ruler = editor.locator('[data-ruler]');
	await ruler.click({ button: 'right', position: { x, y: 20 } });
	const menu = page.locator('.timeline-ruler-context-menu');
	const playback = menu.getByRole('menuitem', {
		name: 'Click ruler to start playback', exact: true,
	});
	await expect(menu).toBeVisible();
	if (await playback.locator('svg').count()) await playback.click();
	else await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await ruler.click({ button: 'right', position: { x, y: 20 } });
	await expect(menu).toBeVisible();
	await expect(playback.locator('svg')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await ruler.click({ position: { x, y: 28 } });
}

export async function clickClipInterior(page, clip, position = 0.5) {
	await clip.scrollIntoViewIfNeeded();
	const box = await clip.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.click(
		box.x + Math.max(12, Math.min(box.width - 12, box.width * position)),
		box.y + Math.max(12, box.height * 0.55),
	);
}

export async function openClipProperties(page, editor, clip, clickOptions = {}) {
	if (clip) {
		await clip.click({ position: { x: 24, y: 10 }, ...clickOptions });
		if (clickOptions.force) {
			await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Clip properties']);
		} else {
			await clip.getByRole('button', { name: 'Clip menu' }).click();
			await page.getByRole('menuitem', { name: 'Clip properties', exact: true }).click();
		}
	} else {
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Clip properties']);
	}
	const dialog = page.getByRole('dialog', { name: 'Clip properties', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="clip"]')).toBeVisible();
	return dialog;
}

export async function openEffectsForTrack(editor, trackIndex) {
	await openTrackHeaderDrawer(editor);
	await editor.locator('[data-track-row]').nth(trackIndex).getByRole('button', { name: 'Effects', exact: true }).click();
	const panel = editor.locator('[data-workspace-panel="effects"]');
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('region', { name: 'Effects panel', exact: true })).toBeVisible();
	return panel;
}

export async function openSelectionEffectDialog(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'Bass and Treble']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="selection-effect"]')).toBeVisible();
	return dialog;
}

export async function openParametricEqSelectionEffect(page, editor) {
	await openChromeDrawer(editor);
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	const effectMenu = page.getByRole('menu', { name: 'Effect', exact: true });
	await expect(effectMenu).toBeVisible();
	const filters = effectMenu.getByRole('menuitem', { name: /^EQ and filters(?:\s|$)/i }).first();
	await expect(filters).toBeVisible();
	await filters.focus();
	await page.keyboard.press('ArrowRight');
	const filtersMenu = filters.getByRole('menu');
	await expect(filtersMenu).toBeVisible();
	const eq = filtersMenu.getByRole('menuitem', { name: /parametric EQ/i }).first();
	await expect(eq).toBeVisible();
	await eq.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="selection-effect"]')).toBeVisible();
	return dialog;
}

export async function openAnalysisPanel(page, editor) {
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
	const panel = editor.locator('[data-workspace-panel="analysis"]');
	await expect(panel).toBeVisible();
	return panel;
}

// Framescaper names this command 'Export video', so a Framescaper workflow has
// to say so; the surface behind it is the same delivery dialog.
export async function openExportDialog(page, editor, { label = 'Export audio', ...options } = {}) {
	await chooseFileAction(page, editor, label, options);
	const dialog = page.getByRole('dialog', { name: label, exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="export"]')).toBeVisible();
	return dialog;
}

export async function closeDialog(dialog) {
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

export async function closeAup4CompatibilityReport(dialog) {
	await dialog.locator('[data-aup4-compatibility-report]').getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

export async function closeEffectsPanel(panel) {
	await panel.locator('[data-workspace-panel-menu="effects"] button').click();
	await panel.page().locator('.kw-audio-editor__workspace-panel-menu').getByRole('menuitem', { name: 'Close', exact: true }).click();
	await expect(panel).toBeHidden();
}

export async function chooseDropdown(page, group, optionName) {
	await group.getByRole('button').click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
	await expect(group.getByRole('button')).toContainText(optionName);
}

/**
 * Route the export's inputs to its outputs through the mapping window.
 *
 * `routes(input, output)` says whether that cell is checked; only the cells
 * that disagree with the grid are pressed, so the helper states the mapping it
 * wants rather than the presses that happen to produce it.
 */
export async function chooseCustomChannelMapping(page, exportDialog, { outputs, routes }) {
	await exportDialog.locator('[data-export-channel-option="custom"] input').check();
	await exportDialog.locator('[data-export-channel-action="edit-mapping"]').getByRole('button').click();
	const mapping = page.locator('[data-export-channel-mapping]');
	await mapping.locator('[data-export-channel-mapping-field="outputs"] input').fill(String(outputs));
	const inputs = await mapping.locator('tbody tr').count();
	for (let input = 0; input < inputs; input += 1) {
		for (let output = 0; output < outputs; output += 1) {
			const cell = mapping.locator(`[data-export-channel-mapping-cell="${input}-${output}"]`).getByRole('checkbox');
			const checked = await cell.getAttribute('aria-checked') === 'true';
			if (checked !== Boolean(routes(input, output))) await cell.click();
		}
	}
	await mapping.locator('[data-export-channel-mapping-action="apply"]').getByRole('button').click();
	await expect(mapping).toBeHidden();
}

export async function openRackPicker(panel, scope) {
	const buttons = panel.locator('[data-effect-rack]').getByRole('button', { name: 'Effects', exact: true });
	await (scope === 'master' ? buttons.last() : buttons.first()).click();
	await expect(panel.page().getByRole('menu', { name: 'Choose an effect' })).toBeVisible();
}

export async function addRackEffect(page, panel, scope, effectName) {
	await openRackPicker(panel, scope);
	const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
	await picker.getByRole('menuitem', { name: effectName, exact: true }).click();
}

export async function openEffectStackMenu(panel, scope) {
	const buttons = panel.locator('[data-effect-rack]').getByRole('button', { name: 'Effect stack options', exact: true });
	await (scope === 'master' ? buttons.last() : buttons.first()).click();
	const menu = panel.page().locator('.audio-editor-effect-stack-menu');
	await expect(menu).toBeVisible();
	return menu;
}

export async function chooseFileAction(page, editor, action, options = {}) {
	await chooseCommandAction(page, editor, 'File', action, options);
}

export async function showToolbarButton(page, editor, label) {
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	const flyout = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
	const toggle = flyout.getByRole('checkbox', { name: label, exact: true });
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await expect(flyout).toBeHidden();
}

export async function chooseCommandAction(page, editor, menu, action, options = {}) {
	const commandMenu = await openCommandMenu(page, editor, menu, options);
	const item = getMenuItem(commandMenu, action);
	await item.press('Enter', options);
	await expect(commandMenu).toBeHidden(options);
}
export async function chooseNestedCommandAction(page, editor, menu, actions, options = {}) {
	const commandMenu = await openCommandMenu(page, editor, menu, options);
	let currentMenu = commandMenu;
	for (const [index, action] of actions.entries()) {
		const item = getMenuItem(currentMenu, action);
		if (index < actions.length - 1) {
			currentMenu = await openMenuItemSubmenu(page, item, options);
		} else {
			let target = item;
			if (await item.locator(':scope > .context-menu-item-content .context-menu-item-arrow').count()) {
				const terminalMenu = await openMenuItemSubmenu(page, item, options);
				target = getMenuItem(terminalMenu, action);
			}
			await expect(target).toBeEnabled(options);
			await target.press('Enter', options);
			await expect(commandMenu).toBeHidden(options);
		}
	}
}
export async function openNestedCommandMenu(page, editor, menu, actions, options = {}) {
	let currentMenu = await openCommandMenu(page, editor, menu, options);
	for (const action of actions) currentMenu = await openMenuItemSubmenu(page, getMenuItem(currentMenu, action), options);
	return currentMenu;
}
async function openCommandMenu(page, editor, menu, options) {
	await openChromeDrawer(editor);
	await editor.getByRole('menubar', { name: /^(Application menu|Anwendungsmenü)$/ })
		.getByRole('menuitem', { name: menu, exact: true }).click();
	const commandMenu = page.getByRole('menu', { name: menu, exact: true });
	await expect(commandMenu).toBeVisible(options);
	return commandMenu;
}
async function openMenuItemSubmenu(page, item, options) {
	await expect(item).toBeEnabled(options);
	await item.press('ArrowRight', options);
	const submenu = item.getByRole('menu');
	await expect(submenu).toBeVisible(options);
	return submenu;
}
export function getMenuItem(menu, label) {
	const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const name = new RegExp(`^${escapedLabel}(?:\\s|$)`);
	return menu.getByRole('menuitem', { name })
		.or(menu.getByRole('menuitemcheckbox', { name }))
		.first();
}

export async function setDocumentTheme(page, theme) {
	await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
	await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
	await expect.poll(() => page.locator('[data-audio-editor]').evaluate((root) => root.style.colorScheme)).toBe(theme);
	await page.waitForTimeout(50);
}

export async function dispatchPinch(timeline) {
	const box = await timeline.boundingBox();
	expect(box).not.toBeNull();
	const y = box.y + Math.min(100, box.height / 2);
	await timeline.dispatchEvent('pointerdown', { bubbles: true, pointerId: 101, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 210, clientY: y });
	await timeline.dispatchEvent('pointerdown', { bubbles: true, pointerId: 102, pointerType: 'touch', isPrimary: false, button: 0, clientX: box.x + 260, clientY: y });
	await timeline.dispatchEvent('pointermove', { bubbles: true, pointerId: 101, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 180, clientY: y });
	await timeline.dispatchEvent('pointermove', { bubbles: true, pointerId: 102, pointerType: 'touch', isPrimary: false, button: 0, clientX: box.x + 290, clientY: y });
	await timeline.dispatchEvent('pointerup', { bubbles: true, pointerId: 101, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 180, clientY: y });
	await timeline.dispatchEvent('pointerup', { bubbles: true, pointerId: 102, pointerType: 'touch', isPrimary: false, button: 0, clientX: box.x + 290, clientY: y });
}

export async function assertAccessibleBasics(root) {
	const violations = await root.evaluate((container) => {
		const visible = (element) => {
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
		};
		const textAlternative = (element) => {
			const labelledBy = element.getAttribute('aria-labelledby');
			const labelledText = labelledBy
				? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
				: '';
			const labels = element.labels ? [...element.labels].map((label) => label.textContent || '').join(' ') : '';
			return [element.getAttribute('aria-label'), labelledText, labels, element.getAttribute('title'), element.textContent]
				.map((value) => String(value || '').trim())
				.find(Boolean) || '';
		};
		const results = [];
		for (const element of container.querySelectorAll('button, input, select, textarea, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="slider"], [role="tab"], [role="dialog"]')) {
			if (!visible(element) || element.disabled || element.getAttribute('aria-hidden') === 'true') continue;
			if (!textAlternative(element)) results.push(`${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[role=${element.getAttribute('role')}]` : ''} has no accessible name`);
		}
		const ids = [...container.querySelectorAll('[id]')].map((element) => element.id).filter(Boolean);
		for (const id of new Set(ids)) if (ids.filter((candidate) => candidate === id).length > 1) results.push(`duplicate id ${id}`);
		return results;
	});
	expect(violations).toEqual([]);
}

export async function assertNoSeriousAxeViolations(page, selector = '#kw-audio-editor-design-system') {
	await settleFiniteAnimations(page);
	const results = await new AxeBuilder({ page })
		.include(selector)
		.analyze();
	const violations = results.violations
		.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
		.map((violation) => ({
			id: violation.id,
			impact: violation.impact,
			nodes: violation.nodes.map((node) => node.target),
		}));
	expect(violations).toEqual([]);
}

export async function sourcePeakChannels(page, sourceName) {
	return page.evaluate(({ databaseName, name }) => new Promise((resolve, reject) => {
		const openRequest = indexedDB.open(databaseName);
		openRequest.onerror = () => reject(openRequest.error);
		openRequest.onsuccess = () => {
			const database = openRequest.result;
			const sourcesRequest = database.transaction('sources', 'readonly').objectStore('sources').getAll();
			sourcesRequest.onerror = () => reject(sourcesRequest.error);
			sourcesRequest.onsuccess = () => {
				const source = sourcesRequest.result.find((candidate) => candidate.name === name);
				if (!source) {
					database.close();
					reject(new Error(`Source ${name} was not found.`));
					return;
				}
				const peaksRequest = database.transaction('analysis', 'readonly')
					.objectStore('analysis').get(`audio-editor-peaks-v2:${source.id}`);
				peaksRequest.onerror = () => reject(peaksRequest.error);
				peaksRequest.onsuccess = () => {
					database.close();
					const peaks = peaksRequest.result?.value;
					const level = peaks?.levels?.[0];
					resolve({
						version: peaks?.version,
						channelCount: peaks?.channelCount,
						blockSizes: (peaks?.levels || []).map(({ blockSize }) => blockSize),
						channels: (level?.channels || []).map((channel) => ({
							minimum: Math.min(...channel.minimums),
							maximum: Math.max(...channel.maximums),
						})),
					});
				};
			};
		};
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, name: sourceName });
}

export async function effectSourceMetadata(page) {
	return page.evaluate((databaseName) => new Promise((resolve, reject) => {
		const openRequest = indexedDB.open(databaseName);
		openRequest.onerror = () => reject(openRequest.error);
		openRequest.onsuccess = () => {
			const database = openRequest.result;
			const request = database.transaction('sources', 'readonly').objectStore('sources').getAll();
			request.onerror = () => {
				database.close();
				reject(request.error);
			};
			request.onsuccess = () => {
				database.close();
				resolve(request.result.filter((source) => source.id?.startsWith('audacity-effect-')));
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

export async function effectSourcePeak(page, name) {
	return page.evaluate(async ({ databaseName, effectName }) => {
		const { source, peaks } = await new Promise((resolve, reject) => {
			const openRequest = indexedDB.open(databaseName);
			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => {
				const database = openRequest.result;
				const sourcesRequest = database.transaction('sources', 'readonly').objectStore('sources').getAll();
				sourcesRequest.onerror = () => reject(sourcesRequest.error);
				sourcesRequest.onsuccess = () => {
					const source = sourcesRequest.result.find((candidate) => candidate.name?.includes(effectName));
					if (!source) {
						database.close();
						resolve({ source: null, peaks: null });
						return;
					}
					const peaksRequest = database.transaction('analysis', 'readonly')
						.objectStore('analysis').get(`audio-editor-peaks-v2:${source.id}`);
					peaksRequest.onerror = () => reject(peaksRequest.error);
					peaksRequest.onsuccess = () => {
						database.close();
						resolve({ source, peaks: peaksRequest.result?.value || null });
					};
				};
			};
		});
		if (!source || !peaks?.levels?.length) return 0;
		let peak = 0;
		for (const level of peaks.levels) {
			for (const channel of level.channels || []) {
				for (const sample of channel.minimums || []) peak = Math.max(peak, Math.abs(sample));
				for (const sample of channel.maximums || []) peak = Math.max(peak, Math.abs(sample));
			}
		}
		return peak;
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, effectName: name });
}

export function collectClientErrors(page) {
	const errors = [];
	const reportedRequests = new Set();

	function reportRequest(request, reason) {
		const key = `${request.url()}: ${reason}`;
		if (reportedRequests.has(key)) return;
		reportedRequests.add(key);
		errors.push(`Browser dependency ${request.url()} was rejected: ${reason}`);
	}

	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const source = message.location().url;
		errors.push(source ? `${message.text()} (${source})` : message.text());
	});
	page.on('requestfailed', (request) => {
		const reason = request.failure()?.errorText || 'request failed';
		// Navigation may abort dependencies that are still loading.
		if (/^(?:NS_BINDING_ABORTED|net::ERR_ABORTED)$/u.test(reason)) return;
		if (isBrowserDependency(request)) reportRequest(request, reason);
	});
	page.on('response', (response) => {
		const request = response.request();
		if (!isBrowserDependency(request)) return;
		if (response.status() === 304) return;
		if (!response.ok()) return reportRequest(request, `HTTP ${response.status()}`);
		const contentType = response.headers()['content-type']?.toLowerCase() || '';
		if ((request.resourceType() === 'script' || /worker\.js(?:$|[?#])/.test(request.url())) && !/(?:java|ecma)script/.test(contentType)) {
			reportRequest(request, `script has disallowed MIME type ${contentType || '(missing)'}`);
		}
		if (/\.wasm(?:$|[?#])/.test(request.url()) && !contentType.startsWith('application/wasm')) {
			reportRequest(request, `WebAssembly has disallowed MIME type ${contentType || '(missing)'}`);
		}
	});

	return errors;
}

export function isBrowserDependency(request) {
	return ['script', 'stylesheet', 'font', 'image'].includes(request.resourceType())
		|| /\.(?:wasm|worker\.js)(?:$|[?#])/.test(request.url());
}

export function escapeRegex(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
