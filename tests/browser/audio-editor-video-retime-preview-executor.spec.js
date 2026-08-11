/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { transformWithEsbuild } from 'vite';

import {
	createVideoRetimePreviewOrdinalRgb,
	videoRetimePreviewMedia,
} from './fixtures/video-retime-preview-media.js';

const HARNESS_ROOT = '/__video-retime-preview__';
const FIXTURE_PATH = `${HARNESS_ROOT}/video-retime-vfr-ordinal.mp4`;
const MODULE_SOURCES = Object.freeze([
	Object.freeze({
		name: 'video-retime-preview-executor',
		file: new URL('../../src/common/editor/video-retime-preview-executor.ts', import.meta.url),
	}),
	Object.freeze({
		name: 'video-retime-html-video-seek-port',
		file: new URL('../../src/common/editor/video-retime-html-video-seek-port.ts', import.meta.url),
	}),
]);

test.describe('3B-5f-b paused retime preview qualification', () => {
	test('pins and decoder-qualifies every unequal VFR interval including the final ordinal', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName !== 'chromium', '3B-5f-b is an explicit focused Chromium decoder oracle.');
		await installHarnessRoutes(page);
		await page.goto(`${HARNESS_ROOT}/index.html`);

		const raw = createVideoRetimePreviewOrdinalRgb();
		expect(raw).toHaveLength(videoRetimePreviewMedia.rawByteLength);
		expect(createHash('sha256').update(raw).digest('hex')).toBe(videoRetimePreviewMedia.rawSha256);
		expect(videoRetimePreviewMedia.file.buffer).toHaveLength(videoRetimePreviewMedia.outputByteLength);
		expect(createHash('sha256').update(videoRetimePreviewMedia.file.buffer).digest('hex'))
			.toBe(videoRetimePreviewMedia.outputSha256);

		const qualification = await page.evaluate(async ({ fixturePath, height, oracle, width }) => {
			if (typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== 'function'
				|| typeof HTMLVideoElement.prototype.cancelVideoFrameCallback !== 'function') {
				throw new Error('Chromium must expose requestVideoFrameCallback and its cancellation peer.');
			}
			const video = await loadVideo(fixturePath);
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('The ordinal oracle requires a 2D canvas context.');
			const frames = [];
			for (const expected of oracle) {
				const metadata = await seekPresentedFrame(video, expected.midpointSeconds);
				context.drawImage(video, 0, 0, width, height);
				frames.push({
					mediaTime: metadata.mediaTime,
					centerRgba: [...context.getImageData(48, 20, 1, 1).data],
					ordinalRgba: Array.from({ length: 4 }, (_value, bit) => (
						[...context.getImageData(4 + bit * 8, 6, 1, 1).data]
					)),
				});
			}
			const result = {
				duration: video.duration,
				seekableStart: video.seekable.length === 0 ? null : video.seekable.start(0),
				seekableEnd: video.seekable.length === 0 ? null : video.seekable.end(0),
				frames,
			};
			video.remove();
			return result;

			async function loadVideo(source) {
				const element = document.createElement('video');
				element.muted = true;
				element.playsInline = true;
				element.preload = 'auto';
				element.src = source;
				document.body.append(element);
				await new Promise((resolve, reject) => {
					element.addEventListener('loadedmetadata', resolve, { once: true });
					element.addEventListener('error', () => reject(
						element.error ?? new Error('The ordinal video failed to load.'),
					), { once: true });
				});
				return element;
			}

			async function seekPresentedFrame(element, target) {
				let callbackId = null;
				let timer = null;
				try {
					const presented = new Promise((resolve, reject) => {
						timer = setTimeout(() => reject(new Error(
							`Timed out waiting for rVFC at ${String(target)}.`,
						)), 5_000);
						callbackId = element.requestVideoFrameCallback((_now, metadata) => resolve(metadata));
					});
					const seeked = new Promise((resolve, reject) => {
						element.addEventListener('seeked', resolve, { once: true });
						element.addEventListener('error', () => reject(
							element.error ?? new Error('The ordinal seek failed.'),
						), { once: true });
					});
					element.currentTime = target;
					const [metadata] = await Promise.all([presented, seeked]);
					callbackId = null;
					return metadata;
				} finally {
					if (timer !== null) clearTimeout(timer);
					if (callbackId !== null) element.cancelVideoFrameCallback(callbackId);
				}
			}
		}, {
			fixturePath: FIXTURE_PATH,
			height: videoRetimePreviewMedia.height,
			oracle: videoRetimePreviewMedia.pixelOracle,
			width: videoRetimePreviewMedia.width,
		});

		expect(qualification.duration).toBe(0.27);
		expect(qualification.seekableStart).toBe(0);
		expect(qualification.seekableEnd).toBe(0.27);
		for (const [index, expected] of videoRetimePreviewMedia.pixelOracle.entries()) {
			const actual = qualification.frames[index];
			expect(actual.mediaTime).toBe(expected.mediaTimeSeconds);
			expect(actual.centerRgba).toEqual(expected.centerRgba);
			expect(actual.ordinalRgba).toEqual(expected.ordinalBits.map((bit) => (
				bit === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]
			)));
		}
	});

	test('presents constant, reverse, freeze, and both ramp modes through one paused adapter', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName !== 'chromium', '3B-5f-b is an explicit focused Chromium decoder oracle.');
		await installHarnessRoutes(page, { strictModules: true });
		await page.goto(`${HARNESS_ROOT}/index.html`);
		const result = await page.evaluate(async ({ fixturePath, root }) => {
			const [{ createVideoRetimePreviewExecutor }, { createVideoRetimeHtmlVideoSeekPort }] = await Promise.all([
				import(`${root}/video-retime-preview-executor.js`),
				import(`${root}/video-retime-html-video-seek-port.js`),
			]);
			const video = await loadVideo(fixturePath);
			let pauseCalls = 0;
			const nativePause = video.pause.bind(video);
			video.pause = () => { pauseCalls += 1; nativePause(); };
			let generation = 1;
			const mediaTimes = [];
			const port = createVideoRetimeHtmlVideoSeekPort(video, {
				assertCurrent: () => {
					if (generation !== 1) throw new Error('Preview generation is stale.');
				},
				timeoutMs: 2_000,
			});
			const canvas = document.createElement('canvas');
			canvas.width = 64;
			canvas.height = 32;
			const context = canvas.getContext('2d', { willReadFrequently: true });
			const callbacks = [];
			const executor = createVideoRetimePreviewExecutor(Object.freeze({
				pause: () => port.pause(),
				assertCurrent: () => port.assertCurrent(),
				present: (request) => Promise.resolve(port.present(request)).then((presented) => {
					mediaTimes.push(presented.mediaTime);
					return presented;
				}),
			}), Object.freeze({
				onPresented: (descriptor) => {
					context.drawImage(video, 0, 0, 64, 32);
					callbacks.push({
						mode: descriptor.mode,
						drawableSourceFrame: descriptor.drawableSourceFrame,
						centerRgba: [...context.getImageData(48, 20, 1, 1).data],
						deepFrozen: isDeepFrozen(descriptor),
					});
				},
			}));
			const requests = [
				descriptor(0, 'constant-forward', 0),
				descriptor(1, 'constant-reverse', 3),
				descriptor(2, 'freeze', 1),
				descriptor(3, 'ramp-forward', 2),
				descriptor(4, 'ramp-reverse', 0),
			];
			const outcomes = [];
			for (const request of requests) outcomes.push(await executor.requestFrame(request));
			generation = 2;
			let currentnessError = null;
			try {
				await executor.requestFrame(descriptor(5, 'constant-forward', 2));
			} catch (error) {
				currentnessError = error instanceof Error ? error.message : String(error);
			}
			executor.dispose();
			video.remove();

			const sourceVideo = await loadVideo(fixturePath);
			const sourcePort = createVideoRetimeHtmlVideoSeekPort(sourceVideo, {
				assertCurrent: () => {}, timeoutMs: 2_000,
			});
			const sourceExecutor = createVideoRetimePreviewExecutor(sourcePort, { onPresented: () => {} });
			const replacementLoaded = new Promise((resolve, reject) => {
				sourceVideo.addEventListener('loadedmetadata', resolve, { once: true });
				sourceVideo.addEventListener('error', () => reject(sourceVideo.error), { once: true });
			});
			sourceVideo.src = `${fixturePath}?replacement=1`;
			sourceVideo.load();
			await replacementLoaded;
			let sourceError = null;
			try {
				await sourceExecutor.requestFrame(descriptor(6, 'constant-forward', 1));
			} catch (error) {
				sourceError = error instanceof Error ? error.message : String(error);
			}
			sourceExecutor.dispose();
			sourceVideo.remove();
			return {
				outcomes, callbacks, mediaTimes, pauseCalls, paused: video.paused,
				currentnessError, sourceError,
			};

			async function loadVideo(source) {
				const element = document.createElement('video');
				element.muted = true;
				element.playsInline = true;
				element.src = source;
				document.body.append(element);
				await new Promise((resolve, reject) => {
					element.addEventListener('loadedmetadata', resolve, { once: true });
					element.addEventListener('error', () => reject(element.error), { once: true });
				});
				return element;
			}

			function descriptor(outerCell, mode, frame) {
				const times = [exact(0n), exact(1n, 25n), exact(13n, 100n), exact(1n, 5n), exact(27n, 100n)];
				return {
					outerCell,
					segmentIndex: outerCell,
					mode,
					sourceFrame: exact(BigInt(frame)),
					sourceTime: times[frame],
					drawableSourceFrame: frame,
					drawableSourceStartTime: times[frame],
					drawableSourceEndTime: times[frame + 1],
				};
			}

			function exact(numerator, denominator = 1n) {
				return { numerator, denominator };
			}

			function isDeepFrozen(value, seen = new Set()) {
				if (value === null || typeof value !== 'object' || seen.has(value)) return true;
				seen.add(value);
				return Object.isFrozen(value) && Object.values(value).every((nested) => isDeepFrozen(nested, seen));
			}
		}, { fixturePath: FIXTURE_PATH, root: HARNESS_ROOT });

		expect(result.outcomes).toEqual(Array.from({ length: 5 }, () => ({ kind: 'presented' })));
		expect(result.callbacks.map(({ mode }) => mode)).toEqual([
			'constant-forward', 'constant-reverse', 'freeze', 'ramp-forward', 'ramp-reverse',
		]);
		expect(result.callbacks.map(({ drawableSourceFrame }) => drawableSourceFrame)).toEqual([0, 3, 1, 2, 0]);
		expect(result.callbacks.map(({ centerRgba }) => centerRgba)).toEqual([0, 3, 1, 2, 0].map(
			(frame) => videoRetimePreviewMedia.pixelOracle[frame].centerRgba,
		));
		expect(result.callbacks.every(({ deepFrozen }) => deepFrozen)).toBe(true);
		expect(result.mediaTimes).toEqual([0, 0.2, 0.04, 0.13, 0]);
		expect(result.pauseCalls).toBeGreaterThanOrEqual(1);
		expect(result.paused).toBe(true);
		expect(result.currentnessError).toMatch(/current|generation|stale/iu);
		expect(result.sourceError).toMatch(/current|source|changed|stale/iu);
	});

	test('keeps only the latest real seek and fences a stale completed picture', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName !== 'chromium', '3B-5f-b is an explicit focused Chromium decoder oracle.');
		await installHarnessRoutes(page, { strictModules: true });
		await page.goto(`${HARNESS_ROOT}/index.html`);
		const result = await page.evaluate(async ({ fixturePath, root }) => {
			const [{ createVideoRetimePreviewExecutor }, { createVideoRetimeHtmlVideoSeekPort }] = await Promise.all([
				import(`${root}/video-retime-preview-executor.js`),
				import(`${root}/video-retime-html-video-seek-port.js`),
			]);
			const video = await loadVideo(fixturePath);
			const port = createVideoRetimeHtmlVideoSeekPort(video, { assertCurrent: () => {}, timeoutMs: 2_000 });
			let releaseFirst;
			let markFirstReady;
			const firstReady = new Promise((resolve) => { markFirstReady = resolve; });
			const presentedFrames = [];
			let presentCalls = 0;
			const executor = createVideoRetimePreviewExecutor(Object.freeze({
				pause: () => port.pause(),
				assertCurrent: () => port.assertCurrent(),
				present: (request) => {
					presentCalls += 1;
					const operation = Promise.resolve(port.present(request));
					if (presentCalls !== 1) return operation;
					return operation.then((value) => new Promise((resolve) => {
						releaseFirst = () => resolve(value);
						markFirstReady();
					}));
				},
			}), Object.freeze({
				onPresented: (descriptor) => presentedFrames.push(descriptor.drawableSourceFrame),
			}));
			const first = executor.requestFrame(descriptor(0, 0));
			await firstReady;
			const discarded = executor.requestFrame(descriptor(1, 1));
			const latest = executor.requestFrame(descriptor(2, 2));
			const discardedResult = await discarded;
			const callsBeforeRelease = presentCalls;
			releaseFirst();
			const [firstResult, latestResult] = await Promise.all([first, latest]);
			executor.dispose();
			video.remove();
			return {
				firstResult, discardedResult, latestResult, callsBeforeRelease, presentCalls, presentedFrames,
			};

			async function loadVideo(source) {
				const element = document.createElement('video');
				element.muted = true;
				element.src = source;
				document.body.append(element);
				await new Promise((resolve, reject) => {
					element.addEventListener('loadedmetadata', resolve, { once: true });
					element.addEventListener('error', () => reject(element.error), { once: true });
				});
				return element;
			}

			function descriptor(outerCell, frame) {
				const times = [exact(0n), exact(1n, 25n), exact(13n, 100n), exact(1n, 5n)];
				return {
					outerCell, segmentIndex: outerCell, mode: 'constant-forward',
					sourceFrame: exact(BigInt(frame)), sourceTime: times[frame],
					drawableSourceFrame: frame,
					drawableSourceStartTime: times[frame], drawableSourceEndTime: times[frame + 1],
				};
			}

			function exact(numerator, denominator = 1n) { return { numerator, denominator }; }
		}, { fixturePath: FIXTURE_PATH, root: HARNESS_ROOT });

		expect(result.callsBeforeRelease).toBe(1);
		expect(result.presentCalls).toBe(2);
		expect(result.discardedResult).toEqual({ kind: 'superseded' });
		expect(result.firstResult).toEqual({ kind: 'superseded' });
		expect(result.latestResult).toEqual({ kind: 'presented' });
		expect(result.presentedFrames).toEqual([2]);
	});

	test('times out cleanly and does not reuse a cancelled decoder slot before drain', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName !== 'chromium', '3B-5f-b is an explicit focused Chromium decoder oracle.');
		await installHarnessRoutes(page, { strictModules: true });
		await page.goto(`${HARNESS_ROOT}/index.html`);
		const result = await page.evaluate(async ({ fixturePath, root }) => {
			const [{ createVideoRetimePreviewExecutor }, { createVideoRetimeHtmlVideoSeekPort }] = await Promise.all([
				import(`${root}/video-retime-preview-executor.js`),
				import(`${root}/video-retime-html-video-seek-port.js`),
			]);
			const timeoutVideo = await loadVideo(fixturePath);
			const timeoutProbe = instrumentVideo(timeoutVideo);
			const timeoutPort = createVideoRetimeHtmlVideoSeekPort(timeoutVideo, {
				assertCurrent: () => {}, timeoutMs: 50,
			});
			const timeoutPublications = [];
			const timeoutExecutor = createVideoRetimePreviewExecutor(timeoutPort, {
				onPresented: (descriptor) => timeoutPublications.push(descriptor.drawableSourceFrame),
			});
			let timeoutError = null;
			try {
				await timeoutExecutor.requestFrame(descriptor(0, 0));
			} catch (error) {
				timeoutError = error instanceof Error ? error.message : String(error);
			}
			const timeoutCleanup = timeoutProbe.snapshot();
			timeoutExecutor.dispose();
			timeoutVideo.remove();

			const cancelVideo = await loadVideo(fixturePath);
			const cancelProbe = instrumentVideo(cancelVideo);
			const cancelPort = createVideoRetimeHtmlVideoSeekPort(cancelVideo, {
				assertCurrent: () => {}, timeoutMs: 2_000,
			});
			let releaseDrain;
			let markUnderlyingDrain;
			const underlyingDrain = new Promise((resolve) => { markUnderlyingDrain = resolve; });
			let presentCalls = 0;
			const publications = [];
			const executor = createVideoRetimePreviewExecutor(Object.freeze({
				pause: () => cancelPort.pause(),
				assertCurrent: () => cancelPort.assertCurrent(),
				present: (request) => {
					presentCalls += 1;
					const operation = Promise.resolve(cancelPort.present(request));
					if (presentCalls !== 1) return operation;
					return operation.then(undefined, (error) => new Promise((_resolve, reject) => {
						releaseDrain = () => reject(error);
						markUnderlyingDrain();
					}));
				},
			}), Object.freeze({
				onPresented: (descriptor) => publications.push(descriptor.drawableSourceFrame),
			}));
			const cancelled = executor.requestFrame(descriptor(0, 0));
			await cancelProbe.nextRequest();
			executor.cancel();
			const afterCancel = executor.requestFrame(descriptor(1, 1));
			await underlyingDrain;
			const callsWhileDraining = presentCalls;
			const secondSeeked = cancelProbe.nextSeeked();
			releaseDrain();
			const secondRequest = await cancelProbe.nextRequest();
			await secondSeeked;
			secondRequest.callback(performance.now(), { mediaTime: 0.04, presentedFrames: 1 });
			const [cancelledResult, afterCancelResult] = await Promise.all([cancelled, afterCancel]);
			const cancelCleanup = cancelProbe.snapshot();
			executor.dispose();
			cancelVideo.remove();

			const faultVideo = await loadVideo(fixturePath);
			const faultProbe = instrumentVideo(faultVideo);
			const faultPort = createVideoRetimeHtmlVideoSeekPort(faultVideo, {
				assertCurrent: () => {}, timeoutMs: 2_000,
			});
			let faultPresentCalls = 0;
			const faultPublications = [];
			const faultExecutor = createVideoRetimePreviewExecutor(Object.freeze({
				pause: () => faultPort.pause(),
				assertCurrent: () => faultPort.assertCurrent(),
				present: (request) => {
					faultPresentCalls += 1;
					return faultPort.present(request);
				},
			}), Object.freeze({
				onPresented: (value) => faultPublications.push(value.drawableSourceFrame),
			}));
			const faultCancelled = faultExecutor.requestFrame(descriptor(0, 0));
			await faultProbe.nextRequest();
			const seekingAtFault = faultVideo.seeking;
			faultExecutor.cancel();
			const faultPending = faultExecutor.requestFrame(descriptor(1, 1));
			const faultPendingError = faultPending.then(
				() => null,
				(error) => error instanceof Error ? error.message : String(error),
			);
			faultVideo.dispatchEvent(new Event('abort'));
			const [faultCancelledResult, faultError] = await Promise.all([
				faultCancelled,
				faultPendingError,
			]);
			const faultCleanup = faultProbe.snapshot();
			faultExecutor.dispose();
			faultVideo.remove();

			const reentrantVideo = await loadVideo(fixturePath);
			const reentrantProbe = instrumentVideo(reentrantVideo);
			const reentrantController = new AbortController();
			let currentnessCalls = 0;
			const reentrantPort = createVideoRetimeHtmlVideoSeekPort(reentrantVideo, {
				assertCurrent: () => {
					currentnessCalls += 1;
					if (currentnessCalls === 3) reentrantController.abort();
				},
				timeoutMs: 2_000,
			});
			const currentTimeBeforeReentrantAbort = reentrantVideo.currentTime;
			let reentrantErrorName = null;
			try {
				await reentrantPort.present(Object.freeze({
					drawableSourceFrame: 1,
					intervalStartSeconds: 0.04,
					intervalEndSeconds: 0.13,
					targetSeconds: 0.085,
					signal: reentrantController.signal,
				}));
			} catch (error) {
				reentrantErrorName = error instanceof Error ? error.name : String(error);
			}
			const reentrantResult = {
				currentnessCalls,
				currentTimeBeforeReentrantAbort,
				currentTimeAfterReentrantAbort: reentrantVideo.currentTime,
				seeking: reentrantVideo.seeking,
				errorName: reentrantErrorName,
				cleanup: reentrantProbe.snapshot(),
			};
			reentrantVideo.remove();
			return {
				timeoutError, timeoutCleanup, timeoutPublications,
				callsWhileDraining, presentCalls, cancelledResult, afterCancelResult,
				cancelCleanup, publications,
				seekingAtFault, faultPresentCalls, faultCancelledResult, faultError,
				faultCleanup, faultPublications, reentrantResult,
			};

			async function loadVideo(source) {
				const element = document.createElement('video');
				element.muted = true;
				element.src = source;
				document.body.append(element);
				await new Promise((resolve, reject) => {
					element.addEventListener('loadedmetadata', resolve, { once: true });
					element.addEventListener('error', () => reject(element.error), { once: true });
				});
				return element;
			}

			function instrumentVideo(video) {
				const nativeAdd = video.addEventListener.bind(video);
				const nativeRemove = video.removeEventListener.bind(video);
				const listeners = new Map();
				const callbacks = new Map();
				const requestWaiters = [];
				let callbackId = 0;
				video.addEventListener = (type, listener, options) => {
					if (['seeked', 'error', 'abort'].includes(type)) listeners.set(listener, type);
					return nativeAdd(type, listener, options);
				};
				video.removeEventListener = (type, listener, options) => {
					listeners.delete(listener);
					return nativeRemove(type, listener, options);
				};
				video.requestVideoFrameCallback = (callback) => {
					callbackId += 1;
					const request = { id: callbackId, callback };
					callbacks.set(callbackId, request);
					requestWaiters.shift()?.(request);
					return callbackId;
				};
				video.cancelVideoFrameCallback = (id) => { callbacks.delete(id); };
				return {
					nextRequest: () => callbacks.size > 0
						? Promise.resolve([...callbacks.values()].at(-1))
						: new Promise((resolve) => requestWaiters.push(resolve)),
					nextSeeked: () => new Promise((resolve) => nativeAdd('seeked', resolve, { once: true })),
					snapshot: () => ({ activeListeners: listeners.size, activeCallbacks: callbacks.size }),
				};
			}

			function descriptor(outerCell, frame) {
				const times = [exact(0n), exact(1n, 25n), exact(13n, 100n)];
				return {
					outerCell, segmentIndex: outerCell, mode: 'constant-forward',
					sourceFrame: exact(BigInt(frame)), sourceTime: times[frame],
					drawableSourceFrame: frame,
					drawableSourceStartTime: times[frame], drawableSourceEndTime: times[frame + 1],
				};
			}

			function exact(numerator, denominator = 1n) { return { numerator, denominator }; }
		}, { fixturePath: FIXTURE_PATH, root: HARNESS_ROOT });

		expect(result.timeoutError).toMatch(/timeout|timed out/iu);
		expect(result.timeoutCleanup).toEqual({ activeListeners: 0, activeCallbacks: 0 });
		expect(result.timeoutPublications).toEqual([]);
		expect(result.callsWhileDraining).toBe(1);
		expect(result.presentCalls).toBe(2);
		expect(result.cancelledResult).toEqual({ kind: 'cancelled' });
		expect(result.afterCancelResult).toEqual({ kind: 'presented' });
		expect(result.cancelCleanup).toEqual({ activeListeners: 0, activeCallbacks: 0 });
		expect(result.publications).toEqual([1]);
		expect(result.seekingAtFault).toBe(true);
		expect(result.faultPresentCalls).toBe(1);
		expect(result.faultCancelledResult).toEqual({ kind: 'cancelled' });
		expect(result.faultError).toMatch(/abort|media|terminal/iu);
		expect(result.faultCleanup).toEqual({ activeListeners: 0, activeCallbacks: 0 });
		expect(result.faultPublications).toEqual([]);
		expect(result.reentrantResult).toEqual({
			currentnessCalls: 3,
			currentTimeBeforeReentrantAbort: 0,
			currentTimeAfterReentrantAbort: 0,
			seeking: false,
			errorName: 'AbortError',
			cleanup: { activeListeners: 0, activeCallbacks: 0 },
		});
	});
});

