/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '../audio-editor-test-fixtures.js';
import { framescaperCaptureManifestProjectPrefix } from '../../../src/common/editor/storage/framescaper-capture-session-creation-repository.ts';
import { getMenuItem, openNestedCommandMenu } from '../audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from '../fixtures/video-timing-probe-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './editor-databases.js';

const SOURCE_LABELS = Object.freeze({
	camera: 'Camera',
	microphone: 'Microphone',
	display: 'Screen',
});

async function openRecordingSetup(page, editor) {
	if (!await recordingSetupWorkspacePanel(editor).isVisible()) {
		const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		const setup = getMenuItem(panels, 'Recording setup');
		await expect(setup).toBeEnabled();
		await setup.focus();
		await setup.press('Enter');
	}
	return waitForRecordingSetup(editor);
}

async function waitForRecordingSetup(editor) {
	const panel = recordingSetupWorkspacePanel(editor);
	await expect(panel).toBeVisible();
	const setup = panel.locator('[data-framescaper-recording-setup]');
	await expect(setup).toBeVisible();
	await expect(setup.getByRole('status')).not.toContainText('Checking capture support');
	return setup;
}

function recordingSetupWorkspacePanel(editor) {
	return editor.locator('[data-workspace-panel="recording-setup"]');
}

async function assertCaptureForcedColorContract(page, status, browserName) {
	if (browserName !== 'webkit') {
		await expect(status).toHaveCSS('forced-color-adjust', 'none');
		return;
	}
	const authored = await page.evaluate(async () => {
		const links = [...document.querySelectorAll('link[rel="stylesheet"][href]')];
		const styles = await Promise.all(links.map(async ({ href }) => (await fetch(href)).text()));
		return styles.some((css) => (
			/@media\s*\(forced-colors:\s*active\)\s*\{[^}]*kw-framescaper-capture__status[^}]*\{[^}]*forced-color-adjust:\s*none/isu
				.test(css)
		));
	});
	expect(authored).toBe(true);
}

async function expectCapturePhase(panel, phase, timeout = 10_000) {
	await expect(panel).toHaveAttribute('data-capture-phase', phase, { timeout });
}

async function selectSourceRoles(panel, roles) {
	for (const [role, label] of Object.entries(SOURCE_LABELS)) {
		const checkbox = panel.getByRole('checkbox', { name: label, exact: true });
		if (roles.includes(role)) await checkbox.check();
		else await checkbox.uncheck();
	}
}

function projectBinCaptureCard(editor, name) {
	return editor.getByRole('listitem', { name: `Project bin: ${name}`, exact: true });
}

async function storedCaptureState(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['projects', 'revisions'], 'readonly');
			const [project, revisions] = await Promise.all([
				result(transaction.objectStore('projects').get(id)),
				result(transaction.objectStore('revisions').getAll()),
			]);
			const latest = revisions
				.filter(({ projectId: revisionProjectId }) => revisionProjectId === id)
				.sort((left, right) => right.revision - left.revision)[0]?.project || project;
			const sources = Array.isArray(latest?.sources) ? latest.sources : [];
			const videoSources = sources.filter(({ kind }) => kind === 'video');
			return {
				revision: latest?.revision ?? null,
				schemaFamily: latest?.schemaFamily ?? null,
				schemaVersion: latest?.schemaVersion ?? null,
				assistanceAssetCount: latest?.assistanceAssets?.length ?? null,
				requirementIds: latest?.featureRequirements?.requirements?.map(({ id }) => id) ?? null,
				sourceCount: sources.length,
				videoSourceCount: videoSources.length,
				proxyAttachmentCount: videoSources.filter(({ proxyAttachment }) => proxyAttachment !== null).length,
				videoSources: videoSources.map((source) => ({
					id: source.id,
					mimeType: source.mimeType,
					timingMode: source.timingDecision?.mode ?? null,
					characteristicsBackend: source.characteristics?.backend ?? null,
					proxyAttached: source.proxyAttachment !== null,
				})),
				projectBinClipCount: Array.isArray(latest?.projectBin?.clips)
					? latest.projectBin.clips.length : -1,
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}

