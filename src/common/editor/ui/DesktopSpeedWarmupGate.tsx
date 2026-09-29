/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { EditorStartupProgress } from '../../site/EditorStartupProgress.tsx';
import type { DesktopSpeedWarmupOptions, DesktopSpeedWarmupResult } from './desktop-speed-warmup.ts';

type ProductId = 'soundscaper' | 'framescaper';
type SessionMode = 'speed' | 'memory';
type WarmupResult = DesktopSpeedWarmupResult | null | void;
type WarmupLoader = (options: DesktopSpeedWarmupOptions) => Promise<WarmupResult>;

interface ControllerSnapshot {
	readonly ready: boolean;
	readonly preferences?: Readonly<{
		readonly performance?: Readonly<{ readonly optimizeFor?: string }>;
	}>;
}

interface Controller {
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => ControllerSnapshot;
	readonly recordLocalDiagnosticError?: (error: unknown, source: string) => void;
}

export interface DesktopSpeedWarmupGateProps {
	readonly controller: Controller;
	readonly desktop: boolean;
	readonly productId: ProductId;
	readonly locale: string;
	readonly copy: Readonly<Record<string, unknown>>;
	readonly children: ReactNode;
	readonly loadWarmup?: WarmupLoader;
}

/** Keep the editor mounted while desktop Speed makes its non-AI code ready. */
export default function DesktopSpeedWarmupGate({
	controller, desktop, productId, locale, copy, children, loadWarmup = loadDesktopWarmup,
}: DesktopSpeedWarmupGateProps) {
	const snapshot = useSyncExternalStore(
		controller.subscribe, controller.getSnapshot, controller.getSnapshot,
	);
	const [frozenMode, setFrozenMode] = useState<SessionMode | null>(null);
	const [warmupReady, setWarmupReady] = useState(false);
	const [failedCount, setFailedCount] = useState<number | 'fatal' | null>(null);
	const warmupPromise = useRef<Promise<WarmupResult> | null>(null);
	const mode = frozenMode ?? (snapshot.ready
		? desktop && snapshot.preferences?.performance?.optimizeFor === 'speed' ? 'speed' : 'memory'
		: null);
	useLayoutEffect(() => {
		if (frozenMode === null && mode !== null) setFrozenMode(mode);
	}, [frozenMode, mode]);
	useEffect(() => {
		if (mode !== 'speed') return undefined;
		let active = true;
		warmupPromise.current ??= Promise.resolve().then(() => loadWarmup({
			desktop: true, productId, performance: { optimizeFor: 'speed' },
		}));
		void warmupPromise.current.then((result) => {
			const failures = result && typeof result === 'object' ? result.failed.length : 0;
			if (failures) {
				controller.recordLocalDiagnosticError?.(
					new Error(`Desktop Speed could not preload ${failures} feature modules.`),
					'workspace',
				);
			}
			if (active) {
				setFailedCount(failures);
				setWarmupReady(true);
			}
		}, (error: unknown) => {
			controller.recordLocalDiagnosticError?.(error, 'workspace');
			if (active) {
				setFailedCount('fatal');
				setWarmupReady(true);
			}
		});
		return () => { active = false; };
	}, [controller, loadWarmup, mode, productId]);
	const speed = mode === 'speed';
	const loading = speed && !warmupReady;
	return <>
		<div
			style={{ display: 'contents' }}
			data-desktop-speed-warmup={speed ? loading ? 'loading' : 'ready' : undefined}
			data-desktop-speed-warmup-failed={speed && warmupReady ? failedCount : undefined}
			aria-busy={loading ? true : undefined}
			inert={loading}
		>
			{children}
		</div>
		{loading && <div role="status" style={{
			position: 'fixed', inset: 0, zIndex: 2147483647,
			display: 'flex', alignItems: 'center', justifyContent: 'center',
			background: 'var(--website-color-surface-raised, #fff)',
		}}>
			<EditorStartupProgress copy={copy} locale={locale} />
		</div>}
	</>;
}

async function loadDesktopWarmup(options: DesktopSpeedWarmupOptions): Promise<WarmupResult> {
	const { warmDesktopSpeedFeatures } = await import('./desktop-speed-warmup.ts');
	return await warmDesktopSpeedFeatures(options);
}
