/* SPDX-License-Identifier: AGPL-3.0-only */

export async function installRound6NativeCapture(page) {
	await page.addInitScript(() => {
		const frameSizes = [];
		const pcm = { frames: 0, peak: 0 };
		const copied = new WeakSet();
		if (typeof AudioData === 'function') {
			const nativeCopy = AudioData.prototype.copyTo;
			AudioData.prototype.copyTo = function(...args) {
				if (!copied.has(this)) {
					frameSizes.push(this.numberOfFrames); pcm.frames += this.numberOfFrames; copied.add(this);
				}
				const result = nativeCopy.apply(this, args);
				if (args[0] instanceof Float32Array) for (const value of args[0]) pcm.peak = Math.max(pcm.peak, Math.abs(value));
				return result;
			};
		}
		window.__round6CaptureNativeFrameSizes = () => [...frameSizes];
		window.__round6CaptureNativePcm = () => ({ ...pcm });
		const tracks = new Map();
		const observers = [];
		const NativeWorklet = AudioWorkletNode;
		window.AudioWorkletNode = class extends NativeWorklet {
			constructor(context, name, options) {
				super(context, name, options);
				if (name !== 'kw-audio-recorder') return;
				const analyser = context.createAnalyser();
				analyser.fftSize = 2048;
				this.connect(analyser);
				observers.push({ node: this, analyser, role: null, peak: 0 });
				this.port.addEventListener('message', ({ data }) => {
					if (data.type !== 'audio-chunk') return;
					pcm.frames += data.frames;
					for (const channel of data.channels) for (const value of new Float32Array(channel)) {
						pcm.peak = Math.max(pcm.peak, Math.abs(value));
					}
				});
				this.port.start();
			}
		};
		const nativeConnect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function(...args) {
			const observer = observers.find(({ node }) => node === args[0]);
			if (observer && this instanceof MediaStreamAudioSourceNode) {
				observer.role = tracks.get(this.mediaStream.getAudioTracks()[0].id);
			}
			return nativeConnect.apply(this, args);
		};
		window.__round6CaptureMonitorOutput = () => {
			const peaks = { microphone: 0, 'system-audio': 0 };
			for (const observer of observers) {
				const values = new Float32Array(observer.analyser.fftSize);
				observer.analyser.getFloatTimeDomainData(values);
				observer.peak = Math.max(observer.peak, ...values.map(Math.abs));
				if (observer.role) peaks[observer.role] = Math.max(peaks[observer.role], observer.peak);
			}
			return peaks;
		};
		const audio = async role => {
			const context = new AudioContext({ sampleRate: 48000 });
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			const output = context.createMediaStreamDestination();
			oscillator.frequency.value = role === 'microphone' ? 440 : 220;
			gain.gain.value = 0.2;
			oscillator.connect(gain).connect(output);
			oscillator.start();
			await context.resume();
			tracks.set(output.stream.getAudioTracks()[0].id, role);
			return output.stream;
		};
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
			configurable: true, value: () => audio('microphone'),
		});
		Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
			configurable: true, value: async () => {
				const canvas = document.createElement('canvas');
				canvas.width = 320; canvas.height = 180;
				const context = canvas.getContext('2d');
				let tick = 0;
				const draw = () => {
					context.fillStyle = tick++ % 2 ? '#1672a5' : '#f3b235';
					context.fillRect(0, 0, canvas.width, canvas.height);
				};
				draw();
				const video = canvas.captureStream(10);
				const timer = setInterval(draw, 100);
				video.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
				const stream = await audio('system-audio');
				stream.addTrack(video.getVideoTracks()[0]);
				return stream;
			},
		});
	});
}
