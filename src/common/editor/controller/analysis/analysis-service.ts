import { spectrumReport, clippingReport, normalizeSpectrumSize } from '../../specialized-audio-analysis.ts';
import { createLocalizedError, setLocalizedStatus } from '../../../i18n/presentation-message.ts';
import { measureBextLoudness } from '../../broadcast-loudness.ts';
import { EBU_R128_MAXIMUM_CHANNELS } from '../../ebu-r128.js';
import { resolveAdmEbuChannelWeights } from '../../loudness-channel-layout.ts';
import type { DeliveryReport } from '../../delivery-report.ts';
import {
	createLoudnessMeasurementReport,
	loudnessMeasurementScope,
} from '../../loudness-measurement-report.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from '../shared/lifecycle.ts';
import { EDITOR_PROJECT_TASK_SCOPE, EditorProjectChangedError, isEditorDisposedError } from '../shared/lifecycle.ts';

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

export interface AnalysisChannelOptions {
	readonly channelWeights?: readonly number[];
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
	readonly tracks?: readonly unknown[];
	readonly selection?: unknown;
	readonly masterChannels?: number;
	readonly metadata?: Readonly<{ readonly adm?: unknown }>;
}

interface ContrastSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly rmsDb: number;
	readonly scope: string;
}

interface AnalysisRequestSnapshot {
	readonly projectId: string;
	readonly revision: number;
	readonly scope: string;
	readonly selectedTrackId: string | null;
	readonly range: AnalysisRange;
}

export type AnalysisRepeatRequest = Readonly<
	| { readonly type: 'levels'; readonly scope: string }
	| { readonly type: 'loudness'; readonly scope: 'master' }
	| { readonly type: 'spectrum' | 'clipping'; readonly scope: string; readonly options: Readonly<Record<string, unknown>> }
	| { readonly type: 'contrast'; readonly role: string; readonly scope: string; readonly options: Readonly<Record<string, unknown>> }
>;

export interface AnalysisState {
	lastAnalysisRequest: AnalysisRepeatRequest | null;
	/** Where a loudness measurement publishes its report, alongside delivery's. */
	deliveryReport?: unknown;
}

export interface AnalysisDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly copy: AnalysisCopy;
	readonly state: AnalysisState;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	getProject(): AnalysisProjectIdentity;
	getSelectedTrackId(): string | null;
	getRange(): AnalysisRange;
	getActiveSelection(): AnalysisRange | null;
	/** Opt in only when this opaque generation binds all immutable render inputs. */
	captureLoudnessGeneration?(): Readonly<{ generation: object; sampleRate: number }> | null;
	getSpectrumWindowSize(): number;
	getContrastSelections(): Readonly<{ foreground: ContrastSelection | null; background: ContrastSelection | null }>;
	setContrastSelections(value: Readonly<{ foreground: ContrastSelection | null; background: ContrastSelection | null }>): void;
	loadAnalysis(key: string): Promise<unknown>;
	saveAnalysis(key: string, value: StoredAnalysis): Promise<unknown>;
	renderAudio(scope: string, range: AnalysisRange, signal: AbortSignal, selectedTrackId?: string | null): Promise<AnalysisAudioBuffer>;
	analyzeChannels(
		channels: Float32Array[],
		sampleRate: number,
		signal: AbortSignal,
		options?: AnalysisChannelOptions,
	): Promise<Record<string, unknown>>;
	createVisuals(channels: Float32Array[], sampleRate: number): unknown;
	createSpecializedReport?(type: 'spectrum' | 'clipping', scope: string, range: AnalysisRange, channels: Float32Array[], sampleRate: number, options: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<unknown>;
	measureLoudnessChannels?(channels: Float32Array[], sampleRate: number, range: AnalysisRange, channelWeights: readonly number[] | undefined, signal: AbortSignal): Promise<DeliveryReport>;
	showAnalysis(result: unknown, visuals?: unknown, report?: unknown): void;
	setProcessing(processing: boolean): void;
	setStatus(message: string, status?: string, localization?: import('../../../i18n/presentation-message.ts').LocalizedPresentationMessage): void;
	publish(): void;
	batchPresentation?(operation: () => void): void;
	handleError(error: unknown): void;
}

interface StoredAnalysis {
	readonly result: Record<string, unknown>;
	readonly visuals: unknown;
	readonly report: unknown;
	readonly createdAt?: string;
}

