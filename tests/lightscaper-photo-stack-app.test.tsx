/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryStackAcknowledgementV1, PhotoLibraryStackCommandV1 } from '../src/common/editor/photo-library-stack-port-v1.ts';
import { mountSurveyApp, surveyAppOwner } from './helpers/lightscaper-survey-app-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred } from './helpers/async-test-control.ts';

const context = { schemaVersion: 1, catalogId: 'catalog', catalogRevision: 3, indexRevision: 4, stateRevision: 2, stackCount: 0 } as const;
const stack = { id: 'product-generated-stack', revision: 0, photoIds: ['a', 'b'], coverPhotoId: 'a' };
function fixture() {
	const owner = surveyAppOwner(), commands: PhotoLibraryStackCommandV1[] = [];
	owner.port.readStackMemberships = async ids => ({ context, memberships: ids.map(photoId => ({ photoId, stackId: null })) });
	owner.port.readStackSnapshot = async () => ({ context: { ...context, stackCount: 1 }, stack });
	owner.port.readStackMembers = async (_binding, ids) => ({ context: { ...context, stackCount: 1 },
		rows: ids.map(photoId => ({ photoId, fileName: `${photoId}.png`, photoRevision: 1 })) });
	owner.port.applyStack = async command => { commands.push(command); return { schemaVersion: 1, catalogId: 'catalog',
		catalogRevision: 4, stateRevision: 3, action: command.type === 'create' ? 'created' : command.type === 'update' ? 'updated' : 'dissolved',
		stack: command.type === 'dissolve' ? null : stack, notices: [] }; };
	return { ...owner, commands };
}
for (const locale of ['en', 'de']) test(`actual ${locale} App exposes stack create/edit only in File > Photo and preserves selection`, async () => {
	const owner = fixture(), mounted = await mountSurveyApp(owner.factory, locale);
	try {
		assert.equal(owner.opens(), 0); assert.equal(mounted.dom.find('[data-photo-stack-dialog]'), null);
		const create = mounted.dom.one('[data-photo-stack-create-menu]'); assert.equal(create.hasAttribute('disabled'), true);
		assert.equal(create.closest('details')?.querySelector('summary')?.textContent, mounted.copy.photoPhotoMenu);
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); assert.equal(create.hasAttribute('disabled'), true);
		await mounted.photo('b', true); await mounted.click(create); assert.ok(mounted.dom.find('[data-photo-stack-dialog]'));
		await mounted.click(mounted.dom.one('[data-stack-save]'));
		assert.equal(owner.commands.length, 1); assert.deepEqual(owner.commands[0], { schemaVersion: 1, catalogId: 'catalog',
			expectedCatalogRevision: 3, expectedStateRevision: 2, type: 'create', photoIds: ['a', 'b'], coverPhotoId: 'a' });
		assert.match(mounted.dom.one('[data-stack-ack]').textContent, new RegExp(mounted.copy.photoStackCreated, 'u'));
		assert.deepEqual(mounted.selected(), ['a', 'b']); assert.equal(owner.previews.length, 0);
		await mounted.click(mounted.dom.one('[data-stack-close]'));
		await mounted.click(mounted.dom.one('[data-photo-stack-edit-menu]')); await mounted.click(mounted.dom.one('[data-stack-later="a"]'));
		await mounted.click(mounted.dom.one('[data-stack-cover="b"]')); await mounted.click(mounted.dom.one('[data-stack-save]'));
		assert.deepEqual(owner.commands[1], { schemaVersion: 1, catalogId: 'catalog', expectedCatalogRevision: 3, expectedStateRevision: 2,
			type: 'update', id: 'product-generated-stack', expectedStackRevision: 0, photoIds: ['b', 'a'], coverPhotoId: 'b' });
	} finally { await mounted.dispose(); }
});

test('actual workflow keeps a held stack ACK and cancellation joined after Close, refusing another menu write', async () => {
	const owner = fixture(), saved = deferred<PhotoLibraryStackAcknowledgementV1>(); let signal: AbortSignal | undefined;
	owner.port.applyStack = async (command, options) => { owner.commands.push(command); signal = options?.signal; return saved.promise; };
	const mounted = await mountSurveyApp(owner.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true);
		await mounted.click(mounted.dom.one('[data-photo-stack-create-menu]')); await mounted.click(mounted.dom.one('[data-stack-save]'));
		const stale = reactProps(mounted.dom.one('[data-photo-stack-edit-menu]')).onClick;
		await mounted.click(mounted.dom.one('[data-stack-close]')); assert.equal(signal?.aborted, false);
		assert.equal(mounted.dom.one('[data-photo-stack-edit-menu]').hasAttribute('disabled'), true);
		await mounted.flush(() => { stale?.({ currentTarget: mounted.dom.one('[data-photo-stack-edit-menu]') }); });
		assert.equal(mounted.dom.find('[data-photo-stack-dialog]'), null); assert.equal(owner.commands.length, 1);
		await mounted.menu(mounted.copy.photoCancelAction); assert.equal(signal?.aborted, true);
		await mounted.flush(() => { saved.resolve({ schemaVersion: 1, catalogId: 'catalog', catalogRevision: 4, stateRevision: 3,
			action: 'created', stack, notices: [] }); });
		assert.equal(mounted.dom.find('[data-photo-stack-dialog]'), null); assert.equal(owner.commands.length, 1);
		await mounted.click(mounted.dom.one('[data-photo-stack-edit-menu]')); assert.ok(mounted.dom.find('[data-photo-stack-dialog]'));
	} finally { saved.resolve({ schemaVersion: 1, catalogId: 'catalog', catalogRevision: 4, stateRevision: 3, action: 'created', stack, notices: [] }); await mounted.flush(); await mounted.dispose(); }
});

