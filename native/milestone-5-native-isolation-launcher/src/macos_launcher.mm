/* SPDX-License-Identifier: AGPL-3.0-only */

#include <sandbox.h>
#include <fcntl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syslimits.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <climits>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace {
constexpr size_t maximumGrants = 64u;
constexpr char expectedBroker[] = "{\"schemaVersion\":1,\"id\":\"milestone5-macos-seatbelt-broker-v1\","
	"\"maximumGrants\":64,\"pathAuthority\":\"fcntl-f-getpath-from-inherited-fd\","
	"\"filesystem\":\"seatbelt-exact-literals\",\"network\":\"denied\","
	"\"childProcesses\":\"fork-denied-exec-peer-only\",\"environment\":\"fixed-empty\","
	"\"attestation\":\"post-sandbox-pre-exec-pipe-v1\"}\n";
enum class Access { readOnly, readExecute, writeOnly };
struct Grant { int fd; Access access; };
struct Request {
	int attestationFd = -1, profileFd = -1, brokerFd = -1, executableFd = -1;
	int extraInputFd = -1;
	uint64_t durationMs = 0u, rssBytes = 0u;
	std::vector<Grant> grants;
	char **childArgv = nullptr;
};

bool singleton(const char *value, const char *prefix, int &output)
{
	if (std::strncmp(value, prefix, std::strlen(prefix)) != 0) return false;
	if (output >= 0) std::exit(125);
	char *end = nullptr; const long parsed = std::strtol(value + std::strlen(prefix), &end, 10);
	if (end == nullptr || *end != '\0' || parsed < 3 || parsed > INT_MAX) std::exit(125);
	output = static_cast<int>(parsed); return true;
}

bool number(const char *value, const char *prefix, uint64_t &output)
{
	if (std::strncmp(value, prefix, std::strlen(prefix)) != 0) return false;
	if (output != 0u) std::exit(125);
	char *end = nullptr; const auto parsed = std::strtoull(value + std::strlen(prefix), &end, 10);
	if (end == nullptr || *end != '\0' || parsed == 0u) std::exit(125);
	output = parsed; return true;
}

Request request(int argc, char **argv)
{
	Request result;
	for (int index = 1; index < argc; ++index) {
		if (std::strcmp(argv[index], "--") == 0) { result.childArgv = argv + index + 1; break; }
		if (singleton(argv[index], "--attestation-fd=", result.attestationFd)
			|| singleton(argv[index], "--profile-fd=", result.profileFd)
			|| singleton(argv[index], "--broker-policy-fd=", result.brokerFd)
			|| singleton(argv[index], "--executable-fd=", result.executableFd)
			|| singleton(argv[index], "--extra-input-fd=", result.extraInputFd)
			|| number(argv[index], "--maximum-duration-ms=", result.durationMs)
			|| number(argv[index], "--maximum-rss-bytes=", result.rssBytes)) continue;
		for (const auto &[prefix, access] : std::array{
			std::pair{"--read-only-fd=", Access::readOnly},
			std::pair{"--read-execute-fd=", Access::readExecute},
			std::pair{"--write-only-fd=", Access::writeOnly},
		}) if (std::strncmp(argv[index], prefix, std::strlen(prefix)) == 0) {
			int fd = -1; (void)singleton(argv[index], prefix, fd); result.grants.push_back({fd, access}); goto admitted;
		}
		return {};
	admitted: if (result.grants.size() > maximumGrants) return {};
	}
	return result;
}

bool valid(const Request &value)
{
	std::vector<int> descriptors{ value.attestationFd, value.profileFd, value.brokerFd, value.executableFd };
	if (value.extraInputFd >= 0) descriptors.push_back(value.extraInputFd);
	for (const auto &grant : value.grants) descriptors.push_back(grant.fd);
	std::sort(descriptors.begin(), descriptors.end());
	if (std::adjacent_find(descriptors.begin(), descriptors.end()) != descriptors.end()) return false;
	struct stat metadata{};
	if (fstat(value.executableFd, &metadata) != 0 || !S_ISREG(metadata.st_mode)) return false;
	if (value.extraInputFd >= 0 && (fstat(value.extraInputFd, &metadata) != 0
		|| (!S_ISFIFO(metadata.st_mode) && !S_ISSOCK(metadata.st_mode)))) return false;
	return true;
}

std::string exactText(int fd, size_t maximum)
{
	struct stat metadata{};
	if (fstat(fd, &metadata) != 0 || !S_ISREG(metadata.st_mode) || metadata.st_size < 1
		|| static_cast<uint64_t>(metadata.st_size) > maximum) std::exit(125);
	std::string result(static_cast<size_t>(metadata.st_size), '\0');
	if (pread(fd, result.data(), result.size(), 0) != static_cast<ssize_t>(result.size())) std::exit(125);
	return result;
}

std::string pathFor(int fd)
{
	std::array<char, PATH_MAX> bytes{};
	if (fcntl(fd, F_GETPATH, bytes.data()) != 0 || bytes[0] != '/') std::exit(125);
	return bytes.data();
}

std::string literal(const std::string &value)
{
	std::string result = "\"";
	for (char byte : value) { if (byte == '\\' || byte == '"') result.push_back('\\'); result.push_back(byte); }
	return result + "\"";
}

std::string profile(const Request &value)
{
	std::string output = exactText(value.profileFd, 4096u);
	output += "(allow process-exec (literal " + literal(pathFor(value.executableFd)) + "))";
	for (const auto &grant : value.grants) {
		const auto path = literal(pathFor(grant.fd));
		struct stat metadata{}; if (fstat(grant.fd, &metadata) != 0) std::exit(125);
		const auto selector = std::string(S_ISDIR(metadata.st_mode) ? "(subpath " : "(literal ") + path + ")";
		if (grant.access == Access::writeOnly) output += "(allow file-write* " + selector + ")";
		else if (grant.access == Access::readExecute) {
			output += "(allow file-read* file-map-executable " + selector + ")";
		} else output += "(allow file-read* " + selector + ")";
	}
	return output;
}

bool enterSandbox(const std::string &policy)
{
	char *error = nullptr;
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#endif
	const int status = sandbox_init(policy.c_str(), 0u, &error);
	if (status != 0 && error != nullptr) sandbox_free_error(error);
#if defined(__clang__)
#pragma clang diagnostic pop
#endif
	return status == 0;
}
}

int main(int argc, char **argv)
{
	const auto value = request(argc, argv);
	if (value.attestationFd < 0 || value.profileFd < 0 || value.brokerFd < 0 || value.executableFd < 0
		|| value.durationMs == 0u || value.rssBytes == 0u || value.childArgv == nullptr
		|| value.childArgv[0] == nullptr || !valid(value)) return 125;
	struct rlimit memory{ value.rssBytes, value.rssBytes };
	struct rlimit cpu{ (value.durationMs + 999u) / 1000u, (value.durationMs + 999u) / 1000u };
	if (setrlimit(RLIMIT_AS, &memory) != 0 || setrlimit(RLIMIT_CPU, &cpu) != 0) return 125;
	const auto policy = profile(value);
	if (exactText(value.brokerFd, 4096u) != expectedBroker) return 125;
	if (!enterSandbox(policy)) return 125;
	// Darwin has no supported atomic executable-FD operation. A path launch cannot
	// preserve the authenticated descriptor identity, so machine availability must remain false.
	return 125;
}
