/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioBufferChannels, type RenderedAudio } from '../../rendered-audio-channels.ts';
import {
	VAMP_ANALYSIS_MAXIMUM_FEATURES,
	normalizeVampAnalysisRequest,
	normalizeVampAnalysisResult,
	normalizeVampAnalyzerCatalog,
	type VampAnalysisFeature,
	type VampAnalysisRequest,
	type VampAnalysisResult,
	type VampAnalyzerDescriptor,
	type VampTimestamp,
} from '../../vamp-analysis.ts';

const BRIDGE_METHODS = Object.freeze([
	'listNativeVampAnalyzers', 'startNativeVampAnalyzer', 'configureNativeVampAnalyzer',
	'pushNativeVampAnalyzerPcm', 'finishNativeVampAnalyzer', 'cancelNativeVampAnalyzer',
] as const);
const CONFIGURED_SESSION_KEYS = Object.freeze([
	'kind', 'format', 'sessionId', 'analyzerId', 'installationId', 'binarySha256', 'state',
	'processedFrames', 'totalFrames', 'outputs',
] as const);
const NATIVE_OUTPUT_KEYS = Object.freeze([
	'identifier', 'name', 'description', 'unit', 'binCount', 'binNames', 'extents',
	'quantizeStep', 'sampleType', 'sampleRate', 'hasDuration',
] as const);
const CHUNK_FRAMES = 65_536;

interface NativeVampBridge {
	listNativeVampAnalyzers(): Promise<unknown>;
	startNativeVampAnalyzer(value: unknown): Promise<unknown>;
	configureNativeVampAnalyzer(value: unknown): Promise<unknown>;
	pushNativeVampAnalyzerPcm(value: unknown): Promise<unknown>;
	finishNativeVampAnalyzer(value: unknown): Promise<unknown>;
	cancelNativeVampAnalyzer(value: unknown): Promise<unknown>;
}

interface VampActionEngine {
	renderTrack(trackId: unknown, options: Readonly<Record<string, unknown>>): Promise<RenderedAudio>;
	renderMix(options: Readonly<Record<string, unknown>>): Promise<RenderedAudio>;
}

interface VampActionProject { readonly id: string; readonly revision: number }

interface NativeCatalogConfiguration {
	readonly inputDomain: 'time' | 'frequency';
	readonly minimumChannels: number;
	readonly maximumChannels: number;
	readonly preferredStepSize: number;
	readonly preferredBlockSize: number;
}

interface NativeCatalogRow extends VampAnalyzerDescriptor {
	readonly configuration: Readonly<NativeCatalogConfiguration>;
}

export interface DesktopVampAnalysisInput {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly selectedTrackId: string | null;
	readonly request: Readonly<VampAnalysisRequest>;
}

export interface DesktopVampAnalysisAction {
	list(): Promise<readonly Readonly<VampAnalyzerDescriptor>[]>;
	analyze(input: Readonly<DesktopVampAnalysisInput>, signal: AbortSignal): Promise<Readonly<VampAnalysisResult>>;
}

