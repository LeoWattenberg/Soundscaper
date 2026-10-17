/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopEffects from '../src/common/editor/ui/lightscaper/PhotoDevelopEffects.tsx';
import { PhotoLibraryDevelopWorkflowV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { VideoEffectLeaf } from '../src/common/editor/project-media-types.ts';
import PhotoDevelopWorkspace from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspace.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../src/common/i18n/video-effect-copy.js';
import { VIDEO_EFFECT_TYPES } from '../src/common/editor/video-effects.js';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';
import VideoEffectRack from '../src/common/editor/ui/inspector/VideoEffectRack.jsx';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
const source = Array.from({length:9},()=>[128,64,255,127]).flat();
const expected = [16,8,31,127,128,64,255,127,16,8,31,127,128,64,255,127,128,64,255,127,128,64,255,127,16,8,31,127,128,64,255,127,16,8,31,127];
const frame = () => ({ width: 3, height: 3, pixels: new Uint8Array(source) });
const key = async (input: ReactTestElement, value: string) => {
	await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value, valueAsNumber: Number(value) } }); });
	await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
};

for (const locale of ['en','de'] as const) {
	test(`${locale} opt-in Photo workspace authors, saves and renders post-crop vignette through the actual Session`, async () => {
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			databaseName: `vignette-author-${locale}`, verifyOriginal: async () => undefined });
		await catalog.createCatalog(queryCatalogRootV1()); await catalog.publishPhotos('catalog',0,[queryPhotoV1()]);
		const before = (await catalog.loadPhoto('catalog',queryPhotoV1().id))!;
		const unexpected = async (): Promise<never> => { throw Error('Original mutation is outside Develop.'); };
		const session = new PhotoLibrarySessionV1({ catalog, initialize: async () => (await catalog.loadCatalog('catalog'))!,
			closeResources: async () => undefined, exclusive: async (_id,operation,signal) => operation(signal),
			journal: { get: async () => undefined, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
			media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected, promote: unexpected,
				releaseStaged: unexpected, readPage: unexpected } } });
		const messages = photoDevelopCopy(locale);
		const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspace locale={locale} photoId={before.id} label={before.metadata.fileName}
			generation={session} execute={async (run,signal) => { await run({ signal: signal!, isCurrent: () => true,
				acquire: async () => session.develop, refresh: async () => undefined }); }} readPreview={async () => ({ outcome: 'missing' })}
			loadProxy={unexpected} beforePresent={Promise.resolve()} registerRetirement={() => () => undefined} onClose={() => undefined} />);
		const click = async (label: string) => { const target = mounted.dom.container.querySelectorAll('button').find(row => row.textContent === label); assert.ok(target,label);
			await act(async () => { reactProps(target).onClick?.({ currentTarget: target }); await settle(); }); };
		try {
			await act(async () => { await settle(); });
			const select = mounted.dom.one('[data-photo-develop-effects]').querySelector('select'); assert.ok(select);
			assert.ok(select.querySelectorAll('option').some(row => row.getAttribute('value')==='post-crop-vignette-v1'));
			await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: 'post-crop-vignette-v1' } }); }); await click(messages.add);
			const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label')===`${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectPostCropVignetteAmount}`);
			assert.ok(input); await key(input,'-100'); await click(messages.save);
			const saved = await session.develop.read({ schemaVersion: 1, photoId: before.id });
			assert.deepEqual(saved.develop.effects[0]?.params,{amount:-100,midpoint:50,roundness:0,feather:50,highlights:0}); assert.equal(saved.history.entries.length,2);
			const capture = frame();
			assert.deepEqual(await withPhotoDevelopProxyV1({ frame: { descriptor: { schemaVersion: 1,width:3,height:3,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb' },
				pixels: capture.pixels }, develop: saved.develop },view=>[...view.frame.pixels]),expected);
			const after = (await catalog.loadPhoto('catalog',before.id))!;
			assert.deepEqual(after.original,before.original); assert.deepEqual(after.metadata,before.metadata); assert.deepEqual(after.extractedMetadata,before.extractedMetadata);
			assert.deepEqual([...capture.pixels],source);
		} finally { await mounted.dispose(); await session.close(); await catalog.close(); }
	});

	test(`${locale} opted-in Frames effect rack authors and persists the same vignette recipe before actual rendering`, async context => {
		const previous = Object.getOwnPropertyDescriptor(globalThis,'React'); Object.defineProperty(globalThis,'React',{configurable:true,value:React});
		context.after(()=>{if(previous) Object.defineProperty(globalThis,'React',previous); else Reflect.deleteProperty(globalThis,'React');});
		let project = createFramescaperProjectFinishing(PROFILE,framescaperV20Options()), error = '';
		const view = (value: unknown) => value as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
		const service = createVideoEffectService({state:{selectedClipId:'video-clip',readOnly:false,videoEffectGestures:new Map()},copy:{projectReadOnly:'Read only'},
			getProject:()=>view(project),captureProject:()=>generation.capture(view(project).id),assertProject:token=>{generation.assertCurrent(token);},editingBlocked:()=>false,
			commit:command=>{project=applyFramescaperProjectCommandFinishing(PROFILE,project,command);return view(project);},publishDocumentSnapshot(){}});
		const actions = {add:service.addVideoClipEffect,beginGesture:service.beginVideoEffectGesture,preview:service.previewVideoEffectGesture,
			commit:service.commitVideoEffectGesture,cancel:service.cancelVideoEffectGesture,toggle:service.toggleVideoClipEffect,reorder:service.reorderVideoClipEffect,
			remove:service.removeVideoClipEffect,update:service.updateVideoClipEffect};
		const copy = VIDEO_EFFECT_COPY_BY_LOCALE[locale];
		const mounted = await mountPhotoImportUi(() => <VideoEffectRack clip={view(project).clips.find(row=>row.id==='video-clip')}
			controller={{actions:{video:{effects:actions}}}} copy={{...copy,chooseEffect:'Choose effect',addEffect:'Add effect'}} disabled={false} onError={(value:string)=>{error=value;}} />);
		try {
			const picker=mounted.dom.one('.dropdown');
			await act(async()=>{reactProps(picker).onKeyDown?.({key:'Enter',preventDefault(){}});});
			for(let n=0;n<VIDEO_EFFECT_TYPES.indexOf('post-crop-vignette-v1');n++) await act(async()=>{reactProps(picker).onKeyDown?.({key:'ArrowDown',preventDefault(){}});});
			await act(async()=>{reactProps(picker).onKeyDown?.({key:'Enter',preventDefault(){}});});
			const add=mounted.dom.container.querySelectorAll('button').find(row=>row.textContent==='Add effect');assert.ok(add);
			await act(async()=>{reactProps(add).onClick?.({});await settle();});await mounted.render();
			const input=mounted.dom.container.querySelectorAll('input').find(row=>row.getAttribute('aria-label')===`${copy.videoEffectExactValue}: ${copy.videoEffectPostCropVignetteAmount}`);assert.ok(input);
			await key(input,'-100');await mounted.render();assert.equal(error,'');
			const clip=view(cloneFramescaperProjectFinishing(PROFILE,project)).clips.find(row=>row.id==='video-clip')!;
			assert.deepEqual(clip.videoEffects?.[0]?.params,{amount:-100,midpoint:50,roundness:0,feather:50,highlights:0});assert.equal(clip.videoEffects?.[0]?.type,'post-crop-vignette-v1');
			const capture=frame();assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing(capture,clip.videoEffects!,new AbortController().signal)).pixels],expected);
			assert.deepEqual([...capture.pixels],source);
		}finally{await mounted.dispose();}
	});
}

