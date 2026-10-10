/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoCubeLutControl from '../src/common/editor/ui/inspector/VideoCubeLutControl.tsx';
import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../src/common/i18n/video-effect-copy.js';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const reference = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 73, size: 2,
	domainMin: [0,0,0] as const, domainMax: [1,1,1] as const };
const file = new File(['LUT_3D_SIZE 2'], 'look.cube');

for (const locale of ['en', 'de'] as const) test(`${locale}: opted-in LUT control uses owning labels and only delivers the selected immutable file`, async () => {
	let received: File | undefined, clears = 0;
	const copy = VIDEO_EFFECT_COPY_BY_LOCALE[locale];
	const mounted = await mountPhotoImportUi(() => <VideoCubeLutControl reference={reference} copy={copy} disabled={false}
		isCurrent={() => true} onImport={value => { received = value; }} onClear={() => { clears++; }} />);
	try {
		assert.equal(mounted.dom.one('input').getAttribute('aria-label'), locale === 'en' ? 'Choose .cube LUT' : '.cube-LUT auswählen');
		await mounted.event('input', 'onChange', { currentTarget: { files: [file], value: 'selected' } });
		assert.equal(received, file); await mounted.event('button', 'onClick'); assert.equal(clears, 1);
	} finally { await mounted.dispose(); }
});

test('a held import excludes clearing and callback reentry until its actual settlement', async () => {
	const held = deferred<void>(); let clears = 0, imports = 0; let reenter = () => undefined;
	const mounted = await mountPhotoImportUi(() => <VideoCubeLutControl reference={reference} copy={VIDEO_EFFECT_COPY_BY_LOCALE.en} disabled={false}
		isCurrent={() => true} onImport={() => { imports++; reenter(); return held.promise; }} onClear={() => { clears++; }} />);
	try {
		reenter = () => { reactProps(mounted.dom.one('button')).onClick?.({}); };
		await mounted.event('input', 'onChange', { currentTarget: { files: [file], value: 'selected' } });
		await mounted.event('button', 'onClick'); assert.equal(imports, 1); assert.equal(clears, 0);
		held.resolve(); await act(async () => { await settle(); }); await mounted.event('button', 'onClick'); assert.equal(clears, 1);
	} finally { held.resolve(); await mounted.dispose(); }
});

test('retained handlers cannot target replaced or unmounted owners and opaque import failure uses fixed copy', async () => {
	let disabled = false, imports = 0, traps = 0; let onImport = () => { imports++; return Promise.resolve(); };
	const mounted = await mountPhotoImportUi(() => <VideoCubeLutControl reference={reference} copy={VIDEO_EFFECT_COPY_BY_LOCALE.en} disabled={disabled}
		isCurrent={() => true} onImport={onImport} onClear={() => undefined} />);
	try {
		const retained = reactProps(mounted.dom.one('input')).onChange!;
		disabled = true; await mounted.render(); await act(async () => { retained({ currentTarget: { files: [file], value: 'selected' } }); });
		assert.equal(imports, 0); disabled = false;
		const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
			getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
		onImport = () => { imports++; return Promise.reject(reason); }; await mounted.render();
		await mounted.event('input', 'onChange', { currentTarget: { files: [file], value: 'selected' } });
		assert.equal(mounted.dom.one('[role="alert"]').textContent, 'The LUT could not be applied.'); assert.equal(traps, 0);
		await mounted.dispose(); retained({ currentTarget: { files: [file], value: 'selected' } }); assert.equal(imports, 1);
	} finally { await mounted.dispose(); }
});

test('native file admission is latched before borrowed currentness can synchronously reenter the retained handler', async () => {
	let checks = 0, imports = 0, retained: ((event: unknown) => unknown) | undefined;
	const event = { currentTarget: { files: [file], value: 'selected' } };
	const mounted = await mountPhotoImportUi(() => <VideoCubeLutControl reference={reference} copy={VIDEO_EFFECT_COPY_BY_LOCALE.en} disabled={false}
		isCurrent={() => { checks++; if (checks === 1) retained?.(event); return true; }} onImport={() => { imports++; }} onClear={() => undefined} />);
	try {
		retained = reactProps(mounted.dom.one('input')).onChange!;
		await act(async () => { retained!(event); }); assert.equal(checks, 1); assert.equal(imports, 1);
	} finally { await mounted.dispose(); }
});

test('failed LUT import re-arms the same file before the callback and permits a retry after settlement', async () => {
	const input = { files: [file], value: 'C:\\fakepath\\look.cube' }, attempts: File[] = [];
	const mounted = await mountPhotoImportUi(() => <VideoCubeLutControl reference={reference} copy={VIDEO_EFFECT_COPY_BY_LOCALE.en} disabled={false}
		isCurrent={() => true} onImport={selected => {
			assert.equal(input.value, '', 'the import callback must see an already re-armed picker'); attempts.push(selected);
			if (attempts.length === 1) return Promise.reject(new Error('Invalid LUT body.'));
		}} onClear={() => undefined} />);
	try {
		await mounted.event('input', 'onChange', { currentTarget: input });
		assert.equal(mounted.dom.one('[role="alert"]').textContent, 'The LUT could not be applied.');
		input.value = 'C:\\fakepath\\look.cube'; await mounted.event('input', 'onChange', { currentTarget: input });
		assert.deepEqual(attempts, [file, file]); assert.equal(input.value, '');
		assert.equal(mounted.dom.find('[role="alert"]'), null);
		input.files = []; input.value = 'C:\\fakepath\\look.cube'; await mounted.event('input', 'onChange', { currentTarget: input });
		assert.equal(input.value, ''); assert.deepEqual(attempts, [file, file]);
	} finally { await mounted.dispose(); }
});
