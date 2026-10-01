/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportProjectTransferBundle, importProjectTransferBundle } from '../src/common/transfer/project-transfer-bundle.ts';
import { receiveProjectTransfer, sendProjectTransfer } from '../src/common/transfer/project-transfer-handshake.ts';
import type { TransferRuntime } from '../src/common/transfer/transfer-session.ts';
import type { createFakeArchive } from './project-transfer-bundle-fixture.ts';

export function runtimeFor(archive: ReturnType<typeof createFakeArchive>): TransferRuntime {
	return {
		exportProject: archive.exportProject as TransferRuntime['exportProject'],
		inspectProject: archive.inspectProject as TransferRuntime['inspectProject'],
		importProject: archive.importProject as TransferRuntime['importProject'],
		exportBundle: exportProjectTransferBundle,
		importBundle: importProjectTransferBundle,
		sendTransfer: sendProjectTransfer,
		receiveTransfer: receiveProjectTransfer,
	};
}
