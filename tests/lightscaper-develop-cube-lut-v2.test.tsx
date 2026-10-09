/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import PhotoDevelopCubeLutV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopCubeLutV2.tsx';
import { PhotoLibraryDevelopWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import { normalizeCubeLutProfileParamsV1 } from '../src/common/editor/video-cube-lut-profile-v1.ts';
import type { PhotoLibraryCubeLutPortV1 } from '../src/common/editor/photo-library-cube-lut-port-v1.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

test('current cube import pins its props receiver, joins held cancellation, and refuses a retired result without reflecting opaque reasons', async () => {
	const fixture = await currentDevelopFixture(1), owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: async () => fixture.develop, isCurrent: () => true, refresh: async () => undefined });
	} }); await owner.open(fixture.photos[0]!.id); owner.setEffects([createVideoEffectV2('cube-lut-profile-v1')]);
	const held = deferred<Awaited<ReturnType<PhotoLibraryCubeLutPortV1['importFile']>>>(), retirees: (() => Promise<void>)[] = [], pending: boolean[] = [];
	let calls = 0, traps = 0, aborted = false, expected: unknown;
	const importCubeLut: PhotoLibraryCubeLutPortV1['importFile'] = new Proxy(async function (this: unknown, _file, options) {
		assert.equal(this, expected); calls++; options!.signal!.addEventListener('abort', () => { aborted = true; }); return held.promise;
	}, { get() { traps++; throw Error('Borrowed callback metadata'); } });
	const mounted = await mountPhotoImportUi(() => { const element = <PhotoDevelopCubeLutV2 effect={owner.snapshot().draft!.effects[0]!} effects={owner.snapshot().draft!.effects}
		owner={owner} copy={photoDevelopCopy('en').shared} disabled={false} isCurrent={() => true} importCubeLut={importCubeLut}
		onPending={value => { pending.push(value); }} registerRetirement={retire => { retirees.push(retire); return () => undefined; }} />; expected = element.props; return element; });
	try {
		const choose = reactProps(mounted.dom.one('input')).onChange!;
		await act(async () => { choose({ currentTarget: { files: [new File(['x'], 'profile.cube')], value: 'profile.cube' } }); await settle(); });
		assert.equal(calls, 1); assert.deepEqual(pending, [true]); const retiring = retirees[0]!(); assert.equal(aborted, true); assert.equal(await remainsPending(retiring), true);
		held.resolve({ reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: true }); await retiring; await act(async () => { await settle(); });
		assert.equal(owner.snapshot().draft!.effects[0]!.params.lut, null); assert.deepEqual(pending, [true, false]); assert.equal(traps, 0);
	} finally { held.resolve({ reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: false }); await mounted.dispose(); await owner.close(); await fixture.close(); }
});

test('the current importer shows localized failure after its parent pending state changes the rendered control', async () => {
	const fixture = await currentDevelopFixture(1), owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: async () => fixture.develop, isCurrent: () => true, refresh: async () => undefined });
	} }); await owner.open(fixture.photos[0]!.id); owner.setEffects([createVideoEffectV2('cube-lut-profile-v1')]);
	const held = deferred<Awaited<ReturnType<PhotoLibraryCubeLutPortV1['importFile']>>>(), importCubeLut: PhotoLibraryCubeLutPortV1['importFile'] = async () => held.promise;
	const registerRetirement = () => () => undefined, messages = photoDevelopCopy('de').shared;
	function View() { const [pending, setPending] = useState(false); return <PhotoDevelopCubeLutV2 effect={owner.snapshot().draft!.effects[0]!} effects={owner.snapshot().draft!.effects}
		owner={owner} copy={messages} disabled={pending} isCurrent={() => true} importCubeLut={importCubeLut} onPending={setPending} registerRetirement={registerRetirement} />; }
	const mounted = await mountPhotoImportUi(() => <View />);
	try {
		await mounted.event('input', 'onChange', { currentTarget: { files: [new File(['bad'], 'profile.cube')], value: '' } });
		await act(async () => { held.reject(Symbol('opaque import failure')); await settle(); });
		assert.equal(mounted.dom.one('[role="alert"]').textContent, messages.videoEffectCubeLutFailed); assert.equal(owner.snapshot().draft!.effects[0]!.params.lut, null);
	} finally { held.resolve({ reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: false }); await mounted.dispose(); await owner.close(); await fixture.close(); }
});

