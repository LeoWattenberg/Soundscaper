/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { TimeCodeMusicalContext } from '../../../../vendor/audacity-design-system/components/src/TimeCode/time-code-musical-context.ts';
import { createMusicalTimeCodeMap, type MusicalTimeCodeProject } from './time-code-musical-map.ts';

interface MusicalController {
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => Readonly<{ project?: unknown }>;
}
const emptySnapshot: Readonly<{ project?: unknown }> = {};
const noSnapshot = () => emptySnapshot;
const noSubscribe = () => () => undefined;

export default function EditorMusicalTimeCodeProvider({ controller, children }: {
	readonly controller?: MusicalController;
	readonly children: ReactNode;
}) {
	const getSnapshot = controller?.getSnapshot ?? noSnapshot;
	const snapshot = useSyncExternalStore(controller?.subscribe ?? noSubscribe, getSnapshot, getSnapshot);
	const map = useMemo(() => {
		const project = snapshot.project as Partial<MusicalTimeCodeProject> | undefined;
		return project?.sampleRate && project.tempoMap?.events.length && project.signatureMap?.events.length
			? createMusicalTimeCodeMap(project as MusicalTimeCodeProject) : undefined;
	}, [snapshot.project]);
	return <TimeCodeMusicalContext.Provider value={map}>{children}</TimeCodeMusicalContext.Provider>;
}
