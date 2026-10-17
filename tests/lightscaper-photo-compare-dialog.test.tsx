/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { PhotoLibraryRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoCompareDialogCopyV1, PhotoCompareDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoCompareDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: PhotoCompareDialog } = await import('../src/common/editor/ui/lightscaper/PhotoCompareDialog.tsx');
hooks.deregister();
const copy: PhotoCompareDialogCopyV1 = {
	photoCompareTitle: 'Compare photos', photoCompareDescription: 'Compare the reference and candidate.',
	photoCompareReference: 'Reference', photoCompareCandidate: 'Candidate', photoComparePrevious: 'Previous candidate',
	photoCompareNext: 'Next candidate', photoCompareSwap: 'Swap sides', photoComparePromote: 'Use candidate as reference',
	photoCompareKeys: 'Arrows change candidate; S swaps; Enter promotes; 0–5 rates; P/X/U flags the focused side.',
	photoCompareEmpty: 'Choose two photos to compare', photoCompareUnavailable: 'The comparison is unavailable',
	photoCompareRefreshFailed: 'Photo saved; comparison refresh failed', photoRating: 'Rating', photoFlag: 'Flag',
	photoColorLabel: 'Color label', photoCloseMetadata: 'Close', photoWorking: 'Working',
	photoPreviewUnavailable: 'Preview unavailable',
};
const flags = { unflagged: 'Unflagged', pick: 'Pick', reject: 'Reject' } as const;
const colorLabels = { none: 'None', red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' } as const;
const rows: readonly PhotoLibraryRowV1[] = Array.from({ length: 4 }, (_, i) => ({ id: `photo-${String(i)}`,
	fileName: `e\u0301-${String(i)}-<&>.PNG`, width: 2, height: 3, rating: i, flag: i === 0 ? 'pick' : 'unflagged', colorLabel: i === 0 ? 'blue' : 'none' }));
function props(overrides: Partial<PhotoCompareDialogPropsV1> = {}): PhotoCompareDialogPropsV1 {
	return { generation: {}, snapshot: { open: true, photoIds: rows.map(row => row.id), referenceId: 'photo-0', candidateId: 'photo-2', pendingPhotoId: null, notice: null },
		rows, previewTargets: [{ photoId: 'photo-0', status: 'ready', error: null }, { photoId: 'photo-2', status: 'ready', error: null }],
		copy, flags, colorLabels, renderFitScreen: (id, label) => <canvas data-fit-photo={id} role="img" aria-label={label} />,
		busy: false, error: null, notice: null, onPrevious: () => undefined, onNext: () => undefined,
		onSwap: () => undefined, onPromote: () => undefined, onRate: () => undefined, onFlag: () => undefined,
		onColorLabel: () => undefined, onClose: () => undefined, ...overrides };
}
async function mount(initial: PhotoCompareDialogPropsV1, strict = false) {
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
		const dialog = <PhotoCompareDialog {...current} />; root.render(strict ? <StrictMode>{dialog}</StrictMode> : dialog);
	}); };
	try { await render(); } catch (error) { await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; throw error; }
	return { dom,
		async replace(next: PhotoCompareDialogPropsV1) { current = next; await render(); },
		async event(selector: string, name: string, value: unknown = {}) { await act(async () => { reactProps(dom.one(selector))[name]?.(value); }); },
		async key(side: 'reference' | 'candidate', key: string, options: Readonly<{ target?: Element; ctrlKey?: boolean; altKey?: boolean }> = {}) {
			const node = dom.one(`[data-compare-side="${side}"]`); let prevented = false;
			await act(async () => { reactProps(node).onKeyDown?.({ key, currentTarget: node, target: options.target ?? node,
				ctrlKey: options.ctrlKey ?? false, altKey: options.altKey ?? false, metaKey: false, repeat: false,
				preventDefault() { prevented = true; } }); }); return prevented;
		},
		async escape() { const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: 'Escape' });
			await act(async () => { for (const listener of listeners) Reflect.apply(listener, doc, [event]); }); return event.defaultPrevented; },
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } },
	};
}

