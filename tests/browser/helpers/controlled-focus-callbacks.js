/* SPDX-License-Identifier: AGPL-3.0-only */

export async function installControlledFocusCallbacks(page, kind) {
	await page.addInitScript(mode => {
		const frames = mode === 'animation-frame';
		const schedule = (frames ? window.requestAnimationFrame : window.setTimeout).bind(window);
		const cancel = (frames ? window.cancelAnimationFrame : window.clearTimeout).bind(window);
		const pending = new Map();
		let held = false;
		let nextId = -1;
		const enqueue = (callback, args) => {
			const id = nextId--;
			pending.set(id, { callback, args, nativeId: null, resolve: null });
			return id;
		};
		const cancelHeld = id => {
			const entry = pending.get(id);
			if (!entry) { cancel(id); return; }
			pending.delete(id);
			if (entry.nativeId !== null) cancel(entry.nativeId);
			entry.resolve?.();
		};
		if (frames) {
			window.requestAnimationFrame = callback => held ? enqueue(callback, []) : schedule(callback);
			window.cancelAnimationFrame = cancelHeld;
		} else {
			window.setTimeout = (callback, delay, ...args) => held && delay === 0 && typeof callback === 'function'
				? enqueue(callback, args) : schedule(callback, delay, ...args);
			window.clearTimeout = cancelHeld;
		}
		globalThis.__controlledFocusCallbacks = {
			hold: () => { held = true; },
			async flush() {
				held = false;
				const batch = [...pending];
				await Promise.all(batch.map(([id, entry]) => new Promise(resolve => {
					entry.resolve = resolve;
					entry.nativeId = schedule(timestamp => {
						if (!pending.delete(id)) return;
						try { entry.callback(...(frames ? [timestamp] : entry.args)); }
						finally { resolve(); }
					}, ...(frames ? [] : [0]));
				})));
				// The submenu path schedules a second zero-delay callback from the first.
				// A native task after that wave confirms the nested focus callback ran too.
				if (!frames) await new Promise(resolve => schedule(resolve, 0));
				return batch.length;
			},
		};
	}, kind);
}

export async function holdFocusCallbacks(page) {
	await page.evaluate(() => globalThis.__controlledFocusCallbacks.hold());
}

export async function flushFocusCallbacks(page) {
	return page.evaluate(() => globalThis.__controlledFocusCallbacks.flush());
}
