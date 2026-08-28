/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/nightly-packaged-electron.js';
import { packagedRuntimeEnvironmentFingerprint } from './helpers/packaged-runtime-environment.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

import {
	M4B2_KEYFRAME_PARITY_FIXTURE_ID,
	M4B2_KEYFRAME_PARITY_LOCAL_ADMISSION_MAXIMUM_CHANNEL_MAE,
	M4B2_KEYFRAME_PARITY_LOCAL_ADMISSION_MINIMUM_SSIM,
	M4B2_KEYFRAME_PARITY_OBSERVATION_CLASS,
	M4B2_KEYFRAME_PARITY_PROFILE,
	M4B2_KEYFRAME_PARITY_SPECIFICATION,
	M4B2_KEYFRAME_PARITY_WORKLOAD_ID,
	createM4B2KeyframeParitySourceRgba,
	m4b2KeyframeParityCases,
} from '../../src/common/editor/quality/m4b2-keyframe-parity-workload.ts';
import {
	compareM4B2KeyframeParityVideo,
	createM4B2KeyframeParityExpectedRgba,
} from '../../scripts/lib/m4b2-keyframe-parity-metrics.mjs';

const ROOT = '/__m4b2-keyframe-parity__';
const LOCAL_ENVIRONMENT_ID = 'local-browser-correctness';
const HOSTED_ENVIRONMENT_ID = 'github-ubuntu-playwright-1.62.1';
const ENVIRONMENT_ID = process.env.SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID || (process.env.GITHUB_ACTIONS === 'true'
	? HOSTED_ENVIRONMENT_ID
	: LOCAL_ENVIRONMENT_ID);
const NOBLE_HASH_FILES = ['sha2.js', '_md.js', '_u64.js', 'utils.js'];

