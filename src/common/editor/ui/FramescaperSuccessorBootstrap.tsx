/* SPDX-License-Identifier: AGPL-3.0-only */
import { Suspense } from 'react';
import { EditorStartupProgress } from '../../site/EditorStartupProgress.tsx';
import { createAudioEditorFileService } from '../file-service.js';
import { BoundAudioEditorApp } from './AudioEditorApp.jsx';
import { AudioEditorWebBootstrap, createAudioEditorWebRuntimeLifecycle, type AudioEditorWebBootstrapConfiguration, type AudioEditorWebBootstrapRenderValue, type AudioEditorWebRuntime } from './audio-editor-web-bootstrap.tsx';
import { snapshotBootstrapCopyFields } from './audio-editor-bootstrap-copy-snapshot.ts';
import { bundledCatalogForLocale, resolveCatalog } from '../../i18n/runtime.js';
import { createFramescaperSuccessorEnvironment, type FramescaperSuccessorEnvironment } from '../../../framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorController } from '../../../framescaper/editor-successor-controller.ts';
interface Presentation { readonly locale: string; readonly copy: Readonly<Record<string, unknown>> }
type FileService = ReturnType<typeof createAudioEditorFileService>;
type Controller = ReturnType<typeof createFramescaperSuccessorController>;
type Runtime = AudioEditorWebRuntime<Controller, FileService>;
const lifecycle = createAudioEditorWebRuntimeLifecycle<Presentation, FileService, FramescaperSuccessorEnvironment['runtime']['projectForRuntimeConsumers'], FramescaperSuccessorEnvironment, Controller, never>({
	createFileService: () => createAudioEditorFileService({ bridge: null }),
	createEnvironment: fileService => createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { linkedOriginalPort: fileService.linkedOriginalPort, linkedVideoOriginalPort: fileService.linkedVideoOriginalPort } }),
	createController: (environment, presentation, fileService, mono, size) => createFramescaperSuccessorController(environment, {
		...presentation, copy: copy(presentation.copy), fileService, confirmMonoConversion: mono.confirm, confirmFileSizeWarning: size.confirm,
	}),
	constructionCleanupMessage: 'Successor editor construction and cleanup failed.',
	controllerAndEnvironmentDisposalMessage: 'Successor editor and storage cleanup failed.',
	controllerAndEnvironmentDisposalCause: true, exactRuntimeMessage: 'An exact successor runtime is required.',
});
function copy(value: unknown): Readonly<Record<string, string>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Successor editor copy is required.');
	const snapshot = snapshotBootstrapCopyFields(value as Record<string, unknown>, 'Successor copy', 'own data property', new Set(Object.keys(bundledCatalogForLocale('en'))));
	const result: Record<string, string> = {}; for (const [key, text] of Object.entries(snapshot)) { if (typeof text !== 'string') throw new TypeError('Successor copy entries must be strings.'); result[key] = text; }
	return Object.freeze({ ...result, title: result.framescaperTitle ?? 'Framescaper', eyebrow: result.framescaperEyebrow ?? 'Framescaper', intro: result.framescaperIntro ?? '', metaDescription: result.framescaperMetaDescription ?? '' });
}
const configuration: AudioEditorWebBootstrapConfiguration<Readonly<Runtime>> = Object.freeze({
	snapshotFallbackCopy: copy, bundledEnglishCopy: () => copy(bundledCatalogForLocale('en')),
	loadLocalizedCopy: (locale: string, signal: AbortSignal) => resolveCatalog(locale, { signal }), snapshotLocalizedCopy: copy,
	createRuntimeWhenReady: (presentation: PromiseLike<Presentation>) => lifecycle.createWhenReady(presentation),
	renderEditor: ({ locale, copy: text, fallbackCopy, initialSurface, runtime }: AudioEditorWebBootstrapRenderValue<Readonly<Runtime>>) => <Suspense fallback={<EditorStartupProgress copy={fallbackCopy} locale={locale} />}>
		<BoundAudioEditorApp locale={locale} copy={text} initialSurface={initialSurface} productId="framescaper"
			controller={runtime.controller} fileService={runtime.fileService} projectForRuntimeConsumers={lifecycle.projectForRuntimeConsumers(runtime)}
			assistanceSearchSource={lifecycle.assistanceSearchSource(runtime)} monoConversionConfirmation={lifecycle.monoConversionConfirmation(runtime)}
			fileSizeWarningConfirmation={lifecycle.fileSizeWarningConfirmation(runtime)} crossProductHandoffAvailable={false} />
	</Suspense>,
	reportRuntimeDisposalFailure: (error: unknown) => { console.error('Successor editor disposal failed:', error); },
	failureFallback: 'Framescaper failed: {message}', loadingFallback: 'Loading project',
});
export default function FramescaperSuccessorBootstrap(props: Readonly<{ locale: string; fallbackCopy: Readonly<Record<string, unknown>>; initialSurface?: string }>) {
	return <AudioEditorWebBootstrap configuration={configuration} {...props} />;
}
