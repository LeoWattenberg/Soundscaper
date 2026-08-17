import {
	calculateAudioSpectrum,
	findAudioClippingRegions,
} from '../analysis.js';
import { measureBextLoudness } from '../broadcast-loudness.ts';
import type { DeliveryReport } from '../delivery-report.ts';
import {
	createLoudnessMeasurementReport,
	loudnessMeasurementScope,
} from '../loudness-measurement-report.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import { isEditorDisposedError } from './lifecycle.ts';

export interface AnalysisRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface AnalysisAudioBuffer {
	readonly sampleRate: number;
	readonly numberOfChannels: number;
	readonly length: number;
	getChannelData(channel: number): Float32Array;
}

interface AnalysisCopy {
	readonly analysisRendering: string;
	readonly analysisCached: string;
	readonly contrastAnalyzing: string;
	readonly contrastForegroundRole: string;
	readonly contrastBackgroundRole: string;
	readonly contrastStored: string;
	readonly done: string;
	readonly timeSelectionRequired: string;
	readonly contrastRoleInvalid: string;
	readonly unsupportedAnalysisReport: string;
	readonly measuringLoudness: string;
	readonly loudnessMeasured: string;
}

interface AnalysisProjectIdentity {
	readonly id: string;
	readonly revision: number;
	readonly clips: readonly unknown[];
}

interface ContrastSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly rmsDb: number;
	readonly scope: string;
}

export type AnalysisRepeatRequest = Readonly<
	| { readonly type: 'levels'; readonly scope: string }
	| { readonly type: 'spectrum' | 'clipping'; readonly scope: string; readonly options: Readonly<Record<string, unknown>> }
	| { readonly type: 'contrast'; readonly role: string; readonly scope: string; readonly options: Readonly<Record<string, unknown>> }
>;

export interface AnalysisState {
	lastAnalysisRequest: AnalysisRepeatRequest | null;
	/** Where a loudness measurement publishes its report, alongside delivery's. */
	deliveryReport?: unknown;
}

interface AnalysisDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly copy: AnalysisCopy;
	readonly state: AnalysisState;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	getProject(): AnalysisProjectIdentity;
	getSelectedTrackId(): string | null;
	getRange(): AnalysisRange;
	getActiveSelection(): AnalysisRange | null;
	getSpectrumWindowSize(): number;
	getContrastSelections(): Readonly<{ foreground: ContrastSelection | null; background: ContrastSelection | null }>;
	setContrastSelections(value: Readonly<{ foreground: ContrastSelection | null; background: ContrastSelection | null }>): void;
	loadAnalysis(key: string): Promise<StoredAnalysis | null>;
	saveAnalysis(key: string, value: StoredAnalysis): Promise<unknown>;
	renderAudio(scope: string, range: AnalysisRange, signal: AbortSignal): Promise<AnalysisAudioBuffer>;
	analyzeChannels(channels: Float32Array[], sampleRate: number, signal: AbortSignal): Promise<Record<string, unknown>>;
	createVisuals(channels: Float32Array[], sampleRate: number): unknown;
	showAnalysis(result: unknown, visuals?: unknown, report?: unknown): void;
	setProcessing(processing: boolean): void;
	setStatus(message: string, status?: string): void;
	publish(): void;
	handleError(error: unknown): void;
}

interface StoredAnalysis {
	readonly result: Record<string, unknown>;
	readonly visuals: unknown;
	readonly report: unknown;
	readonly createdAt?: string;
}