test('real dialog shell presents exactly two injected fits, scalar culling facts and candidate initial focus', async () => {
	const calls: string[][] = []; const mounted = await mount(props({ renderFitScreen: (id, label) => {
		calls.push([id, label]); return <canvas data-fit-photo={id} role="img" aria-label={label} />;
	} }));
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').length, 1);
		assert.equal(mounted.dom.container.querySelectorAll('[data-compare-side]').length, 2);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 2);
		assert.deepEqual(calls, [['photo-0', 'Reference: e\u0301-0-<&>.PNG'], ['photo-2', 'Candidate: e\u0301-2-<&>.PNG']]);
		assert.match(mounted.dom.container.textContent, /Rating: 0/u); assert.match(mounted.dom.container.textContent, /Flag: Pick/u);
		assert.match(mounted.dom.container.textContent, /Color label: Blue/u);
		assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-compare-side="candidate"]'));
		assert.doesNotMatch(mounted.dom.container.textContent, /photo-0|photo-2/u);
	} finally { await mounted.dispose(); }
});

test('keyboard culling targets the focused side and documented pair actions have explicit keys', async () => {
	const calls: unknown[] = [];
	const mounted = await mount(props({ onRate: (id, rating) => { calls.push(['rate', id, rating]); },
		onFlag: (id, flag) => { calls.push(['flag', id, flag]); }, onPrevious: () => { calls.push('previous'); },
		onNext: () => { calls.push('next'); }, onSwap: () => { calls.push('swap'); }, onPromote: () => { calls.push('promote'); } }));
	try {
		for (const key of ['0', '5', 'P', 'x', 'u']) assert.equal(await mounted.key('reference', key), true);
		assert.equal(await mounted.key('candidate', '3'), true);
		for (const key of ['ArrowLeft', 'ArrowRight', 's', 'Enter']) assert.equal(await mounted.key('candidate', key), true);
		assert.deepEqual(calls, [['rate', 'photo-0', 0], ['rate', 'photo-0', 5], ['flag', 'photo-0', 'pick'],
			['flag', 'photo-0', 'reject'], ['flag', 'photo-0', 'unflagged'], ['rate', 'photo-2', 3], 'previous', 'next', 'swap', 'promote']);
	} finally { await mounted.dispose(); }
});

test('controls edit their own side while nested inputs and modifier keys retain their keyboard behavior', async () => {
	const calls: unknown[] = [];
	const mounted = await mount(props({ onRate: (id, value) => { calls.push(['rating', id, value]); },
		onFlag: (id, value) => { calls.push(['flag', id, value]); }, onColorLabel: (id, value) => { calls.push(['label', id, value]); } }));
	try {
		const select = mounted.dom.one('[data-compare-rating="candidate"]');
		for (const key of ['ArrowRight', '5', 's', 'Enter']) assert.equal(await mounted.key('candidate', key, { target: select as unknown as Element }), false);
		assert.equal(await mounted.key('candidate', '5', { ctrlKey: true }), false);
		assert.equal(await mounted.key('candidate', 'P', { altKey: true }), false);
		await mounted.event('[data-compare-rating="candidate"]', 'onChange', { currentTarget: { value: '5' } });
		await mounted.event('[data-compare-flag="reference"]', 'onChange', { currentTarget: { value: 'reject' } });
		await mounted.event('[data-compare-label="candidate"]', 'onChange', { currentTarget: { value: 'purple' } });
		await mounted.event('[data-compare-label="candidate"]', 'onChange', { currentTarget: { value: 'future' } });
		assert.deepEqual(calls, [['rating', 'photo-2', 5], ['flag', 'photo-0', 'reject'], ['label', 'photo-2', 'purple']]);
	} finally { await mounted.dispose(); }
});