test('current cube selection stores only a detached complete reference; replaced effect handlers cannot clear or import the new recipe', async () => {
	const fixture = await currentDevelopFixture(1), owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: async () => fixture.develop, isCurrent: () => true, refresh: async () => undefined });
	} }); await owner.open(fixture.photos[0]!.id); owner.setEffects([createVideoEffectV2('cube-lut-profile-v1')]);
	const retirees: (() => Promise<void>)[] = []; let calls = 0;
	const importCubeLut: PhotoLibraryCubeLutPortV1['importFile'] = async () => { calls++; return { reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: true }; };
	const render = () => <PhotoDevelopCubeLutV2 effect={owner.snapshot().draft!.effects[0]!} effects={owner.snapshot().draft!.effects} owner={owner}
		copy={photoDevelopCopy('de').shared} disabled={false} isCurrent={() => true} importCubeLut={importCubeLut} onPending={() => undefined}
		registerRetirement={retire => { retirees.push(retire); return () => undefined; }} />;
	const mounted = await mountPhotoImportUi(render);
	try {
		const oldChoose = reactProps(mounted.dom.one('input')).onChange!;
		await mounted.event('input', 'onChange', { currentTarget: { files: [new File(['x'], 'profile.cube')], value: 'profile.cube' } });
		await act(async () => { await settle(); }); await mounted.render(); assert.equal(calls, 1); assert.deepEqual(owner.snapshot().draft!.effects[0]!.params.lut, currentRecipe().effects[0]!.params.lut);
		const oldClear = reactProps(mounted.dom.one('button')).onClick!;
		owner.setEffects([{ ...owner.snapshot().draft!.effects[0]!, params: { lut: null } }]); await mounted.render();
		await act(async () => { oldChoose({ currentTarget: { files: [new File(['x'], 'other.cube')], value: '' } }); oldClear({}); await settle(); });
		assert.equal(calls, 1); assert.equal(owner.snapshot().draft!.effects[0]!.params.lut, null);
	} finally { await mounted.dispose(); await Promise.all(retirees.map(retire => retire())); await owner.close(); await fixture.close(); }
});

