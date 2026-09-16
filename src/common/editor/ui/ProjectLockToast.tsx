/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';

import EditorToast from './EditorToast.tsx';

interface ProjectLockToastProps {
	readonly snapshot: Readonly<{ lockReadOnly?: boolean }>;
	readonly copy: Readonly<{
		projectOpenOtherTab: string;
		claimProjectLock: string;
		claimingProjectLock: string;
		close: string;
	}>;
	readonly controller: Readonly<{
		actions: Readonly<{ project: Readonly<{ claimLock(): unknown }> }>;
	}>;
	run(action: () => unknown): unknown;
}

/** The workspace remounts this notification for each new project-lock loss. */
export default function ProjectLockToast({ snapshot, copy, controller, run }: ProjectLockToastProps) {
	const [dismissed, setDismissed] = useState(false);
	const [claimingLock, setClaimingLock] = useState(false);
	if (!snapshot.lockReadOnly || dismissed) return null;
	const claimProjectLock = () => {
		if (claimingLock) return;
		setClaimingLock(true);
		run(async () => {
			try {
				await controller.actions.project.claimLock();
			} finally {
				setClaimingLock(false);
			}
		});
	};
	return <EditorToast
		id="project-lock"
		title={copy.projectOpenOtherTab}
		type="warning"
		actions={[{
			label: claimingLock ? copy.claimingProjectLock : copy.claimProjectLock,
			disabled: claimingLock,
			onClick: claimProjectLock,
		}]}
		dismissLabel={copy.close}
		onDismiss={() => setDismissed(true)}
	/>;
}
