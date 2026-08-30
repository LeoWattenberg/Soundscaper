/* SPDX-License-Identifier: AGPL-3.0-only */

#include <fcntl.h>
#include <libproc.h>
#include <mach/vm_prot.h>
#include <signal.h>
#include <spawn.h>
#include <sys/proc.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syslimits.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <climits>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace {

namespace bootstrap {
constexpr int attestationDescriptor = 3;
constexpr int policyDescriptor = 4;
constexpr int extraInputDescriptor = 5;
constexpr size_t maximumPolicyBytes = 512u * 1024u;
constexpr std::array<uint8_t, 8> policyMagic{ 'M', '5', 'M', 'A', 'C', 'S', 'B', '1' };
constexpr size_t policyHeaderBytes = 16u;
}

constexpr size_t maximumGrants = 64u;
constexpr size_t maximumMappedRegions = 16384u;
constexpr size_t verifierAttempts = 500u;
constexpr char expectedBroker[] = "{\"schemaVersion\":1,\"id\":\"milestone5-macos-seatbelt-broker-v1\","
	"\"maximumGrants\":64,\"pathAuthority\":\"fcntl-f-getpath-from-inherited-fd\","
	"\"filesystem\":\"seatbelt-exact-literals\",\"network\":\"denied\","
	"\"childProcesses\":\"fork-denied-exec-peer-only\",\"environment\":\"fixed-empty\","
	"\"executionIdentity\":\"posix-spawn-setexec-stopped-public-proc-region-vnode-v1\","
	"\"sandboxEntry\":\"peer-bootstrap-before-work-v1\","
	"\"memory\":\"trusted-verifier-physical-footprint-poll-10ms-v1\","
	"\"attestation\":\"peer-post-sandbox-bootstrap-pipe-v1\"}\n";

enum class Access { readOnly, readExecute, writeOnly };
struct Grant { int fd; Access access; };
struct Request {
	int attestationFd = -1, profileFd = -1, brokerFd = -1, executableFd = -1;
	int extraInputFd = -1;
	uint64_t durationMs = 0u, rssBytes = 0u;
	std::vector<Grant> grants;
	char **childArgv = nullptr;
};
struct FileIdentity { uint64_t device = 0u, inode = 0u, size = 0u; };

[[noreturn]] void nativeFailure(const char *stage, int code)
{
	std::array<char, 128> message{};
	const auto boundedCode = static_cast<unsigned int>(code > 0 ? code : 1);
	const int length = std::snprintf(message.data(), message.size(),
		"M5_NATIVE_ISOLATION_FAILURE_V1 macos %s %u\n", stage, boundedCode);
	if (length > 0 && static_cast<size_t>(length) < message.size()) {
		size_t offset = 0u;
		while (offset < static_cast<size_t>(length)) {
			const ssize_t written = write(STDERR_FILENO, message.data() + offset,
				static_cast<size_t>(length) - offset);
			if (written > 0) { offset += static_cast<size_t>(written); continue; }
			if (written < 0 && errno == EINTR) continue;
			break;
		}
	}
	_exit(125);
}

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

bool exactWrite(int descriptor, const void *input, size_t length)
{
	const auto *bytes = static_cast<const uint8_t *>(input);
	size_t offset = 0u;
	while (offset < length) {
		const ssize_t written = write(descriptor, bytes + offset, length - offset);
		if (written > 0) { offset += static_cast<size_t>(written); continue; }
		if (written < 0 && errno == EINTR) continue;
		return false;
	}
	return true;
}

bool descriptorIdentity(int descriptor, FileIdentity &output)
{
	struct stat metadata{};
	if (fstat(descriptor, &metadata) != 0 || !S_ISREG(metadata.st_mode) || metadata.st_size < 1) return false;
	output = { static_cast<uint64_t>(metadata.st_dev), static_cast<uint64_t>(metadata.st_ino),
		static_cast<uint64_t>(metadata.st_size) };
	return true;
}

bool firstMappedVnode(pid_t process, FileIdentity &output)
{
	uint64_t address = 0u;
	for (size_t count = 0u; count < maximumMappedRegions; ++count) {
		proc_regionwithpathinfo region{};
		if (proc_pidinfo(process, PROC_PIDREGIONPATHINFO, address, &region, sizeof(region))
			!= static_cast<int>(sizeof(region))) return false;
		const auto &mapping = region.prp_prinfo;
		const auto &status = region.prp_vip.vip_vi.vi_stat;
		if ((mapping.pri_protection & VM_PROT_EXECUTE) != 0u
			&& S_ISREG(status.vst_mode) && status.vst_ino != 0u && status.vst_size > 0) {
			output = { static_cast<uint64_t>(status.vst_dev), static_cast<uint64_t>(status.vst_ino),
				static_cast<uint64_t>(status.vst_size) };
			return true;
		}
		if (mapping.pri_size == 0u
			|| mapping.pri_address > std::numeric_limits<uint64_t>::max() - mapping.pri_size) return false;
		const uint64_t next = mapping.pri_address + mapping.pri_size;
		if (next <= address) return false;
		address = next;
	}
	return false;
}