async function storedProjectExists(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return Boolean(await new Promise((resolve, reject) => {
				const request = database.transaction('projects', 'readonly').objectStore('projects').get(id);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			}));
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}

async function storedCaptureRecoveryState(page, projectId) {
	const prefix = framescaperCaptureManifestProjectPrefix(projectId);
	return page.evaluate(async ({ databaseName, keyPrefix }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const range = IDBKeyRange.bound(keyPrefix, `${keyPrefix}\uffff`);
			const rows = await result(database.transaction(['analysis'], 'readonly').objectStore('analysis').getAll(range));
			const manifest = rows.map(({ value }) => value).find(({ state }) => state === 'sealed');
			const retainedPresentationRangeCount = manifest?.streams?.filter(({ role, storage, timing }) => (
				role === 'microphone' && storage.chunkCount > 0 && storage.frameCount > 0
				&& timing.firstPresentationMicroseconds !== null
				&& timing.lastPresentationEndMicroseconds > timing.firstPresentationMicroseconds
			)).length ?? 0;
			return { state: manifest?.state ?? null, retainedPresentationRangeCount };
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, keyPrefix: prefix });
}

async function expectCaptureCalls(page, expected) {
	await expect.poll(async () => (
		captureCallState(await captureHarnessState(page))
	)).toEqual({ requests: expected, enumerateCalls: 0 });
}

function captureCallState(state) {
	return {
		requests: state.requests.map(({ kind }) => kind),
		enumerateCalls: state.enumerateCalls,
	};
}

async function captureHarnessState(page) {
	return page.evaluate(() => {
		const harness = globalThis.__framescaperCaptureHarness;
		return {
			requests: structuredClone(harness.requests),
			enumerateCalls: harness.enumerateCalls,
			displayCalls: harness.displayCalls,
			userCalls: harness.userCalls,
			createdTracks: harness.createdTracks,
			stopCalls: harness.stopCalls,
			audioDataClosed: harness.audioDataClosed,
			readerCancels: harness.readerCancels,
			readerReleases: harness.readerReleases,
			videoDataEvents: harness.videoDataEvents,
			audioProcessorConstructions: harness.audioProcessorConstructions,
		};
	});
}

