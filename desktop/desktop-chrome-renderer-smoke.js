/* SPDX-License-Identifier: AGPL-3.0-only */

export async function collectSoundscaperArtifactWitness(scope) {
	return Object.freeze({
		url: scope.location.href,
		title: scope.document.title,
		bridge: Object.keys(scope.soundscaperDesktop?.v1 || {}).sort(),
		environment: await scope.soundscaperDesktop?.v1?.getEnvironment?.(),
		hasEditor: Boolean(scope.document.querySelector('main')),
		nodeExposed: typeof scope.process !== 'undefined' || typeof scope.require !== 'undefined',
		saveOwnerReady: await scope.soundscaperDesktop?.v1?.beginWrite?.({
			targetId: '0'.repeat(48),
			size: 0,
		}).then(() => false, (error) => (
			/Save target expired or was already used/u.test(String(error?.message || error))
		)),
	});
}

/** Observe the renderer-owned chrome from the actual packaged application window. */
export async function collectDesktopChromeArtifactWitness(scope) {
	const platform = (await scope.scapeDesktop?.v1?.getEnvironment?.())?.platform;
	const accessKeyReady = (value) => platform === 'darwin'
		? value === null : typeof value === 'string' && /^Alt\+[\p{Letter}\p{Number}]$/u.test(value);
	const deadline = Date.now() + 5_000;
	let witness;
	do {
		const document = scope.document;
		const editor = document?.querySelector?.('[data-audio-editor-bound="true"]');
		const shell = document?.querySelector?.('.website-site-shell');
		const header = editor?.querySelector?.('[data-desktop-chrome="true"]');
		const titlebar = header?.querySelector?.('.application-header__windows-titlebar');
		const actions = header?.querySelector?.('.kw-audio-editor__window-actions');
		const buttons = [...(actions?.querySelectorAll?.('button') || [])];
		const actionFor = (button) => button.classList.contains('kw-audio-editor__fullscreen')
			? 'fullscreen' : button.dataset.windowControl;
		const bounds = editor?.getBoundingClientRect?.();
		const editorStyle = editor ? scope.getComputedStyle(editor) : null;
		const region = (element) => element
			? scope.getComputedStyle(element).getPropertyValue('-webkit-app-region').trim() : '';
		const file = header?.querySelector?.('[data-application-menubar] [role="menuitem"]');
		witness = {
			documentDesktop: document?.documentElement?.dataset?.desktop === 'true',
			shellDesktop: shell?.classList?.contains?.('website-desktop') === true,
			fullBleed: Boolean(bounds && Math.abs(bounds.left) < 1 && Math.abs(bounds.top) < 1
				&& Math.abs(bounds.right - scope.innerWidth) < 1 && Math.abs(bounds.bottom - scope.innerHeight) < 1
				&& editorStyle?.borderTopWidth === '0px' && editorStyle?.borderTopLeftRadius === '0px'),
			customHeader: Boolean(header),
			titlebarDraggable: region(titlebar) === 'drag',
			controlsNoDrag: region(actions) === 'no-drag',
			controlsVisible: buttons.length === 4 && buttons.every((button) => button.getClientRects().length > 0),
			maximizeEnabled: buttons.some((button) => ['maximize', 'restore'].includes(button.dataset.windowControl) && !button.disabled),
			controlOrder: buttons.map(actionFor),
			fileAccessKey: file?.getAttribute?.('aria-keyshortcuts') ?? null,
		};
		if (witness.customHeader && witness.controlsVisible && accessKeyReady(witness.fileAccessKey)) break;
		await new Promise((resolve) => scope.setTimeout(resolve, 25));
	} while (Date.now() < deadline);
	return Object.freeze(witness);
}
