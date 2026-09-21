/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared ownership lifecycle for product-specific browser editor bootstraps. */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
	createMonoConversionConfirmation,
	type MonoConversionConfirmation,
} from './dialogs/mono-conversion-confirmation.ts';
import {
	createLocalAssistanceLazySemanticSearchSourceV1,
	type LocalAssistanceLazySemanticSearchSourceOptionsV1,
} from './local-assistance-lazy-semantic-search-source.ts';

type AssistanceSearchSource = ReturnType<typeof createLocalAssistanceLazySemanticSearchSourceV1>;

export interface AudioEditorWebRuntime<Controller, FileService> {
	readonly controller: Controller;
	readonly fileService: FileService;
	readonly dispose: () => Promise<void>;
}

interface RuntimeFileService {
	readonly isDesktop: boolean;
	readonly bridge: unknown;
}

interface RuntimeEnvironment<Projector> {
	readonly runtime: Readonly<{ readonly projectForRuntimeConsumers: Projector }>;
	readonly store: Readonly<{
		readonly assistanceDerivativeRepository:
			LocalAssistanceLazySemanticSearchSourceOptionsV1['repository'];
	}>;
	close(): PromiseLike<void> | void;
}

interface RuntimeController {
	dispose(): PromiseLike<void> | void;
}

interface RuntimeMetadata<Projector> {
	readonly assistanceSearchSource: AssistanceSearchSource | null;
	readonly monoConversionConfirmation: MonoConversionConfirmation;
	readonly projectForRuntimeConsumers: Projector;
}

export interface AudioEditorWebRuntimeLifecycleOptions<
	Presentation,
	FileService extends RuntimeFileService,
	Projector,
	Environment extends RuntimeEnvironment<Projector>,
	Controller extends RuntimeController,
	Extension,
> {
	readonly createFileService: () => FileService;
	readonly createEnvironment: (fileService: FileService) => Promise<Environment>;
	readonly createController: (
		environment: Environment,
		presentation: Presentation,
		fileService: FileService,
		monoConversionConfirmation: MonoConversionConfirmation,
	) => Controller;
	readonly createExtension?: (
		controller: Controller,
		environment: Environment,
		fileService: FileService,
	) => Extension;
	readonly disposeExtension?: (extension: Extension) => PromiseLike<void> | void;
	readonly createMonoConversionConfirmation?: () => MonoConversionConfirmation;
	readonly constructionCleanupMessage: string;
	readonly extensionAndControllerDisposalMessage?: string;
	readonly controllerAndEnvironmentDisposalMessage: string;
	readonly controllerAndEnvironmentDisposalCause: boolean;
	readonly exactRuntimeMessage: string;
}

export interface AudioEditorWebRuntimeLifecycle<
	Presentation,
	FileService,
	Projector,
	Controller,
> {
	create(presentation: Presentation): Promise<Readonly<AudioEditorWebRuntime<Controller, FileService>>>;
	assistanceSearchSource(runtime: Readonly<AudioEditorWebRuntime<Controller, FileService>>):
		AssistanceSearchSource | null;
	monoConversionConfirmation(runtime: Readonly<AudioEditorWebRuntime<Controller, FileService>>):
		MonoConversionConfirmation;
	projectForRuntimeConsumers(runtime: Readonly<AudioEditorWebRuntime<Controller, FileService>>): Projector;
}

export function createAudioEditorWebRuntimeLifecycle<
	Presentation,
	FileService extends RuntimeFileService,
	Projector,
	Environment extends RuntimeEnvironment<Projector>,
	Controller extends RuntimeController,
	Extension = never,
