/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense } from 'react';

import { createAudioEditorFileService } from '../../common/editor/file-service.js';
import { BoundAudioEditorApp } from '../../common/editor/ui/AudioEditorApp.jsx';
import type { MonoConversionConfirmation } from
	'../../common/editor/ui/dialogs/mono-conversion-confirmation.ts';
import {
	AudioEditorWebBootstrap,
	createAudioEditorWebRuntimeLifecycle,
	type AudioEditorWebBootstrapConfiguration,
	type AudioEditorWebBootstrapRenderValue,
	type AudioEditorWebRuntime,
} from '../../common/editor/ui/audio-editor-web-bootstrap.tsx';
import { resolveFramescaperNativeServicesBridge } from
	'../../common/editor/ui/framescaper-native-services-bridge.ts';
import { bundledCatalogForLocale, resolveCatalog } from '../../common/i18n/runtime.js';
import { createFramescaperAudioEditorController } from '../editor-controller.ts';
import {
	createFramescaperNativeWatchImportClient,
	type FramescaperNativeWatchImportClient,
} from '../editor-native-watch-import-client.ts';
import {
	createFramescaperEditorProjectEnvironment,
	type FramescaperEditorProjectEnvironment,
} from '../editor-project-environment.ts';

type WebController = ReturnType<typeof createFramescaperAudioEditorController>;
type WebFileService = ReturnType<typeof createAudioEditorFileService>;
type RuntimeProjection = FramescaperEditorProjectEnvironment['runtime']['projectForRuntimeConsumers'];
const PRESENTATION_FIELDS = ['locale', 'copy'] as const;

export interface FramescaperWebEditorRuntimePresentation {
	readonly locale: string;
	readonly copy: Readonly<Record<string, unknown>>;
}

export type FramescaperWebEditorRuntime = AudioEditorWebRuntime<
	WebController,
	WebFileService
>;

export interface FramescaperAudioEditorBootstrapProps {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, unknown>>;
	readonly initialSurface?: string;
}

const RUNTIME_LIFECYCLE = createAudioEditorWebRuntimeLifecycle<
	FramescaperWebEditorRuntimePresentation,
	WebFileService,
	RuntimeProjection,
	FramescaperEditorProjectEnvironment,
	WebController,
	FramescaperNativeWatchImportClient
>({
	createFileService: createAudioEditorFileService,
	createEnvironment: (fileService: WebFileService) => createFramescaperEditorProjectEnvironment({
		storeOptions: {
			linkedOriginalPort: fileService.linkedOriginalPort,
			linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
		},
	}),
	createController: (
		environment: FramescaperEditorProjectEnvironment,
		presentation: FramescaperWebEditorRuntimePresentation,
		fileService: WebFileService,
		monoConversionConfirmation: MonoConversionConfirmation,
	) => createFramescaperAudioEditorController(environment, {
		locale: presentation.locale,
		copy: presentation.copy,
		fileService,
		confirmMonoConversion: monoConversionConfirmation.confirm,
	}),
	createExtension: (controller: WebController, _environment, fileService: WebFileService) => (
		createFramescaperNativeWatchImportClient({
			controller,
			linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
			bridge: resolveFramescaperNativeServicesBridge(),
		})
	),
	disposeExtension: (watchImports: FramescaperNativeWatchImportClient) => watchImports.dispose(),
	constructionCleanupMessage: 'Framescaper runtime construction and cleanup both failed.',
	extensionAndControllerDisposalMessage: 'Framescaper watch and controller disposal failed.',
	controllerAndEnvironmentDisposalMessage:
		'Framescaper controller and environment disposal failed.',
	controllerAndEnvironmentDisposalCause: false,
	exactRuntimeMessage: 'An exact Framescaper web runtime is required.',
});

export async function createFramescaperWebEditorRuntime(
	presentationValue: FramescaperWebEditorRuntimePresentation | unknown,
): Promise<Readonly<FramescaperWebEditorRuntime>> {
	return RUNTIME_LIFECYCLE.create(snapshotPresentation(presentationValue));
}

const BOOTSTRAP_CONFIGURATION: AudioEditorWebBootstrapConfiguration<
	Readonly<FramescaperWebEditorRuntime>
