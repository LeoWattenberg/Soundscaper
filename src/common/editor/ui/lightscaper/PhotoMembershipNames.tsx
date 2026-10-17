/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useState } from 'react';
import type { PhotoLibraryDefinitionReader } from '../../controller/shared/photo-library-definition-reader.ts';
import type { PhotoLibraryDefinitionReadRequestV1, PhotoLibraryDefinitionSnapshotV1 } from '../../photo-library-organization-port-v1.ts';
import type { PhotoLibraryDefinitionKindV1 } from '../../photo-library-session-port-v1.ts';

type ReadDefinition = (request: PhotoLibraryDefinitionReadRequestV1) => Promise<PhotoLibraryDefinitionSnapshotV1>;

interface Props {
	readonly ids: readonly string[];
	readonly kind: PhotoLibraryDefinitionKindV1;
	readonly snapshotKey: string;
	readonly copy: Readonly<{ photoWorking: string; photoDefinitionFailed: string; photoMembershipRemove: string }>;
	readonly reader: Pick<PhotoLibraryDefinitionReader, 'read'>;
	readonly readDefinition: ReadDefinition;
	readonly onRemove: (id: string) => void;
}

/** Only the current membership page has names; IDs retain command identity. */
export default function PhotoMembershipNames(props: Props) {
	const { kind, snapshotKey, reader, readDefinition, copy } = props;
	if (props.ids.length > 64) throw new RangeError('Membership names exceed one display page.');
	const idsKey = props.ids.join('\0');
	const [state, setState] = useState({ idsKey, kind, snapshotKey, readDefinition, names: new Map<string, string | null>() });
	useEffect(() => {
		const controller = new AbortController(); let live = true;
		void Promise.resolve().then(async () => {
			if (!live) return;
			setState({ idsKey, kind, snapshotKey, readDefinition, names: new Map() });
			for (const id of idsKey ? idsKey.split('\0') : []) {
				if (!live || controller.signal.aborted) return;
				let name: string | null = null;
				try {
					const snapshot = await reader.read(readDefinition, { kind, id, signal: controller.signal });
					if (snapshot.row.kind === kind && snapshot.row.id === id && typeof snapshot.row.name === 'string'
						&& snapshot.row.name.length > 0 && snapshot.row.name.length <= 256) name = snapshot.row.name;
				} catch { /* The stable ID remains visible only as an explicit failure fallback. */ }
				if (!live || controller.signal.aborted) return;
				setState(previous => ({ ...previous, names: new Map(previous.names).set(id, name) }));
			}
		});
		return () => { live = false; controller.abort(); };
	}, [idsKey, kind, snapshotKey, reader, readDefinition]);
	const current = state.idsKey === idsKey && state.kind === kind && state.snapshotKey === snapshotKey && state.readDefinition === readDefinition;
	return <ul>{props.ids.map(id => {
		const name = current ? state.names.get(id) : undefined;
		return <li key={id} data-membership-id={id}><span data-membership-name={id}>
			{name === undefined ? copy.photoWorking : name === null ? `${copy.photoDefinitionFailed} (${id})` : name}
		</span><button type="button" data-membership-remove={id} onClick={() => { props.onRemove(id); }}>{copy.photoMembershipRemove}</button></li>;
	})}</ul>;
}
