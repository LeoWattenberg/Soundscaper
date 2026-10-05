/* SPDX-License-Identifier: AGPL-3.0-only */

// This script is injected only by the native executable's explicit smoke mode.
export async function runTauriPrototypeSmoke(scope = globalThis) {
	const started = performance.now();
	const document = scope.document;
	const failures = [];
	scope.addEventListener('error', event => failures.push(String(event.message)));
	scope.addEventListener('unhandledrejection', event => failures.push(String(event.reason)));
	const waitFor = async (read, label, timeout = 30_000) => {
		const deadline = performance.now() + timeout;
		while (performance.now() < deadline) {
			const value = read();
			if (value) return value;
			await new Promise(resolve => scope.setTimeout(resolve, 50));
		}
		const detail = document.querySelector('[role="alert"]')?.textContent || document.body?.innerText?.slice(-2_000) || '';
		const menus = [...document.querySelectorAll('[role="menu"]')].map(element => element.outerHTML.slice(0, 5_000));
		throw new Error(`Timed out waiting for ${label}: ${detail}; menus: ${menus.join('; ')}; errors: ${failures.join('; ')}`);
	};
	const text = element => String(element.textContent || '').replace(/\s+/gu, ' ').trim();
	const activateFileCommand = async (label) => {
		const trigger = await waitFor(() => [...document.querySelectorAll('[role="menubar"] [role="menuitem"]')]
			.find(element => text(element) === 'File'), 'File menu');
		trigger.click();
		const command = await waitFor(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
			.find(element => text(element.querySelector('.context-menu-item-label') || element).replace(/…$/u, '') === label), label);
		command.click();
	};
	const editor = await waitFor(() => document.querySelector('[data-audio-editor-bound="true"]'), 'editor startup', 60_000);
	await waitFor(() => editor.getAttribute('data-editor-ready') === 'true', 'editor controller readiness');
	await waitFor(() => editor.getAttribute('data-project-id'), 'active project');
	await waitFor(() => editor.getAttribute('data-project-activation-pending') !== 'true', 'project activation');
	await activateFileCommand('Open');
	await waitFor(() => [...document.querySelectorAll('[data-clip-id][role="group"]')]
		.find(element => text(element).includes('tauri-prototype-tone')), 'native WAV import');
	await activateFileCommand('Export audio');
	const dialog = await waitFor(() => document.querySelector('[data-editor-surface="export"]'), 'export dialog');
	const format = await waitFor(() => dialog.querySelector('[data-export-field="format"] button'), 'export format');
	if (!text(format).includes('WAV')) {
		format.click();
		const wav = await waitFor(() => [...document.querySelectorAll('[role="option"]')].find(element => text(element) === 'WAV'), 'WAV option');
		wav.click();
	}
	const exportButton = await waitFor(() => [...dialog.querySelectorAll('button')]
		.find(element => text(element) === 'Export' && !element.disabled), 'Export button');
	exportButton.click();
	await waitFor(() => {
		const output = dialog.querySelector('[data-export-download]');
		return output?.getAttribute('download') === 'tauri-prototype-export.wav';
	}, 'native export completion');
	if (failures.length) throw new Error(`Renderer errors during smoke: ${failures.join('; ')}`);
	return {
		success: true,
		editorReady: true,
		importedViaMenu: true,
		exportedViaMenu: true,
		nodeExposed: typeof scope.process !== 'undefined' || typeof scope.require !== 'undefined',
		crossOriginIsolated: scope.crossOriginIsolated === true,
		sharedArrayBuffer: typeof scope.SharedArrayBuffer === 'function',
		elapsedMs: Math.round(performance.now() - started),
		userAgent: scope.navigator.userAgent,
		errors: failures,
	};
}

if (globalThis.__TAURI__?.core?.invoke) {
	void runTauriPrototypeSmoke().then(report => globalThis.__TAURI__.core.invoke('prototype_smoke_complete', { report }))
		.catch(error => globalThis.__TAURI__.core.invoke('prototype_smoke_complete', { report: {
			success: false, error: `${String(error)}\n${String(error?.stack || '')}`,
		} })
			.catch(failure => console.error('Tauri smoke could not report its result:', failure)));
}