bool snapshotOpenDescriptors(std::vector<int> &output)
{
	const int required = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0u, nullptr, 0);
	if (required <= 0 || required % static_cast<int>(sizeof(proc_fdinfo)) != 0) return false;
	std::vector<proc_fdinfo> rows(static_cast<size_t>(required) / sizeof(proc_fdinfo));
	const int received = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0u,
		rows.data(), static_cast<int>(rows.size() * sizeof(proc_fdinfo)));
	if (received <= 0 || received % static_cast<int>(sizeof(proc_fdinfo)) != 0) return false;
	const size_t count = static_cast<size_t>(received) / sizeof(proc_fdinfo);
	output.reserve(count);
	for (size_t index = 0u; index < count; ++index) output.push_back(rows[index].proc_fd);
	return true;
}

bool sameIdentity(const FileIdentity &left, const FileIdentity &right)
{
	return left.device == right.device && left.inode == right.inode && left.size == right.size;
}

bool stopped(pid_t process)
{
	proc_bsdinfo information{};
	return proc_pidinfo(process, PROC_PIDTBSDINFO, 0u, &information, sizeof(information))
		== static_cast<int>(sizeof(information)) && information.pbi_status == SSTOP
		&& (information.pbi_flags & PROC_FLAG_EXEC) != 0u;
}

std::array<uint8_t, bootstrap::policyHeaderBytes> policyHeader(size_t length, bool hasExtraInput)
{
	std::array<uint8_t, bootstrap::policyHeaderBytes> result{};
	std::copy(bootstrap::policyMagic.begin(), bootstrap::policyMagic.end(), result.begin());
	const auto encoded = static_cast<uint32_t>(length);
	for (uint32_t index = 0u; index < 4u; ++index) {
		result[bootstrap::policyMagic.size() + index] = static_cast<uint8_t>(encoded >> (index * 8u));
	}
	result[12] = hasExtraInput ? 1u : 0u;
	return result;
}

[[noreturn]] void verifierFailure(pid_t parent)
{
	if (getppid() == parent) (void)kill(parent, SIGKILL);
	_exit(125);
}

[[noreturn]] void monitorPhysicalFootprint(pid_t parent, uint64_t maximumRssBytes)
{
	const timespec interval{ 0, 10'000'000 };
	for (;;) {
		if (getppid() != parent) _exit(0);
		rusage_info_v2 usage{};
		if (proc_pid_rusage(parent, RUSAGE_INFO_V2,
			reinterpret_cast<rusage_info_t *>(&usage)) != 0) {
			if (getppid() != parent) _exit(0);
			verifierFailure(parent);
		}
		if (usage.ri_phys_footprint > maximumRssBytes) verifierFailure(parent);
		if (nanosleep(&interval, nullptr) != 0 && errno != EINTR) verifierFailure(parent);
	}
}

[[noreturn]] void verifyAndRelease(
	pid_t parent,
	uint64_t maximumRssBytes,
	int executableFd,
	int policyWriteFd,
	const std::vector<int> &openDescriptors,
	const FileIdentity &launcherIdentity,
	const FileIdentity &executableIdentity,
	const std::array<uint8_t, bootstrap::policyHeaderBytes> &header,
	const std::string &policy)
{
	if (dup2(executableFd, 0) != 0 || dup2(policyWriteFd, 1) != 1) verifierFailure(parent);
	for (const int descriptor : openDescriptors) {
		if (descriptor > 1 && close(descriptor) != 0) verifierFailure(parent);
	}
	struct sigaction ignoreBrokenPipe{};
	ignoreBrokenPipe.sa_handler = SIG_IGN;
	if (sigemptyset(&ignoreBrokenPipe.sa_mask) != 0
		|| sigaction(SIGPIPE, &ignoreBrokenPipe, nullptr) != 0) verifierFailure(parent);
	const timespec interval{ 0, 10'000'000 };
	for (size_t attempt = 0u; attempt < verifierAttempts; ++attempt) {
		if (getppid() != parent) _exit(125);
		FileIdentity mapped{};
		if (firstMappedVnode(parent, mapped) && !sameIdentity(mapped, launcherIdentity)) {
			if (!sameIdentity(mapped, executableIdentity)) verifierFailure(parent);
			if (stopped(parent)) {
				if (!exactWrite(1, header.data(), header.size()) || kill(parent, SIGCONT) != 0) {
					verifierFailure(parent);
				}
				if (!exactWrite(1, policy.data(), policy.size()) || close(1) != 0) verifierFailure(parent);
				(void)close(0);
				monitorPhysicalFootprint(parent, maximumRssBytes);
			}
		}
		(void)nanosleep(&interval, nullptr);
	}
	verifierFailure(parent);
}

int failureCode()
{
	return errno > 0 ? errno : EIO;
}

int makeInheritable(int descriptor)
{
	const int flags = fcntl(descriptor, F_GETFD);
	if (flags < 0) return failureCode();
	if ((flags & FD_CLOEXEC) != 0 && fcntl(descriptor, F_SETFD, flags & ~FD_CLOEXEC) != 0) {
		return failureCode();
	}
	return 0;
}

