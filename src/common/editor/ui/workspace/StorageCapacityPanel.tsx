/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';
import type { EditorSnapshot } from '../../types.ts';
import { createStorageCapacityViewModel } from '../storage-capacity-model.ts';

interface StorageActionGroup {
	refresh(): unknown;
	requestPersistence(): unknown;
	cleanupDisposable(): unknown;
	cleanupDerivatives(): unknown;
}

interface StorageCapacityPanelProps {
	readonly snapshot: EditorSnapshot;
	readonly locale: string;
	readonly controller: Readonly<{ actions: Readonly<{ storage: StorageActionGroup }> }>;
	run(action: () => unknown): unknown;
}

export default function StorageCapacityPanel({
	snapshot,
	locale,
	controller,
	run,
}: StorageCapacityPanelProps) {
	const model = createStorageCapacityViewModel(snapshot.storage, locale);
	return <details
		className="kw-audio-editor__storage-capacity"
		data-storage-capacity
		data-storage-pressure={model.pressure}
	>
		<summary>{model.summary}</summary>
		<dl>
			<div><dt>{model.capacityLabel}</dt><dd>{model.capacity}</dd></div>
			<div><dt>{model.backendLabel}</dt><dd>{model.backend}</dd></div>
			<div><dt>{model.evictionLabel}</dt><dd>{model.evictionProtection}</dd></div>
			<div><dt>{model.preflightLabel}</dt><dd>{model.preflight}</dd></div>
		</dl>
		<div className="kw-audio-editor__storage-capacity-actions">
			<button type="button" onClick={() => void run(() => controller.actions.storage.refresh())}>
				{model.refreshLabel}
			</button>
			<button
				type="button"
				disabled={model.requestPersistenceDisabled}
				onClick={() => void run(() => controller.actions.storage.requestPersistence())}
			>
				{model.requestPersistenceLabel}
			</button>
			<button
				type="button"
				disabled={model.cleanupDisabled}
				onClick={() => void run(() => controller.actions.storage.cleanupDisposable())}
			>
				{model.cleanupLabel}
			</button>
			<button
				type="button"
				disabled={model.derivativeCleanupDisabled}
				onClick={() => void run(() => controller.actions.storage.cleanupDerivatives())}
			>
				{model.derivativeCleanupLabel}
			</button>
		</div>
	</details>;
}