test('busy state fences retained handlers and disables navigation/edits while Close remains available', async () => {
	let actions = 0, closes = 0; const initial = props({ onRate: () => { actions++; }, onNext: () => { actions++; }, onClose: () => { closes++; } });
	const mounted = await mount(initial);
	try {
		const old = reactProps(mounted.dom.one('[data-compare-next]')).onClick;
		await mounted.replace({ ...initial, busy: true });
		for (const name of ['previous', 'next', 'swap', 'promote']) assert.equal(reactProps(mounted.dom.one(`[data-compare-${name}]`)).disabled, true);
		assert.equal(reactProps(mounted.dom.one('[data-compare-rating="reference"]')).disabled, true);
		await act(async () => { old?.({}); }); await mounted.key('candidate', '5');
		await mounted.event('[data-compare-rating="reference"]', 'onChange', { currentTarget: { value: '5' } }); assert.equal(actions, 0);
		await mounted.event('[data-compare-close]', 'onClick'); assert.equal(closes, 1); assert.equal(mounted.dom.find('[role="dialog"]'), null);
	} finally { await mounted.dispose(); }
});

test('old page/generation/unmounted handlers cannot operate replacement rows or close the replacement dialog', async () => {
	for (const changed of ['generation', 'page', 'unmount'] as const) {
		let actions = 0; const initial = props({ onSwap: () => { actions++; }, onClose: () => { actions++; }, onRate: () => { actions++; } });
		const mounted = await mount(initial); let disposed = false;
		try {
			const swap = reactProps(mounted.dom.one('[data-compare-swap]')).onClick, close = reactProps(mounted.dom.one('[data-compare-close]')).onClick;
			const key = reactProps(mounted.dom.one('[data-compare-side="candidate"]')).onKeyDown;
			if (changed === 'unmount') { await mounted.dispose(); disposed = true; }
			else await mounted.replace({ ...initial, ...(changed === 'generation' ? { generation: {} } : { snapshot: { ...initial.snapshot!, candidateId: 'photo-3' } }) });
			await act(async () => { swap?.({}); close?.({}); key?.({ key: '5', currentTarget: {}, target: {}, preventDefault() {} }); });
			assert.equal(actions, 0);
		} finally { if (!disposed) await mounted.dispose(); }
	}
});

test("late scalar arrival focuses the candidate once without stealing a user's control focus after an acknowledgment", async () => {
	const ready = props(), mounted = await mount({ ...ready, snapshot: null });
	try {
		await mounted.replace(ready); assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-compare-side="candidate"]'));
		const field = mounted.dom.one('[data-compare-label="reference"]'); field.focus();
		await mounted.replace({ ...ready, rows: rows.map(row => ({ ...row, rating: 5 })) });
		assert.equal(mounted.dom.container.ownerDocument.activeElement, field);
	} finally { await mounted.dispose(); }
});

test('an exact ACK restores focus to a replacement candidate after a pending empty page', async () => {
	const ready = props(), mounted = await mount(ready);
	try {
		const original = mounted.dom.one('[data-compare-side="candidate"]');
		await mounted.replace({ ...ready, snapshot: { open: false, photoIds: [], referenceId: null,
			candidateId: null, pendingPhotoId: 'photo-2', notice: null }, busy: true });
		assert.equal(mounted.dom.find('[data-compare-side="candidate"]'), null);
		await mounted.replace({ ...ready, snapshot: { ...ready.snapshot! } });
		const replacement = mounted.dom.one('[data-compare-side="candidate"]');
		assert.notEqual(replacement, original);
		assert.equal(mounted.dom.container.ownerDocument.activeElement, replacement);
		const control = mounted.dom.one('[data-compare-rating="candidate"]'); control.focus();
		await mounted.replace({ ...ready, rows: rows.map(row => ({ ...row, rating: 4 })) });
		assert.equal(mounted.dom.container.ownerDocument.activeElement, control);
	} finally { await mounted.dispose(); }
});

test('missing/failed preview states are explicit and a durable saved refresh notice is distinct from an error', async () => {
	const mounted = await mount(props({ previewTargets: [{ photoId: 'photo-0', status: 'missing', error: null },
		{ photoId: 'photo-2', status: 'failed', error: 'Native decode failed' }], notice: 'refresh-failed', error: 'Query refresh failed' }));
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-compare-preview-unavailable]').length, 2);
		assert.match(mounted.dom.one('[data-compare-notice]').textContent, /Photo saved; comparison refresh failed/u);
		assert.match(mounted.dom.one('[data-compare-error]').textContent, /Query refresh failed/u);
		assert.equal(mounted.dom.one('[data-compare-error]').getAttribute('role'), 'alert');
		assert.equal(mounted.dom.one('[data-compare-notice]').getAttribute('role'), 'status');
	} finally { await mounted.dispose(); }
});