test('collects keyed preview/offline RGBA and exact dual-consumer ledgers without qualifying a host', async ({
	runtimeBrowser,
	runtimeBrowserName,
	runtimeBaseURL,
	page,
}) => {
	test.skip(
		process.env.SOUNDSCAPER_M4B2_KEYFRAME_PARITY !== '1',
		'Run explicitly through the dormant M4B2 keyed parity collector.',
	);
	test.skip(runtimeBrowserName !== 'chromium', 'The maintained keyed compositor path requires Chromium WebGL.');
	test.setTimeout(180_000);
	await installRoutes(page);
	await page.goto(new URL(`${ROOT}/index.html`, runtimeBaseURL).href);

	const sourceBytes = createM4B2KeyframeParitySourceRgba();
	const definitions = m4b2KeyframeParityCases();
	const cases = await page.evaluate(async ({ root, sourceBase64 }) => {
		const [
			workload, projection, timelineModule, frameSourceModule, renderStateModule,
			rendererModule, previewStateModule,
			compositorModule, timingAssetModule, timingViewModule, presentationModule,
			projectMediaFactory, framescaperV20, framescaperProfile, framescaperRuntime,
			framescaperRequirements,
		] = await Promise.all([
			import(`${root}/src/common/editor/quality/m4b2-keyframe-parity-workload.ts`),
			import(`${root}/src/common/editor/runtime-clip-projection.ts`),
			import(`${root}/src/common/editor/video-timeline.js`),
			import(`${root}/src/common/editor/video-keyframe-export-frame-source.ts`),
			import(`${root}/src/common/editor/video-keyframe-render-state-provider.ts`),
			import(`${root}/src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts`),
			import(`${root}/src/common/editor/video-keyframe-preview-state.ts`),
			import(`${root}/src/common/editor/ui/video-preview-compositor.js`),
			import(`${root}/src/common/editor/video-timing-asset.ts`),
			import(`${root}/src/common/editor/video-source-timing-view.ts`),
			import(`${root}/src/common/editor/video-keyframe-export-presentation-authority.ts`),
			import(`${root}/src/common/editor/project-media-factory.ts`),
			import(`${root}/src/framescaper/editor-project-retime.ts`),
			import(`${root}/src/framescaper/editor-project-retime-profile.ts`),
			import(`${root}/src/framescaper/editor-project-retime-runtime.ts`),
			import(`${root}/src/framescaper/editor-project-feature-requirements-retime.ts`),
		]);
		const source = Uint8Array.from(atob(sourceBase64), (value) => value.charCodeAt(0));
		const sourceFrameByteLength = 128 * 72 * 4;
		const results = [];
		for (const definition of workload.m4b2KeyframeParityCases()) {
			const prepared = definition.curveKind === 'bezier'
				? materializedVfrProject(definition.id)
				: cfrProject(definition.id);
			if (prepared.runtime.clips.length !== 1
				|| prepared.runtime.clips[0].id !== definition.evidenceClipId) {
				throw new Error(`${definition.id} did not resolve its frozen evidence occurrence.`);
			}
			const boundTiming = timingViewModule.bindVideoSourceTimingView(
				new Map([[prepared.sourceId, prepared.timingView]]),
				prepared.runtime.sources[0],
			);
			const authority = presentationModule.createVideoKeyframeExportPresentationAuthority({
				project: prepared.runtime,
				timingBySourceId: new Map([[prepared.sourceId, boundTiming]]),
			});
			const provider = renderStateModule.createVideoKeyframeRenderStateProvider();
			const frameSource = frameSourceModule.createVideoKeyframeExportFrameSource({
				project: prepared.runtime,
				canvas: { width: 128, height: 72, frameRate: { num: 12, den: 1 } },
				provider,
				resolvePresentationDescriptor: authority.resolvePresentationDescriptor,
			});
			const sourceCanvas = rgbaCanvas(source.subarray(0, sourceFrameByteLength), 128, 72);
			const previewVideo = Object.freeze({
				drawable: sourceCanvas, videoWidth: 128, videoHeight: 72,
				displayWidth: 128, displayHeight: 72, readyState: 4,
			});
			let lastPresentation;
			const presentation = Object.freeze({
				sourceId: prepared.sourceId,
				identity: `sha256:${workload.M4B2_KEYFRAME_PARITY_SPECIFICATION.sourceSha256}`,
				drawable: sourceCanvas,
				decodedWidth: 128,
				decodedHeight: 72,
				displayWidth: 128,
				displayHeight: 72,
				present(entry) {
					const descriptor = authority.presentationForEntry(entry);
					const start = descriptor.drawableSourceFrame * sourceFrameByteLength;
					paintRgbaCanvas(
						sourceCanvas, source.subarray(start, start + sourceFrameByteLength), 128, 72,
					);
					lastPresentation = descriptorEvidence(descriptor);
				},
				dispose() {},
			});
			const offlineCanvas = document.createElement('canvas');
			let offlineReport = null;
			const renderer = rendererModule.createVideoKeyframeOfflineRgbaRenderer({
				frameSource,
				canvas: offlineCanvas,
				resolveSource: () => presentation,
				createCompositor(canvas) {
					const compositor = new compositorModule.VideoPreviewCompositor(canvas);
					return {
						gl: compositor.gl,
						render(layers, options) {
							offlineReport = compositor.render(layers, options);
							return offlineReport;
						},
						dispose() { compositor.dispose(); },
					};
				},
			});
			const previewCanvas = document.createElement('canvas');
			const previewCompositor = new compositorModule.VideoPreviewCompositor(previewCanvas);
			const queries = [];
			try {
				for (const query of definition.queries) {
					const frame = frameSource.frame(query.frameIndex);
					const frameEntry = frame.layers[0].clips[0];
					const previewDescriptor = authority.resolvePresentationDescriptor({
						clip: frameEntry.clip,
						source: frameEntry.source,
						localSequencePosition: query.position,
					});
					lastPresentation = null;
					presentation.present({
						...frameEntry,
						presentationDescriptor: previewDescriptor,
					});
					if (lastPresentation === null) throw new Error('Preview presentation evidence is missing.');
					const previewPresentation = lastPresentation;
					let previewStateValue = null;
					const previewLayers = timelineModule.resolveActiveVideoLayers(
						prepared.runtime,
						frame.timelineSample,
						{
							renderCanvas: { width: 128, height: 72 },
							resolveClipRenderState(request) {
								const state = previewStateModule.resolveVideoKeyframePreviewState(provider, request);
								previewStateValue = state?.composition.opacity ?? null;
								return state;
							},
						},
					);
					const previewRenderLayers = previewLayers.map((layer) => ({
						trackId: layer.trackId,
						blendMode: layer.clips[0].renderDescription.blendMode,
						entries: layer.clips.map((entry) => ({
							clipId: entry.clipId,
							video: previewVideo,
							effects: entry.videoEffects ?? [],
							opacity: entry.opacity,
							displayWidth: 128,
							displayHeight: 72,
							renderDescription: entry.renderDescription,
							intervalProgress: 0,
						})),
					}));
					const previewReport = previewCompositor.render(previewRenderLayers, {
						referenceWidth: 128,
						referenceHeight: 72,
						outputWidth: 128,
						outputHeight: 72,
						outputColorModel: 'rgba',
					});
					const previewBytes = topDownPixels(previewCompositor.gl, 128, 72);
					const offlineBytes = new Uint8Array(renderer.byteLength);
					offlineReport = null;
					lastPresentation = null;
					await renderer.produce(frame, offlineBytes, { signal: new AbortController().signal });
					if (offlineReport === null) throw new Error('The offline compositor report is missing.');
					if (lastPresentation === null) throw new Error('Offline presentation evidence is missing.');
					const offlinePresentation = lastPresentation;
					const offlineStateValue = frameEntry.renderDescription.opacityStart;
					const operationId = workload.m4b2KeyframeParityOperationId(definition.id, query.id);
					queries.push({
						id: query.id,
						frameIndex: query.frameIndex,
						position: query.position,
						previewPresentation,
						offlinePresentation,
						previewBase64: bytesToBase64(previewBytes),
						offlineBase64: bytesToBase64(offlineBytes),
						preview: consumed(operationId, previewStateValue, previewReport),
						offline: consumed(operationId, offlineStateValue, offlineReport),
					});
				}
			} finally {
				previewCompositor.dispose();
				await renderer.dispose();
			}
			results.push({
				id: definition.id,
				curveKind: definition.curveKind,
				targetId: definition.targetId,
				clipId: definition.evidenceClipId,
				presentationClass: definition.presentationClass,
				presentationIdentity: presentation.identity,
				queries,
			});
		}
		return results;

		function cfrProject(caseId) {
			const runtime = projection.resolveRuntimeProjectProjection(
				workload.createM4B2KeyframeParityProject(caseId),
			);
			const sourceId = runtime.sources[0].id;
			return {
				runtime,
				sourceId,
				timingView: Object.freeze({
					kind: 'cfr', rate: Object.freeze({ num: 12, den: 1 }), frameCount: 12,
				}),
			};
		}

		function materializedVfrProject(caseId) {
			const sourceId = 'm4b2-opacity-bezier-source';
			const digest = workload.M4B2_KEYFRAME_PARITY_SPECIFICATION.sourceSha256;
			const publication = timingAssetModule.createVideoTimingAssetPublication(digest, {
				timescale: 120,
				presentationTicks: [0n, 5n, 13n, 20n, 33n, 41n, 55n, 62n, 76n, 90n, 105n, 113n],
				finalFrameDurationTicks: 7n,
			});
			const sourceValue = projectMediaFactory.createVideoSource({
				id: sourceId, name: 'M4B2 VFR source', storageKey: sourceId,
				mimeType: 'video/mp4', contentSha256: digest,
				frameCount: 48_000, sampleFrameCount: 48_000,
				sourceFrameCount: 12, frameRate: { num: 12, den: 1 }, width: 128, height: 72,
				timingAsset: publication.reference,
				timingDecision: { mode: 'exact', rate: { num: 12, den: 1 } },
			}, 48_000);
			const profile = framescaperProfile.FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE;
			const project = framescaperV20.createFramescaperProjectRetime(profile, {
				id: 'm4b2-keyframe-vfr', title: 'M4B2 keyed VFR',
				now: '2026-08-14T00:00:00.000Z', sampleRate: 48_000,
				sources: [sourceValue],
				clips: [{
					kind: 'video', id: 'm4b2-opacity-bezier-leaf-clip', sourceId,
					title: 'Bezier leaf', sequenceId: 'leaf', sequenceStartFrame: 0,
					sequenceFrameCount: 12, sourceInFrame: 0, sourceFrameCount: 12, retimeMap: null,
				}],
				tracks: [projectMediaFactory.createVideoTrack({
					id: 'leaf-track', name: 'Leaf',
					clipIds: ['m4b2-opacity-bezier-leaf-clip'], locked: false,
				})],
				sequences: [
					{ id: 'main', rate: { num: 12, den: 1 }, trackIds: [] },
					{ id: 'leaf', rate: { num: 12, den: 1 }, trackIds: ['leaf-track'] },
				],
				primarySequenceId: 'main',
				subsequences: [{
					id: 'm4b2-materialized', sequenceId: 'main', sourceSequenceId: 'leaf',
					sequenceStartFrame: 0, sequenceFrameCount: 12,
					sourceInFrame: 0, sourceFrameCount: 12,
				}],
			});
			project.clips[0].videoKeyframes = structuredClone(
				workload.createM4B2KeyframeParityProject(caseId).clips[0].videoKeyframes,
			);
			project.featureRequirements =
				framescaperRequirements.reconcileFramescaperProjectFeatureRequirementsRetime(profile, project);
			const runtime = framescaperRuntime.framescaperProjectForRuntimeConsumersRetime(profile, project);
			const index = timingAssetModule.validateVideoTimingAssetBytes(
				publication.reference, publication.bytes,
			);
			return {
				runtime,
				sourceId,
				timingView: Object.freeze({
					kind: 'vfr', reference: publication.reference, index,
				}),
			};
		}

		function consumed(operationId, stateValue, renderReport) {
			const clipId = renderReport.composition?.requested[0]?.clipId;
			const rendered = renderReport.status === 'rendered'
				&& renderReport.rendererStatus === 'available'
				&& renderReport.composition?.rendered.includes(clipId);
			return {
				operationId,
				stateValue: rendered ? stateValue : null,
				outcomes: {
					requested: [operationId],
					rendered: rendered ? [operationId] : [],
					substituted: [],
					fallback: !rendered && renderReport.composition?.fallbackRendered.includes(clipId)
						? [operationId] : [],
					omitted: !rendered && !renderReport.composition?.fallbackRendered.includes(clipId)
						? [operationId] : [],
				},
				renderReport,
			};
		}

		function rgbaCanvas(bytes, width, height) {
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			paintRgbaCanvas(canvas, bytes, width, height);
			return canvas;
		}

		function paintRgbaCanvas(canvas, bytes, width, height) {
			canvas.getContext('2d').putImageData(
				new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0,
			);
		}

		function descriptorEvidence(descriptor) {
			return Object.freeze({
				drawableSourceFrame: descriptor.drawableSourceFrame,
				sourceFrame: exactString(descriptor.sourceFrame),
				sourceTime: exactString(descriptor.sourceTime),
			});
		}

		function exactString(value) {
			return `${String(value.numerator)}/${String(value.denominator)}`;
		}

		function topDownPixels(gl, width, height) {
			gl.finish();
			const bottomUp = new Uint8Array(width * height * 4);
			gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
			if (gl.getError() !== gl.NO_ERROR) throw new Error('Preview RGBA readback failed.');
			const output = new Uint8Array(bottomUp.length);
			const stride = width * 4;
			for (let y = 0; y < height; y += 1) {
				output.set(bottomUp.subarray((height - y - 1) * stride, (height - y) * stride), y * stride);
			}
			return output;
		}

		function bytesToBase64(bytes) {
			let binary = '';
			for (let start = 0; start < bytes.length; start += 0x4000) {
				binary += String.fromCharCode(...bytes.subarray(start, start + 0x4000));
			}
			return btoa(binary);
		}
	}, { root: ROOT, sourceBase64: Buffer.from(sourceBytes).toString('base64') });

	expect(cases).toHaveLength(4);
	for (const [caseIndex, candidate] of cases.entries()) {
		const definition = definitions[caseIndex];
		expect(candidate.clipId).toBe(definition.evidenceClipId);
		expect(candidate.queries).toHaveLength(3);
		for (const [queryIndex, query] of candidate.queries.entries()) {
			const expected = definition.queries[queryIndex];
			expect(query.id).toBe(expected.id);
			expect(query.preview.outcomes.rendered).toHaveLength(1);
			expect(query.offline.outcomes.rendered).toHaveLength(1);
			expect(query.previewPresentation).toEqual(expected.expectedPresentation);
			expect(query.offlinePresentation).toEqual(expected.expectedPresentation);
			expect(query.preview.stateValue).toBeCloseTo(expected.expectedValue, 12);
			expect(query.offline.stateValue).toBeCloseTo(expected.expectedValue, 12);
			const preview = new Uint8Array(Buffer.from(query.previewBase64, 'base64'));
			const offline = new Uint8Array(Buffer.from(query.offlineBase64, 'base64'));
			const semanticReference = createM4B2KeyframeParityExpectedRgba(
				sourceBytes, expected.expectedPresentation.drawableSourceFrame,
				expected.expectedValue, 128, 72,
			);
			for (const [left, right] of [
				[preview, offline], [preview, semanticReference], [offline, semanticReference],
			]) {
				const metrics = compareM4B2KeyframeParityVideo(left, right, 128, 72);
				expect(metrics.ssim).toBeGreaterThanOrEqual(
					M4B2_KEYFRAME_PARITY_LOCAL_ADMISSION_MINIMUM_SSIM,
				);
				expect(metrics.maximumChannelMae).toBeLessThanOrEqual(
					M4B2_KEYFRAME_PARITY_LOCAL_ADMISSION_MAXIMUM_CHANNEL_MAE,
				);
			}
		}
	}

	const renderer = await rendererDiagnostic(page);
	const diagnostic = {
		schemaVersion: 1,
		profile: M4B2_KEYFRAME_PARITY_PROFILE,
		observationClass: M4B2_KEYFRAME_PARITY_OBSERVATION_CLASS,
		workloadId: M4B2_KEYFRAME_PARITY_WORKLOAD_ID,
		fixtureId: M4B2_KEYFRAME_PARITY_FIXTURE_ID,
		environmentId: ENVIRONMENT_ID,
		rendererClass: renderer.rendererClass,
		environmentFingerprint: packagedRuntimeEnvironmentFingerprint(runtimeBrowser, renderer),
		fixture: { ...M4B2_KEYFRAME_PARITY_SPECIFICATION },
		sourceBase64: Buffer.from(sourceBytes).toString('base64'),
		cases,
	};
	console.log(`SOUNDSCAPER_M4B2_KEYFRAME_PARITY ${JSON.stringify(diagnostic)}`);
});

