/* SPDX-License-Identifier: AGPL-3.0-only */

#include "professional_host_containment_probe.h"

#include <array>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <winsock2.h>
#include <windows.h>
#else
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace soundscaper {
namespace {

bool option(const char *value, const char *prefix, std::string &output)
{
	const size_t length = std::strlen(prefix);
	if (std::strncmp(value, prefix, length) != 0 || value[length] == '\0') return false;
	output.assign(value + length);
	return output.find('\0') == std::string::npos;
}

int denied(const char *operation)
{
	return std::printf("SOUNDSCAPER_CONTAINMENT_PROBE %s denied\n", operation) > 0
		&& std::fflush(stdout) == 0 ? 0 : 125;
}

int filesystemProbe(int argc, char **argv)
{
	std::string authorizedPath, unauthorizedPath;
	if (argc != 4 || !option(argv[2], "--authorized-path=", authorizedPath)
		|| !option(argv[3], "--unauthorized-path=", unauthorizedPath)) return 125;
	FILE *authorized = std::fopen(authorizedPath.c_str(), "rb");
	if (authorized == nullptr) return 125;
	const int firstByte = std::fgetc(authorized);
	const bool authorizedRead = firstByte != EOF && std::fclose(authorized) == 0;
	FILE *unauthorized = std::fopen(unauthorizedPath.c_str(), "rb");
	if (unauthorized != nullptr) {
		(void)std::fclose(unauthorized);
		return 126;
	}
	if (!authorizedRead) return 125;
	return std::fputs(
		"SOUNDSCAPER_CONTAINMENT_PROBE filesystem authorized-read unauthorized-denied\n",
		stdout) >= 0 && std::fflush(stdout) == 0 ? 0 : 125;
}

int networkProbe(int argc, char **argv)
{
	std::string rawPort;
	if (argc != 3 || !option(argv[2], "--loopback-port=", rawPort)) return 125;
	char *end = nullptr;
	errno = 0;
	const auto parsed = std::strtoul(rawPort.c_str(), &end, 10);
	if (errno != 0 || end == rawPort.c_str() || *end != '\0' || parsed < 1u || parsed > 65535u) return 125;
#if defined(_WIN32)
	WSADATA data{};
	if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return denied("network");
	const SOCKET handle = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if (handle == INVALID_SOCKET) { (void)WSACleanup(); return denied("network"); }
#else
	const int handle = socket(AF_INET, SOCK_STREAM, 0);
	if (handle < 0) return denied("network");
#endif
	sockaddr_in address{};
	address.sin_family = AF_INET;
	address.sin_port = htons(static_cast<uint16_t>(parsed));
	address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	const bool connected = connect(handle, reinterpret_cast<const sockaddr *>(&address), sizeof(address)) == 0;
#if defined(_WIN32)
	(void)closesocket(handle);
	(void)WSACleanup();
#else
	(void)close(handle);
#endif
	return connected ? 126 : denied("network");
}

int childProcessProbe(int argc)
{
	if (argc != 2) return 125;
#if defined(_WIN32)
	std::array<wchar_t, 32768> executable{};
	if (GetModuleFileNameW(nullptr, executable.data(), static_cast<DWORD>(executable.size())) == 0u) return 125;
	std::wstring command = L"\"" + std::wstring(executable.data()) + L"\"";
	std::vector<wchar_t> mutableCommand(command.begin(), command.end());
	mutableCommand.push_back(L'\0');
	STARTUPINFOW startup{}; startup.cb = sizeof(startup);
	PROCESS_INFORMATION process{};
	const BOOL created = CreateProcessW(executable.data(), mutableCommand.data(), nullptr, nullptr,
		FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process);
	if (created) {
		(void)TerminateProcess(process.hProcess, 126u);
		(void)WaitForSingleObject(process.hProcess, 5000u);
		(void)CloseHandle(process.hThread); (void)CloseHandle(process.hProcess);
		return 126;
	}
#else
	const pid_t child = fork();
	if (child == 0) _exit(0);
	if (child > 0) { (void)waitpid(child, nullptr, 0); return 126; }
#endif
	return denied("child-process");
}

#if defined(__APPLE__)
int residentMemoryProbe(int argc)
{
	if (argc != 2 || std::fputs(
		"SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling pressure-started\n", stdout) < 0
		|| std::fflush(stdout) != 0) return 125;
	constexpr size_t pressureBytes = 256u * 1024u * 1024u;
	std::vector<uint8_t> pressure(pressureBytes);
	volatile uint8_t *resident = pressure.data();
	for (size_t offset = 0u; offset < pressure.size(); offset += 4096u) resident[offset] = 0x5au;
	(void)sleep(1u);
	return std::fputs("SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling survived\n", stdout) >= 0
		&& std::fflush(stdout) == 0 ? 126 : 125;
}
#endif

} // namespace

int professionalHostContainmentProbe(int argc, char **argv)
{
	if (argc == 1) return -1;
	constexpr const char prefix[] = "--soundscaper-containment-probe=";
	if (std::strncmp(argv[1], prefix, sizeof(prefix) - 1u) != 0) return 125;
	const char *scenario = argv[1] + sizeof(prefix) - 1u;
	if (std::strcmp(scenario, "filesystem") == 0) return filesystemProbe(argc, argv);
	if (std::strcmp(scenario, "network") == 0) return networkProbe(argc, argv);
	if (std::strcmp(scenario, "child-process") == 0) return childProcessProbe(argc);
#if defined(__APPLE__)
	if (std::strcmp(scenario, "rss-ceiling") == 0) return residentMemoryProbe(argc);
#endif
	return 125;
}

} // namespace soundscaper