async function installHarnessRoutes(page, options = {}) {
	const strictModules = options.strictModules === true ? await transpileStrictModules() : new Map();
	await page.route(`**${HARNESS_ROOT}/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === `${HARNESS_ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><title>retime preview qualification</title>',
			});
			return;
		}
		if (pathname === FIXTURE_PATH) {
			const bytes = videoRetimePreviewMedia.file.buffer;
			const range = route.request().headers().range;
			const match = range?.match(/^bytes=(\d+)-(\d*)$/u);
			const start = match ? Number(match[1]) : 0;
			const requestedEnd = match?.[2] ? Number(match[2]) : bytes.byteLength - 1;
			const end = Math.min(requestedEnd, bytes.byteLength - 1);
			const body = bytes.subarray(start, end + 1);
			await route.fulfill({
				status: match ? 206 : 200,
				contentType: videoRetimePreviewMedia.file.mimeType,
				headers: {
					'Accept-Ranges': 'bytes',
					'Content-Length': String(body.byteLength),
					...(match ? { 'Content-Range': `bytes ${String(start)}-${String(end)}/${String(bytes.byteLength)}` } : {}),
				},
				body,
			});
			return;
		}
		const module = strictModules.get(pathname);
		if (module !== undefined) {
			await route.fulfill({ status: 200, contentType: 'text/javascript', body: module });
			return;
		}
		await route.fulfill({ status: 404, body: 'Unknown retime preview harness resource.' });
	});
}

async function transpileStrictModules() {
	const routes = new Map();
	for (const descriptor of MODULE_SOURCES) {
		const filename = fileURLToPath(descriptor.file);
		const source = await readFile(descriptor.file, 'utf8');
		const transformed = await transformWithEsbuild(source, filename, {
			loader: 'ts',
			format: 'esm',
			target: 'es2022',
			sourcemap: 'inline',
		});
		routes.set(`${HARNESS_ROOT}/${descriptor.name}.js`, transformed.code);
		routes.set(`${HARNESS_ROOT}/${descriptor.name}.ts`, transformed.code);
	}
	return routes;
}
