/* SPDX-License-Identifier: AGPL-3.0-only */

import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { TOOLBAR_DOCKS, type ToolbarDock } from '../../controller/composition/toolbar-docking-session.ts';
import { workspaceDockLabel } from './workspace-panel-model.ts';

interface Props {
	readonly copy: Record<string, string>;
	readonly dock: ToolbarDock;
	readonly onDock: (dock: ToolbarDock) => void;
	readonly onClose: () => void;
}

export default function ToolbarDockingMenu({ copy, dock, onDock, onClose }: Props) {
	return <ContextMenuItem label={copy.toolbarDocking} hasSubmenu>
		{TOOLBAR_DOCKS.map((target) => <ContextMenuItem
			key={target}
			label={workspaceDockLabel(copy, target)}
			checked={dock === target}
			onClick={() => { onDock(target); onClose(); }}
		/>)}
	</ContextMenuItem>;
}
