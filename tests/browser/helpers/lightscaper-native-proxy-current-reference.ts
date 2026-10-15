/* SPDX-License-Identifier: AGPL-3.0-only */

export { readRawCullingCustodyCurrentV1 as readNativeProxyCustodyCurrentV1 } from './lightscaper-raw-culling-current-reference.ts';

interface Timing {
	trusted: boolean; pendingObserved: boolean; inputAtMs: number;
	readyAtMs: number | null; presentedAtMs: number | null;
}
let timing: Timing | undefined;
let timingObserver: MutationObserver | undefined;
let retirement: (() => Readonly<{ pendingAtClose: boolean; retired: boolean; latePublications: number }>) | undefined;

/** Observe an actual resolution-menu gesture and presentation settlement.
 * This installs no renderer, scheduler, worker or session execution hook. */
export function armNativeProxyTimingCurrentV1(label: string, width: number, height: number): void {
	timingObserver?.disconnect(); timing = undefined;
	const region = document.querySelector<HTMLElement>('[data-photo-develop-preview]');
	const button = [...document.querySelectorAll<HTMLButtonElement>('.lightscaper-develop-settings-menu button')]
		.find(value => value.textContent?.trim() === label);
	const canvas = region?.querySelector<HTMLCanvasElement>('[data-photo-develop-after]');
	if (!region || !button || !canvas) throw new Error('The real resolution menu or preview is unavailable.');
	button.addEventListener('click', event => {
		const record: Timing = { trusted: event.isTrusted, pendingObserved: false, inputAtMs: performance.now(), readyAtMs: null, presentedAtMs: null };
		timing = record;
		const matches = () => region.getAttribute('data-state') === 'ready' && canvas.width === width && canvas.height === height;
		timingObserver = new MutationObserver(mutations => {
			if (region.getAttribute('data-state') === 'pending' || mutations.some(value => value.attributeName === 'data-state' && value.oldValue === 'pending')) record.pendingObserved = true;
			if (!record.pendingObserved || record.readyAtMs !== null || !matches()) return;
			record.readyAtMs = performance.now(); requestAnimationFrame(() => {
				if (timing === record && matches()) record.presentedAtMs = performance.now();
			});
		});
		timingObserver.observe(region, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-state', 'width', 'height'] });
	}, { once: true, capture: true });
}

export function readNativeProxyTimingCurrentV1(): Timing | null { return timing ? { ...timing } : null; }

/** Retain only the old DOM surfaces while native Close joins a pending render.
 * Once cleared, no retired canvas may receive a later publication. */
export function armNativeProxyRetirementCurrentV1(closeLabel: string): void {
	const region = document.querySelector<HTMLElement>('[data-photo-develop-preview]');
	const close = [...document.querySelectorAll<HTMLButtonElement>('.lightscaper-develop-actions button')]
		.find(value => value.textContent?.trim() === closeLabel);
	if (!region || !close) throw new Error('The actual Develop Close surface is unavailable.');
	const canvases = [...region.querySelectorAll('canvas')];
	let closed = false, pendingAtClose = false, cleared = false, latePublications = 0;
	const observer = new MutationObserver(() => {
		if (!closed) return;
		const empty = canvases.every(value => value.width === 0 && value.height === 0);
		if (cleared && !empty) latePublications++;
		if (empty) cleared = true;
	});
	observer.observe(region, { subtree: true, attributes: true, attributeFilter: ['data-state', 'width', 'height'] });
	close.addEventListener('click', event => {
		if (!event.isTrusted) throw new Error('Close must use an actual user gesture.');
		pendingAtClose = region.getAttribute('data-state') === 'pending'; closed = true;
	}, { once: true, capture: true });
	retirement = () => {
		observer.disconnect();
		return { pendingAtClose, retired: closed && !region.isConnected && canvases.every(value => value.width === 0 && value.height === 0), latePublications };
	};
}

export function readNativeProxyRetirementCurrentV1() {
	if (!retirement) throw new Error('No pending native Develop retirement was observed.');
	return retirement();
}
