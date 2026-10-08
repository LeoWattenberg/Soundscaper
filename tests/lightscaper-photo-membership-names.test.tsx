/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PhotoMembershipNames from '../src/common/editor/ui/lightscaper/PhotoMembershipNames.tsx';
import { PhotoLibraryDefinitionReader } from '../src/common/editor/controller/shared/photo-library-definition-reader.ts';
import type { PhotoLibraryDefinitionReadRequestV1, PhotoLibraryDefinitionSnapshotV1 } from '../src/common/editor/photo-library-organization-port-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const copy = { photoWorking: 'Working', photoDefinitionFailed: 'Definition unavailable', photoMembershipRemove: 'Remove' };
function result(request: PhotoLibraryDefinitionReadRequestV1, name = `Display ${request.id}`): PhotoLibraryDefinitionSnapshotV1 {
	return { rootRevision: 7, queryJson: null, row: request.kind === 'collection'
		? { kind: request.kind, id: request.id, name, collectionKind: 'manual' }
		: { kind: request.kind, id: request.id, name, parentId: null } };
}

test('one64-ID display page borrows definition reads serially and renders human names', async () => {
	const first = deferred<PhotoLibraryDefinitionSnapshotV1>(), ids = Array.from({ length: 64 }, (_, index) => `opaque-${index}`);
	const calls: PhotoLibraryDefinitionReadRequestV1[] = []; let active = 0, maximum = 0;
	const mounted = await mount({ ids, kind: 'keyword', snapshotKey: 'photo:9', copy, reader: new PhotoLibraryDefinitionReader(),
		onRemove: () => undefined, readDefinition: async request => {
			calls.push(request); active++; maximum = Math.max(active, maximum);
			try { return calls.length === 1 ? await first.promise : result(request, `Keyword ${calls.length}`); }
			finally { active--; }
		} });
	try {
		assert.equal(calls.length, 1); assert.equal(mounted.dom.container.querySelectorAll('[data-membership-id]').length, 64);
		await act(async () => { first.resolve(result(calls[0]!, 'First human keyword')); });
		assert.equal(calls.length, 64); assert.equal(maximum, 1);
		assert.equal(mounted.dom.one('[data-membership-name="opaque-0"]').textContent, 'First human keyword');
		assert.equal(mounted.dom.one('[data-membership-name="opaque-63"]').textContent, 'Keyword 64');
		assert.equal(mounted.dom.container.textContent.includes('opaque-'), false);
	} finally { first.resolve(result({ kind: 'keyword', id: 'opaque-0' })); await mounted.dispose(); }
});

test('offset/kind/snapshot replacement aborts old and pending names without overlapping borrowed reads', async () => {
	const held = deferred<PhotoLibraryDefinitionSnapshotV1>(), calls: PhotoLibraryDefinitionReadRequestV1[] = [], removals: string[] = [];
	const reader = new PhotoLibraryDefinitionReader(), readDefinition = async (request: PhotoLibraryDefinitionReadRequestV1) => {
		calls.push(request); return calls.length === 1 ? held.promise : result(request, 'Current manual collection');
	};
	const props = { ids: ['old'], kind: 'keyword' as const, snapshotKey: 'photo:9', copy, reader, readDefinition,
		onRemove: (id: string) => { removals.push(id); } };
	const mounted = await mount(props);
	try {
		await mounted.render({ ...props, ids: ['next-page'] });
		assert.equal(calls[0]?.signal?.aborted, true); assert.equal(calls.length, 1);
		await mounted.render({ ...props, ids: ['old-collection'], kind: 'collection' });
		await mounted.render({ ...props, ids: ['current'], kind: 'collection', snapshotKey: 'photo:10' });
		assert.equal(calls.length, 1);
		await act(async () => { held.resolve(result({ kind: 'keyword', id: 'old' }, 'Obsolete keyword')); });
		assert.deepEqual(calls.map(request => request.id), ['old', 'current']);
		assert.equal(mounted.dom.one('[data-membership-name="current"]').textContent, 'Current manual collection');
		assert.equal(mounted.dom.container.textContent.includes('Obsolete keyword'), false);
		await mounted.click('[data-membership-remove="current"]'); assert.deepEqual(removals, ['current']);
	} finally { held.resolve(result({ kind: 'keyword', id: 'old' })); await mounted.dispose(); }
});

test('failed or mismatched definitions have explicit ID fallbacks and unmount aborts held lookup', async () => {
	const held = deferred<PhotoLibraryDefinitionSnapshotV1>(); let signal: AbortSignal | undefined;
	const props = { ids: ['missing', 'wrong', 'held'], kind: 'folder' as const, snapshotKey: 'photo:9', copy, reader: new PhotoLibraryDefinitionReader(),
		onRemove: () => undefined, readDefinition: async (request: PhotoLibraryDefinitionReadRequestV1) => {
			if (request.id === 'missing') throw new ReferenceError('Definition disappeared');
			if (request.id === 'wrong') return result({ kind: 'folder', id: 'other' }, 'Wrong source');
			signal = request.signal; return held.promise;
		} };
	const mounted = await mount(props);
	assert.equal(mounted.dom.one('[data-membership-name="missing"]').textContent, 'Definition unavailable (missing)');
	assert.equal(mounted.dom.one('[data-membership-name="wrong"]').textContent, 'Definition unavailable (wrong)');
	await mounted.dispose(); assert.equal(signal?.aborted, true);
	held.resolve(result({ kind: 'folder', id: 'held' })); await Promise.resolve();
});

type Props = React.ComponentProps<typeof PhotoMembershipNames>;
async function mount(props: Props) {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const render = async (next: Props) => { await act(async () => { root.render(<PhotoMembershipNames {...next} />); }); };
	await render(props);
	return { dom, render, async click(selector: string) { await act(async () => { reactProps(dom.one(selector)).onClick?.({}); }); },
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } } };
}
