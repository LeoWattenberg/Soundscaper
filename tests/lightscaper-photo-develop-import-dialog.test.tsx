/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoImportDialog from '../src/common/editor/ui/lightscaper/PhotoImportDialog.tsx';
import type { PhotoLibraryImportGestureOptionsV2 } from '../src/common/editor/photo-library-develop-import-port-v1.ts';
import type { PhotoLibraryDevelopPresetSnapshotV1 } from '../src/common/editor/photo-library-develop-presets-port-v1.ts';
import { importDialogProps } from './helpers/photo-import-dialog-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const menu: PhotoLibraryDevelopPresetSnapshotV1 = { schemaVersion: 1, catalogId: 'catalog', revision: 7, presets: [
	{ id: 'look', name: 'Look', scope: 'partial', authoredStateSha256: 'a'.repeat(64) },
] };
const file = new File(['original bytes'], '東京 é source.png');
const choice = { schemaVersion: 1, catalogId: 'catalog', presetId: 'look', expectedRevision: 7 };

test('whole Import dialog reads no Develop menu by default and submits only an explicitly selected scalar choice', async () => {
	let reads = 0, calls = 0, request: PhotoLibraryImportGestureOptionsV2 | undefined;
	const props = { ...importDialogProps(), readDevelopPresets: async () => { reads++; return menu; } };
	props.onImport = async (files, options) => { calls++; assert.equal(files[0], file); request = options; return { outcome: 'failed' }; };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialog {...props} />);
	try {
		assert.equal(reads, 0); assert.equal(mounted.dom.container.querySelector('[data-import-develop-choice]'), null);
		Reflect.set(mounted.dom.one('input'), 'files', [file]); await mounted.event('input', 'onChange');
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } }); assert.equal(reads, 1);
		await mounted.event('[data-import-develop-choice]', 'onChange', { currentTarget: { value: 'look' } });
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: false } });
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } }); assert.equal(reads, 2);
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(calls, 1);
		assert.deepEqual(request?.developPreset, choice); assert.equal(Object.isFrozen(request?.developPreset), true);
		assert.equal(Object.hasOwn(request ?? {}, 'settings'), false); assert.equal(Object.hasOwn(request?.developPreset ?? {}, 'body'), false);
		assert.equal(file.name, '東京 é source.png');
	} finally { await mounted.dispose(); }
});

test('whole Import dialog refuses submission and a replacement read until its collapsed canceled list actually joins', async () => {
	const held = deferred<PhotoLibraryDevelopPresetSnapshotV1>(); let reads = 0, calls = 0, signal: AbortSignal | undefined;
	const readDevelopPresets = async (options?: Readonly<{ signal?: AbortSignal }>) => {
		reads++; if (reads === 1) { signal = options?.signal; return held.promise; } return menu;
	};
	const props = { ...importDialogProps(), readDevelopPresets };
	props.onImport = async () => { calls++; return { outcome: 'failed' }; };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialog {...props} />);
	try {
		Reflect.set(mounted.dom.one('input'), 'files', [file]); await mounted.event('input', 'onChange');
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } }); assert.equal(reads, 1);
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: false } }); assert.equal(signal?.aborted, true);
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } }); assert.equal(reads, 1);
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(calls, 0);
		await act(async () => { held.resolve(menu); await settle(); }); assert.equal(reads, 2);
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(calls, 1);
	} finally { held.resolve(menu); await mounted.dispose(); }
});
