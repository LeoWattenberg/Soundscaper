/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { openFramescaperCompositionLinksDialog, disposeFramescaperCompositionLinks } from '../src/common/editor/ui/FramescaperCompositionLinksDialog.tsx';
import { createFramescaperCompositionOwnerReader } from '../src/common/editor/ui/framescaper-composition-owner-reader.ts';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../src/framescaper/editor-successor-controller.ts';
import type { FramescaperCompositionLinkOwnerReceipt } from '../src/framescaper/editor-composition-link-owner-repository.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';
import { COPY } from './helpers/audio-editor-controller-harness.js';

test('Motion link dialog coalesces pending owner reads while retaining the latest refresh', async () => {
	const f = await fixture();
	try {
		await f.open();
		for (let index = 0; index < 5; index++) await act(async () => f.publishEquivalent());
		assert.equal(f.reads.length, 1, 'one unresolved owner read owns the storage slot');
		await act(async () => f.reads[0]!.resolve(f.paused));
		assert.equal(f.reads.length, 2, 'all superseding notifications coalesce into one current read');
		assert.equal(f.code(), null, 'an obsolete response cannot publish while the latest refresh is pending');
		await act(async () => f.reads[1]!.resolve(f.paused));
		assert.equal(f.code(), f.firstDigest);
		assert.equal(f.resume().disabled, false);
	} finally { await f.close(); }
});

test('Motion link dialog adopts the real Resume receipt without waiting for an obsolete read', async () => {
	const f = await fixture();
	try {
		await f.open(); await act(async () => f.reads[0]!.resolve(f.paused));
		await act(async () => f.publishEquivalent());
		assert.equal(f.reads.length, 2);
		await act(async () => { reactProps(f.resume()).onClick({}); });
		assert.equal(f.transitions.length, 1);
		let resumed!: FramescaperCompositionLinkOwnerReceipt;
		await act(async () => { resumed = await f.transitions[0]!; });
		assert.notEqual(resumed.project.compositionLinks[0]!.acceptedDigest, f.firstDigest);
		assert.equal(f.code(), resumed.project.compositionLinks[0]!.acceptedDigest);
		await act(async () => f.reads[1]!.resolve(f.paused));
		assert.equal(f.code(), resumed.project.compositionLinks[0]!.acceptedDigest);
		assert.equal(f.reads.length, 2, 'the committed action receipt supersedes queued background refreshes');
	} finally { await f.close(); }
});

test('Motion link dialog never displays the previous owner while a new owner read is pending', async () => {
	const f = await fixture();
	try {
		await f.open(); await act(async () => f.reads[0]!.resolve(f.paused));
		assert.equal(f.code(), f.firstDigest);
		await act(async () => f.changeOwner());
		assert.equal(f.code(), null, 'the old owner and its action buttons retire synchronously with the new scope');
		await act(async () => f.reads[1]!.resolve(null));
		assert.equal(f.code(), null);
	} finally { await f.close(); }
});

test('Motion link dialog closes without starting its coalesced owner refresh', async () => {
	const f = await fixture();
	try {
		await f.open(); await act(async () => f.publishEquivalent());
		await f.closeDialog();
		await act(async () => { for (const read of f.reads) read.resolve(f.paused); });
		assert.equal(f.reads.length, 1);
		assert.equal(f.code(), null);
	} finally { await f.close(); }
});

test('Motion owner refresh ignores obsolete errors and recovers after the current failure', async () => {
	const reads: { promise: Promise<null>; reject(error: unknown): void; resolve(value: null): void }[] = [];
	const errors: unknown[] = [], scope = {};
	const reader = createFramescaperCompositionOwnerReader({ currentOwner: () => 'owner', publish() {}, fail: error => errors.push(error) });
	const load = () => {
		let resolve!: (value: null) => void, reject!: (error: unknown) => void;
		const promise = new Promise<null>((accept, refuse) => { resolve = accept; reject = refuse; });
		reads.push({ promise, resolve, reject }); return promise;
	};
	const oldCleanup = reader.refresh(scope, 'owner', load);
	reader.refresh(scope, 'owner', load); oldCleanup();
	reads[0]!.reject(new Error('obsolete read failure')); await reads[0]!.promise.catch(() => undefined);
	assert.equal(reads.length, 2); assert.deepEqual(errors, []);
	const current = new Error('current read failure');
	reads[1]!.reject(current); await reads[1]!.promise.catch(() => undefined);
	assert.deepEqual(errors, [current]);
	reader.refresh(scope, 'owner', load);
	reads[2]!.resolve(null); await reads[2]!.promise;
	assert.deepEqual(errors, [current]);
});

