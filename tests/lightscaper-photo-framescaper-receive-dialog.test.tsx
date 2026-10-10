/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoFramescaperReceiveDialog, { type PhotoFramescaperReceiveDialogProps } from '../src/common/editor/ui/lightscaper/PhotoFramescaperReceiveDialog.tsx';
import { photoFramescaperReceiveCopy } from '../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

const choices = Object.freeze({ schemaVersion: 1 as const, projectId: 'project', projectRevision: 2, title: 'Saved project', unsupportedImageCount: 1,
	sources: Object.freeze(['one', 'two'].map(sourceId => Object.freeze({ sourceId, name: `Recipe ${sourceId}`, originalName: `${sourceId}.png`, processVersion: 2 as const, width: 2, height: 3 }))) });
const ordinaryChoices = Object.freeze({ ...choices, sources: Object.freeze([...choices.sources,
	Object.freeze({ sourceId: 'still', name: 'Camera still', originalName: 'Camera.png', processVersion: 1 as const, width: 2, height: 3,
		imageClips: Object.freeze([Object.freeze({ clipId: 'timeline-image', sequenceId: 'sequence', sequenceName: 'Opening sequence', scope: 'timeline' as const }),
			Object.freeze({ clipId: 'bin-image', sequenceId: 'sequence', sequenceName: 'Opening sequence', scope: 'bin' as const })]) }),
	Object.freeze({ sourceId: 'single', name: 'Another still', originalName: 'Another.png', processVersion: 1 as const, width: 2, height: 3,
		imageClips: Object.freeze([Object.freeze({ clipId: 'single-image', sequenceId: 'another-sequence', sequenceName: 'Ending sequence', scope: 'bin' as const })]) })]) });
const receipt = Object.freeze({ schemaVersion: 1 as const, status: 'imported' as const, catalogId: 'catalog', photoId: 'photo', originalId: 'original', activeVersionId: 'copy', revision: 0 as const, reusedOriginal: false, settlement: 'complete' as const });
async function mount(overrides: Partial<PhotoFramescaperReceiveDialogProps> = {}, strict = false) {
	const events: string[] = [], destinations = new PhotoExportDestinations();
	const props: PhotoFramescaperReceiveDialogProps = { locale: 'en', isCurrent: () => true,
		inspect: async () => choices, capture: Object.freeze({ receive: async () => Object.freeze({ receipt, refresh: 'complete' as const }), reload: async () => undefined }),
		registerDestination: cancel => destinations.register(cancel), onImported: () => { events.push('imported'); }, onClose: () => { events.push('closed'); }, ...overrides };
	const mounted = await mountPhotoImportUi(() => strict ? <StrictMode><PhotoFramescaperReceiveDialog {...props} /></StrictMode> : <PhotoFramescaperReceiveDialog {...props} />);
	const flush = async (run: () => void = () => undefined) => { await act(async () => { run(); await settle(); }); };
	const click = async (label: string) => { const node = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === label); assert.ok(node); await flush(() => { reactProps(node).onClick?.({}); }); };
	const file = async (body: File | null) => {
		const target = { files: body ? [body] : [], value: body?.name ?? '' };
		await flush(() => { reactProps(mounted.dom.one('[data-photo-framescaper-receive-file]')).onChange?.({ currentTarget: target }); });
		assert.equal(target.value, '', 'File input must rearm without retaining the selected path.');
	};
	const choose = async (sourceId: string) => { await flush(() => { reactProps(mounted.dom.one('[data-photo-framescaper-receive-source]')).onChange?.({ currentTarget: { value: sourceId } }); }); };
	const chooseClip = async (clipId: string) => { await flush(() => { reactProps(mounted.dom.one('[data-photo-framescaper-receive-clip]')).onChange?.({ currentTarget: { value: clipId } }); }); };
	return { ...mounted, props, events, destinations, flush, click, file, choose, chooseClip };
}

