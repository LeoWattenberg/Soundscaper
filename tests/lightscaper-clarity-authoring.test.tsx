/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useEffect, useState } from 'react';
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
const source = [40,40,40,255,100,100,100,127,160,160,160,255];
// Alpha127 center gives binomial luma63/137 at the edges; midtone-gated half gain rounds -4/+9.
const expected = [36,36,36,255,100,100,100,127,169,169,169,255];
const frame = () => ({ width: 3, height: 1, pixels: new Uint8Array(source) });
const key = async (input: ReactTestElement, value: string) => {
	await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value, valueAsNumber: Number(value) } }); });
	await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
};

for (const locale of ['en','de'] as const) {
	test(`${locale} opt-in Photo workspace authors, saves and renders Clarity through the actual Session`, async () => {
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			databaseName: `clarity-author-${locale}`, verifyOriginal: async () => undefined });
		await catalog.createCatalog(queryCatalogRootV1()); await catalog.publishPhotos('catalog',0,[queryPhotoV1()]);
		const before = (await catalog.loadPhoto('catalog',queryPhotoV1().id))!;
		const unexpected = async (): Promise<never> => { throw Error('Original mutation is outside Develop.'); };
		const session = new PhotoLibrarySessionV1({ catalog, initialize: async () => (await catalog.loadCatalog('catalog'))!,
			closeResources: async () => undefined, exclusive: async (_id,operation,signal) => operation(signal),
			journal: { get: async () => undefined, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
			media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected, promote: unexpected,
				releaseStaged: unexpected, readPage: unexpected } } });
		const messages = photoDevelopCopy(locale);
		assert.equal(messages.shared.videoEffectClarity, locale === 'en' ? 'Clarity' : 'Klarheit');
		const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspace locale={locale} photoId={before.id} label={before.metadata.fileName}
			generation={session} execute={async (run,signal) => { await run({ signal: signal!, isCurrent: () => true,
				acquire: async () => session.develop, refresh: async () => undefined }); }} readPreview={async () => ({ outcome: 'missing' })}
			loadProxy={unexpected} beforePresent={Promise.resolve()} registerRetirement={() => () => undefined} onClose={() => undefined} />);
		const click = async (label: string) => { const target = mounted.dom.container.querySelectorAll('button').find(row => row.textContent === label); assert.ok(target,label);
			await act(async () => { reactProps(target).onClick?.({ currentTarget: target }); await settle(); }); };
		try {
			await act(async () => { await settle(); });
			const select = mounted.dom.one('[data-photo-develop-effects]').querySelector('select'); assert.ok(select);
			assert.ok(select.querySelectorAll('option').some(row => row.getAttribute('value')==='clarity-v1'));
			await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: 'clarity-v1' } }); }); await click(messages.add);
			const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label')===`${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectClarityAmount}`);
			assert.ok(input); await key(input,'50'); await click(messages.save);
			const saved = await session.develop.read({ schemaVersion: 1, photoId: before.id });
			assert.deepEqual(saved.develop.effects[0]?.params,{amount:50}); assert.equal(saved.history.entries.length,2);
			const capture = frame();
			assert.deepEqual(await withPhotoDevelopProxyV1({ frame: { descriptor: { schemaVersion: 1,width:3,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb' },
				pixels: capture.pixels }, develop: saved.develop },view=>[...view.frame.pixels]),expected);
			const after = (await catalog.loadPhoto('catalog',before.id))!;
			assert.deepEqual(after.original,before.original); assert.deepEqual(after.metadata,before.metadata); assert.deepEqual(after.extractedMetadata,before.extractedMetadata);
			assert.deepEqual([...capture.pixels],source);
		} finally { await mounted.dispose(); await session.close(); await catalog.close(); }
	});

	test(`${locale} opted-in Frames effect rack authors and persists the same local-contrast recipe before actual rendering`, async context => {
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
			for(let n=0;n<VIDEO_EFFECT_TYPES.indexOf('clarity-v1');n++) await act(async()=>{reactProps(picker).onKeyDown?.({key:'ArrowDown',preventDefault(){}});});
			await act(async()=>{reactProps(picker).onKeyDown?.({key:'Enter',preventDefault(){}});});
			const add=mounted.dom.container.querySelectorAll('button').find(row=>row.textContent==='Add effect');assert.ok(add);
			await act(async()=>{reactProps(add).onClick?.({});await settle();});await mounted.render();
			const input=mounted.dom.container.querySelectorAll('input').find(row=>row.getAttribute('aria-label')===`${copy.videoEffectExactValue}: ${copy.videoEffectClarityAmount}`);assert.ok(input);
			await key(input,'50');await mounted.render();assert.equal(error,'');
			const clip=view(cloneFramescaperProjectFinishing(PROFILE,project)).clips.find(row=>row.id==='video-clip')!;
			assert.deepEqual(clip.videoEffects?.[0]?.params,{amount:50});assert.equal(clip.videoEffects?.[0]?.type,'clarity-v1');
			const capture=frame();assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing(capture,clip.videoEffects!,new AbortController().signal)).pixels],expected);
			assert.deepEqual([...capture.pixels],source);
		}finally{await mounted.dispose();}
	});
}

