/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared ownership lifecycle for product-specific browser editor bootstraps. */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { EditorStartupProgress } from '../../site/EditorStartupProgress.tsx';

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
	beginDisposal?(): void;
	dispose(): PromiseLike<void> | void;
	canCloseStore?(): boolean;
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
	createWhenReady(presentation: PromiseLike<Presentation>): Promise<Readonly<AudioEditorWebRuntime<Controller, FileService>>>;
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

	const createWithEnvironment = async (
		presentation: Presentation,
		fileService: FileService,
		environment: Environment,
	): Promise<Runtime> => {
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
	const create = async (presentation: Presentation): Promise<Runtime> => {
		const fileService = options.createFileService();
		const environment = await options.createEnvironment(fileService);
		return createWithEnvironment(presentation, fileService, environment);
	};
	const createWhenReady = async (presentation: PromiseLike<Presentation>): Promise<Runtime> => {
		const fileService = options.createFileService();
		const environmentPromise = Promise.resolve(options.createEnvironment(fileService));
		let environment: Environment;
		let resolvedPresentation: Presentation;
		try {
			[environment, resolvedPresentation] = await Promise.all([environmentPromise, presentation]);
		} catch (error) {
			const opened = await environmentPromise.catch(() => null);
			if (opened) {
				try {
					await opened.close();
				} catch (cleanupError) {
					// eslint-disable-next-line preserve-caught-error -- The presentation failure remains the primary cause.
					throw new AggregateError([error, cleanupError], options.constructionCleanupMessage, { cause: error });
				}
			}
			throw error;
		}
		return createWithEnvironment(resolvedPresentation, fileService, environment);
	};

	return Object.freeze({
		create,
		createWhenReady,
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
	let failed = false;
	monoConversionConfirmation.dispose();
	if (extension !== undefined && options.disposeExtension) {
		try {
			controller.beginDisposal?.();
		} catch (error) {
			failure = error;
			failed = true;
		}
		try {
			await options.disposeExtension(extension);
		} catch (error) {
			failure = failed
				? new AggregateError(
					[failure, error], options.extensionAndControllerDisposalMessage
						?? options.controllerAndEnvironmentDisposalMessage,
				)
				: error;
			failed = true;
		}
	}
	try {
		await controller.dispose();
	} catch (error) {
		failure = failed
			? new AggregateError(
				[failure, error],
				options.extensionAndControllerDisposalMessage
					?? options.controllerAndEnvironmentDisposalMessage,
			)
			: error;
		failed = true;
	}
	try {
		if (controller.canCloseStore?.() !== false) await environment.close();
	} catch (error) {
		if (failed) {
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
	if (failed) throw failure;
}

export interface AudioEditorWebBootstrapProps {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, unknown>>;
	readonly initialSurface?: string;
}

export interface AudioEditorWebBootstrapRenderValue<Runtime> {
	readonly locale: string;
	readonly copy: Readonly<Record<string, unknown>>;
	readonly fallbackCopy: Readonly<Record<string, unknown>>;
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
	readonly createRuntimeWhenReady: (presentation: PromiseLike<Readonly<{
		readonly locale: string;
		readonly copy: Readonly<Record<string, unknown>>;
	}>>) => Promise<Runtime>;
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
	const attempt = useMemo(() => Object.freeze({ locale }), [locale]);
	const [ready, setReady] = useState<Readonly<{
		attempt: typeof attempt;
		copy: Readonly<Record<string, unknown>>;
		runtime: Runtime;
	}> | null>(null);
	const [failure, setFailure] = useState<Readonly<{ attempt: typeof attempt; error: unknown }> | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		let active = true;
		setReady(null);
		setFailure(null);
		const copyPromise = Promise.resolve().then(() => locale === 'en'
			? configuration.bundledEnglishCopy()
			: configuration.loadLocalizedCopy(locale, controller.signal)).then((value) => locale === 'en'
				? value as Readonly<Record<string, unknown>>
				: configuration.snapshotLocalizedCopy(value));
		const aborted = new Promise<never>((_resolve, reject) => {
			controller.signal.addEventListener('abort', () => reject(new DOMException('Editor startup cancelled.', 'AbortError')), { once: true });
		});
		const activeCopyPromise = Promise.race([copyPromise, aborted]);
		const runtimePromise = configuration.createRuntimeWhenReady(activeCopyPromise.then((copy) => ({ locale, copy })));
		void Promise.all([activeCopyPromise, runtimePromise]).then(
			([copy, runtime]) => { if (active) setReady({ attempt, copy, runtime }); },
			(error: unknown) => { if (active) setFailure({ attempt, error }); },
		);
		return () => {
			active = false;
			controller.abort();
			void runtimePromise.then(
				(runtime) => runtime.dispose().catch(configuration.reportRuntimeDisposalFailure),
				(error: unknown) => {
					if (error instanceof AggregateError) configuration.reportRuntimeDisposalFailure(error);
				},
			);
		};
	}, [attempt, configuration, locale]);

	if (failure?.attempt === attempt) {
		const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
		return <div role="alert">{
			copyText(fallbackCopy, 'genericError', configuration.failureFallback)
				.replace('{message}', message)
		}</div>;
	}
	if (!ready || ready.attempt !== attempt) {
		return <EditorStartupProgress copy={fallbackCopy} />;
	}
	return configuration.renderEditor({
		locale,
		copy: ready.copy,
		fallbackCopy,
		...(initialSurface === undefined ? {} : { initialSurface }),
		runtime: ready.runtime,
	});
}

function copyText(
	copy: Readonly<Record<string, unknown>>,
	key: string,
	fallback: string,
): string {
	return typeof copy[key] === 'string' ? copy[key] : fallback;
}
