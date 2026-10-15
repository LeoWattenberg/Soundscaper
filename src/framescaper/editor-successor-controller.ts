/* SPDX-License-Identifier: AGPL-3.0-only */
import { createFramescaperSuccessorNativeInput } from './editor-successor-native-input.ts';
import { createAudioEditorController } from '../common/editor/app.js';
import type { ControllerOptions } from '../common/editor/controller/composition/controller-options.ts';
import { createFramescaperCompositionLinkSession } from './editor-composition-link-session.ts';
import { createFramescaperCompositionPcmSource } from './editor-composition-link-pcm-source.ts';
import { bindFramescaperSuccessorCompositionPreview } from './editor-composition-link-preview-controller.ts';
import { createVideoRetimeProgramOrdinalBridge } from '../common/editor/video-retime-program-ordinal-bridge.ts';
import { FRAMESCAPER_EDITOR_CAPTURE_RUNTIME } from './editor-capture-runtime.ts';
import { assertFramescaperSuccessorEnvironment, type FramescaperSuccessorEnvironment } from './editor-project-successor-environment.ts';
import { framescaperSuccessorPlaybackCanonicalProject } from './editor-project-successor-playback.ts';
import { resolveFramescaperCompositionSource } from './editor-composition-link-source.ts';
import { createFramescaperSuccessorScapeNativeRuntime } from './editor-scape-successor-native.ts';
import { createFramescaperSequenceActionsSequence } from './editor-project-sequence-sequence-actions.ts';
import { createFramescaperMulticameraActionsSequence } from './editor-project-sequence-multicam-actions.ts';
import { createFramescaperVideoRetimeActionsRetime } from './editor-project-retime-retime-actions.ts';
import type { FramescaperProjectCommand } from './editor-project-commands.ts';
import type { FramescaperAudioEditorControllerPresentation } from './editor-controller.ts';
const CONTEXTS = new WeakMap<object, Readonly<{ environment: FramescaperSuccessorEnvironment; nativeInput: ReturnType<typeof createFramescaperSuccessorNativeInput>['nativeInput']; session: ReturnType<FramescaperSuccessorEnvironment['runtime']['createSessionController']>; links: ReturnType<typeof createFramescaperCompositionLinkSession> }>>();
/** Own the successor session, store and project runtime explicitly; the common editor supplies timeline interaction. */
export function createFramescaperSuccessorController(value: unknown, presentation: FramescaperAudioEditorControllerPresentation = {}) {
	const environment = assertFramescaperSuccessorEnvironment(value); const session = environment.runtime.createSessionController();
	let controller: ReturnType<typeof createAudioEditorController> | null = null;
	const execute = (command: FramescaperProjectCommand) => { if (!controller) throw new Error('Successor controller is not ready.'); return controller.actions.edit.commit(command as never); };
	const retime = createFramescaperVideoRetimeActionsRetime(execute);
	controller = createAudioEditorController(null, {
		headless: true, productId: 'framescaper', framescaperCaptureRuntime: FRAMESCAPER_EDITOR_CAPTURE_RUNTIME,
		store: environment.controllerStore, sessionController: session,
		projectRuntime: environment.runtime as unknown as ControllerOptions['projectRuntime'],
		scapeProjectRuntime: createFramescaperSuccessorScapeNativeRuntime(environment),
		acquireProjectLock: environment.runtime.acquireProjectLock, playbackProjectService: environment.playback,
		createProjectIfAbsent: (project, options) => environment.controllerStore.createProjectIfAbsent(project, options),
		createProductVideoRetimeProgramOrdinalBridge: createVideoRetimeProgramOrdinalBridge,
		loadProductVideoExportStrategy: async () => {
			const { createFramescaperVideoExportStrategySuccessor } = await import('./video-export-strategy-successor.ts');
			return createFramescaperVideoExportStrategySuccessor({ store: environment.controllerStore, readAsset: asset => environment.owners.readAsset(asset) });
		},
		productSequenceActions: { ...createFramescaperSequenceActionsSequence(execute), ...createFramescaperMulticameraActionsSequence(execute),
			retimeSet: retime.set, retimeReset: retime.reset, retimeConstant: retime.constant, retimeReverse: retime.reverse, retimeFreeze: retime.freeze, retimeRamp: retime.ramp },
		resolveProductAudioSource: async request => {
			request.assertCurrent(); request.signal?.throwIfAborted();
			const project = canonicalSourceProject(request.project, request.source); if (!project) return null;
			const provider = createFramescaperCompositionPcmSource({ project,
				source: request.source, readAsset: asset => environment.owners.readAsset(asset) });
			return provider ? { ...provider, readStorageChunk: (index, context = {}) => provider.readStorageChunk(index, { signal: context.signal instanceof AbortSignal ? context.signal : undefined }) } : null;
		},
		resolveProductVideoSource: async request => {
			request.assertCurrent(); const project = canonicalSourceProject(request.project, request.source); if (!project) return null;
			const resolved = resolveFramescaperCompositionSource(project, request.source); request.signal?.throwIfAborted(); request.assertCurrent();
			return resolved ? { mediaKind: 'composition', timingIndex: resolved.timing.index } : null;
		},
		locale: presentation.locale, copy: presentation.copy, fileService: presentation.fileService,
		confirmMonoConversion: presentation.confirmMonoConversion, confirmFileSizeWarning: presentation.confirmFileSizeWarning,
	});
	bindFramescaperSuccessorCompositionPreview({ controller, store: environment.controllerStore, readAsset: asset => environment.owners.readAsset(asset) });
	const { nativeInput, adoptSavedRevision } = createFramescaperSuccessorNativeInput(controller, environment);
	const links = createFramescaperCompositionLinkSession({ controller, environment, session, adoptSavedRevision });
	const original = controller.actions;
	controller.actions = Object.freeze({ ...original, edit: Object.freeze({ ...original.edit,
		undo: () => links.history('undo'), redo: () => links.history('redo'),
		execute: (action: string) => action === 'undo' || action === 'redo' ? links.history(action) : original.edit.execute(action),
	}) });
	CONTEXTS.set(controller, Object.freeze({ environment, nativeInput, session, links })); return controller;
}
export function framescaperSuccessorControllerContext(controller: object) {
	const context = CONTEXTS.get(controller); if (!context) throw new TypeError('An exact successor controller is required.'); return context;
}
function canonicalSourceProject(project: object, source: object): object | null {
	const associated = framescaperSuccessorPlaybackCanonicalProject(project); if (associated) return associated;
	if (Object.getOwnPropertyDescriptor(project, 'schemaVersion')?.value === 2) return project;
	const mime = Object.getOwnPropertyDescriptor(source, 'mimeType')?.value;
	if (mime === 'application/vnd.motionscaper.composition' || mime === 'application/vnd.motionscaper.composition-audio') throw new TypeError('A linked composition requires its captured canonical successor project.');
	return null;
}
