/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { PhotoLibraryRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoSurveyDialogCopyV1, PhotoSurveyDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoSurveyDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: PhotoSurveyDialog } = await import('../src/common/editor/ui/lightscaper/PhotoSurveyDialog.tsx');
hooks.deregister();
const copy: PhotoSurveyDialogCopyV1 = {
	photoSurveyTitle: 'Survey selected photos', photoSurveyDescription: 'Removing a photo from this review keeps it in the catalog.',
	photoSurveyPrevious: 'Previous photo', photoSurveyNext: 'Next photo', photoSurveyRemove: 'Remove from review',
	photoSurveyRestore: 'Restore removed photos', photoSurveyKeys: 'Left/Right focuses; 0–5 rates; P/X/U flags; Delete removes from review.',
	photoSurveyEmpty: 'No photos remain in this review.', photoSurveyUnavailable: 'This review is unavailable.',
	photoSurveyRefreshFailed: 'Photo saved; review refresh failed.', photoSurveyFocused: 'Focused photo', photoSurveyPhoto: 'Photo',
	photoRating: 'Rating', photoFlag: 'Flag', photoColorLabel: 'Color label', photoCloseMetadata: 'Close',
	photoWorking: 'Working', photoPreviewUnavailable: 'Preview unavailable',
};
const flags = { unflagged: 'Unflagged', pick: 'Pick', reject: 'Reject' } as const;
const colorLabels = { none: 'None', red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' } as const;
const rows: readonly PhotoLibraryRowV1[] = Array.from({ length: 4 }, (_, i) => ({ id: `photo-${String(i)}`,
	fileName: `e\u0301-${String(i)}-<&>.PNG`, width: 2, height: 3, rating: i, flag: i === 0 ? 'pick' : 'unflagged', colorLabel: i === 0 ? 'blue' : 'none' }));
function props(overrides: Partial<PhotoSurveyDialogPropsV1> = {}): PhotoSurveyDialogPropsV1 {
	return { generation: {}, snapshot: { open: true, capturedPhotoIds: ['photo-0', 'photo-2', 'photo-3'],
		photoIds: ['photo-0', 'photo-2', 'photo-3'], removedPhotoIds: [], focusedPhotoId: 'photo-2', pendingPhotoId: null, notice: null },
		rows, previewTargets: [{ photoId: 'photo-0', tier: 'thumbnail', status: 'ready', error: null },
			{ photoId: 'photo-2', tier: 'fit-screen', status: 'ready', error: null }, { photoId: 'photo-3', tier: 'thumbnail', status: 'ready', error: null }],
		copy, flags, colorLabels, renderThumbnail: (id, label) => <canvas data-thumb-photo={id} role="img" aria-label={label} />,
		renderFitScreen: (id, label) => <canvas data-fit-photo={id} role="img" aria-label={label} />,
		busy: false, error: null, notice: null, onFocus: () => undefined, onPrevious: () => undefined, onNext: () => undefined,
		onRemove: () => undefined, onRestoreRemoved: () => undefined, onRate: () => undefined, onFlag: () => undefined,
		onColorLabel: () => undefined, onClose: () => undefined, ...overrides };
}
async function mount(initial: PhotoSurveyDialogPropsV1, strict = false) {
	const dom = installReactTestDom(), doc = dom.container.ownerDocument, root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<EventListener>(), add = doc.addEventListener, remove = doc.removeEventListener;
	Object.defineProperty(doc, 'addEventListener', { configurable: true, value: (...args: unknown[]) => {
		if (args[0] === 'keydown' && typeof args[1] === 'function') listeners.add(args[1] as EventListener);
		Reflect.apply(add, doc, args);
	} });
	Object.defineProperty(doc, 'removeEventListener', { configurable: true, value: (...args: unknown[]) => {
		if (args[0] === 'keydown' && typeof args[1] === 'function') listeners.delete(args[1] as EventListener);
		Reflect.apply(remove, doc, args);
	} });
	let current = initial;
	const render = async () => { await act(async () => {
		const dialog = <PhotoSurveyDialog {...current} />; root.render(strict ? <StrictMode>{dialog}</StrictMode> : dialog);
	}); };
	try { await render(); } catch (error) { await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; throw error; }
	return { dom,
		async replace(next: PhotoSurveyDialogPropsV1) { current = next; await render(); },
		async event(selector: string, name: string, value: unknown = {}) { await act(async () => { reactProps(dom.one(selector))[name]?.(value); }); },
		async key(id: string, key: string, options: Readonly<{ target?: Element; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }> = {}) {
			const node = dom.one(`[data-survey-photo="${id}"]`); let prevented = false;
			await act(async () => { reactProps(node).onKeyDown?.({ key, currentTarget: node, target: options.target ?? node,
				ctrlKey: options.ctrlKey ?? false, altKey: options.altKey ?? false, metaKey: options.metaKey ?? false,
				preventDefault() { prevented = true; } }); }); return prevented;
		},
		async escape() { const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: 'Escape' });
			await act(async () => { for (const listener of listeners) Reflect.apply(listener, doc, [event]); }); return event.defaultPrevented; },
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } },
	};
}

