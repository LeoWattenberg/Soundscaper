/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
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
const source = Array.from({length:8},()=>[128,128,128,127]).flat();
const expected = [124,128,128,123,125,134,140,142].flatMap(value=>[value,value,value,127]);
const params = { amount:100, size:2, roughness:0, seed:7 };
const controls = [['videoEffectGrainAmount',100],['videoEffectGrainSize',2],['videoEffectGrainRoughness',0],['videoEffectGrainSeed',7]] as const;
const key = async (input: ReactTestElement, value: number, commit = true) => {
	await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value: String(value), valueAsNumber: value } }); });
	if (commit) await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
};

for (const locale of ['en','de'] as const) {
	test(`${locale} menu-owned Photo Develop saves four Grain controls through the actual Session and preserves original custody`, async () => {
		const indexedDB=createInstrumentedIndexedDB(),catalog = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
			databaseName: `grain-author-${locale}`, verifyOriginal: async () => undefined });
		await catalog.createCatalog(queryCatalogRootV1()); await catalog.publishPhotos('catalog',0,[queryPhotoV1()]);
		const before = (await catalog.loadPhoto('catalog',queryPhotoV1().id))!;
		const unexpected = async (): Promise<never> => { throw Error('No original write is authorized by Develop.'); };
		const openSession=(owned:PhotoCatalogRepositoryV1)=>new PhotoLibrarySessionV1({ catalog:owned, initialize: async () => (await owned.loadCatalog('catalog'))!, closeResources: async () => undefined,
			exclusive: async (_id,operation,signal) => operation(signal), journal: { get: async () => undefined, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
			media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected, promote: unexpected, releaseStaged: unexpected, readPage: unexpected } } });
		const session=openSession(catalog),messages = photoDevelopCopy(locale);
		assert.equal(messages.shared.videoEffectGrain,locale==='en'?'Grain':'Körnung');
		const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspace locale={locale} photoId={before.id} label={before.metadata.fileName}
			generation={session} execute={async (run,signal) => { await run({ signal: signal!, isCurrent: () => true,
				acquire: async () => session.develop, refresh: async () => undefined }); }} readPreview={async () => ({ outcome: 'missing' })}
			loadProxy={unexpected} beforePresent={Promise.resolve()} registerRetirement={() => () => undefined} onClose={() => undefined} />);
		const click = async (label: string) => { const row = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === label); assert.ok(row,label);
			await act(async () => { reactProps(row).onClick?.({ currentTarget: row }); await settle(); }); };
		const input = (copyKey: string) => { const row = mounted.dom.container.querySelectorAll('input').find(candidate => candidate.getAttribute('aria-label') === `${messages.shared.videoEffectExactValue}: ${messages.shared[copyKey]}`); assert.ok(row,copyKey); return row; };
		let disposed=false;
		try {
			await act(async () => { await settle(); });
			const picker = mounted.dom.one('[data-photo-develop-effects]').querySelector('select'); assert.ok(picker);
			assert.ok(picker.querySelectorAll('option').some(row => row.getAttribute('value') === 'grain-v1'));
			await act(async () => { reactProps(picker).onChange?.({ currentTarget: { value: 'grain-v1' } }); }); await click(messages.add);
			for (const [copyKey,value] of controls) await key(input(copyKey),value);
			await key(input('videoEffectGrainSeed'),0.5,false);
			const adjustments=mounted.dom.one('[data-photo-develop-effects]');
			assert.equal(adjustments.querySelector('[role="alert"]')?.textContent,messages.shared.videoEffectParametersInvalid);
			await act(async () => { reactProps(input('videoEffectGrainSeed')).onKeyDown?.({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); });
			assert.equal(adjustments.querySelectorAll('[role="alert"]').length,0);
			await click(messages.save);
			const saved = await session.develop.read({ schemaVersion: 1, photoId: before.id });
			assert.equal(saved.develop.effects[0]?.type,'grain-v1'); assert.deepEqual(saved.develop.effects[0]?.params,params); assert.equal(saved.history.entries.length,2);
			assert.equal(saved.history.cursor,1);assert.equal(saved.revision,before.revision+1);assert.equal(saved.versionId,before.activeVersionId);
			const capture = new Uint8Array(source);
			assert.deepEqual(await withPhotoDevelopProxyV1({ frame: { descriptor: { schemaVersion: 1,width:8,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb' },pixels:capture },
				develop:saved.develop },view=>[...view.frame.pixels]),expected);
			const after = (await catalog.loadPhoto('catalog',before.id))!;
			assert.deepEqual(after.original,before.original); assert.deepEqual(after.metadata,before.metadata); assert.deepEqual(after.extractedMetadata,before.extractedMetadata); assert.deepEqual([...capture],source);
			await mounted.dispose();disposed=true;await session.close();await catalog.close();
			const reopened=new PhotoCatalogRepositoryV1({indexedDB:indexedDB as unknown as IDBFactory,databaseName:`grain-author-${locale}`,verifyOriginal:async()=>undefined});
			const replacement=openSession(reopened);
			try{assert.deepEqual(await replacement.develop.read({schemaVersion:1,photoId:before.id,versionId:saved.versionId}),saved);
				assert.deepEqual(await reopened.loadPhoto('catalog',before.id),after);
			}finally{await replacement.close();await reopened.close();}
		} finally { if(!disposed)await mounted.dispose(); await session.close(); await catalog.close(); }
	});

	test(`${locale} existing Frame effect menu authors and persists the same four Grain controls before actual rendering`, async context => {
		const previous = Object.getOwnPropertyDescriptor(globalThis,'React'); Object.defineProperty(globalThis,'React',{configurable:true,value:React});
		context.after(()=>{if(previous) Object.defineProperty(globalThis,'React',previous); else Reflect.deleteProperty(globalThis,'React');});
		let project = createFramescaperProjectFinishing(PROFILE,framescaperV20Options()), error = '';
		const view = (value: unknown) => value as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
		const service = createVideoEffectService({ state:{selectedClipId:'video-clip',readOnly:false,videoEffectGestures:new Map()},copy:{projectReadOnly:'Read only'},
			getProject:()=>view(project),captureProject:()=>generation.capture(view(project).id),assertProject:token=>{generation.assertCurrent(token);},editingBlocked:()=>false,
			commit:command=>{project=applyFramescaperProjectCommandFinishing(PROFILE,project,command);return view(project);},publishDocumentSnapshot(){} });
		const actions = { add:service.addVideoClipEffect,beginGesture:service.beginVideoEffectGesture,preview:service.previewVideoEffectGesture,commit:service.commitVideoEffectGesture,
			cancel:service.cancelVideoEffectGesture,toggle:service.toggleVideoClipEffect,reorder:service.reorderVideoClipEffect,remove:service.removeVideoClipEffect,update:service.updateVideoClipEffect };
		const copy = VIDEO_EFFECT_COPY_BY_LOCALE[locale];
		const mounted = await mountPhotoImportUi(() => <VideoEffectRack clip={view(project).clips.find(row=>row.id==='video-clip')}
			controller={{actions:{video:{effects:actions}}}} copy={{...copy,chooseEffect:'Choose effect',addEffect:'Add effect'}} disabled={false} onError={(message:string)=>{error=message;}} />);
		try {
			const position = VIDEO_EFFECT_TYPES.indexOf('grain-v1'); assert.ok(position>=0);
			const picker = mounted.dom.one('.dropdown'); await act(async()=>{reactProps(picker).onKeyDown?.({key:'Enter',preventDefault(){}});});
			for(let n=0;n<position;n++) await act(async()=>{reactProps(picker).onKeyDown?.({key:'ArrowDown',preventDefault(){}});});
			await act(async()=>{reactProps(picker).onKeyDown?.({key:'Enter',preventDefault(){}});});
			const add = mounted.dom.container.querySelectorAll('button').find(row=>row.textContent==='Add effect'); assert.ok(add);
			await act(async()=>{reactProps(add).onClick?.({});await settle();}); await mounted.render();
			for(const [copyKey,value] of controls) { const row=mounted.dom.container.querySelectorAll('input').find(candidate=>candidate.getAttribute('aria-label')===`${copy.videoEffectExactValue}: ${copy[copyKey]}`); assert.ok(row,copyKey); await key(row,value); await mounted.render(); }
			assert.equal(error,''); const clip=view(cloneFramescaperProjectFinishing(PROFILE,project)).clips.find(row=>row.id==='video-clip')!;
			assert.deepEqual(clip.videoEffects?.[0]?.params,params); assert.equal(clip.videoEffects?.[0]?.type,'grain-v1');
			const capture=new Uint8Array(source),rendered=await applyVideoExactBrowserEffectsFinishing({width:8,height:1,pixels:capture},clip.videoEffects!,new AbortController().signal);
			try{assert.deepEqual([...rendered.pixels],expected);}finally{rendered.pixels.fill(0);}assert.deepEqual([...capture],source);
		} finally { await mounted.dispose(); }
	});
}