test('factory replacement retires retained stack menu/Save handlers and joins held old Session close', async () => {
	const first = fixture(), second = fixture(), close = deferred<void>(), saved = deferred<PhotoLibraryStackAcknowledgementV1>(); let closes = 0;
	first.port.close = async () => { closes++; await close.promise; };
	first.port.applyStack = async command => { first.commands.push(command); return saved.promise; };
	const mounted = await mountSurveyApp(first.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true);
		const menu = mounted.dom.one('[data-photo-stack-create-menu]'), staleMenu = reactProps(menu).onClick;
		await mounted.click(menu); const staleSave = reactProps(mounted.dom.one('[data-stack-save]')).onClick;
		await mounted.click(mounted.dom.one('[data-stack-save]')); await mounted.replace(second.factory);
		await mounted.flush(() => { staleMenu?.({ currentTarget: menu }); staleSave?.({}); });
		assert.equal(mounted.dom.find('[data-photo-stack-dialog]'), null); assert.equal(second.opens(), 0); assert.equal(first.commands.length, 1);
		await mounted.menu(mounted.copy.photoFirstPage); assert.equal(second.opens(), 0);
		await mounted.flush(() => { saved.resolve({ schemaVersion: 1, catalogId: 'catalog', catalogRevision: 4, stateRevision: 3, action: 'created', stack, notices: [] }); });
		assert.equal(closes, 1); assert.equal(second.opens(), 0);
		await mounted.flush(() => { close.resolve(); }); assert.equal(second.opens(), 1); assert.equal(second.commands.length, 0);
	} finally { saved.resolve({ schemaVersion: 1, catalogId: 'catalog', catalogRevision: 4, stateRevision: 3, action: 'created', stack, notices: [] }); close.resolve(); await mounted.flush(); await mounted.dispose(); }
});

for (const first of ['stack', 'compare', 'survey'] as const) test(`${first} excludes a retained opposite menu in the same native gesture`, async () => {
	const owner = fixture(), mounted = await mountSurveyApp(owner.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true);
		const stackButton = mounted.dom.one('[data-photo-stack-create-menu]'), compareButton = mounted.dom.one('[data-photo-compare-menu]'),
			surveyButton = mounted.dom.one('[data-photo-survey-menu]');
		const start = reactProps(first === 'stack' ? stackButton : first === 'compare' ? compareButton : surveyButton).onClick;
		const otherButton = first === 'stack' ? compareButton : stackButton, other = reactProps(otherButton).onClick;
		await mounted.flush(() => { start?.({ currentTarget: first === 'stack' ? stackButton : first === 'compare' ? compareButton : surveyButton });
			other?.({ currentTarget: otherButton }); });
		assert.ok(mounted.dom.find(`[data-photo-${first}-dialog]`));
		assert.equal(mounted.dom.find(`[data-photo-${first === 'stack' ? 'compare' : 'stack'}-dialog]`), null);
	} finally { await mounted.dispose(); }
});

for (const locale of ['en', 'de']) test(`actual ${locale} View collapse toggle borrows global steps, keeps default view plain and expands with fresh page authority`, async () => {
	const owner = fixture(), requests: unknown[] = [];
	owner.port.readStackQueryStep = async request => { requests.push(request.cursor);
		return request.cursor === null ? { catalogName: 'Library', totalCount: 4, rows: [], cursor: 'members-64', scanned: 64 }
			: { catalogName: 'Library', totalCount: 4, rows: [{ id: 'b', fileName: 'b.png', width: 2, height: 3, rating: 0, flag: 'unflagged', colorLabel: 'none' }], cursor: null, scanned: 3 }; };
	const mounted = await mountSurveyApp(owner.factory, locale);
	try {
		const menu = mounted.dom.one('[data-photo-stack-view-menu]'); assert.equal(menu.hasAttribute('disabled'), true);
		assert.equal(menu.closest('details')?.querySelector('summary')?.textContent, mounted.copy.photoViewMenu); assert.equal(requests.length, 0);
		await mounted.menu(mounted.copy.photoShowLibrary); assert.equal(mounted.dom.container.querySelectorAll('[data-photo-id]').length, 4);
		await mounted.click(menu); assert.deepEqual(requests, [null, 'members-64']); assert.equal(mounted.dom.container.querySelectorAll('[data-photo-id]').length, 1);
		assert.equal(menu.textContent, mounted.copy.photoStackExpandView); assert.equal(mounted.dom.one('[data-photo-id="b"]').textContent.includes('b.png'), true);
		await mounted.click(menu); assert.equal(menu.textContent, mounted.copy.photoStackCollapseView);
		assert.equal(mounted.dom.container.querySelectorAll('[data-photo-id]').length, 4); assert.equal(owner.commands.length, 0); assert.equal(owner.previews.length, 0);
	} finally { await mounted.dispose(); }
});
