// @ts-check
/* SPDX-License-Identifier: AGPL-3.0-only */

interface EditingPerformanceMetrics {
	start: number | null;
	finished: boolean;
	frames: number[];
	longTasks: number[];
	completion: number | null;
	durationMs?: number;
}

interface WaveformPaintPlan { readonly sourceId?: unknown; readonly waveformIdentity?: unknown }
type PaintedCanvas = HTMLCanvasElement & { __kwWaveformPlan?: WaveformPaintPlan };

/** Self-contained browser function: Playwright serializes this function body. */
export function armElectronEditingCompletion({ buttonLabel, surface }: {
	readonly buttonLabel: string;
	readonly surface: string;
}): void {
	const metrics: EditingPerformanceMetrics = { start: null, finished: false, frames: [], longTasks: [], completion: null };
	(globalThis as typeof globalThis & { __editingPerformance: EditingPerformanceMetrics }).__editingPerformance = metrics;
	const observer = new PerformanceObserver(list => {
		for (const entry of list.getEntries()) if (metrics.start !== null
			&& entry.startTime + entry.duration >= metrics.start) metrics.longTasks.push(entry.duration);
	});
	observer.observe({ type: 'longtask', buffered: false });
	let previous: number | null = null;
	const initialPaints = new Map<PaintedCanvas, WaveformPaintPlan | undefined>();
	const initialIdentities = new Set<string>();
	let qualifiedPaints: Map<PaintedCanvas, object> | null = null;
	let generation = 0;
	const callbacks = {
		frame(time: number): void {
			if (metrics.finished) { observer.disconnect(); return; }
			if (metrics.start !== null) {
				if (previous !== null) metrics.frames.push(time - previous);
				previous = time;
			}
			requestAnimationFrame(callbacks.frame);
		},
		readPaints(): Map<PaintedCanvas, object> | null {
			if (metrics.start === null || metrics.finished || document.querySelector(surface)) return null;
			if (document.querySelector<HTMLElement>('[data-status]')?.dataset.state !== 'success') return null;
			if (document.querySelector('[data-waveform-pending="true"]')) return null;
			const canvases = document.querySelectorAll('canvas.clip-body__waveform');
			if (!canvases.length) return null;
			const paints = new Map<PaintedCanvas, object>();
			for (const candidate of canvases) {
				if (!(candidate instanceof HTMLCanvasElement)) return null;
				const canvas: PaintedCanvas = candidate, plan = canvas.__kwWaveformPlan;
				if (canvas.dataset.waveformRenderer !== 'audacity' || canvas.dataset.waveformError
					|| !plan || initialPaints.get(canvas) === plan || typeof plan.sourceId !== 'string'
					|| typeof plan.waveformIdentity !== 'string' || !plan.waveformIdentity
					|| initialIdentities.has(plan.waveformIdentity)) return null;
				paints.set(canvas, plan);
			}
			return paints;
		},
		samePaints(expected: Map<PaintedCanvas, object>, current: Map<PaintedCanvas, object> | null): boolean {
			if (!current || current.size !== expected.size) return false;
			for (const [canvas, plan] of expected) if (current.get(canvas) !== plan) return false;
			return true;
		},
		boundary(expected: Map<PaintedCanvas, object>, epoch: number, remaining: number): void {
			if (metrics.finished || epoch !== generation) return;
			if (!callbacks.samePaints(expected, callbacks.readPaints())) {
				qualifiedPaints = null;
				metrics.completion = null;
				generation += 1;
				callbacks.changed();
				return;
			}
			if (remaining > 1) {
				requestAnimationFrame(() => callbacks.boundary(expected, epoch, remaining - 1));
				return;
			}
			metrics.durationMs = performance.now() - metrics.start!;
			metrics.finished = true;
			mutations.disconnect();
		},
		changed(): void {
			if (metrics.finished) return;
			const current = callbacks.readPaints();
			if (qualifiedPaints && callbacks.samePaints(qualifiedPaints, current)) return;
			qualifiedPaints = null;
			metrics.completion = null;
			generation += 1;
			if (!current) return;
			qualifiedPaints = current;
			metrics.completion = performance.now();
			const epoch = generation;
			requestAnimationFrame(() => callbacks.boundary(current, epoch, 2));
		},
		click(event: Event): void {
			const button = event.target instanceof Element ? event.target.closest('button') : null;
			if (button?.textContent?.trim() !== buttonLabel) return;
			for (const canvas of document.querySelectorAll<PaintedCanvas>('canvas.clip-body__waveform')) {
				const plan = canvas.__kwWaveformPlan;
				initialPaints.set(canvas, plan);
				if (typeof plan?.waveformIdentity === 'string') initialIdentities.add(plan.waveformIdentity);
			}
			metrics.start = performance.now();
			previous = metrics.start;
			document.removeEventListener('click', callbacks.click, true);
		},
	};
	requestAnimationFrame(callbacks.frame);
	const mutations = new MutationObserver(callbacks.changed);
	mutations.observe(document.body, { subtree: true, childList: true, attributes: true });
	document.addEventListener('click', callbacks.click, true);
}
