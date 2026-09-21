/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense } from 'react';

import { createAudioEditorFileService } from '../../common/editor/file-service.js';
import { BoundAudioEditorApp } from '../../common/editor/ui/AudioEditorApp.jsx';
import { snapshotBootstrapCopyFields } from
	'../../common/editor/ui/audio-editor-bootstrap-copy-snapshot.ts';
import type { MonoConversionConfirmation } from
	'../../common/editor/ui/dialogs/mono-conversion-confirmation.ts';
import {
	AudioEditorWebBootstrap,
	createAudioEditorWebRuntimeLifecycle,
	type AudioEditorWebBootstrapConfiguration,
	type AudioEditorWebBootstrapRenderValue,
	type AudioEditorWebRuntime,
} from '../../common/editor/ui/audio-editor-web-bootstrap.tsx';
import { bundledCatalogForLocale, resolveCatalog } from '../../common/i18n/runtime.js';
import { createSoundscaperAudioEditorController } from '../editor-controller.ts';
import {
	createSoundscaperEditorProjectEnvironment,
	type SoundscaperEditorProjectEnvironment,
} from '../editor-project-environment.ts';

type SoundscaperWebController = ReturnType<typeof createSoundscaperAudioEditorController>;
type SoundscaperWebFileService = ReturnType<typeof createAudioEditorFileService>;
type SoundscaperProjectRuntimeProjection =
	SoundscaperEditorProjectEnvironment['runtime']['projectForRuntimeConsumers'];

const PRESENTATION_FIELDS = ['locale', 'copy'] as const;

export interface SoundscaperWebEditorRuntimePresentation {
	readonly locale: string;
	readonly copy: Readonly<Record<string, unknown>>;
}

export type SoundscaperWebEditorRuntime = AudioEditorWebRuntime<
	SoundscaperWebController,
	SoundscaperWebFileService
>;

export interface SoundscaperAudioEditorBootstrapProps {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, unknown>>;
	readonly initialSurface?: string;
}

const RUNTIME_LIFECYCLE = createAudioEditorWebRuntimeLifecycle<
	SoundscaperWebEditorRuntimePresentation,
	SoundscaperWebFileService,
	SoundscaperProjectRuntimeProjection,
	SoundscaperEditorProjectEnvironment,
	SoundscaperWebController
>({
	createFileService: createAudioEditorFileService,
	createEnvironment: (fileService: SoundscaperWebFileService) => (
		createSoundscaperEditorProjectEnvironment({
			storeOptions: {
				linkedOriginalPort: fileService.linkedOriginalPort,
				linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
			},
		})
	),
	createController: (
		environment: SoundscaperEditorProjectEnvironment,
		presentation: SoundscaperWebEditorRuntimePresentation,
		fileService: SoundscaperWebFileService,
		monoConversionConfirmation: MonoConversionConfirmation,
	) => createSoundscaperAudioEditorController(environment, {
		locale: presentation.locale,
		copy: presentation.copy,
		fileService,
		confirmMonoConversion: monoConversionConfirmation.confirm,
	}),
	constructionCleanupMessage:
		'Soundscaper baseline web runtime construction and cleanup both failed.',
	controllerAndEnvironmentDisposalMessage:
		'Soundscaper baseline controller and environment disposal both failed.',
	controllerAndEnvironmentDisposalCause: true,
	exactRuntimeMessage: 'An exact Soundscaper baseline web runtime is required.',
});

/** Construct the baseline browser runtime from presentation-only input. */
export async function createSoundscaperWebEditorRuntime(
	presentationValue: SoundscaperWebEditorRuntimePresentation | unknown,
): Promise<Readonly<SoundscaperWebEditorRuntime>> {
	return RUNTIME_LIFECYCLE.create(snapshotPresentation(presentationValue));
}

const BOOTSTRAP_CONFIGURATION: AudioEditorWebBootstrapConfiguration<
	Readonly<SoundscaperWebEditorRuntime>
> = Object.freeze({
	snapshotFallbackCopy: (value: unknown) => snapshotCopy(value, 'Soundscaper fallback copy'),
	bundledEnglishCopy: () => snapshotCopy(
		bundledCatalogForLocale('en'), 'Soundscaper bundled copy',
	),
	loadLocalizedCopy: (locale: string, signal: AbortSignal) => resolveCatalog(locale, { signal }),
	snapshotLocalizedCopy: (value: unknown) => snapshotCopy(value, 'Soundscaper localized copy'),
	reportLocalizedCopyProjectionFailure: true,
	createRuntime: createSoundscaperWebEditorRuntime,
	renderEditor: ({ locale, copy, initialSurface, runtime }: AudioEditorWebBootstrapRenderValue<
		Readonly<SoundscaperWebEditorRuntime>
	>) => (
		<Suspense fallback={<div role="status" aria-live="polite">{
			copyText(copy, 'loading', 'Loading project')
		}</div>}>
			<BoundAudioEditorApp
				locale={locale}
				copy={copy}
				initialSurface={initialSurface}
				productId="soundscaper"
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
	failureFallback: 'Soundscaper failed: {message}',
	loadingFallback: 'Loading project',
});

/** Product route adapter; it adds no default-visible production surface. */
export default function SoundscaperAudioEditorBootstrap({
	locale,
	fallbackCopy,
	initialSurface,
}: SoundscaperAudioEditorBootstrapProps) {
	return <AudioEditorWebBootstrap
		configuration={BOOTSTRAP_CONFIGURATION}
		locale={locale}
		fallbackCopy={fallbackCopy}
		{...(initialSurface === undefined ? {} : { initialSurface })}
	/>;
}

function reportRuntimeDisposalFailure(error: unknown): void {
	console.error('The Soundscaper web editor runtime did not close cleanly:', error);
}

function runtimeProjector(
	runtime: Readonly<SoundscaperWebEditorRuntime>,
): SoundscaperProjectRuntimeProjection {
	return RUNTIME_LIFECYCLE.projectForRuntimeConsumers(runtime);
}

function runtimeMonoConversionConfirmation(
	runtime: Readonly<SoundscaperWebEditorRuntime>,
): MonoConversionConfirmation {
	return RUNTIME_LIFECYCLE.monoConversionConfirmation(runtime);
}

function snapshotPresentation(value: unknown): SoundscaperWebEditorRuntimePresentation {
	const record = closedRecord(value, PRESENTATION_FIELDS, 'Soundscaper baseline web presentation');
	const locale = record.locale;
	if (typeof locale !== 'string' || !locale.trim() || locale.length > 128) {
		throw new TypeError('The Soundscaper baseline web locale must be a bounded string.');
	}
	return Object.freeze({
		locale,
		copy: snapshotCopy(record.copy, 'Soundscaper baseline web copy'),
	});
}

function snapshotCopy(value: unknown, label: string): Readonly<Record<string, unknown>> {
	return snapshotBootstrapCopyFields(plainRecord(value, label), label, 'own enumerable data property');
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
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(record, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property.`);
		}
	}
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