test('real shell renders only the selected mosaic, replacing the focused thumbnail with one injected fit', async () => {
	const calls: unknown[] = []; const mounted = await mount(props({ renderThumbnail: (id, label) => {
		calls.push(['thumbnail', id, label]); return <canvas data-thumb-photo={id} />;
	}, renderFitScreen: (id, label) => { calls.push(['fit', id, label]); return <canvas data-fit-photo={id} />; } }));
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').length, 1);
		assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 3);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 3);
		assert.deepEqual(calls, [['thumbnail', 'photo-0', 'Photo: e\u0301-0-<&>.PNG'], ['fit', 'photo-2', 'Focused photo: e\u0301-2-<&>.PNG'],
			['thumbnail', 'photo-3', 'Photo: e\u0301-3-<&>.PNG']]);
		assert.match(mounted.dom.container.textContent, /Rating: 0/u); assert.match(mounted.dom.container.textContent, /Flag: Pick/u);
		assert.match(mounted.dom.container.textContent, /Color label: Blue/u); assert.doesNotMatch(mounted.dom.container.textContent, /photo-0|photo-2|photo-3/u);
		assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-survey-photo="photo-2"]'));
	} finally { await mounted.dispose(); }
});

test('focused-tile keyboard culling, no-wrap navigation and temporary removal use the injected scalar actions', async () => {
	const calls: unknown[] = []; const mounted = await mount(props({ onRate: (id, value) => { calls.push(['rate', id, value]); },
		onFlag: (id, value) => { calls.push(['flag', id, value]); }, onRemove: id => { calls.push(['remove', id]); },
		onPrevious: () => { calls.push('previous'); }, onNext: () => { calls.push('next'); } }));
	try {
		for (const key of ['0', '5', 'P', 'x', 'u', 'ArrowLeft', 'ArrowRight', 'Delete']) assert.equal(await mounted.key('photo-2', key), true);
		assert.deepEqual(calls, [['rate', 'photo-2', 0], ['rate', 'photo-2', 5], ['flag', 'photo-2', 'pick'],
			['flag', 'photo-2', 'reject'], ['flag', 'photo-2', 'unflagged'], 'previous', 'next', ['remove', 'photo-2']]);
		assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 3);
	} finally { await mounted.dispose(); }
});

test('controls target their own reviewed photo, native descendant keys and modifiers remain untouched', async () => {
	const calls: unknown[] = []; const mounted = await mount(props({ onFocus: id => { calls.push(['focus', id]); },
		onRate: (id, value) => { calls.push(['rate', id, value]); }, onFlag: (id, value) => { calls.push(['flag', id, value]); },
		onColorLabel: (id, value) => { calls.push(['color', id, value]); } }));
	try {
		const select = mounted.dom.one('[data-survey-rating="photo-0"]');
		for (const key of ['ArrowRight', '5', 'Delete']) assert.equal(await mounted.key('photo-0', key, { target: select as unknown as Element }), false);
		assert.equal(await mounted.key('photo-2', '5', { ctrlKey: true }), false);
		assert.equal(await mounted.key('photo-2', 'P', { altKey: true }), false);
		assert.equal(await mounted.key('photo-2', 'Delete', { metaKey: true }), false);
		await mounted.event('[data-survey-photo="photo-0"]', 'onFocus');
		await mounted.event('[data-survey-rating="photo-0"]', 'onChange', { currentTarget: { value: '4' } });
		await mounted.event('[data-survey-flag="photo-3"]', 'onChange', { currentTarget: { value: 'reject' } });
		await mounted.event('[data-survey-label="photo-0"]', 'onChange', { currentTarget: { value: 'purple' } });
		await mounted.event('[data-survey-rating="photo-0"]', 'onChange', { currentTarget: { value: '6' } });
		await mounted.event('[data-survey-label="photo-0"]', 'onChange', { currentTarget: { value: 'future' } });
		assert.deepEqual(calls, [['focus', 'photo-0'], ['rate', 'photo-0', 4], ['flag', 'photo-3', 'reject'], ['color', 'photo-0', 'purple']]);
	} finally { await mounted.dispose(); }
});

