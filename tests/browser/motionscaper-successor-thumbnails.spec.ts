/* SPDX-License-Identifier: AGPL-3.0-only */
import { test, expect } from '@playwright/test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productResolveAliases } from '../../scripts/lib/product-aliases.mjs';
let directory: string; let server: Server; let address: string;
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = (path: string) => JSON.stringify(join(root, path));
test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'motion-thumbnails-')); const entry = join(directory, 'fixture.tsx'), output = join(directory, 'site');
	await writeFile(entry, `
import React from ${source('node_modules/react/index.js')};
import { createRoot } from ${source('node_modules/react-dom/client.js')};
import { createMotionscaperProject, createMotionLayer } from ${source('src/motionscaper/editor-project.ts')};
import { createMotionscaperRevision } from ${source('src/common/editor/motion-project-revision.ts')};
import { createMotionCompositionOffer } from ${source('src/common/editor/motion-link-protocol.ts')};
import { motionColor, motionVector } from ${source('src/common/editor/motion-property.ts')};
import { createVideoTrack } from ${source('src/common/editor/project-media-factory.ts')};
import { createFramescaperCompositionSource } from ${source('src/framescaper/editor-composition-link-source.ts')};
import { createFramescaperSuccessorRuntime } from ${source('src/framescaper/editor-project-successor-runtime.ts')};
import { createFramescaperSuccessorPlayback } from ${source('src/framescaper/editor-project-successor-playback.ts')};
import { bindFramescaperSuccessorCompositionPreview } from ${source('src/framescaper/editor-composition-link-preview-controller.ts')};
import SourceMonitorPanel from ${source('src/common/editor/ui/workspace/SourceMonitorPanel.jsx')};
import ProjectBinCard from ${source('src/common/editor/ui/workspace/ProjectBinCard.jsx')};
import { VideoFilmstripClip } from ${source('src/common/editor/ui/timeline/VideoFilmstrip.jsx')};
import { bundledCatalogForLocale } from ${source('src/common/i18n/runtime.js')};
const base = createMotionscaperProject({id:'motion',title:'Saved Motion',compositionId:'main',width:32,height:16,durationFrames:3,frameRate:{num:30000,den:1001}});
const layer = createMotionLayer({id:'red',name:'Red',durationFrames:3,content:{kind:'solid',color:motionColor([1,0,0,.5]),size:motionVector([16,16])}});
const animated = {...layer,transform:{...layer.transform,position:{...motionVector([0,0,0]),expression:{enabled:true,source:'[frame * 8, 0, 0]',references:[]}}}};
const offer = createMotionCompositionOffer('main',createMotionscaperRevision({...base,compositions:[{...base.compositions[0],layers:[animated]}]}));
const linked = createFramescaperCompositionSource({sourceId:'linked',offer,sampleRate:48000});
const clip = {kind:'video',id:'clip',sourceId:'linked',title:'Saved Scene',sequenceId:'seq',sequenceStartFrame:0,sequenceFrameCount:3,sourceInFrame:0,sourceFrameCount:3,retimeMap:null};
const runtime=createFramescaperSuccessorRuntime({line:'successor'});
const project={...runtime.createProject({sources:[linked.source],clips:[clip],projectBin:{clips:[{...clip,id:'bin',sourceInFrame:1,sourceFrameCount:2,sequenceFrameCount:2}]},tracks:[createVideoTrack({id:'track',clipIds:['clip']})],sequences:[{id:'seq',rate:offer.output.frameRate,trackIds:['track']}],primarySequenceId:'seq'}),compositionLinks:[linked.link]};
const store={loadMediaAsset(){throw Error('Virtual media lookup');},loadSource(){throw Error('Virtual PCM lookup');}};
const playback=createFramescaperSuccessorPlayback(store); await playback.prepareProjectForActivation(project);
const projection=playback.projectForPlayback(project).project;
const projected=runtime.projectForRuntimeConsumers(project); const timelineClip=projected.clips[0];
const visual=Object.freeze({available:true});const copy=bundledCatalogForLocale('en');let position=0;let paint=()=>{};
const snapshot=Object.freeze({project,readOnly:false});
const controller={getSnapshot:()=>snapshot,actions:{projectBin:{getVisualData:()=>visual,instanceCount:()=>1,stopPreview(){}},video:{getClipVisualData:()=>visual,getSourceVisualData:()=>visual,sourceMonitor:{view:()=>({sourceId:'linked',sourceName:'Saved Scene',positionFrame:position,sourceFrameCount:3,openRevision:1,frameRate:offer.output.frameRate,mediaSeconds:position*1001/30000,timecodeLabel:String(position)}),seek(frame){position=Math.max(0,Math.min(2,frame));paint();},step(delta){this.seek(position+delta);},markIn(){},markOut(){},clearMarks(){}}},edit:{commit(){}}}};
bindFramescaperSuccessorCompositionPreview({controller,store,readAsset:async()=>{throw Error('No original in solid scene');}});
const root=createRoot(document.getElementById('root'));
paint=()=>root.render(React.createElement(React.Fragment,null,
 React.createElement('div',{id:'monitor'},React.createElement(SourceMonitorPanel,{controller,snapshot,copy,run:operation=>operation(),blocked:false})),
 React.createElement('ul',null,React.createElement(ProjectBinCard,{controller,project,clip:project.projectBin.clips[0],itemClips:project.projectBin.clips,source:project.sources[0],sources:project.sources,copy,locale:'en',mutationBlocked:false,missing:false,preview:null,run:operation=>operation(),onOpenMenu(){},onDragEnd(){}})),
 React.createElement('div',{id:'strip',style:{height:200,position:'relative'}},React.createElement(VideoFilmstripClip,{controller,project:projection,clip:timelineClip,source:project.sources[0],overscanStartFrame:0,overscanEndFrame:timelineClip.durationFrames,pixelsPerSecond:1000,sampleRate:48000,copy,onOpenMenu(){},onRename(){},blocked:false,selected:false}))));
paint();
`);
	await build({ root, configFile: false, publicDir: false, plugins: [react()], resolve: { alias: productResolveAliases({ productId: 'framescaper', repositoryRoot: root }) }, logLevel: 'silent', build: { target: 'esnext', outDir: output, assetsInlineLimit: 0, rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } } });
	server = createServer((request, response) => { void (async () => { try {
		const path = new URL(request.url ?? '/', 'http://localhost').pathname;
		if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div><script type="module" src="/fixture.js"></script>'); return; }
		if (!/^\/[A-Za-z0-9_./-]+$/u.test(path) || path.includes('..')) { response.writeHead(404).end(); return; }
		response.setHeader('Content-Type', extname(path) === '.wasm' ? 'application/wasm' : extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream'); response.end(await readFile(join(output, path.slice(1))));
	} catch { response.writeHead(404).end(); } })(); });
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('Thumbnail fixture failed to bind.'); address = `http://127.0.0.1:${bound.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });
test('M10 actual bin, exact filmstrip and source-monitor seek paint saved pixels without any video element', async ({ page }) => {
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.goto(address);
	const monitor = page.locator('[data-generated-source-canvas]'); await expect(monitor).toHaveAttribute('data-generated-source-state', 'ready');
	const first = await monitor.evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(2, 2, 1, 1).data]); expect(first).toEqual([255, 0, 0, 128]);
	await expect(page.locator('[data-project-bin-visual-canvas]')).toHaveCount(1);
	await expect(page.locator('[data-product-visual-thumbnail-canvas]')).toHaveCount(1);
	await page.locator('[data-source-monitor-action="next"]').click(); await expect(page.locator('[data-source-monitor-frame]')).toHaveAttribute('data-source-monitor-frame', '1');
	await expect(monitor).toHaveAttribute('data-generated-source-state', 'ready'); expect(await monitor.evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(2, 2, 1, 1).data])).toEqual([0, 0, 0, 0]);
	await page.locator('[data-source-monitor-action="previous"]').click(); await expect(monitor).toHaveAttribute('data-generated-source-state', 'ready');
	expect(await monitor.evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(2, 2, 1, 1).data])).toEqual(first);
	await expect(page.locator('video')).toHaveCount(0); expect(errors).toEqual([]);
});