for (const locale of ['en','de'] as const) test(`${locale} actual Session numeric adjustment refusal preserves last valid draft and cancellation`, async () => {
	const fixture=await mountNumericWorkspace(locale),{owner,mounted,messages,session}=fixture;
	try {
		for (const [type,name,label,valid,invalid] of [
			['white-balance-v1','temperature','videoEffectParamTemperature',20,101],
			['detail-sharpen-v1','amount','videoEffectDetailSharpenAmount',50,201],
			['clarity-v1','amount','videoEffectClarityAmount',50,101],
			['develop-geometry-v1','cropWidth','videoEffectParamCropWidth',0.5,0],
		] as const) {
			await act(async () => { owner.setEffects([createVideoEffect(type,{id:'numeric'}) as VideoEffectLeaf]); });
			const find = () => { const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label')===`${messages.shared.videoEffectExactValue}: ${messages.shared[label]}`);
				assert.ok(input); return input; };
			await act(async () => { reactProps(find()).onFocus?.({}); reactProps(find()).onChange?.({ currentTarget: {value:String(valid),valueAsNumber:valid} }); });
			const lastValid = owner.snapshot().draft; assert.equal(lastValid!.effects[0]!.params[name],valid);
			await act(async () => { reactProps(find()).onChange?.({ currentTarget: {value:String(invalid),valueAsNumber:invalid} }); });
			assert.strictEqual(owner.snapshot().draft,lastValid); assert.equal(mounted.dom.one('[role="alert"]').textContent,
				locale==='en' ? 'Enter valid adjustment values within their limits.' : 'Gültige Anpassungswerte innerhalb ihrer Grenzen eingeben.');
			await act(async () => { reactProps(find()).onKeyDown?.({key:'Escape',preventDefault(){},stopPropagation(){}}); });
			assert.deepEqual(owner.snapshot().draft!.effects[0]!.params,createVideoEffect(type,{id:'numeric'}).params);
			await key(find(),String(valid)); let acknowledged=false;
			await act(async()=>{acknowledged=(await owner.save('Accepted numeric adjustment'))!==null;});assert.ok(acknowledged);
			assert.equal((await session.develop.read({schemaVersion:1,photoId:queryPhotoV1().id})).develop.effects[0]!.params[name],valid);
		}
		await act(async () => { owner.setEffects([createVideoEffect('develop-geometry-v1',{id:'numeric',params:{cropWidth:0.5}}) as VideoEffectLeaf]); });
		const cropX=mounted.dom.container.querySelectorAll('input').find(row=>row.getAttribute('aria-label')===`${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamCropX}`); assert.ok(cropX);
		const before=owner.snapshot().draft;
		await act(async () => { reactProps(cropX).onFocus?.({}); reactProps(cropX).onChange?.({currentTarget:{value:'0.75',valueAsNumber:0.75}}); });
		assert.strictEqual(owner.snapshot().draft,before); assert.ok(mounted.dom.one('[role="alert"]'));
		await act(async()=>{owner.cancelGesture();owner.setEffects([createVideoEffect('develop-geometry-v1',{id:'numeric'})as VideoEffectLeaf]);});
		const flip=mounted.dom.container.querySelectorAll('select').find(row=>row.getAttribute('aria-label')===`${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamFlipHorizontal}`);assert.ok(flip);
		await act(async()=>{reactProps(flip).onChange?.({currentTarget:{value:'1'}});});
		const rotation=()=>{const result=mounted.dom.container.querySelectorAll('input').find(row=>row.getAttribute('aria-label')===`${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamGeometryRotation}`);assert.ok(result);return result;};
		await act(async()=>{reactProps(rotation()).onFocus?.({});reactProps(rotation()).onChange?.({currentTarget:{value:'20',valueAsNumber:20}});});
		await act(async()=>{reactProps(rotation()).onKeyDown?.({key:'Escape',preventDefault(){},stopPropagation(){}});});
		assert.equal(owner.snapshot().draft!.effects[0]!.params.flipHorizontal,1);assert.equal(owner.snapshot().draft!.effects[0]!.params.rotationDegrees,0);
	} finally { await fixture.close(); }
});