export function createDesktopVampAnalysisAction(options: Readonly<{
	bridge: unknown;
	engine: VampActionEngine;
	getProject: () => unknown;
}>): Readonly<DesktopVampAnalysisAction> | null {
	const bridge = admitBridge(options.bridge);
	if (bridge === null) return null;
	let configurations = new Map<string, Readonly<NativeCatalogRow>>();
	const loadCatalog = async (): Promise<readonly Readonly<VampAnalyzerDescriptor>[]> => {
		const rows = admitNativeCatalog(await bridge.listNativeVampAnalyzers());
		configurations = new Map(rows.map((row) => [catalogKey(row), row]));
		return normalizeVampAnalyzerCatalog(rows.map(stripConfiguration));
	};
	return Object.freeze({
		list: loadCatalog,
		async analyze(
			inputValue: Readonly<DesktopVampAnalysisInput>,
			signal: AbortSignal,
		): Promise<Readonly<VampAnalysisResult>> {
			const input = admitInput(inputValue);
			const request = normalizeVampAnalysisRequest(input.request);
			assertProject(options.getProject(), input.projectId, input.projectRevision);
			signal.throwIfAborted();
			const catalog = await loadCatalog();
			const row = configurations.get(catalogKey(request));
			if (row === undefined || !catalog.some((candidate) => catalogKey(candidate) === catalogKey(request))) {
				throw new Error('The selected Vamp analyzer installation is no longer available.');
			}
			if (!row.outputs.some(({ id }) => id === request.outputId)) {
				throw new Error('The selected Vamp output is no longer available.');
			}
			const rendered = await renderSelection(options.engine, input, request);
			signal.throwIfAborted();
			assertProject(options.getProject(), input.projectId, input.projectRevision);
			const channels = admitRenderedChannels(rendered, request.endFrame - request.startFrame,
				row.configuration);
			const sizes = analysisSizes(row.configuration);
			let sessionId: string | null = null;
			let finished = false;
			let cancellation: Promise<void> | null = null;
			const scheduleCancellation = (reason: string): void => {
				if (sessionId === null || finished || cancellation !== null) return;
				const activeSessionId = sessionId;
				cancellation = Promise.resolve().then(async () => {
					await bridge.cancelNativeVampAnalyzer({ sessionId: activeSessionId, reason });
				}).catch(() => undefined);
			};
			const abortListener = (): void => { scheduleCancellation('renderer-aborted'); };
			try {
				const started = record(await bridge.startNativeVampAnalyzer({
					analyzerId: request.analyzerId, stableId: request.stableId,
					binarySha256: request.binarySha256, sessionId: null,
				}), 'Vamp analyzer start result');
				sessionId = runtimeId(started.sessionId, 'Vamp analyzer session');
				signal.addEventListener('abort', abortListener, { once: true });
				signal.throwIfAborted();
				const parameterValues = Object.freeze(Object.fromEntries(
					request.parameters.map(({ id, value }) => [id, value]),
				));
				const configured = await bridge.configureNativeVampAnalyzer({
					sessionId, sampleRate: request.sampleRate, channelCount: channels.length,
					stepSize: sizes.stepSize, blockSize: sizes.blockSize,
					frameCount: request.endFrame - request.startFrame,
					parameters: parameterValues, program: request.program,
				});
				const output = configuredOutput(configured, row, request, sessionId);
				const nativeFeatures: unknown[] = [];
				for (let startFrame = 0; startFrame < channels[0]!.length; startFrame += CHUNK_FRAMES) {
					signal.throwIfAborted();
					assertProject(options.getProject(), input.projectId, input.projectRevision);
					const endFrame = Math.min(channels[0]!.length, startFrame + CHUNK_FRAMES);
					const batch = record(await bridge.pushNativeVampAnalyzerPcm({
						sessionId, startFrame,
						channels: channels.map((channel) => channel.slice(startFrame, endFrame)),
					}), 'Vamp analyzer feature batch');
					appendNativeFeatures(nativeFeatures, batch.features, 'Vamp analyzer features');
					signal.throwIfAborted();
					assertProject(options.getProject(), input.projectId, input.projectRevision);
				}
				const finalBatch = record(await bridge.finishNativeVampAnalyzer({ sessionId }),
					'Vamp analyzer final feature batch');
				finished = true;
				appendNativeFeatures(nativeFeatures, finalBatch.features, 'Vamp analyzer final features');
				signal.throwIfAborted();
				assertProject(options.getProject(), input.projectId, input.projectRevision);
				const features = rendererFeatures(nativeFeatures, output, sizes.stepSize, request.sampleRate);
				return normalizeVampAnalysisResult({ schemaVersion: 1, request, features }, request);
			} finally {
				signal.removeEventListener('abort', abortListener);
				if (sessionId !== null && !finished) {
					scheduleCancellation(signal.aborted ? 'renderer-aborted' : 'renderer-fault');
				}
				if (cancellation !== null) await cancellation;
			}
		},
	});
}

function configuredOutput(
	value: unknown,
	row: Readonly<NativeCatalogRow>,
	request: Readonly<VampAnalysisRequest>,
	sessionId: string,
): Readonly<VampAnalyzerDescriptor['outputs'][number]> {
	const session = exactRecord(value, CONFIGURED_SESSION_KEYS, 'Configured Vamp analyzer session');
	const expectedFrames = request.endFrame - request.startFrame;
	if (session.kind !== 'analyzer-session' || session.format !== 'vamp'
		|| runtimeId(session.sessionId, 'Vamp analyzer session') !== sessionId
		|| session.analyzerId !== request.analyzerId || session.installationId !== request.stableId
		|| session.binarySha256 !== request.binarySha256 || session.state !== 'configured'
		|| integer(session.processedFrames, 0, expectedFrames, 'processed frame count') !== 0
		|| integer(session.totalFrames, 0, Number.MAX_SAFE_INTEGER, 'total frame count') !== expectedFrames) {
		throw new Error('The configured Vamp analyzer session does not match its request.');
	}
	const outputs = array(session.outputs, 'Configured Vamp analyzer outputs').map((valueOutput) => {
		const output = exactRecord(valueOutput, NATIVE_OUTPUT_KEYS, 'Configured Vamp output');
		return Object.freeze({
			id: output.identifier,
			name: output.name,
			description: output.description,
			unit: output.unit,
			sampleType: output.sampleType,
			sampleRate: output.sampleRate,
			hasDuration: output.hasDuration,
		});
	});
	const descriptor = normalizeVampAnalyzerCatalog([{ ...stripConfiguration(row), outputs }])[0]!;
	const selected = descriptor.outputs.find(({ id }) => id === request.outputId);
	if (selected === undefined) {
		throw new Error('The selected Vamp output is no longer available after configuration.');
	}
	return selected;
}

