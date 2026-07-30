export async function installDirectPcmTarget(page, options) {
	await page.evaluate((configuration) => {
		const createObjectUrl = URL.createObjectURL.bind(URL);
		const state = {
			objectUrls: [],
			pickerOptions: null,
			sessions: [],
		};
		Object.defineProperty(state, 'commitReleases', { value: [] });
		globalThis.__directPcmSave = state;
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value(blob) {
				globalThis.__directPcmSave.objectUrls.push({ size: blob.size, type: blob.type });
				return createObjectUrl(blob);
			},
		});
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async (options) => {
				globalThis.__directPcmSave.pickerOptions = options;
				return {
					name: configuration.fileName,
					async createWritable() {
						const sessionIndex = state.sessions.length;
						const session = {
							aborts: 0,
							activeWrites: 0,
							closes: 0,
							commitStarted: 0,
							commits: 0,
							maxConcurrentWrites: 0,
							maximumWriteBytes: 0,
							nonzeroPcmBytes: 0,
							opens: 1,
							prefix: new Uint8Array(configuration.prefixBytes || 2 * 1024),
							prefixBytes: 0,
							publications: 0,
							suffix: new Uint8Array(configuration.suffixBytes || 0),
							suffixBytes: 0,
							totalBytes: 0,
							writeCalls: 0,
						};
						globalThis.__directPcmSave.sessions.push(session);
						return {
							async write(chunk) {
								if (!(chunk instanceof Uint8Array)) throw new TypeError('Expected PCM container bytes.');
								session.activeWrites += 1;
								session.maxConcurrentWrites = Math.max(session.maxConcurrentWrites, session.activeWrites);
								session.maximumWriteBytes = Math.max(session.maximumWriteBytes, chunk.byteLength);
								session.writeCalls += 1;
								const prefixBytes = Math.min(chunk.byteLength, session.prefix.length - session.prefixBytes);
								if (prefixBytes > 0) {
									session.prefix.set(chunk.subarray(0, prefixBytes), session.prefixBytes);
									session.prefixBytes += prefixBytes;
								}
								if (session.suffix.length > 0) retainSuffix(session, chunk);
								for (let index = Math.max(0, configuration.pcmOffset - session.totalBytes); index < chunk.byteLength; index += 1) {
									if (chunk[index] !== 0) session.nonzeroPcmBytes += 1;
								}
								session.totalBytes += chunk.byteLength;
								await Promise.resolve();
								session.activeWrites -= 1;
							},
							async close() {
								session.commitStarted += 1;
								if (sessionIndex === configuration.stallCommitSession) {
									await new Promise((resolve) => {
										state.commitReleases[sessionIndex] = () => {
											state.commitReleases[sessionIndex] = null;
											resolve();
										};
									});
								}
								session.closes += 1;
								session.commits += 1;
								session.publications += 1;
							},
							async abort() { session.aborts += 1; },
						};
					},
				};
			},
		});
		function retainSuffix(session, chunk) {
			if (chunk.byteLength >= session.suffix.length) {
				session.suffix.set(chunk.subarray(chunk.byteLength - session.suffix.length));
				session.suffixBytes = session.suffix.length;
				return;
			}
			const overflow = Math.max(0, session.suffixBytes + chunk.byteLength - session.suffix.length);
			if (overflow > 0) session.suffix.copyWithin(0, overflow, session.suffixBytes);
			const retainedBytes = session.suffixBytes - overflow;
			session.suffix.set(chunk, retainedBytes);
			session.suffixBytes = retainedBytes + chunk.byteLength;
		}
	}, options);
}