async function mountNumericWorkspace(locale:'en'|'de') {
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		databaseName: `clarity-numeric-${locale}`, verifyOriginal: async () => undefined });
	await catalog.createCatalog(queryCatalogRootV1()); await catalog.publishPhotos('catalog',0,[queryPhotoV1()]);
	const unexpected = async (): Promise<never> => { throw Error('Original mutation is outside Develop.'); };
	const session = new PhotoLibrarySessionV1({ catalog, initialize: async () => (await catalog.loadCatalog('catalog'))!,
		closeResources: async () => undefined, exclusive: async (_id,operation,signal) => operation(signal),
		journal: { get: async () => undefined, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
		media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected, promote: unexpected,
			releaseStaged: unexpected, readPage: unexpected } } });
	const owner = new PhotoLibraryDevelopWorkflowV1({ execute: async (run, signal) => { await run({ signal: signal!, isCurrent: () => true,
		acquire: async () => session.develop, refresh: async () => undefined }); } });
	await owner.open(queryPhotoV1().id); const messages = photoDevelopCopy(locale);
	function Harness() { const [view,update] = useState(owner.snapshot()); useEffect(() => owner.subscribe(update), []);
		return <PhotoDevelopEffects effects={view.draft!.effects} owner={owner} messages={messages} disabled={view.busy} isCurrent={() => true} />; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	return {owner,mounted,messages,session,async close(){await mounted.dispose();await owner.close();await session.close();await catalog.close();}};
}

for(const locale of ['en','de'] as const)test(`${locale} actual Session combined split refusal clears only its matching settled gesture`,async()=>{
	const fixture=await mountNumericWorkspace(locale),{owner,mounted,messages,session}=fixture;
	const input=(label:string)=>{const result=mounted.dom.container.querySelectorAll('input').find(row=>row.getAttribute('aria-label')===`${messages.shared.videoEffectExactValue}: ${label}`);assert.ok(result);return result;};
	const change=async(target:ReactTestElement,value:number)=>{await act(async()=>{reactProps(target).onFocus?.({});reactProps(target).onChange?.({currentTarget:{value:String(value),valueAsNumber:value}});});};
	const escape=async(props:ReturnType<typeof reactProps>)=>{await act(async()=>{props.onKeyDown?.({key:'Escape',preventDefault(){},stopPropagation(){}});});};
	try{
		await act(async()=>{owner.setEffects([createVideoEffect('parametric-curves-v1',{id:'numeric',params:{masterShadows:100}})as VideoEffectLeaf]);});
		const split=()=>input(messages.shared.videoEffectCurveShadowSplit!);
		for(const value of [0.5,0.75])await change(split(),value);
		assert.equal(mounted.dom.one('[role="alert"]').textContent,messages.shared.videoEffectCurveParametersInvalid);
		await escape(reactProps(split()));assert.equal(mounted.dom.container.querySelectorAll('[role="alert"]').length,0);
		assert.equal(owner.snapshot().draft!.effects[0]!.params.shadowSplit,0.25);assert.equal(owner.snapshot().draft!.effects[0]!.params.masterShadows,100);
		// Native typing the already-restored .25 need not emit change; Enter alone must leave no stale refusal.
		await act(async()=>{reactProps(split()).onFocus?.({});reactProps(split()).onKeyDown?.({key:'Enter',preventDefault(){}});});
		assert.equal(mounted.dom.container.querySelectorAll('[role="alert"]').length,0);
		await act(async()=>{owner.setEffects([createVideoEffect('white-balance-v1',{id:'numeric'})as VideoEffectLeaf]);});
		await change(input(messages.shared.videoEffectParamTemperature!),20);
		const retired=reactProps(input(messages.shared.videoEffectParamTemperature!));
		await act(async()=>{owner.commitGesture();owner.setEffects([createVideoEffect('parametric-curves-v1',{id:'numeric',params:{masterShadows:100}})as VideoEffectLeaf]);});
		await change(split(),0.2);await change(split(),0.5);const valid=owner.snapshot().draft;
		await escape(retired);assert.strictEqual(owner.snapshot().draft,valid);assert.equal(mounted.dom.one('[role="alert"]').textContent,messages.shared.videoEffectCurveParametersInvalid);
		await escape(reactProps(split()));assert.equal(mounted.dom.container.querySelectorAll('[role="alert"]').length,0);
		await act(async()=>{assert.ok(await owner.save('Accepted curves'));});
		const saved=await session.develop.read({schemaVersion:1,photoId:queryPhotoV1().id});
		assert.equal(saved.develop.effects[0]!.params.shadowSplit,0.25);assert.equal(saved.develop.effects[0]!.params.masterShadows,100);
	}finally{await fixture.close();}
});
