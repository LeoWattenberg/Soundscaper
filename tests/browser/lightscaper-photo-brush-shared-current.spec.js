/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { photoDevelopBrushMaskCopy } from '../../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { expect, test, compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard } from './helpers/lightscaper-repair-settings-ui-fixture.js';

const PROGRAM = '/__photo_brush_shared_current_native.js';
const BOTH = [255, 255, 255, 255, 188, 188, 188, 255], SECOND = [225, 225, 225, 255, 188, 188, 188, 255];
const ALL_BODY = body([255, 255]), SECOND_BODY = body([0, 255]);
// Independent endpoints: repaired crop/flip yields linear .75/.25; exposure
// +1 affects only painted cells. Literal SCMASK01 bytes use no encoder oracle.

for (const locale of ['en', 'de']) test(`${locale}: Current repaired Photo keeps shared brush paint, re-edit and persisted history through native saves and reload`, async ({ page, browserName }) => {
	expect(['chromium', 'firefox']).toContain(browserName); expect(test.info().config.workers).toBe(1);
	expect(test.info().project.retries).toBe(0); expect(test.info().retry).toBe(0); test.setTimeout(240000);
	const f = await repairSettingsUiFixtureV1(page, locale), brush = photoDevelopBrushMaskCopy(locale);
	const program = await compileNativeImageHandoffScript('photo-brush-shared-current-native.js', fileURLToPath(new URL('./helpers/lightscaper-repair-frame-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	const original = await custody();
	await f.openDevelop(); await f.repair('heal'); await f.geometry(); await f.painted(BOTH); await f.save();
	const base = await custody(), basePhoto = base.photos[0].photo, baseDevelop = active(basePhoto).develop;
	expect(basePhoto.schemaVersion).toBe(3); expect(baseDevelop.processVersion).toBe(3); expect(baseDevelop.repairs.spots[0].mode).toBe('heal');
	expect(baseDevelop.effects.map(effect => effect.type)).toEqual(['develop-geometry-v1', 'tone-ladder-v1']);
	expect(base.bodies).toEqual([]); immutable(base, original);
	const toneId = baseDevelop.effects.find(effect => effect.type === 'tone-ladder-v1').id, beforeBrushPhotos = await f.photos();
	let author = await openBrush(); await expect(named(author, 'checkbox', brush.showOverlay)).not.toBeChecked();
	for (const [key, value] of [['width', '2'], ['height', '1']]) await named(author, 'spinbutton', brush[key]).fill(value);
	await keyboard(page, named(author, 'button', brush.create)); await alpha(author, [0, 0]);
	await stamp(author, 'paint', '.75'); await alpha(author, [0, 255]);
	const grid = named(author, 'img', brush.grid); await grid.scrollIntoViewIfNeeded(); const box = await grid.boundingBox(); expect(box).toBeTruthy();
	await grid.click({ position: { x: box.width * .25, y: box.height * .5 } }); await alpha(author, [255, 255]);
	await keyboard(page, named(author, 'button', brush.undo)); await alpha(author, [0, 255]);
	await keyboard(page, named(author, 'button', brush.redo)); await alpha(author, [255, 255]);
	const bindingLabel = await author.locator('.lightscaper-brush-mask-bindings > div').first().locator('input[type="checkbox"]').first().getAttribute('aria-label');
	expect(bindingLabel).toBeTruthy(); await check(named(author, 'checkbox', bindingLabel)); await check(named(author, 'checkbox', brush.showOverlay));
	await named(author, 'combobox', brush.overlayEffect).selectOption(toneId);
	expect(await f.photos()).toEqual(beforeBrushPhotos);
	await keyboard(page, named(author, 'button', brush.apply)); await expect(author).toHaveCount(0); await f.painted(BOTH);
	const overlay = f.develop().locator('[data-photo-develop-mask-overlay]'); await expect(overlay).toBeVisible();
	await expect.poll(() => plane(overlay)).toEqual([2, 1, 255, 48, 48, 255, 255, 48, 48, 255]);
	expect(await overlay.boundingBox()).toEqual(await named(f.develop(), 'img', f.words.after).boundingBox());
	await f.save();
	const first = await custody(), firstDevelop = active(first.photos[0].photo).develop, graph = firstDevelop.masks[0];
	expect(firstDevelop.maskBindings).toEqual([{ maskId: graph.id, effectId: toneId }]);
	expect(graph.inputs).toEqual([{ name: 'paint', kind: 'alpha', sourceRef: ALL_BODY.key }]);
	expect(graph.nodes).toEqual([{ id: graph.outputNodeId, kind: 'alpha', inputName: 'paint' }]);
	expectBody(first, ALL_BODY); immutable(first, original); retainedRecipe(firstDevelop, baseDevelop);
	const firstCursor = await history().inputValue();

	// Installed alpha is borrowed for re-edit. Cancel joins its actual display
	// without installing the unpublished erase or changing the repaired recipe.
	author = await openBrush(); await reedit(author, graph.id, [255, 255]); await stamp(author, 'erase', '.25'); await alpha(author, [0, 255]);
	await closeBrush(author); await f.painted(BOTH); expect(await custody()).toEqual(first);
	author = await openBrush(); await reedit(author, graph.id, [255, 255]); await stamp(author, 'erase', '.25'); await alpha(author, [0, 255]);
	await keyboard(page, named(author, 'button', brush.apply)); await expect(author).toHaveCount(0); await f.painted(SECOND); await f.save();
	const erased = await custody(), erasedPhoto = erased.photos[0].photo, erasedDevelop = active(erasedPhoto).develop;
	expect(erasedDevelop).toEqual({ ...firstDevelop, masks: [{ ...graph, inputs: [{ ...graph.inputs[0], sourceRef: SECOND_BODY.key }] }] });
	expectBody(erased, ALL_BODY); expectBody(erased, SECOND_BODY); immutable(erased, original); retainedRecipe(erasedDevelop, baseDevelop);
	for (const old of first.resourceRecords) expect(erased.resourceRecords.find(([key]) => key === old[0])).toEqual(old);
	const erasedCursor = await history().inputValue(); expect(erasedCursor).not.toBe(firstCursor);

	author = await openBrush(); await reedit(author, graph.id, [0, 255]);
	await keyboard(page, named(author, 'button', brush.apply)); await expect(author).toHaveCount(0); await f.painted(SECOND);
	await expect(named(f.develop(), 'button', f.words.save)).toBeDisabled(); expect(await custody()).toEqual(erased);
	// Photo's existing persisted Develop History control owns the recipe rewind
	// and native ACK. It is distinct from the local stroke cursor above.
	await history().selectOption(firstCursor); await acknowledged(erasedPhoto.revision + 1); await f.painted(BOTH);
	const rewound = await custody(); expect(active(rewound.photos[0].photo).develop).toEqual(firstDevelop); immutable(rewound, original);
	expect(rewound.bodies).toEqual(erased.bodies); expect(rewound.resourceRecords).toEqual(erased.resourceRecords);
	await history().selectOption(erasedCursor); await acknowledged(rewound.photos[0].photo.revision + 1); await f.painted(SECOND);
	const restored = await custody(); expect(active(restored.photos[0].photo).develop).toEqual(erasedDevelop); immutable(restored, original);
	expect(restored.bodies).toEqual(erased.bodies); expect(restored.resourceRecords).toEqual(erased.resourceRecords);
	await f.closeDevelop(); await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); await f.select(0); await f.openDevelop(); await f.painted(SECOND);
	expect(await custody()).toEqual(restored); author = await openBrush(); await reedit(author, graph.id, [0, 255]);
	await closeBrush(author); await f.painted(SECOND); expect(await custody()).toEqual(restored); await f.closeDevelop(); expect(f.errors).toEqual([]);

	function custody() { return page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href)).readRepairFramePhotoCustodyNativeV1(ids,
		() => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, ids: f.ids }); }
	function history() { return named(f.develop(), 'combobox', f.words.history); }
	async function acknowledged(revision) {
		await expect.poll(async () => (await f.photos()).photos[0].photo.revision).toBe(revision);
		await expect(f.develop().locator('[data-photo-develop-ack]')).toBeVisible(); await expect(named(f.develop(), 'button', f.words.save)).toBeDisabled();
	}
	async function openBrush() {
		await f.settingsMenu(); await keyboard(page, named(f.develop(), 'button', brush.menu)); const dialog = named(page, 'dialog', brush.title);
		await expect(dialog).toBeVisible(); await expect(named(dialog, 'img', brush.grid)).toHaveAttribute('data-state', 'ready'); return dialog;
	}
	async function alpha(dialog, expected) {
		const canvas = named(dialog, 'img', brush.grid); await expect(canvas).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => canvas.evaluate(node => [node.width, node.height, ...node.getContext('2d').getImageData(0, 0, node.width, node.height).data.filter((_, index) => index % 4 === 3)])).toEqual([2, 1, ...expected]);
	}
	async function stamp(dialog, mode, x) {
		await named(dialog, 'combobox', brush.mode).selectOption(mode);
		for (const [key, value] of [['radius', '.25'], ['hardness', '1'], ['opacity', '1'], ['x', x], ['y', '.5']]) await named(dialog, 'spinbutton', brush[key]).fill(value);
		await keyboard(page, named(dialog, 'button', brush.stamp));
	}
	async function reedit(dialog, id, expected) {
		await named(dialog, 'combobox', brush.mask).selectOption(id); await alpha(dialog, expected);
		for (const [key, value] of [['width', '2'], ['height', '1']]) { await expect(named(dialog, 'spinbutton', brush[key])).toHaveValue(value); await expect(named(dialog, 'spinbutton', brush[key])).toBeDisabled(); }
	}
	async function closeBrush(dialog) {
		const canvases = await dialog.evaluateHandle(node => Array.from(node.querySelectorAll('canvas')));
		try { await keyboard(page, named(dialog, 'button', brush.close).last()); await expect(dialog).toHaveCount(0);
			await expect.poll(() => canvases.evaluate(nodes => nodes.every(canvas => canvas.width === 0 && canvas.height === 0))).toBe(true);
		} finally { await canvases.dispose(); }
	}
	async function check(control) { await expect(control).not.toBeChecked(); await control.focus(); await page.keyboard.press('Space'); await expect(control).toBeChecked(); }
});

