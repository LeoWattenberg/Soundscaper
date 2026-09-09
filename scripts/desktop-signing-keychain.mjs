#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
if (process.platform !== 'darwin') throw new Error('Signing keychains require a macOS runner.');
if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required.');
const directory = join(resolve(process.env.RUNNER_TEMP), 'soundscaper-signing');
const keychain = join(directory, 'release.keychain-db');
if (process.argv[2] === 'cleanup') {
	await execute('security', ['delete-keychain', keychain]).catch(() => {});
	await rm(directory, { recursive: true, force: true });
} else if (process.argv[2] === 'setup') {
	const encoded = process.env.MAC_CERTIFICATE_P12;
	const password = process.env.MAC_CERTIFICATE_PASSWORD;
	if (!encoded || !password || !process.env.GITHUB_ENV) throw new Error('Mac certificate secrets are incomplete.');
	await mkdir(directory, { mode: 0o700 });
	const certificate = join(directory, 'identity.p12');
	await writeFile(certificate, Buffer.from(encoded, 'base64'), { mode: 0o600, flag: 'wx' });
	const temporaryPassword = randomBytes(32).toString('hex');
	try {
		await execute('security', ['create-keychain', '-p', temporaryPassword, keychain]);
		await execute('security', ['set-keychain-settings', '-lut', '21600', keychain]);
		await execute('security', ['unlock-keychain', '-p', temporaryPassword, keychain]);
		await execute('security', ['import', certificate, '-k', keychain, '-P', password,
			'-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
		await execute('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', temporaryPassword, keychain]);
		await appendFile(process.env.GITHUB_ENV, `CSC_KEYCHAIN=${keychain}\n`);
	} catch {
		// execFile errors include argv; never print private-key passwords.
		throw new Error('Unable to import the Developer ID certificate into the temporary signing keychain.');
	} finally {
		await rm(certificate, { force: true });
	}
} else throw new Error('Expected setup or cleanup.');