>(
	options: AudioEditorWebRuntimeLifecycleOptions<
		Presentation, FileService, Projector, Environment, Controller, Extension
	>,
): AudioEditorWebRuntimeLifecycle<Presentation, FileService, Projector, Controller> {
	type Runtime = Readonly<AudioEditorWebRuntime<Controller, FileService>>;
	const metadata = new WeakMap<object, RuntimeMetadata<Projector>>();

	const requireMetadata = (runtime: Runtime): RuntimeMetadata<Projector> => {
		const attached = metadata.get(runtime);
		if (!attached) throw new TypeError(options.exactRuntimeMessage);
		return attached;
	};

	const create = async (presentation: Presentation): Promise<Runtime> => {
		const fileService = options.createFileService();
		const environment = await options.createEnvironment(fileService);
		const monoConversionConfirmation = (
			options.createMonoConversionConfirmation ?? createMonoConversionConfirmation
		)();
		try {
			const controller = options.createController(
				environment, presentation, fileService, monoConversionConfirmation,
			);
			const extension = options.createExtension?.(controller, environment, fileService);
			let disposal: Promise<void> | null = null;
			const dispose = (): Promise<void> => {
				disposal ??= disposeRuntimeResources(
					controller, environment, extension, monoConversionConfirmation, options,
				);
				return disposal;
			};
			const runtime: Runtime = Object.freeze({ controller, fileService, dispose });
			metadata.set(runtime, Object.freeze({
				projectForRuntimeConsumers: environment.runtime.projectForRuntimeConsumers,
				monoConversionConfirmation,
				assistanceSearchSource: fileService.isDesktop
					? createLocalAssistanceLazySemanticSearchSourceV1({
						bridgeScope: fileService.bridge,
						repository: environment.store.assistanceDerivativeRepository,
					})
					: null,
			}));
			return runtime;
		} catch (error) {
			monoConversionConfirmation.dispose();
			try {
				await environment.close();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					options.constructionCleanupMessage,
					// eslint-disable-next-line preserve-caught-error -- Preserve each product's established primary-failure cause.
					{ cause: error },
				);
			}
			throw error;
		}
	};

	return Object.freeze({
		create,
		assistanceSearchSource: (runtime: Runtime) => requireMetadata(runtime).assistanceSearchSource,
		monoConversionConfirmation: (runtime: Runtime) => requireMetadata(runtime).monoConversionConfirmation,
		projectForRuntimeConsumers: (runtime: Runtime) => requireMetadata(runtime).projectForRuntimeConsumers,
	});
}

async function disposeRuntimeResources<
	Presentation,
	FileService extends RuntimeFileService,
	Projector,
	Environment extends RuntimeEnvironment<Projector>,
	Controller extends RuntimeController,
	Extension,
>(
	controller: Controller,
	environment: Environment,
	extension: Extension | undefined,
	monoConversionConfirmation: MonoConversionConfirmation,
	options: AudioEditorWebRuntimeLifecycleOptions<
		Presentation, FileService, Projector, Environment, Controller, Extension
	>,
): Promise<void> {
	let failure: unknown;
	monoConversionConfirmation.dispose();
	if (extension !== undefined && options.disposeExtension) {
		try {
			await options.disposeExtension(extension);
		} catch (error) {
			failure = error;
		}
	}
	try {
		await controller.dispose();
	} catch (error) {
		failure = failure
			? new AggregateError(
				[failure, error],
				options.extensionAndControllerDisposalMessage
					?? options.controllerAndEnvironmentDisposalMessage,
			)
			: error;
	}
	try {
		await environment.close();
	} catch (error) {
		if (failure) {
			if (options.controllerAndEnvironmentDisposalCause) {
					throw new AggregateError(
						[failure, error],
						options.controllerAndEnvironmentDisposalMessage,
						// eslint-disable-next-line preserve-caught-error -- Soundscaper's public contract names the controller failure as cause.
						{ cause: failure },
					);
				}
				// eslint-disable-next-line preserve-caught-error -- Framescaper's public contract intentionally has no cause.
				throw new AggregateError(
				[failure, error],
				options.controllerAndEnvironmentDisposalMessage,
			);
		}
		throw error;
	}
	if (failure) throw failure;
}

export interface AudioEditorWebBootstrapProps {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, unknown>>;
	readonly initialSurface?: string;
}

export interface AudioEditorWebBootstrapRenderValue<Runtime> {
	readonly locale: string;
	readonly copy: Readonly<Record<string, unknown>>;
	readonly initialSurface?: string;
	readonly runtime: Runtime;
}