> = Object.freeze({
	snapshotFallbackCopy: (value: unknown) => framescaperCopy(snapshotCopy(
		value, 'Framescaper fallback copy',
	)),
	bundledEnglishCopy: () => framescaperCopy(snapshotCopy(
		bundledCatalogForLocale('en'), 'Framescaper bundled copy',
	)),
	loadLocalizedCopy: (locale: string, signal: AbortSignal) => resolveCatalog(locale, { signal }),
	snapshotLocalizedCopy: (value: unknown) => framescaperCopy(snapshotCopy(
		value, 'Framescaper localized copy',
	)),
	reportLocalizedCopyProjectionFailure: false,
	createRuntime: createFramescaperWebEditorRuntime,
	renderEditor: ({ locale, copy, initialSurface, runtime }: AudioEditorWebBootstrapRenderValue<
		Readonly<FramescaperWebEditorRuntime>
	>) => (
		<Suspense fallback={<div role="status" aria-live="polite">{
			copyText(copy, 'loading', 'Loading project')
		}</div>}>
			<BoundAudioEditorApp
				locale={locale}
				copy={copy}
				initialSurface={initialSurface}
				productId="framescaper"
				controller={runtime.controller}
				fileService={runtime.fileService}
				projectForRuntimeConsumers={runtimeProjector(runtime)}
				assistanceSearchSource={RUNTIME_LIFECYCLE.assistanceSearchSource(runtime)}
				monoConversionConfirmation={runtimeMonoConversionConfirmation(runtime)}
				crossProductHandoffAvailable={true}
			/>
		</Suspense>
	),
	reportRuntimeDisposalFailure,
	failureFallback: 'Framescaper failed: {message}',
	loadingFallback: 'Loading project',
});

export default function FramescaperAudioEditorBootstrap({
	locale,
	fallbackCopy,
	initialSurface,
}: FramescaperAudioEditorBootstrapProps) {
	return <AudioEditorWebBootstrap
		configuration={BOOTSTRAP_CONFIGURATION}
		locale={locale}
		fallbackCopy={fallbackCopy}
		{...(initialSurface === undefined ? {} : { initialSurface })}
	/>;
}

function reportRuntimeDisposalFailure(error: unknown): void {
	console.error('The Framescaper web editor runtime did not close cleanly:', error);
}

function runtimeProjector(runtime: Readonly<FramescaperWebEditorRuntime>): RuntimeProjection {
	return RUNTIME_LIFECYCLE.projectForRuntimeConsumers(runtime);
}

function runtimeMonoConversionConfirmation(
	runtime: Readonly<FramescaperWebEditorRuntime>,
): MonoConversionConfirmation {
	return RUNTIME_LIFECYCLE.monoConversionConfirmation(runtime);
}

function snapshotPresentation(value: unknown): FramescaperWebEditorRuntimePresentation {
	const record = closedRecord(value, PRESENTATION_FIELDS, 'Framescaper web presentation');
	if (typeof record.locale !== 'string' || !record.locale.trim() || record.locale.length > 128) {
		throw new TypeError('The Framescaper locale must be a bounded string.');
	}
	return Object.freeze({
		locale: record.locale,
		copy: snapshotCopy(record.copy, 'Framescaper web copy'),
	});
}

function framescaperCopy(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	return Object.freeze({
		...value,
		title: copyText(value, 'framescaperTitle', copyText(value, 'title', 'Framescaper')),
		eyebrow: copyText(value, 'framescaperEyebrow', copyText(value, 'eyebrow', 'Framescaper')),
		intro: copyText(value, 'framescaperIntro', copyText(value, 'intro', '')),
		metaDescription: copyText(value, 'framescaperMetaDescription', copyText(value, 'metaDescription', '')),
	});
}

function snapshotCopy(value: unknown, label: string): Readonly<Record<string, unknown>> {
	const record = plainRecord(value, label);
	const keys = Reflect.ownKeys(record);
	if (keys.length > 4_096 || keys.some((key) => typeof key !== 'string')) {
		throw new RangeError(`${label} has an invalid field inventory.`);
	}
	const output: Record<string, unknown> = Object.create(null);
	for (const key of keys as string[]) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	return Object.freeze(output);
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	const record = plainRecord(value, label);
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${label} has unsupported fields.`);
	return record as Readonly<Record<Field, unknown>>;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function copyText(value: Readonly<Record<string, unknown>>, field: string, fallback: string): string {
	return typeof value[field] === 'string' ? value[field] : fallback;
}