async function photoWorkflowFixture() {
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		databaseName: 'held-vignette-ui', verifyOriginal: async () => undefined });
	await catalog.createCatalog(queryCatalogRootV1()); await catalog.publishPhotos('catalog', 0, [queryPhotoV1()]);
	const unexpected = async (): Promise<never> => { throw Error('No original mutation is authorized.'); };
	const session = new PhotoLibrarySessionV1({ catalog, initialize: async () => (await catalog.loadCatalog('catalog'))!,
		closeResources: async () => undefined, exclusive: async (_id, operation, signal) => operation(signal),
		journal: { get: async () => undefined, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
		media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected, promote: unexpected,
			releaseStaged: unexpected, readPage: unexpected } } });
	const owner = new PhotoLibraryDevelopWorkflowV1({ execute: async (run, signal) => { await run({ signal: signal!, isCurrent: () => true,
		acquire: async () => session.develop, refresh: async () => undefined }); } });
	await owner.open(queryPhotoV1().id);
	return { owner, close: async () => { await owner.close(); await session.close(); await catalog.close(); } };
}

test('Photo vignette retained numeric handlers refuse externally replaced same-ID arrays',async()=>{
 const h=await photoWorkflowFixture(),messages=photoDevelopCopy('en');
 h.owner.setEffects([createVideoEffect('post-crop-vignette-v1',{id:'same'}) as VideoEffectLeaf]);
 const mounted=await mountPhotoImportUi(()=><PhotoDevelopEffects effects={h.owner.snapshot().draft!.effects} owner={h.owner} messages={messages} disabled={false} isCurrent={()=>true}/>);
 try{
  const input=mounted.dom.container.querySelectorAll('input').find(row=>row.getAttribute('aria-label')==='Exact value: Amount');assert.ok(input);const retained=reactProps(input).onChange!;
  h.owner.setEffects([createVideoEffect('post-crop-vignette-v1',{id:'same',params:{amount:-50,midpoint:25}}) as VideoEffectLeaf]);const expected=h.owner.snapshot().draft;
  await act(async()=>{retained({currentTarget:{value:'-100',valueAsNumber:-100}});});assert.equal(h.owner.snapshot().draft,expected);
 }finally{await mounted.dispose();await h.close();}
});
test('Photo vignette cancel retains accepted midpoint after invalid signed-amount scratch and owning error containment',async()=>{
 const h=await photoWorkflowFixture(),messages=photoDevelopCopy('en');h.owner.setEffects([createVideoEffect('post-crop-vignette-v1',{id:'same'}) as VideoEffectLeaf]);
 const mounted=await mountPhotoImportUi(()=><PhotoDevelopEffects effects={h.owner.snapshot().draft!.effects} owner={h.owner} messages={messages} disabled={false} isCurrent={()=>true}/>);
 const input=(name:string)=>{const row=mounted.dom.container.querySelectorAll('input').find(row=>row.getAttribute('aria-label')===`Exact value: ${name}`);assert.ok(row);return row;};
 try{
  await act(async()=>{reactProps(input('Midpoint')).onFocus?.({});reactProps(input('Midpoint')).onChange?.({currentTarget:{value:'0',valueAsNumber:0}});});await mounted.render();
  await act(async()=>{reactProps(input('Midpoint')).onKeyDown?.({key:'Enter',preventDefault(){}});});await mounted.render();const accepted=h.owner.snapshot().draft;
  await act(async()=>{reactProps(input('Amount')).onFocus?.({});reactProps(input('Amount')).onChange?.({currentTarget:{value:'-50',valueAsNumber:-50}});});await mounted.render();
  await act(async()=>{reactProps(input('Amount')).onChange?.({currentTarget:{value:'101',valueAsNumber:101}});});assert.equal(mounted.dom.one('[role="alert"]').textContent,messages.shared.videoEffectPostCropVignetteInvalid);
  await act(async()=>{reactProps(input('Amount')).onKeyDown?.({key:'Escape',preventDefault(){},stopPropagation(){}});});
  assert.equal(h.owner.snapshot().draft,accepted);assert.equal(accepted!.effects[0]!.params.midpoint,0);
 }finally{await mounted.dispose();await h.close();}
});
