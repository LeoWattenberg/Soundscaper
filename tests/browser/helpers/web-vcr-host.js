/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeterministicAvFixture } from '../fixtures/deterministic-av-media.js';

export async function installWebVcrHost(page, { recordingFixture = false } = {}) {
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
