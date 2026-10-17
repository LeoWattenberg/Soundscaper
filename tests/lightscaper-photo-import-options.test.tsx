/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useState } from 'react';
import PhotoImportOptions, { type PhotoImportOptionsCopyV1 } from '../src/common/editor/ui/lightscaper/PhotoImportOptions.tsx';
import type { PhotoLibraryImportSettingsV1 } from '../src/common/editor/photo-library-import-settings-port-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';

const copy: PhotoImportOptionsCopyV1 = { photoImportOptions: 'Import options', photoImportRename: 'Rename catalog display names',
	photoImportNameTemplate: 'Template', photoImportSequenceStart: 'Start', photoImportSequencePadding: 'Padding',
	photoImportMetadataHelp: 'Unchecked fields keep source values; checked empty fields clear them.', photoImportOverride: 'Override {field}',
	photoMetadataTitle: 'Title', photoCaption: 'Caption', photoCreator: 'Creator', photoCopyright: 'Copyright', photoLocation: 'Location' };
const initial: PhotoLibraryImportSettingsV1 = { rename: null, metadata: {}, keywordIds: [] };

test('plain options are collapsed and do not mount resource-bearing children until explicitly opened', async () => {
	let renders = 0, changes = 0;
	function Child() { renders++; return <span data-resource-child />; }
	const mounted = await mountPhotoImportUi(() => <PhotoImportOptions value={initial} onChange={() => { changes++; }} busy={false} copy={copy}><Child /></PhotoImportOptions>);
	try {
		assert.equal(renders, 0); assert.equal(mounted.dom.find('input'), null);
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } });
		assert.equal(renders, 1); assert.ok(mounted.dom.find('[data-resource-child]'));
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: false } });
		assert.equal(mounted.dom.find('[data-resource-child]'), null); assert.equal(changes, 0);
	} finally { await mounted.dispose(); }
});

test('metadata overrides distinguish omitted fields from explicit blank and preserve exact Unicode and multiline values', async () => {
	let value = initial;
	function Harness() { const [current, setCurrent] = useState(initial); value = current;
		return <PhotoImportOptions value={current} onChange={setCurrent} busy={false} copy={copy} />; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } });
		await mounted.event('[data-import-override="title"]', 'onChange', { currentTarget: { checked: true } });
		assert.deepEqual({ ...value.metadata }, { title: '' });
		await mounted.event('[data-import-metadata="title"]', 'onChange', { currentTarget: { value: 'Ä東京 é 📷' } });
		assert.equal(value.metadata.title, 'Ä東京 é 📷');
		await mounted.event('[data-import-override="caption"]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event('[data-import-metadata="caption"]', 'onChange', { currentTarget: { value: 'First\nSecond\tline' } });
		assert.equal(value.metadata.caption, 'First\nSecond\tline');
		await mounted.event('[data-import-override="title"]', 'onChange', { currentTarget: { checked: false } });
		assert.equal(Object.hasOwn(value.metadata, 'title'), false); assert.equal(Object.hasOwn(value.metadata, 'creator'), false);
		assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.metadata), true); assert.equal(Object.isFrozen(value.keywordIds), true);
	} finally { await mounted.dispose(); }
});

test('rename controls preserve literal templates and include only authored numeric choices', async () => {
	let value = initial;
	function Harness() { const [current, setCurrent] = useState(initial); value = current;
		return <PhotoImportOptions value={current} onChange={setCurrent} busy={false} copy={copy} />; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } });
		await mounted.event('[data-import-rename]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event('[data-import-template]', 'onChange', { currentTarget: { value: '{stem}-東京-{sequence}.{extension}' } });
		await mounted.event('[data-import-sequence-start]', 'onChange', { currentTarget: { valueAsNumber: 7 } });
		await mounted.event('[data-import-sequence-padding]', 'onChange', { currentTarget: { valueAsNumber: 6 } });
		assert.deepEqual(value.rename, { template: '{stem}-東京-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 6 });
		assert.equal(Object.isFrozen(value.rename), true);
		await mounted.event('[data-import-rename]', 'onChange', { currentTarget: { checked: false } }); assert.equal(value.rename, null);
	} finally { await mounted.dispose(); }
});

test('busy controls refuse stale event handlers and closing options retains the controlled recipe', async () => {
	let writes = 0, busy = false;
	const value: PhotoLibraryImportSettingsV1 = { ...initial, metadata: { title: 'Draft' } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportOptions value={value} onChange={() => { writes++; }} busy={busy} copy={copy} />);
	try {
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } });
		busy = true; await mounted.render();
		await mounted.event('[data-import-override="title"]', 'onChange', { currentTarget: { checked: false } });
		await mounted.event('[data-import-rename]', 'onChange', { currentTarget: { checked: true } }); assert.equal(writes, 0);
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: false } });
		busy = false; await mounted.render(); await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } });
		assert.equal(mounted.dom.one('[data-import-metadata="title"]').value, 'Draft');
	} finally { await mounted.dispose(); }
});