async function rendererDiagnostic(page) {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2');
		if (!gl) return { rendererClass: 'unknown', vendor: 'unavailable', renderer: 'unavailable' };
		const extension = gl.getExtension('WEBGL_debug_renderer_info');
		const vendor = String(extension
			? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
			: gl.getParameter(gl.VENDOR));
		const renderer = String(extension
			? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
			: gl.getParameter(gl.RENDERER));
		return {
			rendererClass: /swiftshader|llvmpipe|software/iu.test(`${vendor} ${renderer}`)
				? 'software' : 'hardware',
			vendor,
			renderer,
		};
	});
}

async function installRoutes(page) {
	const routes = await transpileSourceModules();
	routes.set(`${ROOT}/shims/pffft.js`, {
		body: 'export default function unavailablePffft(){throw new Error("PFFFT is outside the keyed parity workload.")}',
		contentType: 'text/javascript',
	});
	const nobleRoot = new URL('../../node_modules/@noble/hashes/', import.meta.url);
	for (const name of NOBLE_HASH_FILES) {
		routes.set(`${ROOT}/noble/${name}`, {
			body: await readFile(new URL(name, nobleRoot)), contentType: 'text/javascript',
		});
	}
	await page.route(`**${ROOT}/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === `${ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: `<!doctype html><meta charset="utf-8">
					<script type="importmap">{"imports":{"@noble/hashes/sha2.js":"${ROOT}/noble/sha2.js","@noble/hashes/utils.js":"${ROOT}/noble/utils.js","@echogarden/pffft-wasm/simd":"${ROOT}/shims/pffft.js"}}</script>
					<title>M4B2 keyed parity</title>`,
			});
			return;
		}
		const descriptor = routes.get(pathname);
		await route.fulfill(descriptor === undefined
			? { status: 404, body: `Unknown keyed parity path ${pathname}` }
			: { status: 200, ...descriptor });
	});
}

