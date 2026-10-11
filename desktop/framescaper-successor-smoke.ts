/* SPDX-License-Identifier: AGPL-3.0-only */
import type { BrowserWindow } from 'electron';
/** Runs against the actual rendered successor, not a substituted HTML fixture. */
export async function smokeFramescaperSuccessorShell(target: BrowserWindow): Promise<Record<string, unknown>> {
	const value: unknown = await target.webContents.executeJavaScript(`(async () => {
		const deadline = Date.now() + 30000;
		while (!document.querySelector('[data-audio-editor-bound="true"]')) {
			if (Date.now() >= deadline) throw new Error('Successor shell did not mount: ' + document.body.innerText.slice(0, 2000));
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		const files = window.framescaperSuccessorDesktop.v1.motionSavedFiles;
		const rejection = await files.read({ token: 'unadmitted', offset: 0, length: 1 }).then(() => '', error => String(error));
		return { environment: await window.scapeDesktop.v1.getEnvironment(), origin: location.protocol + '//' + location.host,
			foreignBridge: !!(window.soundscaperDesktop || window.framescaperDesktop), bridgeMethods: Object.keys(window.scapeDesktop.v1),
			fileBridge: ['select', 'poll', 'read', 'release', 'cancel'].every(method => typeof files[method] === 'function'), rejection,
			databases: (await indexedDB.databases()).map(database => database.name).sort() };
	})()`);
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Framescaper successor smoke evidence.'); return value as Record<string, unknown>;
}