test('Motion owner refresh checks live ownership before React effect cleanup', async () => {
	let owner = 'first', resolve!: (value: null) => void;
	const publications: null[] = [];
	const reader = createFramescaperCompositionOwnerReader({ currentOwner: () => owner,
		publish: value => { assert.equal(value, null); publications.push(value); }, fail: error => { throw error; } });
	const pending = new Promise<null>(accept => { resolve = accept; });
	reader.refresh({}, owner, () => pending); publications.length = 0;
	owner = 'second'; resolve(null); await pending;
	assert.deepEqual(publications, [], 'the old owner cannot publish in the interval before cleanup runs');
});

async function fixture() {
	const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	const actual = createFramescaperSuccessorController(environment, { locale: 'en', copy: COPY });
	await actual.ready;
	const context = framescaperSuccessorControllerContext(actual);
	const project = createMotionscaperProject({ id: 'refresh-sender', title: 'Saved scene', compositionId: 'main', width: 2, height: 2, durationFrames: 2 });
	const offer = (revision: number) => createMotionCompositionOffer('main', createMotionscaperRevision({ ...project, revision, title: `Saved ${revision}` }));
	const first = await context.links.receive(offer(0), { readAsset: async () => null });
	await context.links.receive(offer(1), { readAsset: async () => null }); await actual.actions.edit.undo();
	const paused = await context.links.receive(offer(2), { readAsset: async () => null });
	const reads: { id: string; resolve(receipt: FramescaperCompositionLinkOwnerReceipt | null): void }[] = [];
	const transitions: Promise<FramescaperCompositionLinkOwnerReceipt>[] = [];
	let snapshot = actual.getSnapshot(); const listeners = new Set<() => void>();
	const controller = { getSnapshot: () => snapshot, get project() { return snapshot.project; }, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } } as unknown as typeof actual;
	const emit = () => { for (const listener of listeners) listener(); };
	const unsubscribe = actual.subscribe(() => { snapshot = actual.getSnapshot(); emit(); });
	const viewContext = { ...context, environment: { ...context.environment, owners: { ...environment.owners,
		loadOwner: (id: string) => new Promise<FramescaperCompositionLinkOwnerReceipt | null>(resolve => reads.push({ id, resolve })),
	} }, links: { ...context.links, transition(...args: Parameters<typeof context.links.transition>) {
		const result = context.links.transition(...args); transitions.push(result); return result;
	} } };
	const dom = installReactTestDom();
	Reflect.set(dom.container.ownerDocument.documentElement, 'lang', 'en');
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'), priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	const descriptors = new Map<string, PropertyDescriptor | undefined>();
	const methods = {
		append(this: ReactTestElement, node: ReactTestElement) { this.appendChild(node); },
		remove(this: ReactTestElement) { this.parentNode?.removeChild(this); },
		showModal(this: ReactTestElement) { this.setAttribute('open', ''); },
	};
	for (const [name, value] of Object.entries(methods)) {
		descriptors.set(name, Object.getOwnPropertyDescriptor(ReactTestElement.prototype, name));
		Object.defineProperty(ReactTestElement.prototype, name, { configurable: true, value });
	}
	const body = dom.container.ownerDocument.body;
	const closeDialog = async () => { await act(async () => disposeFramescaperCompositionLinks(controller)); };
	return {
		reads, transitions, paused, firstDigest: first.project.compositionLinks[0]!.acceptedDigest,
		open: async () => { await act(async () => openFramescaperCompositionLinksDialog(controller, viewContext)); },
		publishEquivalent() { snapshot = { ...snapshot, project: structuredClone(snapshot.project) }; emit(); },
		changeOwner() { assert.ok(snapshot.project); snapshot = { ...snapshot, project: { ...snapshot.project, id: 'different-receiver' } }; emit(); },
		code: () => body.querySelector('code')?.textContent ?? null,
		resume() { const button = body.querySelectorAll('button').find(value => value.textContent === 'Resume automatic updates'); assert.ok(button); return button; },
		closeDialog,
		async close() {
			await closeDialog(); unsubscribe();
			await act(async () => { for (const read of reads) read.resolve(null); });
			for (const [name, descriptor] of descriptors) {
				if (descriptor) Object.defineProperty(ReactTestElement.prototype, name, descriptor); else Reflect.deleteProperty(ReactTestElement.prototype, name);
			}
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
			dom.restore(); await actual.dispose(); await environment.close();
		},
	};
}