export function createAudioAnalysisService(dependencies: AnalysisDependencies) {
	const {
		lifetime,
		copy,
	} = dependencies;

	return Object.freeze({
		run,
		plotSpectrum: (scope = 'master') => runSpecialized('spectrum', scope),
		findClipping: (scope = 'master', options: Record<string, unknown> = {}) => runSpecialized('clipping', scope, options),
		captureContrast,
		measureLoudness,
		repeatLast,
		cancel: () => lifetime.cancelTask('analysis'),
	});

	function repeatLast(): Promise<unknown> {
		const request = dependencies.state.lastAnalysisRequest;
		if (!request) return Promise.resolve(null);
		if (request.type === 'levels') return run(request.scope);
		if (request.type === 'contrast') return captureContrast(request.role, request.scope, request.options);
		return runSpecialized(request.type, request.scope, request.options);
	}

	async function run(scope = 'master'): Promise<unknown> {
		const project = dependencies.getProject();
		if (!project.clips.length) return null;
		const projectToken = dependencies.captureProject();
		const task = begin(copy.analysisRendering);
		const range = dependencies.getRange();
		const key = [
			'audio-editor-analysis-v1',
			project.id,
			project.revision,
			scope,
			scope === 'track' ? dependencies.getSelectedTrackId() : 'master',
			range.startFrame,
			range.endFrame,
		].join(':');
		try {
			const cached = await dependencies.loadAnalysis(key);
			assertCurrent(task, projectToken);
			if (cached?.result) {
				dependencies.showAnalysis(cached.result, cached.visuals, cached.report || levelsReport(scope, range));
				remember({ type: 'levels', scope });
				dependencies.setStatus(copy.analysisCached, 'success');
				return cached.result;
			}
			const { channels, sampleRate, result } = await renderAndAnalyze(scope, range, task, projectToken);
			const visuals = dependencies.createVisuals(channels, sampleRate);
			const report = levelsReport(scope, range);
			await dependencies.saveAnalysis(key, {
				result,
				visuals,
				report,
				createdAt: new Date().toISOString(),
			});
			assertCurrent(task, projectToken);
			dependencies.showAnalysis(result, visuals, report);
			remember({ type: 'levels', scope });
			dependencies.setStatus(copy.done, 'success');
			return result;
		} catch (error) {
			handleTaskError(error);
			return null;
		} finally {
			finish(task);
		}
	}

	async function runSpecialized(type: 'spectrum' | 'clipping', scope: string, options: Record<string, unknown> = {}) {
		if (!dependencies.getProject().clips.length) return null;
		const projectToken = dependencies.captureProject();
		const task = begin(copy.analysisRendering);
		try {
			const range = dependencies.getRange();
			const { channels, sampleRate, result } = await renderAndAnalyze(scope, range, task, projectToken);
			const report = type === 'spectrum'
				? spectrumReport(scope, range, channels, sampleRate, {
					...options,
					size: options.size ?? dependencies.getSpectrumWindowSize(),
				})
				: clippingReport(scope, range, channels, options);
			dependencies.showAnalysis(result, dependencies.createVisuals(channels, sampleRate), report);
			remember({ type, scope, options: Object.freeze({ ...options }) });
			dependencies.setStatus(copy.done, 'success');
			return report;
		} catch (error) {
			handleTaskError(error);
			return null;
		} finally {
			finish(task);
		}
	}

	async function captureContrast(role = 'foreground', scope = 'master', options: Record<string, unknown> = {}) {
		if (role !== 'foreground' && role !== 'background') throw new RangeError(copy.contrastRoleInvalid);
		const projectToken = dependencies.captureProject();
		const task = begin(copy.contrastAnalyzing);
		const selection = dependencies.getActiveSelection();
		if (!selection) {
			finish(task);
			const error = new Error(copy.timeSelectionRequired);
			dependencies.handleError(error);
			return null;
		}
		try {
			const { channels, sampleRate, result } = await renderAndAnalyze(scope, selection, task, projectToken);
			const rmsDb = Number(result.rmsDbfs);
			const selections = {
				...dependencies.getContrastSelections(),
				[role]: Object.freeze({ ...selection, rmsDb, scope }),
			};
			dependencies.setContrastSelections(selections);
			const foreground = selections.foreground;
			const background = selections.background;
			const minimumDifferenceDb = Number(options.minimumDifferenceDb ?? 20);
			const differenceDb = foreground && background ? foreground.rmsDb - background.rmsDb : null;
			const report = Object.freeze({
				type: 'contrast',
				foreground,
				background,
				minimumDifferenceDb,
				differenceDb,
				passes: Number.isFinite(differenceDb) ? Number(differenceDb) >= minimumDifferenceDb : null,
			});
			dependencies.showAnalysis(result, dependencies.createVisuals(channels, sampleRate), report);
			remember({ type: 'contrast', role, scope, options: Object.freeze({ ...options }) });
			const roleLabel = role === 'foreground' ? copy.contrastForegroundRole : copy.contrastBackgroundRole;
			dependencies.setStatus(copy.contrastStored.replace('{role}', roleLabel), 'success');
			return report;
		} catch (error) {
			handleTaskError(error);
			return null;
		} finally {
			finish(task);
		}
	}

	/**
	 * Measure the loudness of the mix, or of the selection when there is one.
	 *
	 * It lives beside the other analyzers because it is one: it renders through
	 * the same offline path they do, so the numbers describe the mix as a
	 * delivery would render it rather than as a second render path imagines it.
	 * Nothing here writes a file and nothing here applies a gain — this command
	 * exists to tell the truth about what is already there, and what a delivery
	 * should do about the number is the delivery's decision to report.
	 *
	 * The answer is published as a sealed report on the surface an operator
	 * already reads for delivery facts, with `loudness-measurement` as its
	 * subject so nothing mistakes it for a delivery that happened.
	 */
	async function measureLoudness(): Promise<DeliveryReport | null> {
		const project = dependencies.getProject();
		if (!project.clips.length) return null;
		const projectToken = dependencies.captureProject();
		const task = begin(copy.measuringLoudness);
		const range = dependencies.getRange();
		try {
			if (!(range.endFrame > range.startFrame)) throw new RangeError(copy.timeSelectionRequired);
			const rendered = await dependencies.renderAudio('master', range, task.signal);
			assertCurrent(task, projectToken);
			const channels = Array.from(
				{ length: rendered.numberOfChannels },
				(_, channel) => rendered.getChannelData(channel),
			);
			const report = createLoudnessMeasurementReport({
				measurement: measureBextLoudness(channels, rendered.sampleRate),
				sampleRate: rendered.sampleRate,
				channelCount: channels.length,
				range,
				scope: loudnessMeasurementScope(dependencies.getActiveSelection()),
			});
			assertCurrent(task, projectToken);
			dependencies.state.deliveryReport = report;
			dependencies.setStatus(copy.loudnessMeasured, 'success');
			return report;
		} catch (error) {
			handleTaskError(error);
			return null;
		} finally {
			finish(task);
		}
	}

	async function renderAndAnalyze(
		scope: string,
		range: AnalysisRange,
		task: EditorTaskScope,
		projectToken: EditorProjectToken,
	) {
		const rendered = await dependencies.renderAudio(scope, range, task.signal);
		assertCurrent(task, projectToken);
		const channels = Array.from({ length: rendered.numberOfChannels }, (_, channel) => rendered.getChannelData(channel));
		const result = await dependencies.analyzeChannels(channels, rendered.sampleRate, task.signal);
		assertCurrent(task, projectToken);
		return { channels, sampleRate: rendered.sampleRate, result };
	}

	function assertCurrent(task: EditorTaskScope, projectToken: EditorProjectToken): void {
		task.assertCurrent();
		dependencies.assertProject(projectToken);
	}

	function begin(message: string): EditorTaskScope {
		const task = lifetime.startTask('analysis');
		dependencies.setProcessing(true);
		dependencies.setStatus(message);
		dependencies.publish();
		return task;
	}

	function finish(task: EditorTaskScope): void {
		try {
			task.assertCurrent();
			dependencies.setProcessing(false);
			dependencies.publish();
		} catch {
			// Replaced work never owns the newer task's busy state.
		} finally {
			task.finish();
		}
	}

	function handleTaskError(error: unknown): void {
		if (!isAbortError(error) && !isEditorDisposedError(error)) dependencies.handleError(error);
	}

	function remember(request: AnalysisRepeatRequest): void {
		dependencies.state.lastAnalysisRequest = Object.freeze(request);
	}
}

