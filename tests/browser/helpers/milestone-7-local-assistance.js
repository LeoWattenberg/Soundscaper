/* SPDX-License-Identifier: AGPL-3.0-only */

const MODELS = Object.freeze([
	['silero-vad-v6', '6.2.1', 'voice-activity-detection'],
	['parakeet-tdt-0.6b-v3', '3.0.0', 'speech-recognition'],
	['deepfilternet3', '3.0.0', 'speech-enhancement'],
	['dereverb-room', '1.0.0', 'dereverberation'],
	['panns-cnn10', '1.0.0', 'audio-tagging'],
	['beat-this-small0', '1.1.0', 'beat-tracking'],
	['nomic-embed-text-v1.5', '1.5.0', 'text-embedding'],
	['siglip2-base-patch16-224', '2.0.0', 'image-text-embedding'],
	['ppocr-v4-mobile', '4.0.0', 'optical-character-recognition'],
	['yunet-face-detection-2026may', '2026.5.0', 'face-detection'],
	['dfine-nano-coco', '1.0.0', 'object-detection'],
	['u2netp-saliency', '1.0.0', 'saliency-detection'],
]);

export async function installMilestone7LocalAssistanceFixture(page) {
	await page.addInitScript(({ models }) => {
		const artifactSha256 = '11'.repeat(32);
		const runtimeModels = Object.freeze(models.map(([modelId, version, task]) => Object.freeze({
			modelId, version, task, artifactSha256s: Object.freeze([artifactSha256]),
		})));
		const state = {
			completeRun: () => undefined,
			consents: [],
			id: 1,
			latestInput: null,
			modelCalls: 0,
			progressEvents: 0,
			queryCalls: 0,
			requests: new Map(),
			stagedInputBodies: new Map(),
			stagedSlots: [],
		};
		const workflowListeners = new Set();
		const outputReservations = new Map();
		const opaqueId = () => (state.id++).toString(16).padStart(40, '0');
		const claim = (custody) => Object.freeze({
			claimVersion: 1, direction: custody.direction, claimId: custody.claimId,
			jobId: custody.jobId, stageId: custody.stageId, slotId: custody.slotId,
		});
		const handle = (custody) => Object.freeze({ custody: Object.freeze(custody),
			workflowClaim: claim(custody) });
		const inputHandle = (request) => handle({
			custodyVersion: 1, workflowId: request.workflowId, direction: 'input',
			jobId: request.jobId, stageId: request.stageId, slotId: request.slotId,
			claimId: opaqueId(), role: inputRole(request), mediaType: request.mediaType,
			byteLength: request.byteLength, sha256: request.sha256, maximumByteLength: null,
			producer: null,
		});
		const outputHandle = (request) => {
			const custody = {
				custodyVersion: 1, workflowId: request.workflowId, direction: 'output',
				jobId: request.jobId, stageId: request.stageId, slotId: request.slotId,
				claimId: opaqueId(), role: outputRole(request.slotId),
				mediaType: outputMediaType(request.slotId),
				byteLength: null, sha256: null, maximumByteLength: request.maximumByteLength,
				producer: null,
			};
			outputReservations.set(custody.claimId, custody);
			return handle(custody);
		};
		const custody = Object.freeze({
			stageInput: async (request) => {
				state.stagedSlots.push(`${request.stageId}:${request.slotId}`);
				const body = request.bytes.slice(0, request.bytes.size, request.mediaType);
				state.latestInput = body;
				state.stagedInputBodies.set(
					`${request.jobId}:${request.stageId}:${request.slotId}`, body,
				);
				return inputHandle(request);
			},
			reserveOutput: async (request) => outputHandle(request),
			bindProducer: async (request) => {
				const producer = outputReservations.get(request.producer.claimId);
				if (!producer) throw new Error('Fixture producer reservation is unavailable.');
				return handle({ ...producer, direction: 'input', stageId: request.stageId,
					slotId: request.slotId, byteLength: null, sha256: null,
					producer: { stageId: request.producer.stageId, slotId: request.producer.slotId,
						claimId: request.producer.claimId } });
			},
			release: async () => true,
		});
		const workflow = Object.freeze({
			custody,
			createJob: async () => Object.freeze({ contractVersion: 1, jobId: opaqueId() }),
			run: async (request) => {
				state.requests.set(request.jobId, request);
				const ranges = request.fence.sourceRanges.map((range) => (
					`${range.sourceId}:${String(range.sourceStartFrame)}-${String(range.sourceEndFrame)}`
				)).join(', ');
				const modelText = request.models.map((model) => (
					`${model.modelId}@${model.version}`
				)).join(', ') || 'none';
				const message = ['Local Assistance consent', `Workflow: ${request.workflowId}`,
					`Selection: ${ranges}`, `Stages: ${request.stageIds.join(', ')}`,
					`Models: ${modelText}`,
					`Outputs: ${request.outputs.map(({ slotId }) => slotId).join(', ')}`].join('\n');
				state.consents.push(message);
				if (!globalThis.confirm(message)) return Object.freeze({ contractVersion: 1,
					jobId: request.jobId, workflowId: request.workflowId,
					outcome: 'consent-declined' });
				setTimeout(() => {
					const progress = Object.freeze({ contractVersion: 1, jobId: request.jobId,
						workflowId: request.workflowId, sequence: 0, stageId: request.stageIds[0],
						stageIndex: 0, stageCount: request.stageIds.length, phase: 'running',
						completed: 1, total: 4 });
					state.progressEvents += 1;
					for (const listener of workflowListeners) listener(progress);
				}, 0);
				return await new Promise((resolve) => {
					state.completeRun = () => {
						state.completeRun = () => undefined;
						resolve(Object.freeze({ contractVersion: 1, jobId: request.jobId,
							workflowId: request.workflowId, outcome: 'completed', result: Object.freeze({
								contractVersion: 1, jobId: request.jobId, workflowId: request.workflowId,
								stageIds: request.stageIds, outputs: request.outputs,
							}) }));
					};
				});
			},
			cancel: async (jobId) => Object.freeze({ contractVersion: 1, jobId,
				outcome: 'cancelled' }),
			readOutput: async ({ claim: outputClaim }) => {
				if (!outputReservations.has(outputClaim.claimId)) {
					throw new Error('Fixture output custody is unavailable.');
				}
				const request = state.requests.get(outputClaim.jobId);
				if (!request) throw new Error('Fixture workflow authority is unavailable.');
				return workflowOutput(request, outputClaim.slotId);
			},
			onProgress: (listener) => {
				workflowListeners.add(listener);
				return () => workflowListeners.delete(listener);
			},
		});
		const semanticSearch = Object.freeze({
			open: async ({ schemaFamily, schemaVersion, projectId, projectRevision }) => Object.freeze({ sessionVersion: 1,
				sessionId: 'aa'.repeat(20), schemaFamily, schemaVersion, projectId, projectRevision,
				expiresAtEpochMs: Date.now() + 60_000 }),
			authorize: async ({ session }) => session,
			revoke: async () => true,
			query: async ({ queryId, provider }) => {
				state.queryCalls += 1;
				return Object.freeze({ queryVersion: 1, queryId, outcome: 'completed', provider,
					embedding: normalizedVector() });
			},
			cancelQuery: async () => false,
		});
		const localAssistance = Object.freeze({
			models: async () => { state.modelCalls += 1; return runtimeModels; },
			createJob: async () => Object.freeze({ contractVersion: 1, jobId: opaqueId() }),
			stageInput: async () => { throw new Error('Primitive staging is not used.'); },
			reserveOutput: async () => { throw new Error('Primitive reservation is not used.'); },
			run: async () => { throw new Error('Primitive inference is not used.'); },
			cancel: async (jobId) => Object.freeze({ contractVersion: 1, jobId,
				outcome: 'not-active' }),
			readOutput: async () => { throw new Error('Primitive output is not used.'); },
			release: async () => true,
			onProgress: () => () => undefined,
			semanticSearch,
			workflow,
		});
		const bridge = Object.freeze({
			getEnvironment: async () => null, signalReady: async () => undefined,
			setLocale: async () => undefined, onMenuCommand: () => () => undefined,
			onOpenProject: () => () => undefined, onCloseRequested: () => () => undefined,
			onWindowStateChanged: () => () => undefined,
			readNativeTierControls: async () => Object.freeze({ probeHelperEnabled: false,
				probeHelperQuarantined: false, audioHelperEnabled: false,
				audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false }),
			applyNativeTierControl: async () => { throw new Error('Unsupported by fixture.'); },
			listAssistanceModels: async () => Object.freeze({ runtimeAvailable: true,
				runtimeReason: null, models: Object.freeze([]) }),
			installAssistanceModel: async () => { throw new Error('Models are preinstalled by fixture.'); },
			cancelAssistanceModelInstall: async (modelId) => Object.freeze({ contractVersion: 1,
				modelId, outcome: 'not-active' }),
			installPreseededAssistanceModel: async () => null,
			reconcileAssistanceModels: async () => Object.freeze({ installedModelIds: [],
				incompleteModelIds: [], rejected: [] }),
			collectAssistanceModelGarbage: async () => Object.freeze({ reclaimedBlobBytes: 0,
				discardedManifestCount: 0, discardedPartialCount: 0, discardedPartialBytes: 0,
				reclaimedBytes: 0 }),
			listAssistanceModelNotices: async () => Object.freeze([]),
			relocateAssistanceModels: async () => null,
			removeAssistanceModel: async () => 0,
			onAssistanceInstallProgress: () => () => undefined,
			localAssistance,
		});
		Object.defineProperty(globalThis, '__milestone7Fixture', { configurable: true, value: state });
		Object.defineProperty(globalThis, 'soundscaperDesktop', {
			configurable: true, value: Object.freeze({ v1: bridge }),
		});

		function outputMediaType(slotId) {
			if (['dialogue', 'music', 'effects', 'enhanced-audio', 'dereverberated-audio']
				.includes(slotId)) return 'audio/wav';
			if (slotId === 'frame-pack') return 'application/vnd.soundscaper.frame-pack';
			if (['embeddings', 'visual-embeddings'].includes(slotId)) {
				return 'application/vnd.soundscaper.embedding-matrix-v1';
			}
			return `application/vnd.soundscaper.${slotId}+json`;
		}
		function outputRole(slotId) {
			if (['dialogue', 'music', 'effects'].includes(slotId)) return 'separated-audio';
			if (slotId === 'dereverberated-audio') return 'enhanced-audio';
			if (slotId === 'visual-embeddings') return 'embeddings';
			return slotId;
		}
		function inputRole(request) {
			if (request.workflowId !== 'make-highlights' || request.stageId !== 'gather-signals') {
				return request.slotId;
			}
			return `highlight-${request.slotId}-signals`;
		}
		async function workflowOutput(request, slotId) {
			if (['enhanced-audio', 'dereverberated-audio', 'dialogue', 'music', 'effects']
				.includes(slotId)) {
				if (!(state.latestInput instanceof Blob) || state.latestInput.type !== 'audio/wav') {
					throw new Error('Fixture audio audition custody is unavailable.');
				}
				return state.latestInput.slice(0, state.latestInput.size, 'audio/wav');
			}
			const matrix = embeddingMatrix();
			const matrixSha256 = await digest(matrix);
			const audio = request.fence.sourceRanges.find(({ mediaKind }) => mediaKind === 'audio');
			const video = request.fence.sourceRanges.find(({ mediaKind }) => mediaKind === 'video');
			const sourceStart = audio?.sourceStartFrame ?? 0;
			const sourceEnd = Math.max(sourceStart + 1, audio?.sourceEndFrame ?? 48_000);
			const videoStart = video?.sourceStartFrame ?? 0;
			const videoEnd = Math.max(videoStart + 2, video?.sourceEndFrame ?? 24);
			const highlightSignals = request.workflowId === 'make-highlights'
				? await stagedJson(request.jobId, 'gather-signals', 'video') : null;
			const sampleFrame = Math.min(videoEnd - 1, videoStart + 10);
			const timelineFrame = 12_000;
			const captionEnd = Math.min(sourceEnd, sourceStart + 24_000);
			const values = {
				captions: { schemaVersion: 1, kind: 'captions', sourceId: audio?.sourceId,
					sampleRate: audio?.sourceSampleRate ?? 48_000, alignmentApplied: false,
					cues: [{ cueId: 'caption:0', startFrame: sourceStart, endFrame: captionEnd,
						text: 'Launch plan from the interview.', words: [] }] },
				'beat-labels': { schemaVersion: 1, kind: 'beat-labels',
					publicationRequested: request.settings.publishBeatLabels,
					points: [{ id: 'beat-grid:downbeat:0', kind: 'downbeat', label: 'Downbeat',
						sample: 0, confidence: 0.9, selected: false }] },
				'tempo-map-diff': { schemaVersion: 1, kind: 'tempo-map-diff',
					applicationRequested: request.settings.applyTempoMap,
					proposal: { kind: 'constant', bpm: 120 } },
				'transcript-index': { schemaVersion: 1, kind: 'transcript-index',
					sourceId: audio?.sourceId, sampleRate: audio?.sourceSampleRate ?? 48_000,
					embedding: { schemaVersion: 1, byteLength: matrix.byteLength,
						sha256: matrixSha256, rowCount: 1, dimensions: 768 },
					rows: [{ resultId: 'transcript:0', timelineFrame, sourceEndFrame: sourceEnd,
						segmentStartIndex: 0, segmentEndIndexExclusive: 1,
						label: 'spoken launch plan', embeddingRow: 0 }] },
				'video-index': videoIndex(video, matrix, matrixSha256, sampleFrame, timelineFrame),
				'reframe-path': reframePath(request, videoStart, videoEnd),
				'highlight-proposals': request.workflowId === 'make-highlights'
					? highlightProposals(request, highlightSignals) : null,
			};
			if (slotId === 'embeddings' || slotId === 'visual-embeddings') {
				return new Blob([matrix], { type: outputMediaType(slotId) });
			}
			if (slotId === 'shot-boundaries') return jsonBlob({ schemaVersion: 1,
				detector: 'ffmpeg-scdet', timescale: 12_800, sourceFrameCount: videoEnd,
				boundaries: [{ sourceFrame: sampleFrame, presentationTick: String(sampleFrame), score: 0.9 }],
			}, slotId);
			if (!(slotId in values)) return jsonBlob({ schemaVersion: 1 }, slotId);
			return jsonBlob(values[slotId], slotId);
		}
		function videoIndex(video, matrix, sha256, sourceFrame, timelineFrame) {
			const sample = { resultId: 'visual-sample:0', shotId: 'shot:000000', anchor: 'midpoint',
				sourceFrame, timelineFrame };
			return { schemaVersion: 1, kind: 'video-index', sourceId: video?.sourceId,
				timescale: 12_800, sampleAuthority: [sample], embedding: { schemaVersion: 1,
					byteLength: matrix.byteLength, sha256, rowCount: 1, dimensions: 768 },
				records: { schemaVersion: 1, tagTaxonomyVersion: 1,
					visual: [{ recordVersion: 1, ...sample, embeddingRow: 0,
						tags: [{ tag: 'presentation', score: 0.9 }] }],
					ocr: [{ recordVersion: 1, ...sample, text: 'Launch Plan', confidence: 0.95 }] },
				rows: { visual: [{ resultId: sample.resultId, timelineFrame,
					label: 'presentation' }], ocr: [{ resultId: sample.resultId, timelineFrame,
					label: 'Launch Plan' }] } };
		}
		function reframePath(request, start, end) {
			const left = 0.341796875;
			return { schemaVersion: 1, kind: 'reframe-path', authority: { width: 1_920,
				height: 1_080, timescale: 12_800, frames: [
					{ sourceFrame: start, presentationTick: String(start) },
					{ sourceFrame: end - 1, presentationTick: String(end - 1) },
				] }, fallbackChain: ['subject', 'saliency', 'center'], path: { schemaVersion: 1,
				targetAspect: { width: request.settings.targetAspectWidth,
					height: request.settings.targetAspectHeight }, keyframes: [crop(start, left),
					crop(end - 1, left)] } };
		}
		function highlightProposals(request, signals) {
			const rows = signals?.sourceTimeAuthority;
			if (!Array.isArray(rows) || rows.length < 2
				|| rows.some((row) => row?.kind === 'source-time-rows')) {
				throw new Error('Fixture highlight timing authority is unavailable.');
			}
			const start = rows[0];
			const end = rows.at(-1);
			if (start.timelineFrame !== signals.selectionStartFrame
				|| end.timelineFrame !== signals.selectionEndFrame) {
				throw new Error('Fixture highlight timing authority lost its admitted endpoints.');
			}
			return { schemaVersion: 1, kind: 'highlight-proposals', workflowId: 'make-highlights',
				targetAspect: { width: 9, height: 16 }, proposals: [{ id: 'highlight-a',
					startFrame: start.timelineFrame, endFrame: end.timelineFrame,
					sourceStartFrame: start.sourceFrame, sourceEndFrame: end.sourceFrame,
					score: 0.8, evidenceMode: 'transcript', transcriptExcerpt: 'Exact transcript cue.',
					visualSummary: 'Presenter beside the launch plan.', selected: false,
					videoOccurrenceId: request.fence.sourceRanges.find(({ mediaKind }) =>
						mediaKind === 'video')?.occurrenceIds[0],
					audioOccurrenceId: request.fence.sourceRanges.find(({ mediaKind }) =>
						mediaKind === 'audio')?.occurrenceIds[0] ?? null,
					title: 'Launch plan highlight', hook: 'A concise opening hook.',
					chapters: ['Opening'], explanation: 'Selected from authenticated evidence.',
					cropKeyframes: [crop(start.sourceFrame, 0.341796875),
						crop(end.sourceFrame - 1, 0.341796875)] }] };
		}
		async function stagedJson(jobId, stageId, slotId) {
			const body = state.stagedInputBodies.get(`${jobId}:${stageId}:${slotId}`);
			if (!(body instanceof Blob)) throw new Error('Fixture staged JSON body is unavailable.');
			return JSON.parse(await body.text());
		}
		function crop(sourceFrame, left) {
			return { sourceFrame, authority: 'center', trackIds: [],
				crop: { left, top: 0, right: 1 - 0.31640625 - left, bottom: 0 } };
		}
		function embeddingMatrix() {
			const magic = new TextEncoder().encode('soundscaper-embedding-matrix-v1\n');
			const result = new Uint8Array(magic.byteLength + 16 + 768 * 4);
			result.set(magic);
			const view = new DataView(result.buffer);
			view.setUint32(magic.byteLength, 1, true);
			view.setUint32(magic.byteLength + 4, 1, true);
			view.setUint32(magic.byteLength + 8, 768, true);
			view.setUint32(magic.byteLength + 12, 1, true);
			view.setFloat32(magic.byteLength + 16, 1, true);
			return result;
		}
		function normalizedVector() {
			return Array.from({ length: 768 }, (_value, index) => index === 0 ? 1 : 0);
		}
		async function digest(bytes) {
			const value = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
			return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
		}
		function jsonBlob(value, slotId) {
			return new Blob([JSON.stringify(value)], { type: outputMediaType(slotId) });
		}
	}, { models: MODELS });
}

export async function completeMilestone7Run(page) {
	await page.evaluate(() => globalThis.__milestone7Fixture.completeRun());
}

export async function milestone7FixtureSnapshot(page) {
	return page.evaluate(async () => {
		const state = globalThis.__milestone7Fixture;
		const stagedVideo = [...state.stagedInputBodies.entries()]
			.filter(([key]) => key.endsWith(':gather-signals:video')).at(-1)?.[1];
		const signals = stagedVideo instanceof Blob ? JSON.parse(await stagedVideo.text()) : null;
		return {
			consents: [...state.consents], highlightSourceTimeRows: signals?.sourceTimeAuthority ?? [],
			modelCalls: state.modelCalls, progressEvents: state.progressEvents,
			queryCalls: state.queryCalls, stagedSlots: [...state.stagedSlots],
			workflowFences: [...state.requests.values()]
				.map(({ workflowId, fence }) => ({ workflowId, fence })),
		};
	});
}
