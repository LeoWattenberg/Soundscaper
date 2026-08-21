import { useEffect, useRef } from 'react';

import { isDesktopTextEditingElement } from '../workspace-runtime.js';
import { editorCloseHasActiveWork, sealEditorCaptureForClose } from './desktop-editor-close-work.ts';

export function useDesktopEditorBridge({
	controller,
	durationFrames,
	fileService,
	onError,
	openDesktopFiles,
	openDesktopProjectDescriptor,
	openSurface,
	run,
	setIsFullscreen,
	snapshot,
	toggleFullscreen,
}) {
	const desktopReadySignalledRef = useRef(false);
	const desktopOpenQueueRef = useRef(Promise.resolve());
	useEffect(() => {
		if (!fileService.isDesktop) return undefined;
		let active = true;
		const openDescriptor = (descriptor) => {
			const operation = desktopOpenQueueRef.current
				.catch(() => undefined)
				.then(() => openDesktopProjectDescriptor(descriptor));
			desktopOpenQueueRef.current = operation;
			void operation.catch(onError);
		};
		const handleMenuCommand = ({ command } = {}) => {
			const edit = (action) => isDesktopTextEditingElement(document.activeElement, action)
				? fileService.editText(action)
				: controller.actions.edit[action]();
			const actions = {
				'project:open': () => openDesktopFiles('project'),
				'project:save': () => controller.actions.project.flush(),
				'project:save-as': () => controller.actions.project.saveScape({ saveCopy: snapshot.readOnly }),
				'audio:export': () => openSurface('export'),
				'edit:undo': () => edit('undo'),
				'edit:redo': () => edit('redo'),
				'edit:cut': () => edit('cut'),
				'edit:copy': () => edit('copy'),
				'edit:paste': () => edit('paste'),
				'edit:select-all': () => isDesktopTextEditingElement(document.activeElement, 'selectAll')
					? fileService.editText('selectAll')
					: controller.actions.timeline.setSelection(0, durationFrames),
				preferences: () => openSurface('preferences'),
				'view:toggle-fullscreen': toggleFullscreen,
			};
			const action = actions[command];
			if (action) run(action);
		};
		const handleClose = async ({ requestId } = {}) => {
			let allow = false;
			try {
				const current = controller.getSnapshot();
				const activeWork = editorCloseHasActiveWork(current);
				if (activeWork) {
					const stopAndQuit = globalThis.confirm?.('Soundscaper is still recording or processing. Stop the active work and quit?') ?? false;
					if (!stopAndQuit) return;
					await sealEditorCaptureForClose(controller);
					await Promise.resolve(controller.actions.export.cancel());
					await Promise.resolve(controller.actions.recording.cancelScheduled());
					await Promise.resolve(controller.actions.recording.stop());
					await Promise.resolve(controller.actions.sampleEdit.cancel());
					await Promise.resolve(controller.actions.nyquist.cancel());
					await Promise.resolve(controller.actions.transport.stop());
					const remaining = controller.getSnapshot();
					if (remaining.importing || remaining.save?.state === 'saving'
						|| remaining.processingEffect || remaining.analysisProcessing) return;
				}
				await controller.actions.project.flush();
				allow = true;
			} catch (error) {
				onError(error);
			} finally {
				await fileService.respondToClose({ requestId, allow });
			}
		};
		const unsubscribers = [
			fileService.onOpenProject(openDescriptor),
			fileService.onMenuCommand(handleMenuCommand),
			fileService.onCloseRequested((request) => { void handleClose(request).catch(onError); }),
			fileService.onFullscreenChanged(({ fullscreen } = {}) => setIsFullscreen(Boolean(fullscreen))),
		];
		void controller.ready.then(() => {
			if (active && !desktopReadySignalledRef.current) {
				desktopReadySignalledRef.current = true;
				return fileService.signalReady();
			}
			return undefined;
		}).catch(onError);
		return () => {
			active = false;
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}, [controller, durationFrames, fileService, onError, openDesktopFiles, openDesktopProjectDescriptor, openSurface, run, snapshot.readOnly, toggleFullscreen]);
}