for (const locale of ['en', 'de']) test(`${locale}: Light ordinary still requires an explicit real clip even when only one exists`, async () => {
	const calls: Readonly<{ archive: Blob; sourceId: string; imageClipId?: string }>[] = [], words = photoFramescaperReceiveCopy(locale);
	const f = await mount({ locale, inspect: async () => ordinaryChoices, capture: { receive: async request => { calls.push(request); return { receipt, refresh: 'complete' }; }, reload: async () => undefined } });
	try {
		await f.file(new File([Uint8Array.of(1)], 'ordinary.fscape')); await f.choose('single');
		assert.ok(f.dom.container.textContent.includes(words.ordinaryStill)); assert.ok(f.dom.one('[data-photo-framescaper-receive-clip]').textContent.includes(words.projectBin));
		assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-clip]')).value, '');
		assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-import]')).disabled, true);
		await f.click(words.importPhoto); assert.equal(calls.length, 0);
		await f.chooseClip('single-image'); await f.click(words.importPhoto);
		assert.equal(calls[0]?.sourceId, 'single'); assert.equal(calls[0]?.imageClipId, 'single-image'); assert.ok(Object.isFrozen(calls[0]));
		assert.deepEqual(Object.keys(calls[0]!).sort(), ['archive', 'imageClipId', 'sourceId']);
	} finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light ordinary clip selection uses human sequence labels and resets across source and archive changes', async () => {
	const calls: Readonly<{ archive: Blob; sourceId: string; imageClipId?: string }>[] = [];
	const f = await mount({ inspect: async () => ordinaryChoices, capture: { receive: async request => { calls.push(request); return { receipt, refresh: 'complete' }; }, reload: async () => undefined } });
	try {
		await f.file(new File([Uint8Array.of(1)], 'ordinary.fscape')); await f.choose('still');
		assert.match(f.dom.container.textContent, /Opening sequence.*Timeline/u); assert.match(f.dom.container.textContent, /Opening sequence.*Project Bin/u);
		assert.match(f.dom.container.textContent, /original appearance/u); assert.match(f.dom.container.textContent, /filename saved in Framescaper/u);
		assert.match(f.dom.container.textContent, /Timeline timing and composition stay in Framescaper/u);
		assert.doesNotMatch(f.dom.one('[data-photo-framescaper-receive-clip]').textContent, /timeline-image|bin-image/u);
		await f.chooseClip('foreign-image'); await f.click('Import photo'); assert.equal(calls.length, 0);
		await f.chooseClip('bin-image'); await f.choose('single'); assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-clip]')).value, '');
		await f.chooseClip('single-image'); await f.file(new File([Uint8Array.of(2)], 'replacement.fscape')); await f.choose('still');
		assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-clip]')).value, '');
		await f.choose('one'); assert.equal(f.dom.find('[data-photo-framescaper-receive-clip]'), null); assert.doesNotMatch(f.dom.container.textContent, /original appearance/u); await f.click('Import photo');
		assert.deepEqual(Object.keys(calls[0]!).sort(), ['archive', 'sourceId']);
	} finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light ordinary Close joins the captured clip publication and clears its retired choices before a late ACK', async () => {
	const entered = deferred<void>(), release = deferred<void>(); let selected: unknown, signal: AbortSignal | undefined;
	const f = await mount({ inspect: async () => ordinaryChoices, capture: { receive: async (request, caller) => {
		selected = Object.getOwnPropertyDescriptor(request, 'imageClipId')?.value as unknown; signal = caller; entered.resolve(); await release.promise; return { receipt, refresh: 'complete' };
	}, reload: async () => undefined } }, true);
	try {
		await f.file(new File([Uint8Array.of(1)], 'held.fscape')); await f.choose('still'); await f.chooseClip('bin-image'); await f.click('Import photo'); await entered.promise;
		await f.chooseClip('timeline-image'); assert.equal(selected, 'bin-image', 'A held publication retains its gesture choice.');
		await f.click('Close'); assert.equal(selected, 'bin-image'); assert.equal(signal?.aborted, true); assert.equal(f.dom.find('[data-photo-framescaper-receive-clip]'), null);
		assert.equal(await remainsPending(f.destinations.retireAndJoin()), true); assert.deepEqual(f.events, []); release.resolve();
		await waitFor(async () => { await f.flush(); return f.events.includes('closed'); }, 'ordinary joined close'); assert.deepEqual(f.events, ['closed']);
	} finally { release.resolve(); await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light ordinary StrictMode replacement drains held publication before fresh inspection and leaves clip selection empty', async () => {
	const entered = deferred<void>(), release = deferred<void>(); let inspections = 0, signal: AbortSignal | undefined;
	const f = await mount({ inspect: async () => { inspections++; return ordinaryChoices; }, capture: { receive: async (_request, caller) => {
		signal = caller; entered.resolve(); await release.promise; return { receipt, refresh: 'complete' };
	}, reload: async () => undefined } }, true);
	try {
		await f.file(new File([Uint8Array.of(1)], 'previous.fscape')); await f.choose('still'); await f.chooseClip('bin-image'); await f.click('Import photo'); await entered.promise;
		Object.defineProperty(f.props, 'capture', { value: Object.freeze({ receive: async () => ({ receipt, refresh: 'complete' as const }), reload: async () => undefined }) });
		await f.render(); assert.equal(signal?.aborted, true); assert.equal(f.dom.find('[data-photo-framescaper-receive-clip]'), null);
		await f.file(new File([Uint8Array.of(2)], 'replacement.fscape')); assert.equal(inspections, 1); release.resolve();
		await waitFor(async () => { await f.flush(); return inspections === 2; }, 'ordinary replacement drain');
		await f.choose('single'); assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-clip]')).value, '');
		assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-import]')).disabled, true); assert.deepEqual(f.events, []);
	} finally { release.resolve(); await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light receive dialog requires explicit choice and clears selection for another archive', async () => {
	const calls: string[] = [], f = await mount({ capture: { receive: async request => { calls.push(request.sourceId); return { receipt, refresh: 'complete' }; }, reload: async () => undefined } });
	try {
		await f.file(new File([Uint8Array.of(1)], 'editable.fscape'));
		assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-import]')).disabled, true);
		assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-source]')).value, '');
		assert.match(f.dom.container.textContent, /unavailable/iu);
		await f.choose('two'); await f.click('Import photo'); assert.deepEqual(calls, ['two']); assert.deepEqual(f.events, ['imported']);
		await f.file(new File([Uint8Array.of(2)], 'another.fscape'));
		assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-import]')).disabled, true);
		assert.equal(f.dom.find('[data-photo-framescaper-receive-receipt]'), null);
	} finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light receive picker dismissal acquires no archive or publication authority', async () => {
	let reads = 0, imports = 0;
	const f = await mount({ inspect: async () => { reads++; return choices; }, capture: { receive: async () => { imports++; return { receipt, refresh: 'complete' }; }, reload: async () => undefined } });
	try { await f.file(null); assert.equal(reads, 0); assert.equal(imports, 0); assert.equal(f.dom.find('[data-photo-framescaper-receive-source]'), null); }
	finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light receive Close joins held inspection before dismissing and retiring selected resources', async () => {
	const entered = deferred<void>(), release = deferred<typeof choices>(); let signal: AbortSignal | undefined;
	const f = await mount({ inspect: async request => { signal = request.signal; entered.resolve(); return release.promise; } });
	try {
		await f.file(new File([Uint8Array.of(1)], 'held.fscape')); await entered.promise; await f.click('Close');
		assert.equal(signal?.aborted, true); assert.deepEqual(f.events, []); assert.equal(await remainsPending(f.destinations.retireAndJoin()), true);
		release.resolve(choices); await waitFor(async () => { await f.flush(); return f.events.includes('closed'); }, 'joined inspection close');
		assert.equal(f.dom.find('[data-photo-framescaper-receive-source]'), null);
	} finally { release.resolve(choices); await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light receive Close joins publication and suppresses retired presentation even after an Imported ACK', async () => {
	const entered = deferred<void>(), release = deferred<void>(); let signal: AbortSignal | undefined;
	const f = await mount({ capture: { receive: async (_request, caller) => { signal = caller; entered.resolve(); await release.promise; return { receipt, refresh: 'complete' }; }, reload: async () => undefined } });
	try {
		await f.file(new File([Uint8Array.of(1)], 'held.fscape')); await f.choose('one'); await f.click('Import photo'); await entered.promise;
		await f.click('Close'); assert.equal(signal?.aborted, true); assert.deepEqual(f.events, []);
		assert.equal(await remainsPending(f.destinations.retireAndJoin()), true); release.resolve();
		await waitFor(async () => { await f.flush(); return f.events.includes('closed'); }, 'joined receive close'); assert.deepEqual(f.events, ['closed']);
	} finally { release.resolve(); await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light receive StrictMode replacement clears its file choice and joins the predecessor reader', async () => {
	const entered = deferred<void>(), release = deferred<typeof choices>(), names: string[] = []; let firstSignal: AbortSignal | undefined;
	const f = await mount({ inspect: async request => {
		names.push((request.archive as File).name);
		if (names.length === 1) { firstSignal = request.signal; entered.resolve(); return release.promise; }
		return choices;
	} }, true);
	try {
		assert.deepEqual(names, [], 'StrictMode opening must remain inert.');
		await f.file(new File([Uint8Array.of(1)], 'previous.fscape')); await entered.promise;
		Object.defineProperty(f.props, 'capture', { value: Object.freeze({ receive: async () => ({ receipt, refresh: 'complete' as const }), reload: async () => undefined }) });
		await f.render(); assert.equal(firstSignal?.aborted, true); assert.equal(f.dom.find('[data-photo-framescaper-receive-source]'), null);
		await f.file(new File([Uint8Array.of(2)], 'replacement.fscape')); assert.deepEqual(names, ['previous.fscape']);
		release.resolve(choices); await waitFor(async () => { await f.flush(); return names.length === 2; }, 'joined replacement reader');
		assert.deepEqual(names, ['previous.fscape', 'replacement.fscape']);
		assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-source]')).value, ''); assert.deepEqual(f.events, []);
	} finally { release.resolve(choices); await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light receive reports durable publication separately from pending recovery and permits joined Reload', async () => {
	const release = deferred<void>(), entered = deferred<void>(); let reloads = 0;
	const f = await mount({ capture: { receive: async () => ({ receipt: { ...receipt, settlement: 'recovery-pending', failure: undefined }, refresh: 'failed', failure: Symbol('refresh') }),
		reload: async () => { reloads++; entered.resolve(); await release.promise; } } });
	try {
		await f.file(new File([Uint8Array.of(1)], 'pending.fscape')); await f.choose('one'); await f.click('Import photo');
		assert.deepEqual(f.events, ['imported']); assert.match(f.dom.container.textContent, /imported/iu); assert.match(f.dom.container.textContent, /finish the import/iu);
		await f.click('Reload library'); await entered.promise; await f.click('Close'); assert.equal(reloads, 1);
		assert.equal(await remainsPending(f.destinations.retireAndJoin()), true); release.resolve();
		await waitFor(async () => { await f.flush(); return f.events.includes('closed'); }, 'joined reload close');
	} finally { release.resolve(); await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light receive failed Reload keeps the Imported ACK and can recover without another publication', async () => {
	let publications = 0, reloads = 0;
	const f = await mount({ capture: { receive: async () => { publications++; return { receipt, refresh: 'failed', failure: undefined }; },
		reload: async () => { reloads++; if (reloads === 1) throw Symbol('page refresh'); } } });
	try {
		await f.file(new File([Uint8Array.of(1)], 'imported.fscape')); await f.choose('one'); await f.click('Import photo');
		await f.click('Reload library'); assert.match(f.dom.container.textContent, /could not be refreshed/iu); assert.equal(publications, 1);
		assert.ok(f.dom.find('[data-photo-framescaper-receive-receipt]')); await f.click('Reload library');
		assert.equal(reloads, 2); assert.equal(publications, 1); assert.equal(f.dom.one('[data-photo-framescaper-receive-receipt]').textContent, 'Photo imported.');
		assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-import]')).disabled, true);
	} finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light receive refuses unavailable archives without silently selecting or flattening them', async () => {
	const f = await mount({ inspect: async () => ({ ...choices, sources: [], unsupportedImageCount: 2 }) });
	try { await f.file(new File([Uint8Array.of(1)], 'ordinary.fscape')); assert.equal(reactProps(f.dom.one('[data-photo-framescaper-receive-import]')).disabled, true); assert.match(f.dom.container.textContent, /unavailable/iu); }
	finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});

for (const locale of ['en', 'de']) test(`${locale}: Light receive exposes localized menu-owned labels`, async () => {
	const f = await mount({ locale });
	try { const copy = photoFramescaperReceiveCopy(locale); assert.match(f.dom.container.textContent, new RegExp(copy.description, 'u')); assert.ok(f.dom.container.querySelectorAll('button').some(button => button.textContent === copy.importPhoto)); }
	finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});