export function createAudioAnalysisService(dependencies: AnalysisDependencies) {
	let specializedCache: Readonly<{ key: string; result: unknown; visuals: unknown; report: unknown }> | null = null;
	let loudnessCache: Readonly<{ generation: WeakRef<object>; key: string; report: DeliveryReport }> | null = null;
	const finishedTasks = new WeakSet<EditorTaskScope>();
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
		if (request.type === 'loudness') return measureLoudness();
		if (request.type === 'levels') return run(request.scope);
		if (request.type === 'contrast') return captureContrast(request.role, request.scope, request.options);
		return runSpecialized(request.type, request.scope, request.options);
	}

	async function run(scope = 'master'): Promise<unknown> {
		const project = dependencies.getProject();
		if (!project.clips.length) return null;
		const request = captureRequest(project, scope, dependencies.getRange(), dependencies.getSelectedTrackId());
		const projectToken = dependencies.captureProject();
		const task = begin('analysisRendering');
		const key = [
			'audio-editor-analysis-v2',
			request.projectId,
			request.revision,
			request.scope,
			request.scope === 'track' ? request.selectedTrackId : 'master',
			request.range.startFrame,
			request.range.endFrame,
		].join(':');
		try {
			assertAnalysisChannelAdmission(project);
			const cached = readStoredAnalysis(await dependencies.loadAnalysis(key));
			assertCurrent(task, projectToken, request);
			if (cached?.result) {
				complete(task, () => {
					dependencies.showAnalysis(cached.result, cached.visuals, cached.report || levelsReport(scope, request.range));
					remember({ type: 'levels', scope });
					setLocalizedStatus(dependencies.setStatus, copy, "analysisCached", undefined, 'success');
				});
				return cached.result;
			}
			const { channels, sampleRate, result } = await renderAndAnalyze(request, task, projectToken);
			const visuals = dependencies.createVisuals(channels, sampleRate);
			const report = levelsReport(scope, request.range);
			dependencies.showAnalysis(result, visuals, report);
			await dependencies.saveAnalysis(key, {
				result,
				visuals,
				report,
				createdAt: new Date().toISOString(),
			});
			assertCurrent(task, projectToken, request);
			complete(task, () => {
				remember({ type: 'levels', scope });
				setLocalizedStatus(dependencies.setStatus, copy, "done", undefined, 'success');
			});
			return result;
		} catch (error) {
			handleTaskError(error);
			return null;
		} finally {
			finish(task);
		}
	}

	async function runSpecialized(type: 'spectrum' | 'clipping', scope: string, options: Record<string, unknown> = {}) {
		const project = dependencies.getProject();
		if (!project.clips.length) return null;
		const request = captureRequest(project, scope, dependencies.getRange(), dependencies.getSelectedTrackId());
		const projectToken = dependencies.captureProject();
		const task = begin('analysisRendering');
		try {
			assertAnalysisChannelAdmission(project);
			const reportOptions = type === 'spectrum'
				? { size: normalizeSpectrumSize(options.size ?? dependencies.getSpectrumWindowSize()) }
				: { threshold: Number(options.threshold ?? 1), minimumConsecutiveSamples: Number(options.minimumConsecutiveSamples ?? 3) };
			const key = JSON.stringify([request, type, reportOptions]);
			if (specializedCache?.key === key) {
				const cached = specializedCache;
				complete(task, () => {
					dependencies.showAnalysis(cached.result, cached.visuals, cached.report);
					remember({ type, scope, options: Object.freeze({ ...options }) });
					setLocalizedStatus(dependencies.setStatus, copy, 'analysisCached', undefined, 'success');
				});
				return cached.report;
			}
			const { channels, sampleRate } = await renderChannels(request, task, projectToken);
			const visuals = dependencies.createVisuals(channels, sampleRate);
			const abort = new AbortController();
			const signal = AbortSignal.any([task.signal, abort.signal]);
			let result: Record<string, unknown>;
			let report: unknown;
			try {
				[result, report] = await Promise.all([
					analyzeRenderedChannels(channels, sampleRate, signal),
					(dependencies.createSpecializedReport
						? dependencies.createSpecializedReport(type, scope, request.range, channels, sampleRate, reportOptions, signal)
						: Promise.resolve(type === 'spectrum' ? spectrumReport(scope, request.range, channels, sampleRate, reportOptions)
							: clippingReport(scope, request.range, channels, reportOptions))).then(partial => {
							assertCurrent(task, projectToken, request);
							dependencies.showAnalysis(null, visuals, partial);
							return partial;
						}),
				]);
			} catch (error) { abort.abort(error); throw error; }
			assertCurrent(task, projectToken, request);
			complete(task, () => {
				dependencies.showAnalysis(result, visuals, report);
				specializedCache = { key, result, visuals, report };
				remember({ type, scope, options: Object.freeze({ ...options }) });
				setLocalizedStatus(dependencies.setStatus, copy, "done", undefined, 'success');
			});
			return report;
		} catch (error) {
			handleTaskError(error);
			return null;
		} finally {
			finish(task);
		}
	}

	async function captureContrast(role = 'foreground', scope = 'master', options: Record<string, unknown> = {}) {
		if (role !== 'foreground' && role !== 'background') throw createLocalizedError(RangeError, copy, 'contrastRoleInvalid');
		const project = dependencies.getProject();
		const projectToken = dependencies.captureProject();
		const task = begin('contrastAnalyzing');
		const selection = dependencies.getActiveSelection();
		if (!selection) {
			finish(task);
			const error = createLocalizedError(Error, copy, 'timeSelectionRequired');
			dependencies.handleError(error);
			return null;
		}
		try {
			assertAnalysisChannelAdmission(project);
			const request = captureRequest(project, scope, selection, dependencies.getSelectedTrackId());
			const { channels, sampleRate, result } = await renderAndAnalyze(request, task, projectToken);
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
			const roleLabel = { key: role === 'foreground' ? 'contrastForegroundRole' : 'contrastBackgroundRole' };
			complete(task, () => {
				dependencies.showAnalysis(result, dependencies.createVisuals(channels, sampleRate), report);
				remember({ type: 'contrast', role, scope, options: Object.freeze({ ...options }) });
				setLocalizedStatus(dependencies.setStatus, copy, "contrastStored", { role: roleLabel }, 'success');
			});
			return report;
		} catch (error) {
			handleTaskError(error);
			return null;
		} finally {
			finish(task);
		}
	}

	/**
	 * Measure the loudness of the selected range of the mix.
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
		const task = begin('measuringLoudness');
		const selectedRange = dependencies.getActiveSelection();
		const range = selectedRange ? Object.freeze({ ...selectedRange }) : null;
		try {
			assertAnalysisChannelAdmission(project);
			if (!range || !(range.endFrame > range.startFrame)) throw createLocalizedError(RangeError, copy, 'timeSelectionRequired');
			const request = captureRequest(project, 'master', range, null);
			const identity = loudnessIdentity(project, range, projectToken);
			assertCurrent(task, projectToken, request);
			if (identity && loudnessCache?.generation.deref() === identity.generation && loudnessCache.key === identity.key) {
				const report = structuredClone(loudnessCache.report);
				complete(task, () => {
					dependencies.state.deliveryReport = report;
					remember({ type: 'loudness', scope: 'master' });
					setLocalizedStatus(dependencies.setStatus, copy, 'loudnessMeasured', undefined, 'success');
				});
				return report;
			}
			const rendered = await dependencies.renderAudio('master', range, task.signal);
			assertCurrent(task, projectToken, request);
			const channels = Array.from(
				{ length: rendered.numberOfChannels },
				(_, channel) => rendered.getChannelData(channel),
			);
			const channelWeights = resolveAdmEbuChannelWeights(project.metadata?.adm, channels.length);
			const report = dependencies.measureLoudnessChannels
				? await dependencies.measureLoudnessChannels(channels, rendered.sampleRate, range, channelWeights ?? undefined, task.signal)
				: createLoudnessMeasurementReport({
				measurement: measureBextLoudness(channels, rendered.sampleRate, {
					...(channelWeights ? { channelWeights } : {}),
				}),
				sampleRate: rendered.sampleRate,
				channelCount: channels.length,
				range,
				scope: loudnessMeasurementScope(range),
			});
			assertCurrent(task, projectToken, request);
			const currentIdentity = loudnessIdentity(dependencies.getProject(), range, projectToken);
			if (identity && currentIdentity?.generation === identity.generation && currentIdentity.key === identity.key
				&& rendered.sampleRate === identity.sampleRate && channels.length === identity.channelCount) {
				loudnessCache = { generation: new WeakRef(identity.generation), key: identity.key, report: structuredClone(report) };
			}
			complete(task, () => {
				dependencies.state.deliveryReport = report;
				remember({ type: 'loudness', scope: 'master' });
				setLocalizedStatus(dependencies.setStatus, copy, "loudnessMeasured", undefined, 'success');
			});
			return report;
		} catch (error) {
			loudnessCache = null;
			handleTaskError(error);
			return null;
		} finally {
			finish(task);
		}
	}

	function loudnessIdentity(project: AnalysisProjectIdentity, range: AnalysisRange, token: EditorProjectToken) {
		const authority = dependencies.captureLoudnessGeneration?.();
		const channelCount = Number(project.masterChannels ?? 2);
		if (!authority || !Number.isSafeInteger(authority.sampleRate) || authority.sampleRate < 1
			|| !Number.isSafeInteger(project.revision) || !Number.isSafeInteger(range.startFrame) || range.startFrame < 0
			|| !Number.isSafeInteger(range.endFrame)
			|| !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > EBU_R128_MAXIMUM_CHANNELS) return null;
		const key = JSON.stringify([token.generation, project.id, project.revision, range.startFrame, range.endFrame,
			authority.sampleRate, channelCount, resolveAdmEbuChannelWeights(project.metadata?.adm, channelCount)]);
		return { generation: authority.generation, sampleRate: authority.sampleRate, channelCount, key };
	}

	async function renderAndAnalyze(
		request: AnalysisRequestSnapshot,
		task: EditorTaskScope,
		projectToken: EditorProjectToken,
	) {
		const { channels, sampleRate } = await renderChannels(request, task, projectToken);
		const result = await analyzeRenderedChannels(channels, sampleRate, task.signal);
		assertCurrent(task, projectToken, request);
		return { channels, sampleRate, result };
	}

	async function renderChannels(request: AnalysisRequestSnapshot, task: EditorTaskScope, projectToken: EditorProjectToken) {
		const rendered = await dependencies.renderAudio(request.scope, request.range, task.signal, request.selectedTrackId);
		assertCurrent(task, projectToken, request);
		const channels = Array.from({ length: rendered.numberOfChannels }, (_, channel) => rendered.getChannelData(channel));
		return { channels, sampleRate: rendered.sampleRate };
	}

	async function analyzeRenderedChannels(channels: Float32Array[], sampleRate: number, signal: AbortSignal) {
		const channelWeights = resolveAdmEbuChannelWeights(
			dependencies.getProject().metadata?.adm,
			channels.length,
		);
		return dependencies.analyzeChannels(channels, sampleRate, signal, {
			...(channelWeights ? { channelWeights } : {}),
		});
	}

	function assertCurrent(task: EditorTaskScope, projectToken: EditorProjectToken, request?: AnalysisRequestSnapshot): void {
		task.assertCurrent();
		dependencies.assertProject(projectToken);
		if (request) {
			const project = dependencies.getProject();
			if (project.id !== request.projectId || project.revision !== request.revision) throw new EditorProjectChangedError();
		}
	}

	function begin(key: keyof AnalysisCopy): EditorTaskScope {
		const task = lifetime.startTask('analysis', { scope: EDITOR_PROJECT_TASK_SCOPE });
		const update = (): void => {
			dependencies.setProcessing(true);
			setLocalizedStatus(dependencies.setStatus, copy, key);
			dependencies.publish();
		};
		if (dependencies.batchPresentation) dependencies.batchPresentation(update); else update();
		return task;
	}

	function finish(task: EditorTaskScope): void {
		if (finishedTasks.has(task)) return;
		finishedTasks.add(task);
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

	function complete(task: EditorTaskScope, operation: () => void): void {
		const update = (): void => { operation(); finish(task); };
		if (dependencies.batchPresentation) dependencies.batchPresentation(update); else update();
	}

	function handleTaskError(error: unknown): void {
		if (!isAbortError(error) && !isEditorDisposedError(error)) dependencies.handleError(error);
	}

	function remember(request: AnalysisRepeatRequest): void {
		dependencies.state.lastAnalysisRequest = Object.freeze(request);
	}
}

function captureRequest(project: AnalysisProjectIdentity, scope: string, range: AnalysisRange, selectedTrackId: string | null): AnalysisRequestSnapshot {
	return Object.freeze({
		projectId: project.id,
		revision: project.revision,
		scope,
		selectedTrackId: scope === 'track' ? selectedTrackId : null,
		range: Object.freeze({ startFrame: range.startFrame, endFrame: range.endFrame }),
	});
}

function assertAnalysisChannelAdmission(project: AnalysisProjectIdentity): void {
	// Every analyzer renders through the project master, including track scope;
	// reject its known width before a cache lookup or an offline render can hide
	// the meter's narrower contract.
	const channelCount = Number(project.masterChannels ?? 2);
	if (Number.isSafeInteger(channelCount) && channelCount > EBU_R128_MAXIMUM_CHANNELS) {
		throw new RangeError(
			`Audio analysis supports at most ${String(EBU_R128_MAXIMUM_CHANNELS)} channels because its levels include EBU R 128 loudness; downmix the master before running an analyzer.`,
		);
	}
}

function levelsReport(scope: string, range: AnalysisRange) {
	return Object.freeze({ type: 'levels', scope, ...range });
}

function isAbortError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

/** Cache records are shared with other analysis kinds and may predate this schema. */
function readStoredAnalysis(value: unknown): StoredAnalysis | null {
	if (!isRecord(value) || !isRecord(value.result)) return null;
	return { result: value.result, visuals: value.visuals, report: value.report };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
