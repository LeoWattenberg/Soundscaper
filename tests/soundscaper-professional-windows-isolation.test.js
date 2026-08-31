/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve('native/milestone-5-native-isolation-launcher');
const [SOURCE, PROFILE, BROKER] = await Promise.all([
	readFile(resolve(ROOT, 'src/windows_launcher.cpp'), 'utf8'),
	readFile(resolve(ROOT, 'profiles/windows-v1.json'), 'utf8'),
	readFile(resolve(ROOT, 'profiles/windows-broker-v1.json'), 'utf8'),
]);

test('Windows registers the exact AppContainer profile before creating its process', () => {
	assert.match(SOURCE,
		/CreateAppContainerProfile\([\s\S]*HRESULT_FROM_WIN32\(ERROR_ALREADY_EXISTS\)[\s\S]*DeriveAppContainerSidFromAppContainerName/u);
	assert.match(SOURCE, /substr\(separator \+ 1u, 40u\)/u,
		'the persistent profile SID must remain bound to the full admitted digest prefix');
	assert.doesNotMatch(SOURCE, /DeleteAppContainerProfile/u,
		'per-launch deletion can race another process using the same exact profile');
});

test('Windows constructs the inherited CRT handle table without unaligned stores', () => {
	assert.match(SOURCE, /handleOffset[\s\S]*std::memcpy\(/u);
	assert.doesNotMatch(SOURCE, /reinterpret_cast<intptr_t \*>\(flags \+ count\)/u,
		'ARM64 cannot admit a pointer aligned only after the variable byte flags');
});

test('Windows reports a bounded pre-enforcement API stage without merging guards', () => {
	assert.match(SOURCE, /M5_NATIVE_ISOLATION_FAILURE_V1/u);
	assert.match(PROFILE,
		/"enforcementHandshake":"post-assignment-pre-resume-enforcement-pipe-v1"/u);
	assert.match(SOURCE, /if \(!CreateProcessW\([\s\S]*nativeFailure\("create-process"/u);
	assert.match(SOURCE, /if \(!AssignProcessToJobObject\([\s\S]*nativeFailure\("assign-job"/u);
	assert.match(SOURCE,
		/if \(!AssignProcessToJobObject\([\s\S]*TerminateProcess\([\s\S]*nativeFailure\("assign-job"/u,
		'the unassigned suspended child must be terminated before the launcher exits');
	assert.doesNotMatch(`${SOURCE}\n${PROFILE}`, /attest/iu);
});

test('Windows opts the peer out of ambient all-application-package access', () => {
	assert.match(SOURCE, /PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT/u,
		'the peer must use a less-privileged AppContainer token');
	assert.match(SOURCE, /PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY/u,
		'ambient All Application Packages ACLs must not broaden exact broker grants');
	assert.match(SOURCE,
		/PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT[\s\S]*UpdateProcThreadAttribute\(attributes,[\s\S]*PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY[\s\S]*nativeFailure\("all-application-packages-policy"[\s\S]*PROC_THREAD_ATTRIBUTE_HANDLE_LIST/u,
		'the LPAC policy must fail closed before inherited handles and process creation');
	assert.match(SOURCE,
		/InitializeProcThreadAttributeList\(nullptr, 3u,[\s\S]*InitializeProcThreadAttributeList\(attributes, 3u,/u,
		'the LPAC policy must occupy its own process attribute slot');
	assert.match(PROFILE, /less-privileged-appcontainer-low-integrity/u);
	assert.match(PROFILE, /exact-user-and-appcontainer-sid-intersection-grants/u);
	assert.match(BROKER,
		/persistent-exact-user-and-less-privileged-appcontainer-intersection-policy/u);
});

test('Windows grants LPAC only the read-only registry capability required by SxS manifests', () => {
	const authorityBody = /bool registryReadAuthority\(const std::wstring &profile\)\n\{([\s\S]*?)\n\}/u
		.exec(SOURCE)?.[1] ?? '';
	assert.match(SOURCE, /DeriveCapabilitySidsFromName\(L"registryRead"/u);
	assert.match(authorityBody, /soundscaper-professional/u);
	assert.match(authorityBody, /framescaper-openfx/u);
	assert.doesNotMatch(authorityBody, /framescaper-media/u);
	assert.match(SOURCE,
		/registryReadAuthority\(values\.authorityProfile\)[\s\S]*SID_AND_ATTRIBUTES registryRead[\s\S]*SE_GROUP_ENABLED[\s\S]*SECURITY_CAPABILITIES capabilities/u);
	assert.doesNotMatch(SOURCE, /L"(?:internetClient|internetClientServer|privateNetworkClientServer|lpacCom)"/u);
	assert.match(SOURCE,
		/DeleteProcThreadAttributeList\(attributes\)[\s\S]*LocalFree\(registryReadSid\)[\s\S]*FreeSid\(sid\)/u,
		'the process attributes must release before the SIDs they reference');
	assert.deepEqual(JSON.parse(PROFILE).capabilitiesByBrand, {
		'framescaper-media': [],
		'framescaper-openfx': ['registryRead'],
		'soundscaper-professional': ['registryRead'],
	});
	assert.match(BROKER, /dynamic-plugin-brands-acl-scoped-registryRead-capability/u);
});

test('Windows exact grants satisfy both LPAC access-check principals', () => {
	assert.match(SOURCE,
		/OpenProcessToken\(GetCurrentProcess\(\), TOKEN_QUERY[\s\S]*GetTokenInformation\([^,]+, TokenUser/u);
	assert.match(SOURCE,
		/std::array<EXPLICIT_ACCESSW, 2>[\s\S]*TRUSTEE_IS_GROUP[\s\S]*TRUSTEE_IS_USER[\s\S]*SetEntriesInAclW\(2u/u);
});
