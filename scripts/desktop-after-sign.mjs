/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export default async function verifyDesktopSignature(context) {
	const name = context.packager.appInfo.productFilename;
	if (context.electronPlatformName === 'darwin' && process.env.SCAPE_MAC_SIGNING === 'true') {
		const app = join(context.appOutDir, `${name}.app`);
		await execute('codesign', ['--verify', '--deep', '--strict', '--test-requirement',
			`anchor apple generic and certificate leaf[subject.OU] = "${process.env.APPLE_TEAM_ID}"`, app]);
		await execute('xcrun', ['stapler', 'validate', app]);
		await execute('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
	}
	if (context.electronPlatformName === 'win32' && ['azure', 'certificate'].includes(process.env.SCAPE_WIN_SIGNING)) {
		await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
			join(import.meta.dirname, 'verify-windows-release-signature.ps1'), '-Artifact', join(context.appOutDir, `${name}.exe`)]);
	}
}