test('empty/duplicate/oversized scalar views never create fits or interactive pair controls', async () => {
	for (const change of ['empty', 'duplicate', 'oversized'] as const) {
		let fits = 0; const initial = props({ renderFitScreen: () => { fits++; return null; } });
		const mounted = await mount({ ...initial, ...(change === 'empty' ? { snapshot: null }
			: change === 'duplicate' ? { snapshot: { ...initial.snapshot!, candidateId: 'photo-0' } }
				: { rows: Array.from({ length: 65 }, (_, index) => ({ ...rows[0]!, id: String(index) })) }) });
		try { assert.equal(fits, 0); assert.equal(mounted.dom.container.querySelectorAll('[data-compare-side]').length, 0);
			assert.equal(reactProps(mounted.dom.one('[data-compare-swap]')).disabled, true);
		} finally { await mounted.dispose(); }
	}
});

test('shared Escape ownership and explicit Close release only this StrictMode dialog once', async () => {
	let closes = 0; const mounted = await mount(props({ onClose: () => { closes++; } }), true);
	try { assert.equal(await mounted.escape(), true); assert.equal(closes, 1);
		assert.equal(mounted.dom.find('[role="dialog"]'), null); await mounted.escape(); assert.equal(closes, 1);
	} finally { await mounted.dispose(); }
});

test('undefined and null factory identities still acquire candidate initial focus', async () => {
	for (const generation of [undefined, null]) {
		const mounted = await mount(props({ generation }));
		try { assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-compare-side="candidate"]')); }
		finally { await mounted.dispose(); }
	}
});

test('candidate navigation respects no-wrap boundaries while skipping the reference', async () => {
	let previous = 0, next = 0; const initial = props({ onPrevious: () => { previous++; }, onNext: () => { next++; } });
	const mounted = await mount({ ...initial, snapshot: { ...initial.snapshot!, referenceId: 'photo-1', candidateId: 'photo-0' } });
	try {
		assert.equal(reactProps(mounted.dom.one('[data-compare-previous]')).disabled, true);
		assert.equal(reactProps(mounted.dom.one('[data-compare-next]')).disabled, false);
		await mounted.key('candidate', 'ArrowLeft'); await mounted.key('candidate', 'ArrowRight');
		assert.equal(previous, 0); assert.equal(next, 1);
		await mounted.replace({ ...initial, snapshot: { ...initial.snapshot!, referenceId: 'photo-2', candidateId: 'photo-3' } });
		assert.equal(reactProps(mounted.dom.one('[data-compare-next]')).disabled, true);
		await mounted.key('candidate', 'ArrowRight'); assert.equal(next, 1);
	} finally { await mounted.dispose(); }
});

test('one pending cull independently locks edits and a 64-row page still renders only the pair', async () => {
	let actions = 0; const initial = props({ onPromote: () => { actions++; } });
	const many = Array.from({ length: 64 }, (_, index) => ({ ...rows[0]!, id: `photo-${String(index)}` }));
	const mounted = await mount({ ...initial, rows: many, snapshot: { ...initial.snapshot!, photoIds: many.map(row => row.id), pendingPhotoId: 'photo-0' },
		previewTargets: [{ photoId: 'photo-0', status: 'pending', error: null }, { photoId: 'photo-2', status: 'pending', error: null }] });
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-compare-side]').length, 2);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 2);
		assert.equal(reactProps(mounted.dom.one('[data-compare-promote]')).disabled, true);
		await mounted.key('candidate', 'Enter'); await mounted.event('[data-compare-promote]', 'onClick'); assert.equal(actions, 0);
		assert.match(mounted.dom.container.textContent, /Working/u);
	} finally { await mounted.dispose(); }
});