function levelsReport(scope: string, range: AnalysisRange) {
	return Object.freeze({ type: 'levels', scope, ...range });
}

function spectrumReport(
	scope: string,
	range: AnalysisRange,
	channels: Float32Array[],
	sampleRate: number,
	options: Record<string, unknown>,
) {
	const size = normalizeSpectrumSize(options.size);
	const spectrum = calculateAudioSpectrum(channels, sampleRate, { size });
	type SpectrumBin = (typeof spectrum.bins)[number];
	const peak = spectrum.bins.reduce<SpectrumBin | null>(
		(best, bin) => !best || bin.amplitude > best.amplitude ? bin : best,
		null,
	);
	return Object.freeze({ type: 'spectrum', scope, ...range, sampleRate: spectrum.sampleRate, size: spectrum.size, bins: spectrum.bins, peak });
}

function clippingReport(
	scope: string,
	range: AnalysisRange,
	channels: Float32Array[],
	options: Record<string, unknown>,
) {
	const threshold = Number(options.threshold ?? 1);
	const minimumConsecutiveSamples = Number(options.minimumConsecutiveSamples ?? 3);
	const regions = findAudioClippingRegions(channels, { threshold, minimumConsecutiveSamples })
		.map((region) => Object.freeze({
			...region,
			startFrame: region.startFrame + range.startFrame,
			endFrame: region.endFrame + range.startFrame,
		}));
	return Object.freeze({
		type: 'clipping',
		scope,
		...range,
		threshold,
		minimumConsecutiveSamples,
		regions: Object.freeze(regions),
		regionCount: regions.length,
		clippedSamples: regions.reduce((sum, region) => sum + region.clippedSamples, 0),
	});
}

function normalizeSpectrumSize(value: unknown): number {
	const requested = Math.max(32, Math.min(65_536, Math.round(Number(value) || 2_048)));
	return 2 ** Math.round(Math.log2(requested));
}

function isAbortError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}
