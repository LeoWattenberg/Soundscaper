/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	closeWorkspacePanel,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
	trackNameText,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

// Realtime recording needs an uninterrupted storage queue.
const realtimeTest = test.extend({ browserCoverage: false });

test.describe('Framescaper Web VCR', () => {
	registerAudioEditorHooks();

	test('opens from capture options and drives the packaged host lifecycle', async ({ browserName, page }) => {
		test.skip(
			browserName !== 'chromium',
			'The packaged Web VCR capture adapter requires Chromium MediaStreamTrackProcessor support.',
		);
		await installWebVcrHost(page);
		const editor = await bootEditor(page, '/framescaper/en/');

		const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		await getMenuItem(panels, 'Recording setup').click();
		const setup = editor.locator('[data-workspace-panel="recording-setup"] [data-framescaper-recording-setup]');
		await expect(setup).toBeVisible();
		await expect(setup.getByRole('status')).not.toContainText('Checking capture support');

		await editor.getByRole('button', { name: 'Capture options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Web VCR', exact: true }).click();

		const workspacePanel = editor.locator('[data-workspace-panel="web-vcr"]');
		const panel = workspacePanel.locator('[data-framescaper-web-vcr]');
		await expect(panel).toBeVisible();
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready');
		await expect(panel.getByRole('status')).toContainText('Web VCR is ready to record.');
		await expect(panel.locator('video[aria-label="Web page preview"]')).toBeVisible();
		await expect(editor.locator('[data-workspace-panel="recording-setup"]')).toBeHidden();

		const address = panel.getByRole('textbox', { name: 'HTTPS address', exact: true });
		await address.fill('https://media.example.test/watch');
		await panel.getByRole('button', { name: 'Go', exact: true }).click();
		await expect(address).toHaveValue('https://media.example.test/watch');
		await expect(panel.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
		await panel.getByRole('button', { name: 'Back', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Forward', exact: true })).toBeEnabled();
		await panel.getByRole('button', { name: 'Forward', exact: true }).click();
		await panel.getByRole('button', { name: 'Reload', exact: true }).click();

		const interaction = panel.getByRole('application', { name: 'Interact with web page', exact: true });
		await interaction.click({ position: { x: 40, y: 30 } });
		await interaction.press('x');
		await interaction.press('Escape');
		await expect(address).toBeFocused();

		await panel.getByRole('combobox', { name: 'Capture resolution', exact: true }).selectOption('720p');
		await expect(panel).toContainText('1280 × 720');
		await panel.getByRole('checkbox', { name: 'Auto-crop', exact: true }).uncheck();
		const aspect = panel.getByRole('combobox', { name: 'Crop aspect', exact: true });
		await expect(aspect).toBeEnabled();
		await aspect.selectOption('1:1');
		await panel.getByRole('button', { name: 'Move crop area', exact: true }).press('ArrowRight');
		await panel.getByRole('checkbox', { name: 'Mute local audio', exact: true }).check();
		await panel.getByRole('checkbox', {
			name: 'Stop automatically when the target video ends', exact: true,
		}).check();

		const clearButton = panel.getByRole('button', { name: 'Clear browser data', exact: true });
		await clearButton.focus();
		await clearButton.press('Enter');
		const clear = panel.getByRole('group', { name: 'Clear browser data', exact: true });
		await expect(clear.getByRole('alert')).toContainText('cookies, cache and sign-ins');
		const confirmClear = clear.getByRole('button', { name: 'Permanently clear browser data', exact: true });
		await confirmClear.focus();
		await confirmClear.press('Enter');
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready');
		await expect(address).toHaveValue('about:blank');

		await expect.poll(() => webVcrState(page)).toMatchObject({
			openCalls: 2,
			previewCalls: 3,
			prepareCaptureCalls: 3,
		});
		const beforeClose = await webVcrState(page);
		expect(beforeClose.commandKinds).toEqual(expect.arrayContaining([
			'navigate', 'go-back', 'go-forward', 'reload',
			'pointer-input', 'key-input', 'set-resolution', 'set-auto-crop',
			'set-crop', 'set-monitor-muted', 'set-auto-stop',
			'request-data-clear', 'clear-browser-data',
		]));

		await closeWorkspacePanel(editor, 'web-vcr');
		await expect.poll(() => webVcrState(page)).toMatchObject({ disposedSessions: 1 });
	});

	realtimeTest('records and reopens a Web VCR screen and system-audio take', async ({ browserName, page }) => {
		test.skip(browserName !== 'chromium', 'Web VCR capture requires Chromium MediaStreamTrackProcessor support.');
		test.setTimeout(120_000);
		await installWebVcrHost(page, { recordingFixture: true });
		let editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		await getMenuItem(panels, 'Recording setup').click();
		const setup = editor.locator('[data-workspace-panel="recording-setup"] [data-framescaper-recording-setup]');
		await expect(setup).toBeVisible();
		await expect(setup.getByRole('status')).not.toContainText('Checking capture support');
		await editor.getByRole('button', { name: 'Capture options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Web VCR', exact: true }).click();

		const panel = editor.locator('[data-workspace-panel="web-vcr"] [data-framescaper-web-vcr]');
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready');
		const record = panel.getByRole('button', { name: 'Record web capture', exact: true });
		await expect(record).toBeEnabled();
		await record.press('Enter');
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'recording', { timeout: 30_000 });
		await expect.poll(async () => (await webVcrState(page)).audioDataClosed, {
			timeout: 30_000,
		}).toBeGreaterThanOrEqual(3);
		await panel.getByRole('button', { name: 'Stop and import', exact: true }).press('Enter');
		await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready', { timeout: 60_000 });
		await expect(trackNameText(editor).filter({ hasText: /^Screen$/u })).toHaveCount(1);
		await expect(trackNameText(editor).filter({ hasText: /^System Audio$/u })).toHaveCount(1);
		const capturedItems = editor.getByRole('listitem', { name: /^Project bin: Web Capture /u });
		await expect(capturedItems).toHaveCount(2);
		await expect(capturedItems.first()).toContainText('WEBM');
		await expect(capturedItems.last()).toContainText('SOUNDSCAPER-PCM');
		await expect.poll(() => storedWebVcrTake(page, projectId)).toMatchObject({
			sourceKinds: ['audio', 'video'], projectBinClipCount: 2,
		});
		expect((await webVcrState(page)).captureStates).toEqual([
			'preparing', 'recording', 'finalizing', 'ready',
		]);

		await page.goto(resolveBrowserProductTestUrl(`/framescaper/en/?project=${encodeURIComponent(projectId)}`));
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-project-id', projectId, { timeout: 30_000 });
		await expect(trackNameText(editor).filter({ hasText: /^Screen$/u })).toHaveCount(1);
		await expect(trackNameText(editor).filter({ hasText: /^System Audio$/u })).toHaveCount(1);
		await expect(editor.getByRole('listitem', { name: /^Project bin: Web Capture /u })).toHaveCount(2);
	});
});

async function storedWebVcrTake(page, projectId) {
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
			return {
				sourceKinds: (latest?.sources ?? []).map(({ kind }) => kind).sort(),
				projectBinClipCount: latest?.projectBin?.clips?.length ?? -1,
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}

async function webVcrState(page) {
	return page.evaluate(() => ({
		audioDataClosed: globalThis.__framescaperWebVcrHarness.audioDataClosed,
		captureStates: globalThis.__framescaperWebVcrHarness.captureStates,
		commandKinds: globalThis.__framescaperWebVcrHarness.commands.map(({ kind }) => kind),
		disposedSessions: globalThis.__framescaperWebVcrHarness.disposedSessions,
		openCalls: globalThis.__framescaperWebVcrHarness.openCalls,
		prepareCaptureCalls: globalThis.__framescaperWebVcrHarness.prepareCaptureCalls,
		previewCalls: globalThis.__framescaperWebVcrHarness.previewCalls,
	}));
}

async function installWebVcrHost(page, { recordingFixture = false } = {}) {
	const recordedVideoBase64 = recordingFixture
		? createDeterministicAvFixture('web-vcr-recording.webm').buffer.toString('base64') : null;
	await page.addInitScript(({ recordingFixture: hasRecordingFixture, recordedVideoBase64: videoBase64 }) => {
		const harness = {
			audioDataClosed: 0,
			captureStates: [],
			commands: [],
			disposedSessions: 0,
			openCalls: 0,
			prepareCaptureCalls: 0,
			previewCalls: 0,
		};
		let nextGeneration = 1;
		let host = null;

		function geometry(resolution) {
			if (hasRecordingFixture) return {
				captureSurface: { width: 160, height: 108 }, outputSize: { width: 96, height: 54 },
			};
			return resolution === '720p'
				? { captureSurface: { width: 1280, height: 720 }, outputSize: { width: 768, height: 360 } }
				: { captureSurface: { width: 1920, height: 1080 }, outputSize: { width: 1152, height: 540 } };
		}

		function snapshot({
			generation,
			sessionId = 'a'.repeat(32),
			phase = 'ready',
			resolution = '1080p',
			visible = true,
			navigation = {},
			target = undefined,
		} = {}) {
			const crop = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 };
			return {
				version: 1,
				sessionId,
				generation,
				phase,
				capability: { status: 'available', resolutions: ['720p', '1080p'] },
				resolution,
				aspect: 'free',
				crop,
				autoCrop: true,
				monitorMuted: false,
				autoStop: false,
				visible,
				navigation: {
					generation: 1,
					url: 'https://example.test/',
					canGoBack: false,
					canGoForward: false,
					isLoading: false,
					...navigation,
				},
				target: target === undefined ? {
					targetId: 'd'.repeat(32),
					generation: 1,
					mediaState: 'playing',
					aperture: crop,
					intrinsicSize: { width: 1920, height: 1080 },
				} : target,
				targetEndedRecordingToken: null,
				...geometry(resolution),
				metrics: null,
				failure: null,
			};
		}

		function update(patch) {
			host = {
				...host,
				...patch,
				navigation: { ...host.navigation, ...patch.navigation },
			};
			return structuredClone(host);
		}

		const bridge = Object.freeze({
			async handshake() {
				return {
					version: 1,
					capability: { status: 'available', resolutions: ['720p', '1080p'] },
					captureGrantTtlMs: 10_000,
				};
			},
			async open({ resolution }) {
				harness.openCalls += 1;
				host = snapshot({
					generation: nextGeneration,
					sessionId: (nextGeneration === 1 ? 'a' : 'b').repeat(32),
					resolution,
					navigation: nextGeneration === 1 ? {} : { generation: 0, url: 'about:blank' },
					target: nextGeneration === 1 ? undefined : null,
				});
				nextGeneration += 1;
				return structuredClone(host);
			},
			async dispatch(command) {
				harness.commands.push(structuredClone(command));
				switch (command.kind) {
					case 'navigate':
						update({ navigation: {
							generation: host.navigation.generation + 1,
							url: new URL(command.url).href,
							canGoBack: true,
							canGoForward: false,
						} });
						break;
					case 'go-back':
						update({ navigation: { canGoBack: false, canGoForward: true } });
						break;
					case 'go-forward':
						update({ navigation: { canGoBack: true, canGoForward: false } });
						break;
					case 'set-visibility':
						update({ visible: command.visible });
						break;
					case 'set-resolution':
						update({ resolution: command.resolution, ...geometry(command.resolution) });
						break;
					case 'set-auto-crop':
						update({ autoCrop: command.enabled });
						break;
					case 'set-crop':
						update({ crop: command.crop, aspect: command.aspect });
						break;
					case 'set-monitor-muted':
						update({ monitorMuted: command.muted });
						break;
					case 'set-auto-stop':
						update({ autoStop: command.enabled });
						break;
					case 'request-data-clear':
						return {
							version: 1,
							kind: 'data-clear-confirmation',
							sessionId: host.sessionId,
							generation: host.generation,
							nonce: 'c'.repeat(32),
							expiresAtMs: 20_000,
						};
					case 'clear-browser-data':
						host = snapshot({
							generation: nextGeneration,
							sessionId: null,
							phase: 'closed',
							resolution: host.resolution,
							visible: false,
							navigation: { generation: 0, url: 'about:blank' },
							target: null,
						});
						nextGeneration += 1;
						break;
					default:
						break;
				}
				return { version: 1, kind: 'snapshot', snapshot: structuredClone(host) };
			},
			async prepareCapture(reference) {
				harness.prepareCaptureCalls += 1;
				return {
					version: 1,
					grantId: 'e'.repeat(32),
					sessionId: reference.sessionId,
					generation: reference.generation,
					expiresAtMs: 20_000,
				};
			},
			async setCaptureState({ state }) {
				harness.captureStates.push(state);
				return true;
			},
			subscribe() { return () => undefined; },
			async dispose() {
				harness.disposedSessions += 1;
				return true;
			},
		});

		async function displayStream() {
			harness.previewCalls += 1;
			const canvas = document.createElement('canvas');
			canvas.width = hasRecordingFixture ? 160 : 640;
			canvas.height = hasRecordingFixture ? 108 : 360;
			const context = canvas.getContext('2d');
			context.fillStyle = '#1e3a8a';
			context.fillRect(0, 0, canvas.width, canvas.height);
			const videoTrack = canvas.captureStream(30).getVideoTracks()[0];
			const audioContext = new AudioContext({ sampleRate: 48_000 });
			const oscillator = audioContext.createOscillator();
			const destination = audioContext.createMediaStreamDestination();
			oscillator.connect(destination);
			oscillator.start();
			await audioContext.resume();
			const audioTrack = destination.stream.getAudioTracks()[0];
			const stopAudio = audioTrack.stop.bind(audioTrack);
			Object.defineProperty(audioTrack, 'stop', { configurable: true, value: () => {
				stopAudio();
				try { oscillator.stop(); } catch { /* Already stopped. */ }
				void audioContext.close();
			} });
			return new MediaStream([videoTrack, audioTrack]);
		}

		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: Object.freeze({
				getDisplayMedia: async () => displayStream(),
				getUserMedia: async () => new MediaStream(),
				enumerateDevices: async () => [],
			}),
		});
		if (hasRecordingFixture) {
			const recordedVideo = Uint8Array.from(atob(videoBase64), (value) => value.charCodeAt(0));
			class FixtureMediaRecorder {
				static isTypeSupported(mimeType) { return mimeType.startsWith('video/webm'); }
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
						this.ondataavailable?.({
							data: new Blob([recordedVideo], { type: this.mimeType }), timecode: 1_000,
						});
						this.onstop?.();
					});
				}
			}
			Object.defineProperty(globalThis, 'MediaRecorder', {
				configurable: true, writable: true, value: FixtureMediaRecorder,
			});
			const NativeProcessor = globalThis.MediaStreamTrackProcessor;
			class FixtureMediaStreamTrackProcessor {
				constructor({ track }) {
					if (track.kind !== 'audio') return new NativeProcessor({ track });
					let canceled = false;
					let frameStart = 0;
					let pending = null;
					this.readable = {
						getReader: () => ({
							read() {
								if (canceled) return Promise.resolve({ done: true });
								return new Promise((resolve) => {
									const finish = () => {
										pending = null;
										if (canceled) { resolve({ done: true }); return; }
										const start = frameStart;
										frameStart += 4_096;
										resolve({ done: false, value: {
											numberOfFrames: 4_096, numberOfChannels: 2, sampleRate: 48_000,
											copyTo(destination, options) {
												for (let index = 0; index < destination.length; index += 1) {
													destination[index] = Math.sin(
													2 * Math.PI * 440 * (start + (options.frameOffset || 0) + index) / 48_000,
												) * 0.05;
												}
											},
											close() { harness.audioDataClosed += 1; },
										} });
									};
									const timer = setTimeout(finish, 85);
									pending = () => { clearTimeout(timer); finish(); };
								});
							},
							cancel: async () => { canceled = true; pending?.(); },
							releaseLock() {},
						}),
					};
				}
			}
			Object.defineProperty(globalThis, 'MediaStreamTrackProcessor', {
				configurable: true, writable: true, value: FixtureMediaStreamTrackProcessor,
			});
		}
		Object.defineProperty(globalThis, '__framescaperWebVcrHarness', {
			configurable: true,
			value: harness,
		});
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: Object.freeze({}) }),
		});
		Object.defineProperty(globalThis, 'framescaperWebVcr', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: bridge }),
		});
	}, { recordingFixture, recordedVideoBase64 });
}