test('removal follows caller acknowledgment, one and zero survivors remain reviewable, Restore does not alter catalog rows', async () => {
	let removes = 0, restores = 0; const initial = props({ onRemove: () => { removes++; }, onRestoreRemoved: () => { restores++; } });
	const mounted = await mount(initial);
	try {
		await mounted.event('[data-survey-remove="photo-0"]', 'onClick'); assert.equal(removes, 1);
		assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 3);
		await mounted.replace({ ...initial, snapshot: { ...initial.snapshot!, photoIds: ['photo-3'], removedPhotoIds: ['photo-0', 'photo-2'], focusedPhotoId: 'photo-3' } });
		assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 1);
		assert.equal(mounted.dom.container.querySelectorAll('[data-fit-photo]').length, 1);
		assert.equal(reactProps(mounted.dom.one('[data-survey-previous]')).disabled, true);
		assert.equal(reactProps(mounted.dom.one('[data-survey-next]')).disabled, true);
		await mounted.replace({ ...initial, snapshot: { ...initial.snapshot!, photoIds: [], removedPhotoIds: ['photo-0', 'photo-2', 'photo-3'], focusedPhotoId: null } });
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 0); assert.match(mounted.dom.container.textContent, /No photos remain/u);
		assert.equal(reactProps(mounted.dom.one('[data-survey-restore]')).disabled, false);
		await mounted.event('[data-survey-restore]', 'onClick'); assert.equal(restores, 1); assert.equal(initial.rows.length, 4);
	} finally { await mounted.dispose(); }
});

test('busy or pending cull blocks retained navigation/edit/removal handlers, while Close always hides once', async () => {
	for (const kind of ['busy', 'pending'] as const) {
		let actions = 0, closes = 0; const initial = props({ onRate: () => { actions++; }, onNext: () => { actions++; },
			onRemove: () => { actions++; }, onFocus: () => { actions++; }, onClose: () => { closes++; } });
		const mounted = await mount(initial);
		try {
			const old = reactProps(mounted.dom.one('[data-survey-next]')).onClick;
			await mounted.replace({ ...initial, ...(kind === 'busy' ? { busy: true } : { snapshot: { ...initial.snapshot!, pendingPhotoId: 'photo-2' } }) });
			for (const name of ['previous', 'next', 'restore']) assert.equal(reactProps(mounted.dom.one(`[data-survey-${name}]`)).disabled, true);
			assert.equal(reactProps(mounted.dom.one('[data-survey-rating="photo-0"]')).disabled, true);
			assert.equal(reactProps(mounted.dom.one('[data-survey-remove="photo-0"]')).disabled, true);
			await act(async () => { old?.({}); }); await mounted.key('photo-2', '5'); await mounted.key('photo-2', 'Delete');
			await mounted.event('[data-survey-photo="photo-0"]', 'onFocus'); assert.equal(actions, 0);
			await mounted.event('[data-survey-close]', 'onClick'); assert.equal(closes, 1); assert.equal(mounted.dom.find('[role="dialog"]'), null);
		} finally { await mounted.dispose(); }
	}
});

test('retained handlers refuse old generations, snapshot replacements, row replacements, and unmounts', async () => {
	for (const changed of ['generation', 'snapshot', 'rows', 'unmount'] as const) {
		let actions = 0; const initial = props({ onClose: () => { actions++; }, onRemove: () => { actions++; }, onRate: () => { actions++; } });
		const mounted = await mount(initial); let disposed = false;
		try {
			const remove = reactProps(mounted.dom.one('[data-survey-remove="photo-2"]')).onClick;
			const rate = reactProps(mounted.dom.one('[data-survey-rating="photo-2"]')).onChange;
			const close = reactProps(mounted.dom.one('[data-survey-close]')).onClick;
			if (changed === 'unmount') { await mounted.dispose(); disposed = true; }
			else await mounted.replace({ ...initial, ...(changed === 'generation' ? { generation: {} }
				: changed === 'snapshot' ? { snapshot: { ...initial.snapshot! } } : { rows: [...rows] }) });
			await act(async () => { remove?.({}); rate?.({ currentTarget: { value: '5' } }); close?.({}); }); assert.equal(actions, 0);
		} finally { if (!disposed) await mounted.dispose(); }
	}
});

