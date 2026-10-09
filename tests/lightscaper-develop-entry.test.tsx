/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { usePhotoDevelopEntry } from '../src/common/editor/ui/lightscaper/use-photo-develop-entry.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { settle, deferred } from './helpers/async-test-control.ts';

for (const generation of [null, Number.NaN]) test(`opaque ${String(generation)} generation is a valid exclusive menu identity`, async () => {
	let actual!: ReturnType<typeof usePhotoDevelopEntry>, starts = 0;
	function Harness() { actual = usePhotoDevelopEntry(generation); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await act(async () => { actual.begin('photo', 'Photo', () => { starts++; return Promise.resolve(); }); });
		assert.ok(actual.entry); assert.equal(actual.isCurrent(), true); assert.equal(actual.isAdmitted(), true);
		await act(async () => { actual.begin('other', 'Other', () => { starts++; return Promise.resolve(); }); }); assert.equal(starts, 1);
		await act(async () => { actual.close(Promise.resolve()); await settle(); });
		assert.equal(actual.entry, null); assert.equal(actual.isAdmitted(), false);
	} finally { await mounted.dispose(); }
});

test('signed-zero replacement refuses old handlers and joins the retired demand before a new open', async () => {
	let generation = 0, actual!: ReturnType<typeof usePhotoDevelopEntry>, starts = 0;
	function Harness() { actual = usePhotoDevelopEntry(generation); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />), held = deferred<void>();
	try {
		await act(async () => { actual.begin('photo', 'Photo', () => Promise.resolve()); });
		const oldBegin = actual.begin, unregister = actual.register(() => held.promise);
		generation = -0; await mounted.render(); assert.equal(actual.entry, null);
		await act(async () => { oldBegin('old', 'Old', () => { starts++; return Promise.resolve(); }); }); assert.equal(starts, 0);
		unregister(); await act(async () => { actual.begin('photo', 'New', () => { starts++; return Promise.resolve(); }); });
		let joined = false; void actual.entry!.beforeOpen.then(() => { joined = true; }); await settle(); assert.equal(joined, false);
		held.resolve(); await actual.entry!.beforeOpen; assert.equal(joined, true);
	} finally { held.resolve(); await mounted.dispose(); }
});

test('failed pixel cleanup still joins a held scalar demand and blocks replacement generations', async () => {
	let generation = {}, actual!: ReturnType<typeof usePhotoDevelopEntry>, starts = 0;
	function Harness() { actual = usePhotoDevelopEntry(generation); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />), held = deferred<void>(), cleanup = new Error('Pixel cleanup failed');
	try {
		await act(async () => { actual.begin('photo', 'Photo', () => Promise.resolve()); });
		actual.register(() => held.promise);
		await act(async () => { actual.close(Promise.reject(cleanup)); await settle(); });
		assert.equal(actual.closing, true); assert.equal(actual.isAdmitted(), true);
		await act(async () => { held.resolve(); await settle(); }); generation = {}; await mounted.render();
		await act(async () => { actual.begin('new', 'New', () => { starts++; return Promise.resolve(); }); });
		assert.equal(starts, 0); assert.equal(actual.closing, true);
	} finally { held.resolve(); await mounted.dispose(); }
});