test('native retirement from the pending callback cannot admit the import and held opaque cleanup stays joined without inspection', async () => {
	const fixture = await currentDevelopFixture(1), owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: async () => fixture.develop, isCurrent: () => true, refresh: async () => undefined });
	} }); await owner.open(fixture.photos[0]!.id); owner.setEffects([createVideoEffectV2('cube-lut-profile-v1')]);
	let retire!: () => Promise<void>, cancelImmediately = true, calls = 0, traps = 0;
	const release = deferred<Awaited<ReturnType<PhotoLibraryCubeLutPortV1['importFile']>>>();
	const failure = new Proxy({}, { get() { traps++; throw Error('Opaque failure read'); }, getPrototypeOf() { traps++; throw Error('Opaque failure read'); } });
	const importCubeLut: PhotoLibraryCubeLutPortV1['importFile'] = async () => { calls++; return release.promise; };
	const registerRetirement = (callback: () => Promise<void>) => { retire = callback; return () => undefined; };
	const nested: Promise<void>[] = [];
	const onPending = (pending: boolean) => { if (pending && cancelImmediately) void retire();
		else if (!pending) { const joining = retire(); nested.push(joining); void joining.catch(() => undefined); } };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopCubeLutV2 effect={owner.snapshot().draft!.effects[0]!} effects={owner.snapshot().draft!.effects}
		owner={owner} copy={photoDevelopCopy('en').shared} disabled={false} isCurrent={() => true} importCubeLut={importCubeLut} onPending={onPending} registerRetirement={registerRetirement} />);
	const choose = () => mounted.event('input', 'onChange', { currentTarget: { files: [new File(['x'], 'profile.cube')], value: '' } });
	try {
		await choose(); await act(async () => { await settle(); }); assert.equal(calls, 0);
		cancelImmediately = false; nested.length = 0; await choose(); assert.equal(calls, 1); const retiring = retire(); const observed = retiring.then(() => assert.fail('Cleanup fulfilled'), (error: unknown) => { assert.ok(Object.is(error, failure)); });
		assert.equal(await remainsPending(retiring), true); await act(async () => { release.reject(failure); await observed; await settle(); });
		assert.equal(nested.length, 1); assert.ok(Object.is(nested[0], retiring));
		await nested[0]!.then(() => assert.fail('Nested retirement lost cleanup failure'), (error: unknown) => { assert.ok(Object.is(error, failure)); });
		await retire().then(() => assert.fail('Retirement lost cleanup failure'), (error: unknown) => { assert.ok(Object.is(error, failure)); });
		await choose(); assert.equal(calls, 1);
		assert.equal(traps, 0); assert.equal(owner.snapshot().draft!.effects[0]!.params.lut, null);
	} finally { release.resolve({ reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: false }); await mounted.dispose(); await owner.close(); await fixture.close(); }
});

test('a final pending notification cannot replace an earlier opaque canceled cleanup failure', async () => {
	const fixture = await currentDevelopFixture(1), owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: async () => fixture.develop, isCurrent: () => true, refresh: async () => undefined });
	} }); await owner.open(fixture.photos[0]!.id); owner.setEffects([createVideoEffectV2('cube-lut-profile-v1')]);
	let retire!: () => Promise<void>, nested: Promise<void> | null = null, traps = 0;
	const release = deferred<Awaited<ReturnType<PhotoLibraryCubeLutPortV1['importFile']>>>();
	const opaque = () => new Proxy({}, { get() { traps++; throw Error('Opaque failure read'); }, getPrototypeOf() { traps++; throw Error('Opaque failure read'); } });
	const primary = opaque(), notification = opaque(), importCubeLut: PhotoLibraryCubeLutPortV1['importFile'] = async () => release.promise;
	const registerRetirement = (callback: () => Promise<void>) => { retire = callback; return () => undefined; };
	const onPending = (pending: boolean) => { if (!pending) { nested = retire(); void nested.catch(() => undefined); throw notification; } };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopCubeLutV2 effect={owner.snapshot().draft!.effects[0]!} effects={owner.snapshot().draft!.effects}
		owner={owner} copy={photoDevelopCopy('en').shared} disabled={false} isCurrent={() => true} importCubeLut={importCubeLut} onPending={onPending} registerRetirement={registerRetirement} />);
	const check = (error: unknown) => {
		assert.equal(Object.is(error, notification), false, 'Final notification replaced the primary cleanup failure');
		assert.ok(error instanceof AggregateError); const errors = error.errors as unknown[];
		assert.equal(errors.length, 2); assert.ok(Object.is(errors[0], primary)); assert.ok(Object.is(errors[1], notification));
	};
	try {
		await mounted.event('input', 'onChange', { currentTarget: { files: [new File(['x'], 'profile.cube')], value: '' } });
		const pending = retire(), observed = pending.then(() => assert.fail('Cleanup fulfilled'), check);
		await act(async () => { release.reject(primary); await observed; await settle(); });
		assert.ok(Object.is(nested, pending)); await retire().then(() => assert.fail('Cleanup was forgotten'), check);
		assert.equal(traps, 0); assert.equal(owner.snapshot().draft!.effects[0]!.params.lut, null);
	} finally { release.resolve({ reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: false }); await mounted.dispose(); await owner.close(); await fixture.close(); }
});
