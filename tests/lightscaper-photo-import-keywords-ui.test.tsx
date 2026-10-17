/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import PhotoImportKeywordOptions, { type PhotoImportKeywordOptionsPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoImportKeywordOptions.tsx';
import { PhotoLibraryDefinitionReader } from '../src/common/editor/controller/shared/photo-library-definition-reader.ts';
import type { PhotoLibraryDefinitionReadRequestV1, PhotoLibraryDefinitionSnapshotV1 } from '../src/common/editor/photo-library-organization-port-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

const copy = { photoKeywords: 'Keywords', photoImportAddKeyword: 'Add keyword', photoImportRemoveKeyword: 'Remove keyword',
	photoImportNoKeywords: 'No added keywords', photoImportPreviousKeywords: 'Previous added keywords', photoImportNextKeywords: 'Next added keywords',
	photoDefinitionRoot: 'Top level', photoDefinitionUp: 'Parent', photoDefinitionNext: 'Next definitions', photoDefinitionReload: 'Reload definitions',
	photoDefinitionChoose: 'Choose', photoDefinitionOpen: 'Open', photoDefinitionClear: 'Clear selection', photoDefinitionSelected: 'Selected',
	photoDefinitionEmpty: 'No definitions', photoDefinitionFailed: 'Definition unavailable', photoWorking: 'Working' };
function result(id: string): PhotoLibraryDefinitionSnapshotV1 { return { rootRevision: 7, queryJson: null,
	row: { kind: 'keyword', id, name: `Name ${id.replace('keyword-', '')}`, parentId: null } }; }
const ids = Array.from({ length: 70 }, (_, index) => `keyword-${String(index).padStart(3, '0')}`);
const base: PhotoImportKeywordOptionsPropsV1 = { copy, busy: false, keywordIds: [], onChange: () => undefined,
	definitionReader: new PhotoLibraryDefinitionReader(), readDefinition: async request => result(request.id),
	readDefinitions: async () => ({ rootRevision: 7, rows: [{ kind: 'keyword', id: 'extra', name: 'Extra keyword', parentId: null },
		{ kind: 'keyword', id: 'second', name: 'Second keyword', parentId: null }], parent: null, selected: null, cursor: null }) };

test('a 64-name page retains unseen loaded-preset IDs and changes only explicitly removed or added keywords', async () => {
	let value: readonly string[] = ids;
	function Harness() { const [current, setCurrent] = useState<readonly string[]>(ids); value = current;
		return <PhotoImportKeywordOptions {...base} keywordIds={current} onChange={setCurrent} />; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-membership-id]').length, 64);
		assert.equal(mounted.dom.one('[data-membership-name="keyword-000"]').textContent, 'Name 000');
		assert.equal(mounted.dom.container.textContent.includes('keyword-000'), false);
		await mounted.event('[data-import-keywords-next]', 'onClick'); assert.equal(mounted.dom.container.querySelectorAll('[data-membership-id]').length, 6);
		await mounted.event('[data-membership-remove="keyword-069"]', 'onClick');
		await mounted.event('[data-definition-choose="extra"]', 'onClick'); await mounted.event('[data-import-keyword-add]', 'onClick');
		assert.deepEqual(new Set(value), new Set([...ids.slice(0, -1), 'extra'])); assert.equal(Object.isFrozen(value), true);
	} finally { await mounted.dispose(); }
});

test('rapid Choose then Add uses the new selected identity and duplicate Add does not queue or overwrite IDs', async () => {
	let value: readonly string[] = [], changes = 0;
	function Harness() { const [current, setCurrent] = useState<readonly string[]>([]); value = current;
		return <PhotoImportKeywordOptions {...base} keywordIds={current} onChange={next => { changes++; setCurrent(next); }} />; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await mounted.event('[data-definition-choose="extra"]', 'onClick');
		await act(async () => {
			reactProps(mounted.dom.one('[data-definition-choose="second"]')).onClick?.({});
			const add = reactProps(mounted.dom.one('[data-import-keyword-add]')).onClick; add?.({}); add?.({});
		});
		assert.deepEqual(value, ['second']); assert.equal(changes, 1);
	} finally { await mounted.dispose(); }
});

test('busy guards and the 1024-reference cap preserve all keyword IDs', async () => {
	let changes = 0, busy = false;
	const full = Array.from({ length: 1_024 }, (_, index) => `id-${index}`);
	const mounted = await mountPhotoImportUi(() => <PhotoImportKeywordOptions {...base} keywordIds={full} busy={busy} onChange={() => { changes++; }} />);
	try {
		await mounted.event('[data-definition-choose="extra"]', 'onClick');
		await mounted.event('[data-import-keyword-add]', 'onClick'); assert.equal(changes, 0);
		busy = true; await mounted.render(); await mounted.event('[data-membership-remove="id-0"]', 'onClick'); assert.equal(changes, 0);
		assert.equal(mounted.dom.container.querySelectorAll('[data-membership-id]').length, 64);
	} finally { await mounted.dispose(); }
});

test('close and reopen share the App reader and cannot publish a held obsolete keyword name', async () => {
	const held = deferred<PhotoLibraryDefinitionSnapshotV1>(), calls: PhotoLibraryDefinitionReadRequestV1[] = [];
	const readDefinition: typeof base.readDefinition = async request => { calls.push(request); return calls.length === 1 ? held.promise : result(request.id); };
	const props = { ...base, definitionReader: new PhotoLibraryDefinitionReader(), readDefinition };
	const first = await mountPhotoImportUi(() => <PhotoImportKeywordOptions {...props} keywordIds={['old']} />);
	await first.dispose(); const second = await mountPhotoImportUi(() => <PhotoImportKeywordOptions {...props} keywordIds={['new']} />);
	try {
		assert.equal(calls.length, 1); assert.equal(calls[0]?.signal?.aborted, true);
		await act(async () => { held.resolve(result('old')); });
		assert.deepEqual(calls.map(request => request.id), ['old', 'new']);
		assert.equal(second.dom.one('[data-membership-name="new"]').textContent, 'Name new');
		assert.equal(second.dom.container.textContent.includes('Name old'), false);
	} finally { held.resolve(result('old')); await second.dispose(); }
});