export interface AudioEditorWebBootstrapConfiguration<Runtime extends Readonly<{
	readonly dispose: () => Promise<void>;
}>> {
	readonly snapshotFallbackCopy: (value: unknown) => Readonly<Record<string, unknown>>;
	readonly bundledEnglishCopy: () => Readonly<Record<string, unknown>>;
	readonly loadLocalizedCopy: (
		locale: string,
		signal: AbortSignal,
	) => PromiseLike<unknown> | unknown;
	readonly snapshotLocalizedCopy: (value: unknown) => Readonly<Record<string, unknown>>;
	readonly reportLocalizedCopyProjectionFailure: boolean;
	readonly createRuntime: (presentation: Readonly<{
		readonly locale: string;
		readonly copy: Readonly<Record<string, unknown>>;
	}>) => Promise<Runtime>;
	readonly renderEditor: (value: Readonly<AudioEditorWebBootstrapRenderValue<Runtime>>) => ReactNode;
	readonly reportRuntimeDisposalFailure: (error: unknown) => void;
	readonly failureFallback: string;
	readonly loadingFallback: string;
}

export function AudioEditorWebBootstrap<Runtime extends Readonly<{
	readonly dispose: () => Promise<void>;
}>>({
	configuration,
	locale,
	fallbackCopy: fallbackCopyValue,
	initialSurface,
}: AudioEditorWebBootstrapProps & Readonly<{
	readonly configuration: AudioEditorWebBootstrapConfiguration<Runtime>;
}>): ReactNode {
	const fallbackCopy = useMemo(
		() => configuration.snapshotFallbackCopy(fallbackCopyValue),
		[configuration, fallbackCopyValue],
	);
	const [copy, setCopy] = useState<Readonly<Record<string, unknown>> | null>(
		() => locale === 'en' ? configuration.bundledEnglishCopy() : null,
	);
	const [runtime, setRuntime] = useState<Runtime | null>(null);
	const [failure, setFailure] = useState<unknown>(null);

	useEffect(() => {
		if (copy) return undefined;
		const controller = new AbortController();
		const loaded = Promise.resolve(configuration.loadLocalizedCopy(locale, controller.signal));
		const publish = (resolved: unknown): void => {
			if (!controller.signal.aborted) {
				setCopy(configuration.snapshotLocalizedCopy(resolved));
			}
		};
		const report = (error: unknown): void => {
			if (!controller.signal.aborted) setFailure(error);
		};
		if (configuration.reportLocalizedCopyProjectionFailure) {
			void loaded.then(publish).catch(report);
		} else {
			void loaded.then(publish, report);
		}
		return () => { controller.abort(); };
	}, [configuration, copy, locale]);

	useEffect(() => {
		if (!copy) return undefined;
		let active = true;
		let owned: Runtime | null = null;
		setFailure(null);
		void configuration.createRuntime({ locale, copy }).then(
			(candidate) => {
				if (!active) {
					void candidate.dispose().catch(configuration.reportRuntimeDisposalFailure);
					return;
				}
				owned = candidate;
				setRuntime(candidate);
			},
			(error: unknown) => { if (active) setFailure(error); },
		);
		return () => {
			active = false;
			if (owned) void owned.dispose().catch(configuration.reportRuntimeDisposalFailure);
		};
	}, [configuration, copy, locale]);

	if (failure) {
		const message = failure instanceof Error ? failure.message : String(failure);
		return <div role="alert">{
			copyText(fallbackCopy, 'genericError', configuration.failureFallback)
				.replace('{message}', message)
		}</div>;
	}
	if (!copy || !runtime) {
		return <div role="status" aria-live="polite">{
			copyText(fallbackCopy, 'loading', configuration.loadingFallback)
		}</div>;
	}
	return configuration.renderEditor({
		locale,
		copy,
		...(initialSurface === undefined ? {} : { initialSurface }),
		runtime,
	});
}

function copyText(
	copy: Readonly<Record<string, unknown>>,
	key: string,
	fallback: string,
): string {
	return typeof copy[key] === 'string' ? copy[key] : fallback;
}
