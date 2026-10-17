/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { usePhotoRasterExportEntry } from '../src/common/editor/ui/lightscaper/use-photo-raster-export-entry.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

type Owner = ReturnType<typeof usePhotoRasterExportEntry>;
async function withEntry(run: (f: Awaited<ReturnType<typeof entryFixture>>) => Promise<void>): Promise<void> {
	const f = await entryFixture(), errors: unknown[] = [];
	try { await run(f); } catch (error) { errors.push(error); }
	try { await f.m.dispose(); } catch (error) { errors.push(error); }
	if (errors.length === 1) throw errors[0];
	if (errors.length) throw new AggregateError(errors, 'Entry test and cleanup failed.', { cause: errors[0] });
}
async function entryFixture() {
	let generation: unknown = {}, selected = { id: 'photo-a', fileName: 'Original A.png' }, disabled = false;
	let owner: Owner | null = null, preparations = 0, menuCloses = 0, allowClose = true;
	const prepareSave = () => { preparations++; return Promise.resolve(null); };
	function Harness() {
		owner = usePhotoRasterExportEntry({ generation, locale: 'en', disabled, selection: selected, selected: [selected], prepareSave,
			closeMenu: () => { menuCloses++; return allowClose; } });
		return <>{owner.menus.map(menu => <button key={menu.key} data-single-menu={menu.key} disabled={menu.disabled} onClick={menu.onClick}>{menu.label}</button>)}</>;
	}
	const m = await mountPhotoImportUi(() => <Harness />);
	return { m, get owner(): Owner { assert.ok(owner); return owner; }, get preparations() { return preparations; }, get menuCloses() { return menuCloses; },
		get generation() { return generation; }, readEntry(): Owner['entry'] { assert.ok(owner); return owner.entry; },
		async choose(format: 'png' | 'jpeg' | 'batch' | 'queue') { await m.event(`[data-single-menu="${format}"]`, 'onClick'); },
		async replaceGeneration(value: unknown) { generation = value; await m.render(); },
		async setSelection(value: typeof selected) { selected = value; await m.render(); },
		async setDisabled(value: boolean) { disabled = value; await m.render(); },
		setMenuAdmission(value: boolean) { allowClose = value; },
	};
}

for (const format of ['png', 'jpeg'] as const) test(`File Export queue reopens the same hidden ${format} entry, including a settled receipt`, async () => {
	await withEntry(async f => {
		await f.choose(format); const first = f.readEntry(); assert.ok(first); assert.equal(first.mode, 'single');
		assert.equal(first.visible, true); assert.equal(f.preparations, 1);
		await act(async () => { f.owner.hide(); }); assert.equal(f.readEntry()?.visible, false);
		assert.equal(reactProps(f.m.dom.one('[data-single-menu="queue"]')).disabled, false);
		await f.choose('queue'); assert.equal(f.readEntry()?.key, first.key); assert.equal(f.readEntry()?.visible, true); assert.equal(f.preparations, 1);
		await act(async () => { f.owner.settled(); f.owner.hide(); });
		await f.setSelection({ id: 'photo-b', fileName: 'Original B.png' }); await f.setDisabled(true);
		assert.equal(reactProps(f.m.dom.one('[data-single-menu="queue"]')).disabled, false, 'Existing queue does not require a current selection.');
		await f.choose('queue'); const reopened = f.readEntry(); assert.ok(reopened); assert.equal(reopened.key, first.key);
		assert.equal(reopened.mode, 'single'); if (reopened.mode === 'single') assert.equal(reopened.photoId, 'photo-a');
		assert.equal(reopened.settled, true); assert.equal(f.preparations, 1);
	});
});

test('single menu admission latches synchronously before React commits a second click', async () => {
	await withEntry(async f => {
		const png = reactProps(f.m.dom.one('[data-single-menu="png"]')).onClick;
		const jpeg = reactProps(f.m.dom.one('[data-single-menu="jpeg"]')).onClick;
		assert.ok(png); assert.ok(jpeg);
		await act(async () => { png({}); jpeg({}); assert.equal(f.preparations, 1, 'The second original gesture cannot replace a queued job.'); });
		const queued = f.readEntry(); assert.ok(queued); assert.equal(queued.mode, 'single'); if (queued.mode === 'single') assert.equal(queued.format, 'png');
		assert.equal(f.menuCloses, 1);
	});
});

test('a retained pre-admission menu callback cannot replace a live single job or prepare again', async () => {
	await withEntry(async f => {
		const oldJpeg = reactProps(f.m.dom.one('[data-single-menu="jpeg"]')).onClick; assert.ok(oldJpeg);
		await f.choose('png'); const key = f.readEntry()?.key;
		await act(async () => { oldJpeg({}); }); assert.equal(f.readEntry()?.key, key); assert.equal(f.preparations, 1);
		assert.equal(f.menuCloses, 1);
	});
});

test('callbacks belonging to a retired job cannot close, hide or settle its same-generation replacement', async () => {
	await withEntry(async f => {
		await f.choose('png'); const old = f.owner, key = old.entry?.key;
		await act(async () => { old.close(); }); assert.equal(f.readEntry(), null);
		await f.choose('jpeg'); const replacement = f.readEntry(); assert.ok(replacement); assert.notEqual(replacement.key, key);
		await act(async () => { old.hide(); old.settled(); old.close(); });
		assert.deepEqual(f.readEntry(), replacement); assert.equal(f.preparations, 2);
	});
});

test('old-generation events and lifecycle callbacks cannot admit or mutate the new selected generation', async () => {
	await withEntry(async f => {
		const stalePng = reactProps(f.m.dom.one('[data-single-menu="png"]')).onClick; assert.ok(stalePng);
		await f.choose('png'); const old = f.owner;
		await f.replaceGeneration({ next: true }); assert.equal(f.readEntry(), null);
		await act(async () => { stalePng({}); }); assert.equal(f.readEntry(), null); assert.equal(f.preparations, 1);
		await f.choose('jpeg'); const next = f.readEntry(); assert.ok(next);
		await act(async () => { old.hide(); old.settled(); old.close(); }); assert.deepEqual(f.readEntry(), next); assert.equal(f.preparations, 2);
	});
});

test('queue admission also latches before render and refused menu closure creates no work', async () => {
	await withEntry(async f => {
		f.setMenuAdmission(false); await f.choose('png'); assert.equal(f.readEntry(), null); assert.equal(f.preparations, 0);
		f.setMenuAdmission(true);
		const queue = reactProps(f.m.dom.one('[data-single-menu="queue"]')).onClick; assert.ok(queue);
		await act(async () => { queue({}); queue({}); assert.equal(f.preparations, 1); });
		assert.equal(f.readEntry()?.mode, 'batch');
	});
});

test('a retained menu gesture cannot export a different selection after the same library rerenders', async () => {
	await withEntry(async f => {
		const oldPng = reactProps(f.m.dom.one('[data-single-menu="png"]')).onClick; assert.ok(oldPng);
		await f.setSelection({ id: 'photo-b', fileName: 'Original B.png' });
		await act(async () => { oldPng({}); });
		assert.equal(f.readEntry(), null); assert.equal(f.preparations, 0); assert.equal(f.menuCloses, 0);
		await f.choose('png'); const admitted = f.readEntry(); assert.ok(admitted); assert.equal(admitted.mode, 'single');
		if (admitted.mode === 'single') assert.equal(admitted.photoId, 'photo-b');
		assert.equal(f.preparations, 1);
	});
});
