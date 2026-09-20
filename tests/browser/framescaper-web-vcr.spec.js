/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	closeWorkspacePanel,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Framescaper Web VCR', () => {
	registerAudioEditorHooks();

	test('opens from capture options and drives the packaged host lifecycle', async ({ page }) => {
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
});

async function webVcrState(page) {
	return page.evaluate(() => ({
		commandKinds: globalThis.__framescaperWebVcrHarness.commands.map(({ kind }) => kind),
		disposedSessions: globalThis.__framescaperWebVcrHarness.disposedSessions,
		openCalls: globalThis.__framescaperWebVcrHarness.openCalls,
		prepareCaptureCalls: globalThis.__framescaperWebVcrHarness.prepareCaptureCalls,
		previewCalls: globalThis.__framescaperWebVcrHarness.previewCalls,
	}));
}

async function installWebVcrHost(page) {
	await page.addInitScript(() => {
		const harness = {
			commands: [],
			disposedSessions: 0,
			openCalls: 0,
			prepareCaptureCalls: 0,
			previewCalls: 0,
		};
		let nextGeneration = 1;
		let host = null;

		function geometry(resolution) {
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
			async setCaptureState() { return true; },
			subscribe() { return () => undefined; },
			async dispose() {
				harness.disposedSessions += 1;
				return true;
			},
		});

		async function displayStream() {
			harness.previewCalls += 1;
			const canvas = document.createElement('canvas');
			canvas.width = 640;
			canvas.height = 360;
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
	});
}