async function transpileSourceModules() {
	const sourceRoot = new URL('../../src/', import.meta.url);
	const entries = [
		'common/editor/quality/m4b2-keyframe-parity-workload.ts',
		'common/editor/runtime-clip-projection.ts',
		'common/editor/video-timeline.js',
		'common/editor/video-keyframe-export-frame-source.ts',
		'common/editor/video-keyframe-render-state-provider.ts',
		'common/editor/ui/video-keyframe-offline-rgba-renderer.ts',
		'common/editor/video-keyframe-preview-state.ts',
		'common/editor/ui/video-preview-compositor.js',
		'common/editor/video-timing-asset.ts',
		'common/editor/video-source-timing-view.ts',
		'common/editor/video-keyframe-export-presentation-authority.ts',
		'common/editor/project-media-factory.ts',
		'framescaper/editor-project-retime.ts',
		'framescaper/editor-project-retime-profile.ts',
		'framescaper/editor-project-retime-runtime.ts',
		'framescaper/editor-project-feature-requirements-retime.ts',
	];
	const pending = entries.map((name) => new URL(name, sourceRoot));
	const discovered = new Map();
	while (pending.length > 0) {
		const url = pending.pop();
		if (discovered.has(url.href)) continue;
		const filename = fileURLToPath(url);
		const source = await readFile(url, 'utf8');
		const transformed = await transform(source, {
			sourcefile: filename,
			loader: filename.endsWith('.ts') || filename.endsWith('.tsx') ? 'ts' : 'js',
			format: 'esm', target: 'es2022', sourcemap: 'inline',
		});
		discovered.set(url.href, transformed.code);
		for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/gu)) {
			const dependency = new URL(match[2], url);
			if (!dependency.pathname.startsWith(sourceRoot.pathname)) continue;
			if (dependency.pathname.endsWith('.js')) {
				const typed = new URL(dependency.href.replace(/\.js$/u, '.ts'));
				try { await readFile(typed, 'utf8'); pending.push(typed); continue; } catch { /* JS owns it. */ }
			}
			pending.push(dependency);
		}
	}
	const routes = new Map();
	for (const [href, body] of discovered) {
		const relative = new URL(href).pathname.slice(sourceRoot.pathname.length);
		const path = `${ROOT}/src/${relative}`;
		const descriptor = { body, contentType: 'text/javascript' };
		routes.set(path, descriptor);
		if (path.endsWith('.ts')) routes.set(path.replace(/\.ts$/u, '.js'), descriptor);
	}
	return routes;
}
