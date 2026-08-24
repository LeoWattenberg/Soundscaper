/* SPDX-License-Identifier: AGPL-3.0-only */

#include <windows.h>
#include <aclapi.h>
#include <userenv.h>
#include <io.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <string>
#include <vector>

namespace {
constexpr char attestation[] = "M5_NATIVE_ISOLATION_ENFORCED_V1\n";
constexpr size_t maximumGrants = 64u;
enum class Access { readOnly, readExecute, writeOnly };
struct Grant { HANDLE handle; Access access; };
struct Values {
	HANDLE attestation = nullptr, profile = nullptr, broker = nullptr, executable = nullptr;
	HANDLE extraInput = nullptr;
	std::vector<Grant> grants;
	std::wstring authorityProfile;
	SIZE_T rss = 0u; uint64_t durationMs = 0u;
};

bool exactFd(const std::wstring &value, const wchar_t *prefix, HANDLE &output)
{
	const size_t length = std::wcslen(prefix);
	if (value.rfind(prefix, 0u) != 0u) return false;
	if (output != nullptr) ExitProcess(125u);
	wchar_t *end = nullptr; const auto raw = std::wcstoull(value.c_str() + length, &end, 10);
	if (end == nullptr || *end != L'\0' || raw < 3u || raw > 4095u) ExitProcess(125u);
	const intptr_t handle = _get_osfhandle(static_cast<int>(raw));
	if (handle == -1) ExitProcess(125u);
	output = reinterpret_cast<HANDLE>(handle); return true;
}

bool exactNumber(const std::wstring &value, const wchar_t *prefix, uint64_t &slot)
{
	const size_t length = std::wcslen(prefix);
	if (value.rfind(prefix, 0u) != 0u) return false;
	if (slot != 0u) ExitProcess(125u);
	wchar_t *end = nullptr; const auto parsed = std::wcstoull(value.c_str() + length, &end, 10);
	if (end == nullptr || *end != L'\0' || parsed == 0u) ExitProcess(125u);
	slot = parsed; return true;
}

std::wstring finalPath(HANDLE handle)
{
	std::array<wchar_t, 32768> path{};
	const DWORD length = GetFinalPathNameByHandleW(handle, path.data(), static_cast<DWORD>(path.size()),
		FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
	if (length == 0u || length >= path.size()) ExitProcess(125u);
	return path.data();
}

bool sameFile(HANDLE left, HANDLE right)
{
	FILE_ID_INFO a{}, b{};
	return GetFileInformationByHandleEx(left, FileIdInfo, &a, sizeof(a))
		&& GetFileInformationByHandleEx(right, FileIdInfo, &b, sizeof(b))
		&& a.VolumeSerialNumber == b.VolumeSerialNumber
		&& std::memcmp(a.FileId.Identifier, b.FileId.Identifier, sizeof(a.FileId.Identifier)) == 0;
}

bool authorityProfile(const std::wstring &value, std::wstring &output)
{
	constexpr wchar_t prefix[] = L"--authority-profile=";
	if (value.rfind(prefix, 0u) != 0u) return false;
	if (!output.empty()) ExitProcess(125u);
	const std::wstring profile = value.substr(std::wcslen(prefix));
	const size_t separator = profile.find(L':');
	if (separator == std::wstring::npos || profile.size() - separator - 1u != 64u) ExitProcess(125u);
	const std::wstring brand = profile.substr(0u, separator);
	if (brand != L"soundscaper-professional" && brand != L"framescaper-media"
		&& brand != L"framescaper-openfx") ExitProcess(125u);
	if (!std::all_of(profile.begin() + static_cast<ptrdiff_t>(separator + 1u), profile.end(),
		[](wchar_t byte) { return (byte >= L'0' && byte <= L'9') || (byte >= L'a' && byte <= L'f'); })) {
		ExitProcess(125u);
	}
	output = profile;
	return true;
}

std::wstring appContainerName(const std::wstring &profile)
{
	const size_t separator = profile.find(L':');
	const std::wstring brand = profile.substr(0u, separator);
	const std::wstring digest = profile.substr(separator + 1u, 40u);
	if (brand == L"soundscaper-professional") return L"Soundscaper.M5.Plugin." + digest;
	if (brand == L"framescaper-media") return L"Framescaper.M5.Media." + digest;
	if (brand == L"framescaper-openfx") return L"Framescaper.M5.OpenFX." + digest;
	ExitProcess(125u);
}

PSID appContainerSid(const std::wstring &profile)
{
	PSID sid = nullptr;
	const auto name = appContainerName(profile);
	const HRESULT status = DeriveAppContainerSidFromAppContainerName(name.c_str(), &sid);
	if (FAILED(status) || sid == nullptr) ExitProcess(125u);
	return sid;
}

void grantExactAccess(HANDLE source, PSID sid, Access access)
{
	const auto path = finalPath(source);
	const HANDLE handle = CreateFileW(path.c_str(), READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES,
		FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
		FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr);
	if (handle == INVALID_HANDLE_VALUE || !sameFile(source, handle)) ExitProcess(125u);
	PSECURITY_DESCRIPTOR descriptor = nullptr;
	PACL currentAcl = nullptr, exactAcl = nullptr;
	if (GetSecurityInfo(handle, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
		nullptr, nullptr, &currentAcl, nullptr, &descriptor) != ERROR_SUCCESS) ExitProcess(125u);
	EXPLICIT_ACCESSW entry{};
	entry.grfAccessPermissions = access == Access::writeOnly
		? FILE_GENERIC_WRITE | FILE_DELETE_CHILD : FILE_GENERIC_READ
			| (access == Access::readExecute ? FILE_GENERIC_EXECUTE : 0u);
	entry.grfAccessMode = SET_ACCESS;
	entry.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
	entry.Trustee.TrusteeForm = TRUSTEE_IS_SID;
	entry.Trustee.TrusteeType = TRUSTEE_IS_GROUP;
	entry.Trustee.ptstrName = static_cast<LPWSTR>(sid);
	if (SetEntriesInAclW(1u, &entry, currentAcl, &exactAcl) != ERROR_SUCCESS
		|| SetSecurityInfo(handle, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
			nullptr, nullptr, exactAcl, nullptr) != ERROR_SUCCESS) ExitProcess(125u);
	// This is an exact brand/payload AppContainer policy, not a launcher lease.
	// Its security never depends on a later restore that a crash could skip.
	LocalFree(exactAcl);
	LocalFree(descriptor);
	CloseHandle(handle);
}

std::wstring quote(const std::wstring &value)
{
	if (value.find_first_of(L" \t\"") == std::wstring::npos) return value;
	std::wstring output = L"\""; size_t slashes = 0u;
	for (const wchar_t byte : value) {
		if (byte == L'\\') { ++slashes; continue; }
		if (byte == L'\"') output.append(slashes * 2u + 1u, L'\\');
		else output.append(slashes, L'\\');
		slashes = 0u; output.push_back(byte);
	}
	output.append(slashes * 2u, L'\\'); return output + L"\"";
}

std::vector<unsigned char> crtDescriptors(HANDLE extraInput)
{
	const int count = extraInput == nullptr ? 3 : 4;
	std::vector<unsigned char> bytes(sizeof(int) + static_cast<size_t>(count)
		+ static_cast<size_t>(count) * sizeof(intptr_t), 0u);
	*reinterpret_cast<int *>(bytes.data()) = count;
	auto *flags = bytes.data() + sizeof(int);
	auto *handles = reinterpret_cast<intptr_t *>(flags + count);
	for (int index = 0; index < count; ++index) {
		const DWORD selector = index == 0 ? STD_INPUT_HANDLE : index == 1 ? STD_OUTPUT_HANDLE : STD_ERROR_HANDLE;
		const HANDLE handle = index < 3 ? GetStdHandle(selector) : extraInput;
		if (handle == nullptr || handle == INVALID_HANDLE_VALUE
			|| !SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) ExitProcess(125u);
		flags[index] = 0x09u; handles[index] = reinterpret_cast<intptr_t>(handle);
	}
	return bytes;
}
}

int wmain(int argc, wchar_t **argv)
{
	Values values; std::vector<std::wstring> child; bool separator = false;
	for (int index = 1; index < argc; ++index) {
		const std::wstring option(argv[index]);
		if (separator) { child.push_back(option); continue; }
		if (option == L"--") { separator = true; continue; }
		if (exactFd(option, L"--attestation-fd=", values.attestation)
			|| exactFd(option, L"--profile-fd=", values.profile)
			|| exactFd(option, L"--broker-policy-fd=", values.broker)
			|| exactFd(option, L"--executable-fd=", values.executable)
			|| exactFd(option, L"--extra-input-fd=", values.extraInput)
			|| authorityProfile(option, values.authorityProfile)) continue;
		for (const auto [prefix, access] : std::array{
			std::pair{L"--read-only-fd=", Access::readOnly},
			std::pair{L"--read-execute-fd=", Access::readExecute},
			std::pair{L"--write-only-fd=", Access::writeOnly},
		}) {
			HANDLE handle = nullptr;
			if (exactFd(option, prefix, handle)) { values.grants.push_back({handle, access}); goto admitted; }
		}
		if (option.rfind(L"--maximum-rss-bytes=", 0u) == 0u) {
			if (values.rss != 0u) return 125;
			uint64_t value = 0u; if (!exactNumber(option, L"--maximum-rss-bytes=", value)) return 125;
			if (value > static_cast<uint64_t>(SIZE_MAX)) return 125; values.rss = static_cast<SIZE_T>(value); continue;
		}
		if (exactNumber(option, L"--maximum-duration-ms=", values.durationMs)) continue;
		return 125;
	admitted: if (values.grants.size() > maximumGrants) return 125;
	}
	if (!separator || values.attestation == nullptr || values.profile == nullptr || values.broker == nullptr
		|| values.executable == nullptr || values.authorityProfile.empty()
		|| values.rss == 0u || values.durationMs == 0u || child.empty()) return 125;
	std::vector<HANDLE> unique{ values.attestation, values.profile, values.broker, values.executable };
	if (values.extraInput != nullptr) unique.push_back(values.extraInput);
	for (const auto &grant : values.grants) unique.push_back(grant.handle);
	std::sort(unique.begin(), unique.end());
	if (std::adjacent_find(unique.begin(), unique.end()) != unique.end()) return 125;

	const auto executable = finalPath(values.executable);
	std::wstring command = quote(executable);
	for (size_t index = 1u; index < child.size(); ++index) command += L" " + quote(child[index]);
	PSID sid = appContainerSid(values.authorityProfile);
	grantExactAccess(values.executable, sid, Access::readExecute);
	for (const auto &grant : values.grants) grantExactAccess(grant.handle, sid, grant.access);
	SECURITY_CAPABILITIES capabilities{ sid, nullptr, 0u, 0u };
	const auto crt = crtDescriptors(values.extraInput);
	std::vector<HANDLE> inherited{ GetStdHandle(STD_INPUT_HANDLE), GetStdHandle(STD_OUTPUT_HANDLE),
		GetStdHandle(STD_ERROR_HANDLE) };
	if (values.extraInput != nullptr) inherited.push_back(values.extraInput);
	SIZE_T bytes = 0u; InitializeProcThreadAttributeList(nullptr, 2u, 0u, &bytes);
	std::vector<unsigned char> storage(bytes);
	auto *attributes = reinterpret_cast<PPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
	if (!InitializeProcThreadAttributeList(attributes, 2u, 0u, &bytes)
		|| !UpdateProcThreadAttribute(attributes, 0u, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
			&capabilities, sizeof(capabilities), nullptr, nullptr)
		|| !UpdateProcThreadAttribute(attributes, 0u, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
			inherited.data(), inherited.size() * sizeof(HANDLE), nullptr, nullptr)) return 125;
	HANDLE job = CreateJobObjectW(nullptr, nullptr);
	JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
	limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		| JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_PROCESS_TIME;
	limits.BasicLimitInformation.ActiveProcessLimit = 1u; limits.ProcessMemoryLimit = values.rss;
	limits.BasicLimitInformation.PerProcessUserTimeLimit.QuadPart = static_cast<LONGLONG>(values.durationMs) * 10000ll;
	if (job == nullptr || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return 125;
	STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup); startup.lpAttributeList = attributes;
	startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
	startup.StartupInfo.hStdInput = inherited[0]; startup.StartupInfo.hStdOutput = inherited[1];
	startup.StartupInfo.hStdError = inherited[2]; startup.StartupInfo.cbReserved2 = static_cast<WORD>(crt.size());
	startup.StartupInfo.lpReserved2 = const_cast<LPBYTE>(crt.data());
	PROCESS_INFORMATION process{};
	if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE,
		CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
		nullptr, nullptr, &startup.StartupInfo, &process)
		|| !AssignProcessToJobObject(job, process.hProcess)) return 125;
	DWORD written = 0u;
	if (!WriteFile(values.attestation, attestation, sizeof(attestation) - 1u, &written, nullptr)
		|| written != sizeof(attestation) - 1u || ResumeThread(process.hThread) == static_cast<DWORD>(-1)) return 125;
	WaitForSingleObject(process.hProcess, INFINITE);
	DWORD exitCode = 125u; GetExitCodeProcess(process.hProcess, &exitCode);
	CloseHandle(process.hThread); CloseHandle(process.hProcess); CloseHandle(job); FreeSid(sid);
	DeleteProcThreadAttributeList(attributes);
	return static_cast<int>(exitCode);
}