test('late scalar arrival and focused-tile replacement acquire focus without stealing a surviving control focus', async () => {
	const ready = props(), mounted = await mount({ ...ready, snapshot: null });
	try {
		await mounted.replace(ready); const original = mounted.dom.one('[data-survey-photo="photo-2"]');
		assert.equal(mounted.dom.container.ownerDocument.activeElement, original);
		const control = mounted.dom.one('[data-survey-label="photo-2"]'); control.focus();
		await mounted.replace({ ...ready, rows: rows.map(row => ({ ...row, rating: 5 })) });
		assert.equal(mounted.dom.container.ownerDocument.activeElement, control);
		await mounted.replace({ ...ready, snapshot: { ...ready.snapshot!, photoIds: [], focusedPhotoId: null, pendingPhotoId: 'photo-2' }, busy: true });
		await mounted.replace({ ...ready, snapshot: { ...ready.snapshot! } });
		const replacement = mounted.dom.one('[data-survey-photo="photo-2"]'); assert.notEqual(replacement, original);
		assert.equal(mounted.dom.container.ownerDocument.activeElement, replacement);
	} finally { await mounted.dispose(); }
});

test('focus changes follow the reviewed tile, preserving an already focused native control within the new tile', async () => {
	const ready = props(), mounted = await mount(ready);
	try {
		await mounted.replace({ ...ready, snapshot: { ...ready.snapshot!, focusedPhotoId: 'photo-3' } });
		assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-survey-photo="photo-3"]'));
		const control = mounted.dom.one('[data-survey-rating="photo-0"]'); control.focus();
		await mounted.replace({ ...ready, snapshot: { ...ready.snapshot!, focusedPhotoId: 'photo-0' } });
		assert.equal(mounted.dom.container.ownerDocument.activeElement, control);
	} finally { await mounted.dispose(); }
});

test('preview status follows the rendered tier and durable saved refresh notice is distinct from errors', async () => {
	const mounted = await mount(props({ previewTargets: [{ photoId: 'photo-0', tier: 'thumbnail', status: 'missing', error: null },
		{ photoId: 'photo-2', tier: 'fit-screen', status: 'failed', error: 'Decode failed' }, { photoId: 'photo-3', tier: 'thumbnail', status: 'pending', error: null }],
		notice: 'refresh-failed', error: 'Query refresh failed' }));
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-survey-preview-unavailable]').length, 2);
		assert.match(mounted.dom.one('[data-survey-notice]').textContent, /Photo saved; review refresh failed/u);
		assert.match(mounted.dom.one('[data-survey-error]').textContent, /Query refresh failed/u);
		assert.equal(mounted.dom.one('[data-survey-error]').getAttribute('role'), 'alert');
		assert.equal(mounted.dom.one('[data-survey-notice]').getAttribute('role'), 'status'); assert.match(mounted.dom.container.textContent, /Working/u);
	} finally { await mounted.dispose(); }
});

test('a ready displaced tier cannot claim that the currently rendered preview is ready', async () => {
	const mounted = await mount(props({ previewTargets: [{ photoId: 'photo-0', tier: 'fit-screen', status: 'missing', error: null },
		{ photoId: 'photo-2', tier: 'thumbnail', status: 'ready', error: null }, { photoId: 'photo-3', tier: 'thumbnail', status: 'ready', error: null }] }));
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-survey-preview-unavailable]').length, 0);
		const previews = mounted.dom.container.querySelectorAll('.lightscaper-survey-preview');
		assert.deepEqual(Array.from(previews, node => node.getAttribute('aria-busy')), ['true', 'true', 'false']);
	} finally { await mounted.dispose(); }
});