int mapBootstrapDescriptors(
	int attestationSource,
	int policySource,
	int extraInputSource,
	const std::vector<int> &openDescriptors)
{
	if (dup2(attestationSource, bootstrap::attestationDescriptor) != bootstrap::attestationDescriptor
		|| dup2(policySource, bootstrap::policyDescriptor) != bootstrap::policyDescriptor) {
		return failureCode();
	}
	if (extraInputSource >= 0) {
		if (dup2(extraInputSource, bootstrap::extraInputDescriptor) != bootstrap::extraInputDescriptor) {
			return failureCode();
		}
	} else if (close(bootstrap::extraInputDescriptor) != 0 && errno != EBADF) {
		return failureCode();
	}
	const int lastDescriptor = extraInputSource >= 0
		? bootstrap::extraInputDescriptor : bootstrap::policyDescriptor;
	for (int descriptor = 0; descriptor <= lastDescriptor; ++descriptor) {
		if (const int status = makeInheritable(descriptor); status != 0) return status;
	}
	for (const int descriptor : openDescriptors) {
		if (descriptor > bootstrap::extraInputDescriptor
			&& close(descriptor) != 0) return failureCode();
	}
	return 0;
}

} // namespace

int main(int argc, char **argv)
{
	const auto value = request(argc, argv);
	if (value.attestationFd < 0 || value.profileFd < 0 || value.brokerFd < 0 || value.executableFd < 0
		|| value.durationMs == 0u || value.rssBytes == 0u || value.childArgv == nullptr
		|| value.childArgv[0] == nullptr || !valid(value)) return 125;
	// Darwin charges its multi-gigabyte dyld shared region to RLIMIT_AS; the
	// trusted verifier below therefore supervises the peer's actual RSS.
	struct rlimit cpu{ (value.durationMs + 999u) / 1000u, (value.durationMs + 999u) / 1000u };
	if (setrlimit(RLIMIT_CPU, &cpu) != 0) return 125;
	const auto policy = profile(value);
	if (policy.empty() || policy.size() > bootstrap::maximumPolicyBytes
		|| exactText(value.brokerFd, 4096u) != expectedBroker) return 125;
	FileIdentity launcherIdentity{}, executableIdentity{};
	if (!firstMappedVnode(getpid(), launcherIdentity)
		|| !descriptorIdentity(value.executableFd, executableIdentity)
		|| sameIdentity(launcherIdentity, executableIdentity)) return 125;
	const auto executablePath = pathFor(value.executableFd);
	int policyPipe[2]{ -1, -1 };
	if (pipe(policyPipe) != 0) return 125;
	const int attestationSource = fcntl(value.attestationFd, F_DUPFD_CLOEXEC, 6);
	const int policySource = fcntl(policyPipe[0], F_DUPFD_CLOEXEC, 6);
	const int extraInputSource = value.extraInputFd < 0
		? -1 : fcntl(value.extraInputFd, F_DUPFD_CLOEXEC, 6);
	if (attestationSource < 0 || policySource < 0 || (value.extraInputFd >= 0 && extraInputSource < 0)) return 125;
	posix_spawnattr_t attributes{};
	if (posix_spawnattr_init(&attributes) != 0) {
		(void)close(policyPipe[0]); (void)close(policyPipe[1]);
		return 125;
	}
	constexpr short flags = POSIX_SPAWN_SETEXEC | POSIX_SPAWN_START_SUSPENDED;
	if (posix_spawnattr_setflags(&attributes, flags) != 0) {
		(void)posix_spawnattr_destroy(&attributes);
		(void)close(policyPipe[0]); (void)close(policyPipe[1]);
		return 125;
	}
	std::vector<int> openDescriptors;
	if (!snapshotOpenDescriptors(openDescriptors)) return 125;
	const auto header = policyHeader(policy.size(), value.extraInputFd >= 0);
	const pid_t parent = getpid();
	const pid_t verifier = fork();
	if (verifier < 0) return 125;
	if (verifier == 0) verifyAndRelease(parent, value.rssBytes, value.executableFd,
		policyPipe[1], openDescriptors,
		launcherIdentity, executableIdentity, header, policy);
	const int transportStatus = mapBootstrapDescriptors(
		attestationSource, policySource, extraInputSource, openDescriptors);
	if (transportStatus != 0) {
		(void)kill(verifier, SIGKILL);
		while (waitpid(verifier, nullptr, 0) < 0 && errno == EINTR) {}
		nativeFailure("transport-fds", transportStatus);
	}
	char language[] = "LANG=C";
	char locale[] = "LC_ALL=C";
	char path[] = "PATH=";
	char home[] = "HOME=/nonexistent";
	char *environment[]{ language, locale, path, home, nullptr };
	const int status = posix_spawn(nullptr, executablePath.c_str(), nullptr, &attributes,
		value.childArgv, environment);
	(void)kill(verifier, SIGKILL);
	while (waitpid(verifier, nullptr, 0) < 0 && errno == EINTR) {}
	(void)posix_spawnattr_destroy(&attributes);
	nativeFailure("posix-spawn", status);
}