function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
function body(alpha) {
	const bytes = Buffer.from([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 1, 0, 0, 0, ...alpha]);
	return { bytes: [...bytes], key: `brush-mask-v1:2:1:${createHash('sha256').update(bytes).digest('hex')}` };
}
function expectBody(value, expected) {
	const observed = value.bodies.find(body => body.reference.storageKey === expected.key); expect(observed).toBeTruthy();
	expect(observed.bytes).toEqual(expected.bytes); expect(observed.reference.byteLength).toBe(18);
	expect(observed.reference.sha256).toBe(createHash('sha256').update(Buffer.from(expected.bytes)).digest('hex'));
}
function retainedRecipe(value, before) { expect(value.repairs).toEqual(before.repairs); expect(value.effects).toEqual(before.effects); expect(value.geometry).toEqual(before.geometry);
	expect(Object.hasOwn(value, 'maskOverlay')).toBe(false); expect(Object.hasOwn(value, 'displayMode')).toBe(false); }
function immutable(value, before) {
	expect(value.namespace).toBe(before.namespace); expect(value.photos).toHaveLength(before.photos.length);
	for (const [index, row] of value.photos.entries()) { expect(row.original).toEqual(before.photos[index].original); expect(row.bytes).toEqual(before.photos[index].bytes); expect(row.photo.original).toEqual(before.photos[index].photo.original); }
	expect(value.photos[1]).toEqual(before.photos[1]);
}
