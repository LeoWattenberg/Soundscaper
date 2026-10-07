/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { LabelManagerRow } from './LabelManagerRows.jsx';

interface Label {
	readonly id: string;
	readonly trackId: string;
	readonly trackName: string;
	readonly title?: string;
	readonly startFrame: number;
	readonly endFrame: number;
}
interface Props {
	readonly projectId: unknown;
	readonly labels: readonly Label[];
	readonly sampleRate: number;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly controller: Readonly<{ actions: Readonly<{
		labels: Readonly<{ update(trackId: string, id: string, changes: unknown): unknown; remove(trackId: string, id: string): unknown }>;
		timeline: Readonly<{ setSelection(startFrame: number, endFrame: number): unknown }>;
	}> }>;
	run(operation: () => unknown): unknown;
	onAdd(): void;
}
interface Removal {
	readonly control: HTMLElement;
	readonly id: string;
	readonly index: number;
	readonly projectId: unknown;
}

export default function LabelManagerList({ projectId, labels, sampleRate, copy, disabled, controller, run, onAdd }: Props) {
	const list = useRef<HTMLUListElement>(null);
	const add = useRef<HTMLButtonElement>(null);
	const removal = useRef<Removal | null>(null);
	useLayoutEffect(() => {
		const request = removal.current;
		if (!request) return;
		if (!Object.is(request.projectId, projectId)) { removal.current = null; return; }
		if (disabled || labels.some(label => label.id === request.id)) return;
		removal.current = null;
		const document = request.control.ownerDocument;
		if (document.activeElement !== request.control && document.activeElement !== document.body) return;
		const controls = list.current?.querySelectorAll<HTMLElement>('.kw-audio-editor__workspace-panel-close');
		(controls?.[Math.min(request.index, labels.length - 1)] ?? add.current)?.focus();
	}, [disabled, labels, projectId]);
	return <>
		<div className="kw-audio-editor__panel-actions-inline">
			<Button ref={add} variant="secondary" disabled={disabled} onClick={onAdd}>{copy.newLabel || copy.addLabelTrack}</Button>
		</div>
		{labels.length ? <ul ref={list} className="kw-audio-editor__panel-list kw-audio-editor__label-manager" data-labels-panel-list>
			{labels.map((label, index) => <LabelManagerRow key={label.id} label={label} sampleRate={sampleRate}
				controller={controller} copy={copy} disabled={disabled} run={run}
				onRemoving={(control) => { removal.current = control.ownerDocument.activeElement === control
					? { control, id: label.id, index, projectId } : null; }} />)}
		</ul> : <p className="kw-audio-editor__panel-empty">{copy.labelsEmpty}</p>}
	</>;
}