test('malformed or oversized scalar review creates no previews and unavailable controls remain disabled', async () => {
	for (const kind of ['duplicate', 'foreign', 'focused', 'rows', 'ids', 'targets'] as const) {
		let previews = 0; const initial = props({ renderFitScreen: () => { previews++; return null; }, renderThumbnail: () => { previews++; return null; } });
		const tooMany = Array.from({ length: 65 }, (_, i) => ({ ...rows[0]!, id: String(i) }));
		const mounted = await mount({ ...initial, ...(kind === 'duplicate' ? { snapshot: { ...initial.snapshot!, photoIds: ['photo-2', 'photo-2'] } }
			: kind === 'foreign' ? { snapshot: { ...initial.snapshot!, photoIds: ['photo-1'], focusedPhotoId: 'photo-1' } }
				: kind === 'focused' ? { snapshot: { ...initial.snapshot!, focusedPhotoId: null } }
					: kind === 'rows' ? { rows: tooMany }
						: kind === 'ids' ? { snapshot: { ...initial.snapshot!, capturedPhotoIds: tooMany.map(row => row.id) } }
							: { previewTargets: Array.from({ length: 65 }, () => initial.previewTargets[0]!) }) });
		try { assert.equal(previews, 0); assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 0);
			assert.equal(reactProps(mounted.dom.one('[data-survey-next]')).disabled, true);
		} finally { await mounted.dispose(); }
	}
});

test('64 selected photos produce exactly one fit and 63 thumbnails within the existing scalar page limit', async () => {
	let fits = 0, thumbs = 0; const many = Array.from({ length: 64 }, (_, i) => ({ ...rows[0]!, id: `photo-${String(i)}` }));
	const mounted = await mount(props({ rows: many, snapshot: { open: true, capturedPhotoIds: many.map(row => row.id), photoIds: many.map(row => row.id),
		removedPhotoIds: [], focusedPhotoId: 'photo-0', pendingPhotoId: null, notice: null },
		previewTargets: many.map(row => ({ photoId: row.id, tier: row.id === 'photo-0' ? 'fit-screen' : 'thumbnail', status: 'ready', error: null })),
		renderFitScreen: () => { fits++; return <canvas />; }, renderThumbnail: () => { thumbs++; return <canvas />; } }));
	try { assert.equal(fits, 1); assert.equal(thumbs, 63); assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 64);
		assert.equal(reactProps(mounted.dom.one('[data-survey-previous]')).disabled, true);
		assert.equal(reactProps(mounted.dom.one('[data-survey-next]')).disabled, false);
	} finally { await mounted.dispose(); }
});

test('real Shell Escape closes only this StrictMode modal once, with no remaining previews', async () => {
	let closes = 0; const mounted = await mount(props({ onClose: () => { closes++; } }), true);
	try { assert.equal(await mounted.escape(), true); assert.equal(closes, 1); assert.equal(mounted.dom.find('[role="dialog"]'), null);
		await mounted.escape(); assert.equal(closes, 1); assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 0);
	} finally { await mounted.dispose(); }
});

test('null and undefined generations still focus the selected tile; changed generations refocus the current tile', async () => {
	for (const generation of [null, undefined]) {
		const initial = props({ generation }), mounted = await mount(initial);
		try { const tile = mounted.dom.one('[data-survey-photo="photo-2"]'); assert.equal(mounted.dom.container.ownerDocument.activeElement, tile);
			mounted.dom.one('[data-survey-rating="photo-2"]').focus(); await mounted.replace({ ...initial, generation: {} });
			assert.equal(mounted.dom.container.ownerDocument.activeElement, tile);
		} finally { await mounted.dispose(); }
	}
});

test('opaque NaN generations admit current actions and preserve an existing control focus across acknowledgment', async () => {
	let rating = 0, closed = 0;
	const initial = props({ generation: NaN, onRate: (_id, value) => { rating = value; }, onClose: () => { closed++; } });
	const mounted = await mount(initial);
	try {
		await mounted.key('photo-2', '4'); assert.equal(rating, 4);
		const control = mounted.dom.one('[data-survey-rating="photo-2"]'); control.focus();
		await mounted.replace({ ...initial, snapshot: { ...initial.snapshot! }, rows: rows.map(row => ({ ...row, rating: 4 })) });
		assert.equal(mounted.dom.container.ownerDocument.activeElement, control);
		await mounted.event('[data-survey-close]', 'onClick'); assert.equal(closed, 1);
	} finally { await mounted.dispose(); }
});
