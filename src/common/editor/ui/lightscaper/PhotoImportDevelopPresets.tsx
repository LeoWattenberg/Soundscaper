/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoLibraryDevelopPresetReadV1, PhotoLibraryDevelopPresetSnapshotV1 } from '../../photo-library-develop-presets-port-v1.ts';
import type { PhotoDevelopSettingsCopyV1 } from '../../../i18n/lightscaper-develop-settings-copy.ts';
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';

export interface PhotoImportDevelopPresetsPropsV1 {
	readonly readPresets: (options?: Readonly<{ signal?: AbortSignal }>) => Promise<PhotoLibraryDevelopPresetSnapshotV1>;
	readonly value: PhotoLibraryDevelopPresetReadV1 | null;
	readonly onChange: (value: PhotoLibraryDevelopPresetReadV1 | null) => void;
	readonly busy: boolean;
	readonly copy: PhotoDevelopSettingsCopyV1;
	/** Remains true until the borrowed list actually settles, including after unmount. */
	readonly onPending: (pending: boolean) => void;
}
interface Scope {
	live: boolean; needsRead: boolean;
	readonly read: PhotoImportDevelopPresetsPropsV1['readPresets'];
	readonly receiver: PhotoImportDevelopPresetsPropsV1;
	readonly notify: PhotoImportDevelopPresetsPropsV1['onPending'];
}
interface Demand { readonly scope: Scope; readonly controller: AbortController; readonly completion: Promise<void> }
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const RETAINED = '$retained';

/** Only the opted-in mounted selector borrows a scalar menu; it has no recipe/body capability. */
export default function PhotoImportDevelopPresets(props: PhotoImportDevelopPresetsPropsV1) {
	const [snapshot, setSnapshot] = useState<PhotoLibraryDevelopPresetSnapshotV1 | null>(null);
	const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
	const latest = useRef(props); latest.current = props;
	const scope = useRef<Scope | null>(null), active = useRef<Demand | null>(null);
	const inventory = useRef<PhotoLibraryDevelopPresetSnapshotV1 | null>(null);
	const observe = useCallback((current: Scope) => {
		const live = () => current.live && scope.current === current && latest.current.readPresets === current.read;
		if (!live() || active.current || latest.current.busy) return;
		current.needsRead = false;
		let finish!: () => void;
		const job: Demand = { scope: current, controller: new AbortController(), completion: new Promise(resolve => { finish = resolve; }) };
		active.current = job; setPending(true); setFailed(false);
		void (async () => {
			try {
				current.notify(true); Reflect.apply(nativeAbort, job.controller.signal, []);
				if (!live()) return;
				const result = await Reflect.apply(current.read, current.receiver, [{ signal: job.controller.signal }]);
				Reflect.apply(nativeAbort, job.controller.signal, []);
				if (live()) { const next = detachSnapshot(result); inventory.current = next; setSnapshot(next); }
			} catch {
				if (live() && !Reflect.apply(nativeAborted, job.controller.signal, [])) setFailed(true);
			} finally {
				if (active.current === job) active.current = null;
				if (scope.current?.live) setPending(false);
				try { current.notify(false); } finally { finish(); }
			}
		})().catch(() => undefined);
	}, []);
	const readPresets = props.readPresets;
	useEffect(() => {
		const owner = latest.current, current: Scope = { live: true, needsRead: true, read: readPresets, receiver: owner, notify: owner.onPending };
		scope.current = current; inventory.current = null; setSnapshot(null); setFailed(false);
		const previous = active.current;
		if (previous) void previous.completion.then(() => { observe(current); });
		else observe(current);
		return () => { current.live = false; if (active.current?.scope === current) active.current.controller.abort(); };
	}, [readPresets, observe]);
	useEffect(() => {
		const current = scope.current;
		if (!props.busy && current?.needsRead && !active.current) observe(current);
	}, [props.busy, readPresets, observe]);
	const interactive = () => {
		const current = scope.current;
		return current?.live && current.read === readPresets && latest.current === props && inventory.current === snapshot
			&& !props.busy && !active.current ? current : null;
	};
	const compatible = props.value && snapshot && props.value.catalogId === snapshot.catalogId && props.value.expectedRevision === snapshot.revision
		&& snapshot.presets.some(preset => preset.id === props.value!.presetId);
	const selected = props.value === null ? '' : compatible ? props.value.presetId : RETAINED;
	return <section data-import-develop-presets aria-label={props.copy.presets} aria-busy={pending}>
		<h3>{props.copy.presets}</h3>
		{pending && <p role="status">{props.copy.working}</p>}{failed && <p role="alert">{props.copy.actionFailed}</p>}
		<label>{props.copy.choosePreset}<select data-import-develop-choice aria-label={props.copy.choosePreset} value={selected}
			disabled={props.busy || pending || snapshot === null} onChange={event => {
				if (!interactive()) return;
				const id = event.currentTarget.value, menu = inventory.current;
				if (id === '') { props.onChange(null); return; }
				if (!menu?.presets.some(preset => preset.id === id)) return;
				props.onChange(Object.freeze({ schemaVersion: 1, catalogId: menu.catalogId, presetId: id, expectedRevision: menu.revision }));
			}}>
			<option value="">{props.copy.noPreset}</option>
			{selected === RETAINED && <option value={RETAINED}>{props.value!.presetId}</option>}
			{snapshot?.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name} ({preset.scope === 'full' ? props.copy.full : props.copy.partial})</option>)}
		</select></label>
		<button type="button" data-import-develop-reload disabled={props.busy || pending} onClick={() => {
			const current = interactive(); if (current) observe(current);
		}}>{props.copy.reloadPresets}</button>
	</section>;
}

function detachSnapshot(value: unknown): PhotoLibraryDevelopPresetSnapshotV1 {
	const input = record(value, 'Import Develop preset menu', ['schemaVersion', 'catalogId', 'revision', 'presets']);
	const revision = field(input, 'revision', 'Import Develop preset menu');
	if (field(input, 'schemaVersion', 'Import Develop preset menu') !== 1 || typeof revision !== 'number'
		|| !Number.isSafeInteger(revision) || revision < 0 || Object.is(revision, -0)) throw new TypeError('Invalid Develop preset menu revision.');
	const catalogId = stableId(field(input, 'catalogId', 'Import Develop preset menu'));
	const presets = array(field(input, 'presets', 'Import Develop preset menu'), 'Import Develop presets', 0, 16).map(value => {
		const row = record(value, 'Import Develop preset info', ['id', 'name', 'scope', 'authoredStateSha256']);
		const name = field(row, 'name', 'Import Develop preset info'), scope = field(row, 'scope', 'Import Develop preset info');
		const digest = field(row, 'authoredStateSha256', 'Import Develop preset info');
		if (typeof name !== 'string' || !name.trim() || name.length > 256 || name !== name.normalize('NFC')
			|| (scope !== 'full' && scope !== 'partial') || typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw new TypeError('Invalid Develop preset info.');
		return Object.freeze({ id: stableId(field(row, 'id', 'Import Develop preset info')), name, scope, authoredStateSha256: digest });
	});
	if (new Set(presets.map(preset => preset.id)).size !== presets.length) throw new TypeError('Duplicate Develop preset identities.');
	return Object.freeze({ schemaVersion: 1, catalogId, revision, presets: Object.freeze(presets) });
}
function stableId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Invalid Develop preset identity.');
	return value;
}