function admitBridge(value: unknown): NativeVampBridge | null {
	if (value === null || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	return BRIDGE_METHODS.every((method) => typeof candidate[method] === 'function')
		? value as NativeVampBridge : null;
}

function admitNativeCatalog(value: unknown): readonly Readonly<NativeCatalogRow>[] {
	const rows = array(value, 'Native Vamp analyzer catalog');
	return Object.freeze(rows.map((valueRow) => {
		const row = record(valueRow, 'Native Vamp analyzer catalog row');
		const configuration = record(row.configuration, 'Native Vamp analyzer configuration');
		if (configuration.inputDomain !== 'time' && configuration.inputDomain !== 'frequency') {
			throw new TypeError('Invalid native Vamp input domain.');
		}
		const admittedConfiguration = Object.freeze({
			inputDomain: configuration.inputDomain,
			minimumChannels: integer(configuration.minimumChannels, 1, 64, 'minimum channel count'),
			maximumChannels: integer(configuration.maximumChannels, 1, 64, 'maximum channel count'),
			preferredStepSize: integer(configuration.preferredStepSize, 0, 1_048_576, 'preferred step size'),
			preferredBlockSize: integer(configuration.preferredBlockSize, 0, 1_048_576, 'preferred block size'),
		});
		if (admittedConfiguration.maximumChannels < admittedConfiguration.minimumChannels) {
			throw new RangeError('Invalid native Vamp channel range.');
		}
		const { configuration: _configuration, ...descriptor } = row;
		const admitted = normalizeVampAnalyzerCatalog([descriptor])[0]!;
		return Object.freeze({ ...admitted, configuration: admittedConfiguration });
	}));
}

function stripConfiguration(row: Readonly<NativeCatalogRow>): Readonly<VampAnalyzerDescriptor> {
	const { configuration: _configuration, ...descriptor } = row;
	return Object.freeze(descriptor);
}

function renderSelection(
	engine: VampActionEngine,
	input: Readonly<DesktopVampAnalysisInput>,
	request: Readonly<VampAnalysisRequest>,
): Promise<RenderedAudio> {
	const options = Object.freeze({
		startFrame: request.startFrame, endFrame: request.endFrame,
		includeTail: false, preRollFrames: Math.min(request.startFrame, request.sampleRate * 10),
	});
	if (request.scope === 'track') {
		if (typeof input.selectedTrackId !== 'string' || input.selectedTrackId.length === 0) {
			throw new Error('Vamp track analysis requires the selected audio track.');
		}
		return engine.renderTrack(input.selectedTrackId, options);
	}
	if (input.selectedTrackId !== null) throw new Error('Vamp master analysis cannot carry a track identity.');
	return engine.renderMix(options);
}

function admitRenderedChannels(
	rendered: RenderedAudio,
	frameCount: number,
	configuration: Readonly<NativeCatalogConfiguration>,
): readonly Float32Array[] {
	const channels = audioBufferChannels(rendered);
	if (channels.length < configuration.minimumChannels || channels.length > configuration.maximumChannels) {
		throw new RangeError('The rendered channel count is outside the Vamp analyzer channel range.');
	}
	if (channels.some((channel) => channel.length !== frameCount)) {
		throw new RangeError('The Vamp analysis render did not preserve the requested range.');
	}
	return Object.freeze(channels);
}

function analysisSizes(configuration: Readonly<NativeCatalogConfiguration>): Readonly<{
	blockSize: number; stepSize: number;
}> {
	let blockSize = configuration.preferredBlockSize || 1_024;
	let stepSize = configuration.preferredStepSize || blockSize;
	if (stepSize > blockSize) blockSize = stepSize;
	if (configuration.inputDomain === 'frequency' && (blockSize & (blockSize - 1)) !== 0) {
		blockSize = 2 ** Math.ceil(Math.log2(blockSize));
	}
	if (blockSize > 1_048_576) throw new RangeError('The Vamp analyzer block size is too large.');
	stepSize = Math.min(stepSize, blockSize);
	return Object.freeze({ blockSize, stepSize });
}

function rendererFeatures(
	values: readonly unknown[],
	output: Readonly<VampAnalyzerDescriptor['outputs'][number]>,
	stepSize: number,
	sampleRate: number,
): readonly Readonly<VampAnalysisFeature>[] {
	let outputIndex = 0;
	const features: Readonly<VampAnalysisFeature>[] = [];
	for (const value of values) {
		const feature = record(value, 'Native Vamp feature');
		if (feature.outputId !== output.id) continue;
		const timestamp = feature.timestamp === null
			? inferredTimestamp(output, outputIndex, stepSize, sampleRate)
			: timestampValue(feature.timestamp);
		features.push(Object.freeze({
			timestamp,
			duration: feature.duration === null ? null : timestampValue(feature.duration),
			values: Object.freeze(array(feature.values, 'Native Vamp feature values').map((item) =>
				finite(item, 'Native Vamp feature value'))),
			label: text(feature.label, 'Native Vamp feature label'),
		}));
		outputIndex += 1;
	}
	return Object.freeze(features);
}

function inferredTimestamp(
	output: Readonly<VampAnalyzerDescriptor['outputs'][number]>,
	index: number,
	stepSize: number,
	sampleRate: number,
): Readonly<VampTimestamp> {
	if (output.sampleType === 'variable-sample-rate') {
		throw new TypeError('A variable-rate Vamp feature omitted its timestamp.');
	}
	if (output.sampleType === 'fixed-sample-rate') {
		if (output.sampleRate === null) throw new TypeError('A fixed-rate Vamp output omitted its rate.');
		const nanoseconds = Math.floor(index * 1_000_000_000 / output.sampleRate);
		return splitNanoseconds(BigInt(nanoseconds));
	}
	return timestampFromFrames(BigInt(index) * BigInt(stepSize), sampleRate);
}

function timestampFromFrames(frames: bigint, sampleRate: number): Readonly<VampTimestamp> {
	return splitNanoseconds(frames * 1_000_000_000n / BigInt(sampleRate));
}

function splitNanoseconds(value: bigint): Readonly<VampTimestamp> {
	return Object.freeze({
		seconds: Number(value / 1_000_000_000n), nanoseconds: Number(value % 1_000_000_000n),
	});
}

function timestampValue(value: unknown): Readonly<VampTimestamp> {
	const candidate = record(value, 'Native Vamp timestamp');
	return Object.freeze({
		seconds: integer(candidate.seconds, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'timestamp seconds'),
		nanoseconds: integer(candidate.nanoseconds, 0, 999_999_999, 'timestamp nanoseconds'),
	});
}

function admitInput(value: unknown): Readonly<DesktopVampAnalysisInput> {
	const input = exactRecord(value, ['projectId', 'projectRevision', 'selectedTrackId', 'request'],
		'Vamp analysis input');
	if (typeof input.projectId !== 'string' || input.projectId.length === 0
		|| !Number.isSafeInteger(input.projectRevision) || Number(input.projectRevision) < 0
		|| (input.selectedTrackId !== null && typeof input.selectedTrackId !== 'string')) {
		throw new TypeError('Invalid Vamp project fence.');
	}
	return input as unknown as Readonly<DesktopVampAnalysisInput>;
}

function assertProject(value: unknown, projectId: string, revision: number): void {
	const project = value as Partial<VampActionProject> | null;
	if (project === null || typeof project !== 'object'
		|| project.id !== projectId || project.revision !== revision) {
		throw new Error('The project changed during Vamp analysis.');
	}
}

function catalogKey(value: Readonly<{ analyzerId: string; stableId: string; binarySha256: string }>): string {
	return `${value.analyzerId}\0${value.stableId}\0${value.binarySha256}`;
}

function exactRecord<const Keys extends readonly string[]>(
	value: unknown, keys: Keys, label: string,
): Record<Keys[number], unknown> {
	const candidate = record(value, label);
	const actual = Object.keys(candidate).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new TypeError(`${label} has invalid keys.`);
	}
	return candidate as Record<Keys[number], unknown>;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
	return value;
}

function appendNativeFeatures(target: unknown[], value: unknown, label: string): void {
	const features = array(value, label);
	if (target.length > VAMP_ANALYSIS_MAXIMUM_FEATURES - features.length) {
		throw new RangeError('Vamp analysis exceeds its renderer feature limit.');
	}
	for (const feature of features) target.push(feature);
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`Invalid ${label}.`);
	}
	return Number(value);
}

function finite(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${label}.`);
	return value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length > 4_096 || value.includes('\0')) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return value;
}

function runtimeId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return value;
}