async function installCaptureHarness(page, options = {}) {
	const videoFixture = videoTimingProbeMedia.find(({ kind }) => kind === (options.videoKind ?? 'vfr'));
	const videoBase64 = videoFixture.file.buffer.toString('base64');
	const videoMimeType = videoFixture.file.mimeType;
	await page.addInitScript(({
		persistentQuota, audioFrameIntervalMs, videoBase64: encodedVideo, videoMimeType: capturedVideoMimeType,
	}) => {
		const binaryVideo = atob(encodedVideo);
		const videoBytes = Uint8Array.from(binaryVideo, (value) => value.charCodeAt(0));
		const harness = {
			requests: [],
			enumerateCalls: 0,
			displayCalls: 0,
			userCalls: 0,
			createdTracks: 0,
			stopCalls: 0,
			audioDataClosed: 0,
			readerCancels: 0,
			readerReleases: 0,
			videoDataEvents: 0,
			audioProcessorConstructions: 0,
			includeSystemAudio: true,
			denyNextUser: false,
			denyNextDisplay: false,
			trackEntries: [],
			endNewest(role) {
				const entry = [...this.trackEntries].reverse().find((candidate) => (
					candidate.role === role && !candidate.stopped
				));
				if (!entry) return false;
				entry.end();
				return true;
			},
		};
		Object.defineProperty(globalThis, '__framescaperCaptureHarness', {
			configurable: true,
			value: harness,
		});
		if (persistentQuota) {
			const storage = navigator.storage ?? {};
			if (!navigator.storage) {
				Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
			}
			Object.defineProperties(storage, {
				estimate: { configurable: true, value: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }) },
				persisted: { configurable: true, value: async () => true },
				persist: { configurable: true, value: async () => true },
			});
		}

		function instrumentTrack(track, role, cleanup, settings, capabilities) {
			const nativeStop = track.stop.bind(track);
			const nativeAddEventListener = track.addEventListener.bind(track);
			const nativeRemoveEventListener = track.removeEventListener.bind(track);
			const endedEvents = new EventTarget();
			const entry = {
				track, role, stopped: false,
				end: () => endedEvents.dispatchEvent(new Event('ended')),
			};
			harness.trackEntries.push(entry);
			harness.createdTracks += 1;
			try {
				Object.defineProperty(track, 'label', { configurable: true, value: `Fixture ${role}` });
			} catch { /* Native labels may remain empty. */ }
			Object.defineProperty(track, 'getSettings', {
				configurable: true,
				value: () => ({ ...settings }),
			});
			Object.defineProperty(track, 'getCapabilities', {
				configurable: true,
				value: () => ({ ...capabilities }),
			});
			Object.defineProperty(track, 'addEventListener', {
				configurable: true,
				value: (type, ...args) => type === 'ended'
					? endedEvents.addEventListener(type, ...args) : nativeAddEventListener(type, ...args),
			});
			Object.defineProperty(track, 'removeEventListener', {
				configurable: true,
				value: (type, ...args) => type === 'ended'
					? endedEvents.removeEventListener(type, ...args) : nativeRemoveEventListener(type, ...args),
			});
			Object.defineProperty(track, 'stop', {
				configurable: true,
				value: () => {
					if (entry.stopped) return;
					entry.stopped = true;
					harness.stopCalls += 1;
					try { cleanup(); } finally { nativeStop(); }
				},
			});
			return track;
		}

		function videoTrack(role) {
			const canvas = document.createElement('canvas');
			canvas.width = 640;
			canvas.height = 360;
			const context = canvas.getContext('2d');
			context.fillStyle = role === 'camera' ? '#14532d' : '#1e3a8a';
			context.fillRect(0, 0, canvas.width, canvas.height);
			const stream = canvas.captureStream(30);
			const track = stream.getVideoTracks()[0];
			return instrumentTrack(track, role, () => undefined, {
				width: 640, height: 360, frameRate: 30,
			}, {
				width: { min: 320, max: 1920 },
				height: { min: 180, max: 1080 },
				frameRate: { min: 15, max: 60 },
			});
		}

		async function audioTrack(role) {
			const context = new AudioContext({ sampleRate: 48_000 });
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			const destination = context.createMediaStreamDestination();
			oscillator.frequency.value = role === 'microphone' ? 440 : 220;
			gain.gain.value = 0.05;
			oscillator.connect(gain).connect(destination);
			oscillator.start();
			await context.resume();
			const track = destination.stream.getAudioTracks()[0];
			return instrumentTrack(track, role, () => {
				try { oscillator.stop(); } catch { /* Already stopped. */ }
				oscillator.disconnect();
				gain.disconnect();
				void context.close();
			}, {
				sampleRate: 48_000, channelCount: 2,
			}, {
				sampleRate: { min: 44_100, max: 96_000 },
				channelCount: { min: 1, max: 2 },
			});
		}

		async function sourceStream({ camera = false, microphone = false, display = false, systemAudio = false }) {
			const tracks = [];
			if (camera) tracks.push(videoTrack('camera'));
			if (microphone) tracks.push(await audioTrack('microphone'));
			if (display) tracks.push(videoTrack('display'));
			if (systemAudio) tracks.push(await audioTrack('system-audio'));
			return new MediaStream(tracks);
		}

		const mediaDevices = {
			async getDisplayMedia(constraints) {
				harness.displayCalls += 1;
				harness.requests.push({ kind: 'display', constraints: structuredClone(constraints) });
				if (harness.denyNextDisplay) {
					harness.denyNextDisplay = false;
					throw new DOMException('Fixture display permission denied.', 'NotAllowedError');
				}
				return sourceStream({ display: true, systemAudio: harness.includeSystemAudio });
			},
			async getUserMedia(constraints) {
				harness.userCalls += 1;
				harness.requests.push({ kind: 'user', constraints: structuredClone(constraints) });
				if (harness.denyNextUser) {
					harness.denyNextUser = false;
					throw new DOMException('Fixture user-media permission denied.', 'NotAllowedError');
				}
				return sourceStream({ camera: Boolean(constraints.video), microphone: Boolean(constraints.audio) });
			},
			async enumerateDevices() {
				harness.enumerateCalls += 1;
				return [
					{ deviceId: 'fixture-camera', kind: 'videoinput', label: 'Fixture camera' },
					{ deviceId: 'fixture-microphone', kind: 'audioinput', label: 'Fixture microphone' },
				];
			},
		};
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });

		class FixtureMediaRecorder {
			static isTypeSupported(mimeType) {
				return mimeType === capturedVideoMimeType || (
					capturedVideoMimeType === 'video/webm' && mimeType.startsWith(`${capturedVideoMimeType};`)
				);
			}
			constructor(_stream, options = {}) {
				this.mimeType = options.mimeType || 'video/webm';
				this.state = 'inactive';
				this.ondataavailable = null;
				this.onerror = null;
				this.onstop = null;
			}
			start() { this.state = 'recording'; }
			pause() { if (this.state === 'recording') this.state = 'paused'; }
			resume() { if (this.state === 'paused') this.state = 'recording'; }
			requestData() {}
			stop() {
				if (this.state === 'inactive') return;
				this.state = 'inactive';
				queueMicrotask(() => {
					harness.videoDataEvents += 1;
					this.ondataavailable?.({
						data: new Blob([videoBytes], { type: this.mimeType }),
						timecode: 1_000,
					});
					this.onstop?.();
				});
			}
		}
		Object.defineProperty(globalThis, 'MediaRecorder', {
			configurable: true,
			writable: true,
			value: FixtureMediaRecorder,
		});

		class FixtureMediaStreamTrackProcessor {
			constructor({ track }) {
				harness.audioProcessorConstructions += 1;
				const settings = track.getSettings();
				const sampleRate = settings.sampleRate || 48_000;
				const channelCount = settings.channelCount || 2;
				const frames = 4_096;
			const frameIntervalMs = audioFrameIntervalMs ?? Math.ceil(frames * 1_000 / sampleRate);
				let canceled = false;
				let frameStart = 0;
				let pending = null;
				this.readable = {
					getReader: () => ({
						read: () => {
							if (canceled) return Promise.resolve({ done: true });
							return new Promise((resolve) => {
								const finish = () => {
									pending = null;
									if (canceled) {
										resolve({ done: true });
										return;
									}
									const start = frameStart;
									frameStart += frames;
									resolve({
										done: false,
										value: {
											numberOfFrames: frames,
											numberOfChannels: channelCount,
											sampleRate,
											copyTo(destination, options) {
												for (let index = 0; index < destination.length; index += 1) {
													destination[index] = Math.sin(
														2 * Math.PI * 440 * (start + (options.frameOffset || 0) + index) / sampleRate,
													) * 0.05;
												}
											},
											close() { harness.audioDataClosed += 1; },
										},
									});
								};
								const timer = setTimeout(finish, frameIntervalMs);
								pending = () => {
									clearTimeout(timer);
									finish();
								};
							});
						},
						cancel: () => {
							if (canceled) return Promise.resolve();
							canceled = true;
							harness.readerCancels += 1;
							pending?.();
							return Promise.resolve();
						},
						releaseLock: () => { harness.readerReleases += 1; },
					}),
				};
			}
		}
		Object.defineProperty(globalThis, 'MediaStreamTrackProcessor', {
			configurable: true,
			writable: true,
			value: FixtureMediaStreamTrackProcessor,
		});
	}, { persistentQuota: options.persistentQuota === true, audioFrameIntervalMs: options.audioFrameIntervalMs, videoBase64, videoMimeType });
}

export {
	assertCaptureForcedColorContract,
	captureHarnessState,
	expectCaptureCalls,
	expectCapturePhase,
	installCaptureHarness,
	openRecordingSetup,
	projectBinCaptureCard,
	recordingSetupWorkspacePanel,
	selectSourceRoles,
	storedCaptureRecoveryState,
	storedCaptureState,
	storedProjectExists,
	waitForRecordingSetup,
};
