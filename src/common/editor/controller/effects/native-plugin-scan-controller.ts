/* SPDX-License-Identifier: AGPL-3.0-only */

/** One background folder batch, independent of any preferences dialog. */
export interface NativePluginScanAvailability {
	readonly enabled: boolean;
	readonly quarantined: boolean;
	readonly payload: Readonly<{ status: string }>;
	readonly scanProgress?: Readonly<{ format: string; progress: number | null }> | null;
	readonly consent: Readonly<{ formats: readonly Readonly<{
		format: string; supported: boolean; granted: boolean;
		roots: readonly Readonly<{ rootId: string; name: string; admitted: boolean }>[];
	}>[] }>;
}

export type NativePluginScanResult =
	| Readonly<{ status: 'described'; scan: Readonly<{ entries: readonly unknown[]; status?: string; detail?: string }> }>
	| Readonly<{ status: 'failed'; code: string; message: string }>;

interface ScanPort {
	nativePluginAvailability(): Promise<NativePluginScanAvailability>;
	scanNativePlugins(request: Readonly<{ format: string; rootId: string }>): Promise<NativePluginScanResult>;
	nativePluginScanProgress?(): Promise<Pick<NativePluginScanAvailability, 'enabled' | 'scanProgress'>>;
}

interface ScanTimers {
	setInterval(callback: () => void): unknown;
	clearInterval(handle: unknown): void;
}

export interface NativePluginScanSnapshot {
	readonly generation: number;
	readonly status: 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';
	readonly total: number;
	readonly completed: number;
	readonly currentFolder: string;
	readonly progress: number;
	readonly found: number;
	readonly detail: string;
}

export interface NativePluginScanController {
	getSnapshot(): NativePluginScanSnapshot;
	subscribe(listener: () => void): () => void;
	startOnOpen(): Promise<void>;
	scan(): Promise<void>;
	setEnabled(enabled: boolean): void;
	dispose(): void;
}

const EMPTY: NativePluginScanSnapshot = Object.freeze({
	generation: 0, status: 'idle', total: 0, completed: 0, currentFolder: '', progress: 0, found: 0, detail: '',
});
const DEFAULT_TIMERS: ScanTimers = {
	setInterval: (callback) => globalThis.setInterval(callback, 500),
	clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export function createNativePluginScanController(port: ScanPort, timers: ScanTimers = DEFAULT_TIMERS): NativePluginScanController {
	let snapshot = EMPTY;
	let disposed = false;
	let opened = false;
	let startup: Promise<void> | null = null;
	let inFlight: Promise<void> | null = null;
	let generation = 0;
	let stopPolling: (() => void) | null = null;
	const listeners = new Set<() => void>();
	const publish = (patch: Partial<NativePluginScanSnapshot>): void => {
		snapshot = Object.freeze({ ...snapshot, ...patch });
		for (const listener of listeners) listener();
	};
	const cancel = (): void => {
		generation += 1;
		stopPolling?.();
		stopPolling = null;
		if (snapshot.status === 'running') publish({ status: 'cancelled', currentFolder: '' });
	};
	const execute = async (batch: number): Promise<void> => {
		const alive = (): boolean => !disposed && generation === batch;
		try {
			const availability = await port.nativePluginAvailability();
			if (!alive()) return;
			if (!canScan(availability)) return;
			const folders = scanFolders(availability);
			if (folders.length === 0) return;
			publish({ ...EMPTY, generation: batch, status: 'running', total: folders.length });
			let currentRootId = '';
			let polling = false;
			const poll = async (): Promise<void> => {
				if (polling || !alive()) return;
				polling = true;
				const rootId = currentRootId;
				try {
					const next = await port.nativePluginScanProgress?.();
					if (!alive()) return;
					if (!next) return;
					if (!next.enabled) { cancel(); return; }
					const active = next.scanProgress;
					const folder = folders.find((entry) => entry.rootId === rootId);
					if (rootId !== currentRootId || !folder || active?.format !== folder.format
						|| active.progress === null || !Number.isFinite(active.progress)) return;
					publish({ progress: (snapshot.completed + Math.max(0, Math.min(0.99, active.progress))) / folders.length });
				} catch {
					// The scan's own result reports failures; a transient progress read does not end it.
				} finally { polling = false; }
			};
			const timer = timers.setInterval(() => { void poll(); });
			stopPolling = () => timers.clearInterval(timer);
			for (const folder of folders) {
				if (!alive()) return;
				const next = await port.nativePluginAvailability();
				if (!alive()) return;
				if (!next.enabled) { cancel(); return; }
				if (!canScan(next)) {
					publish({ status: 'failed', currentFolder: '', detail: snapshot.detail || 'The plug-in scanner is unavailable.' });
					return;
				}
				if (!scanFolders(next).some((entry) => entry.rootId === folder.rootId && entry.format === folder.format)) continue;
				currentRootId = folder.rootId;
				publish({ currentFolder: folder.name, progress: snapshot.completed / folders.length });
				const result = await port.scanNativePlugins({ format: folder.format, rootId: folder.rootId });
				if (!alive()) return;
				if (result.status === 'failed' && ['helper-cancelled', 'helper-disabled', 'consent-required'].includes(result.code)) {
					cancel(); return;
				}
				const completed = snapshot.completed + 1;
				const detail = result.status === 'failed' && result.code !== 'unknown-root' ? result.message
					: result.status === 'described' && result.scan.status && !['scanned', 'complete'].includes(result.scan.status)
						? result.scan.detail || result.scan.status : snapshot.detail;
				publish({ completed, progress: completed / folders.length,
					found: snapshot.found + (result.status === 'described' ? result.scan.entries.length : 0),
					// Standard locations need not exist on a machine with no installed plugins.
					detail,
				});
			}
			if (alive()) publish({ status: snapshot.detail ? 'failed' : 'complete', currentFolder: '', progress: 1 });
		} catch (cause) {
			if (alive()) publish({ generation: batch, status: 'failed', currentFolder: '',
				detail: cause instanceof Error ? cause.message : String(cause) });
		} finally {
			stopPolling?.();
			stopPolling = null;
		}
	};
	const scan = (): Promise<void> => {
		if (inFlight !== null) return inFlight;
		if (disposed) return Promise.resolve();
		const operation = execute(++generation);
		inFlight = operation;
		void operation.then(() => { if (inFlight === operation) inFlight = null; });
		return operation;
	};
	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		startOnOpen: () => {
			if (!opened) { opened = true; startup = scan(); }
			return startup ?? Promise.resolve();
		},
		scan,
		setEnabled: (enabled: boolean) => { if (!enabled) cancel(); },
		dispose: () => {
			if (disposed) return;
			disposed = true;
			cancel();
			listeners.clear();
		},
	});
}

function canScan(availability: NativePluginScanAvailability): boolean {
	return availability.enabled && !availability.quarantined && availability.payload.status === 'available';
}

function scanFolders(availability: NativePluginScanAvailability) {
	return availability.consent.formats.filter((format) => format.supported && format.granted)
		.flatMap((format) => format.roots.filter((root) => root.admitted)
			.map((root) => ({ format: format.format, rootId: root.rootId, name: root.name })));
}
