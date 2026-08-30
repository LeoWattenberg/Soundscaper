/* SPDX-License-Identifier: AGPL-3.0-only */

/** Persistent binary RPC peer; all third-party plug-in code stays in this process. */

#include "professional_host_api.h"

#include <algorithm>
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
#include <fcntl.h>
#include <io.h>
#else
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace {

constexpr size_t maximumFrameBytes = 16u * 1024u * 1024u;
constexpr size_t maximumStateBytes = maximumFrameBytes - 64u;
constexpr std::array<uint8_t, 4> magic{ 'M', '5', 'F', '1' };

enum class Operation : uint8_t {
	scan = 1u, open = 2u, process = 3u, latency = 4u,
	save = 5u, load = 6u, close = 7u, vendor = 8u,
};

enum class VendorOperation : uint8_t { open = 1u, close = 2u };

bool exactRead(FILE *stream, void *bytes, size_t length)
{
	return length == 0u || std::fread(bytes, 1u, length, stream) == length;
}

bool exactWrite(FILE *stream, const void *bytes, size_t length)
{
	return (length == 0u || std::fwrite(bytes, 1u, length, stream) == length)
		&& std::fflush(stream) == 0;
}

uint32_t decode32(const uint8_t *bytes)
{
	return static_cast<uint32_t>(bytes[0]) | static_cast<uint32_t>(bytes[1]) << 8u
		| static_cast<uint32_t>(bytes[2]) << 16u | static_cast<uint32_t>(bytes[3]) << 24u;
}

void encode32(uint8_t *bytes, uint32_t value)
{
	for (uint32_t index = 0u; index < 4u; ++index) bytes[index] = static_cast<uint8_t>(value >> (index * 8u));
}

class Reader {
public:
	explicit Reader(const std::vector<uint8_t> &bytes) : bytes_(bytes) {}
	bool byte(uint8_t &value) { return take(&value, 1u); }
	bool unsigned32(uint32_t &value)
	{
		uint8_t bytes[4];
		if (!take(bytes, sizeof(bytes))) return false;
		value = decode32(bytes);
		return true;
	}
	bool number(double &value)
	{
		uint8_t bytes[8];
		if (!take(bytes, sizeof(bytes))) return false;
		uint64_t encoded = 0u;
		for (uint32_t index = 0u; index < 8u; ++index) encoded |= static_cast<uint64_t>(bytes[index]) << (index * 8u);
		std::memcpy(&value, &encoded, sizeof(value));
		return true;
	}
	bool text(std::string &value, size_t maximum = 4096u)
	{
		uint32_t length = 0u;
		if (!unsigned32(length) || length == 0u || length > maximum || remaining() < length) return false;
		value.assign(reinterpret_cast<const char *>(bytes_.data() + offset_), length);
		offset_ += length;
		return value.find('\0') == std::string::npos;
	}
	bool blob(std::vector<uint8_t> &value, size_t maximum)
	{
		uint32_t length = 0u;
		if (!unsigned32(length) || length > maximum || remaining() < length) return false;
		value.assign(bytes_.begin() + static_cast<ptrdiff_t>(offset_),
			bytes_.begin() + static_cast<ptrdiff_t>(offset_ + length));
		offset_ += length;
		return true;
	}
	bool floats(std::vector<float> &value, uint32_t count)
	{
		const size_t length = static_cast<size_t>(count) * sizeof(float);
		if (count > maximumFrameBytes / sizeof(float) || remaining() < length) return false;
		value.resize(count);
		std::memcpy(value.data(), bytes_.data() + offset_, length);
		offset_ += length;
		return true;
	}
	bool done() const { return offset_ == bytes_.size(); }
private:
	bool take(void *output, size_t length)
	{
		if (remaining() < length) return false;
		std::memcpy(output, bytes_.data() + offset_, length);
		offset_ += length;
		return true;
	}
	size_t remaining() const { return bytes_.size() - offset_; }
	const std::vector<uint8_t> &bytes_;
	size_t offset_ = 0u;
};

class Writer {
public:
	bool byte(uint8_t value) { return append(&value, 1u); }
	bool unsigned32(uint32_t value)
	{
		uint8_t bytes[4]; encode32(bytes, value); return append(bytes, sizeof(bytes));
	}
	bool text(const char *value)
	{
		const size_t length = value == nullptr ? 0u : std::strlen(value);
		return length <= UINT32_MAX && unsigned32(static_cast<uint32_t>(length)) && append(value, length);
	}
	bool blob(const void *value, size_t length)
	{
		return length <= UINT32_MAX && unsigned32(static_cast<uint32_t>(length)) && append(value, length);
	}
	bool floats(const std::vector<float> &value) { return append(value.data(), value.size() * sizeof(float)); }
	const std::vector<uint8_t> &bytes() const { return bytes_; }
private:
	bool append(const void *value, size_t length)
	{
		if (length > maximumFrameBytes - bytes_.size()) return false;
		if (length == 0u) return true;
		const auto *first = static_cast<const uint8_t *>(value);
		bytes_.insert(bytes_.end(), first, first + length);
		return true;
	}
	std::vector<uint8_t> bytes_;
};

bool readFrame(std::vector<uint8_t> &body)
{
	uint8_t header[8];
	const size_t first = std::fread(header, 1u, 1u, stdin);
	if (first == 0u && std::feof(stdin)) return false;
	if (first != 1u || !exactRead(stdin, header + 1u, sizeof(header) - 1u)
		|| !std::equal(magic.begin(), magic.end(), header)) return false;
	const uint32_t length = decode32(header + magic.size());
	if (length < 2u || length > maximumFrameBytes) return false;
	body.resize(length);
	return exactRead(stdin, body.data(), body.size());
}

bool writeFrame(const std::vector<uint8_t> &body)
{
	if (body.empty() || body.size() > maximumFrameBytes) return false;
	uint8_t header[8];
	std::copy(magic.begin(), magic.end(), header);
	encode32(header + magic.size(), static_cast<uint32_t>(body.size()));
	return exactWrite(stdout, header, sizeof(header)) && exactWrite(stdout, body.data(), body.size());
}

bool description(Writer &writer, const soundscaper_pro_plugin_description &value)
{
	return writer.text(value.format) && writer.text(value.stable_id) && writer.text(value.name)
		&& writer.text(value.vendor) && writer.text(value.version)
		&& writer.unsigned32(value.input_channels) && writer.unsigned32(value.output_channels)
		&& writer.unsigned32(value.is_instrument) && writer.unsigned32(value.latency_frames);
}

soundscaper_pro_status scan(
	const std::string &format,
	const std::string &path,
	std::vector<soundscaper_pro_plugin_description> &values)
{
	size_t count = 0u;
	auto status = soundscaper_pro_plugin_scan(format.c_str(), path.c_str(), nullptr, 0u, &count);
	if (status != SOUNDSCAPER_PRO_OK) return status;
	if (count == 0u || count > SOUNDSCAPER_PRO_MAX_PLUGIN_DESCRIPTORS) {
		return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	}
	values.resize(count);
	size_t written = 0u;
	status = soundscaper_pro_plugin_scan(format.c_str(), path.c_str(), values.data(), values.size(), &written);
	return status == SOUNDSCAPER_PRO_OK && written == count ? status : SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
}

class Peer {
public:
	~Peer() { close(); }
	bool finished() const { return finished_; }
	bool dispatch(const std::vector<uint8_t> &request, std::vector<uint8_t> &answer)
	{
		Reader reader(request);
		uint8_t version = 0u, rawOperation = 0u;
		if (!reader.byte(version) || !reader.byte(rawOperation) || version != 1u
			|| rawOperation < static_cast<uint8_t>(Operation::scan)
			|| rawOperation > static_cast<uint8_t>(Operation::vendor)) return false;
		const auto operation = static_cast<Operation>(rawOperation);
		Writer payload;
		const auto status = execute(operation, reader, payload);
		if (!reader.done()) return false;
		Writer response;
		if (!response.byte(1u) || !response.byte(rawOperation)
			|| !response.unsigned32(static_cast<uint32_t>(status))) return false;
		if (status == SOUNDSCAPER_PRO_OK) {
			if (!response.blob(payload.bytes().data(), payload.bytes().size())) return false;
		} else if (!response.text("The isolated professional host refused the exact request.")) return false;
		answer = response.bytes();
		return true;
	}
private:
	soundscaper_pro_status execute(Operation operation, Reader &reader, Writer &writer)
	{
		switch (operation) {
		case Operation::scan: return inspect(reader, writer);
		case Operation::open: return open(reader, writer);
		case Operation::process: return process(reader, writer);
		case Operation::latency: return latency(reader, writer);
		case Operation::save: return save(reader, writer);
		case Operation::load: return load(reader);
		case Operation::close: close(); finished_ = true; return SOUNDSCAPER_PRO_OK;
		case Operation::vendor: return vendor(reader, writer);
		}
		return SOUNDSCAPER_PRO_UNSUPPORTED;
	}
	soundscaper_pro_status inspect(Reader &reader, Writer &writer)
	{
		std::string format, path;
		if (!reader.text(format, 16u) || !reader.text(path)) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		std::vector<soundscaper_pro_plugin_description> values;
		const auto status = scan(format, path, values);
		if (status != SOUNDSCAPER_PRO_OK) return status;
		if (!writer.unsigned32(static_cast<uint32_t>(values.size()))) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		for (const auto &value : values) if (!description(writer, value)) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		return SOUNDSCAPER_PRO_OK;
	}
	soundscaper_pro_status open(Reader &reader, Writer &writer)
	{
		if (plugin_ != nullptr) return SOUNDSCAPER_PRO_MODE_REFUSED;
		std::string format, path, stableId;
		double sampleRate = 0.0;
		uint32_t maximumFrames = 0u;
		if (!reader.text(format, 16u) || !reader.text(path) || !reader.text(stableId, SOUNDSCAPER_PRO_MAX_TEXT - 1u)
			|| !reader.number(sampleRate) || !reader.unsigned32(maximumFrames)) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		std::vector<soundscaper_pro_plugin_description> values;
		auto status = scan(format, path, values);
		const auto matches = std::count_if(values.begin(), values.end(), [&](const auto &value) {
			return stableId == value.stable_id;
		});
		const auto selected = std::find_if(values.begin(), values.end(), [&](const auto &value) {
			return stableId == value.stable_id;
		});
		if (status != SOUNDSCAPER_PRO_OK || matches != 1 || selected == values.end()) {
			return SOUNDSCAPER_PRO_PLUGIN_UNREADABLE;
		}
		status = soundscaper_pro_plugin_open(format.c_str(), path.c_str(), stableId.c_str(), sampleRate,
			maximumFrames, &plugin_);
		if (status == SOUNDSCAPER_PRO_OK) {
			description_ = *selected;
			if (!description(writer, description_)) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		}
		return status;
	}
	soundscaper_pro_status process(Reader &reader, Writer &writer)
	{
		uint32_t frames = 0u, inputCount = 0u, outputCount = 0u;
		if (plugin_ == nullptr || !reader.unsigned32(frames) || frames == 0u || frames > 65536u
			|| !reader.unsigned32(inputCount) || inputCount != description_.input_channels) {
			return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		}
		std::vector<std::vector<float>> inputs(inputCount);
		std::vector<const float *> inputPointers(inputCount);
		for (uint32_t channel = 0u; channel < inputCount; ++channel) {
			if (!reader.floats(inputs[channel], frames)) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
			inputPointers[channel] = inputs[channel].data();
		}
		if (!reader.unsigned32(outputCount) || outputCount != description_.output_channels) {
			return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		}
		std::vector<std::vector<float>> outputs(outputCount, std::vector<float>(frames));
		std::vector<float *> outputPointers(outputCount);
		for (uint32_t channel = 0u; channel < outputCount; ++channel) outputPointers[channel] = outputs[channel].data();
		const auto status = soundscaper_pro_plugin_process(plugin_, inputPointers.data(), inputCount,
			outputPointers.data(), outputCount, frames);
		if (status != SOUNDSCAPER_PRO_OK) return status;
		if (!writer.unsigned32(soundscaper_pro_plugin_latency(plugin_))
			|| !writer.unsigned32(outputCount)) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		for (const auto &channel : outputs) if (!writer.floats(channel)) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		return SOUNDSCAPER_PRO_OK;
	}
	soundscaper_pro_status latency(Reader &, Writer &writer)
	{
		return plugin_ != nullptr && writer.unsigned32(soundscaper_pro_plugin_latency(plugin_))
			? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	}
	soundscaper_pro_status save(Reader &, Writer &writer)
	{
		if (plugin_ == nullptr) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		size_t required = 0u;
		auto status = soundscaper_pro_plugin_save_state(plugin_, nullptr, 0u, &required);
		if ((status != SOUNDSCAPER_PRO_OK && status != SOUNDSCAPER_PRO_STATE_TOO_LARGE)
			|| required > maximumStateBytes) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		std::vector<uint8_t> bytes(required);
		status = soundscaper_pro_plugin_save_state(plugin_, bytes.data(), bytes.size(), &required);
		return status == SOUNDSCAPER_PRO_OK && writer.blob(bytes.data(), required)
			? status : SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	}
	soundscaper_pro_status load(Reader &reader)
	{
		std::vector<uint8_t> bytes;
		return plugin_ != nullptr && reader.blob(bytes, maximumStateBytes)
			? soundscaper_pro_plugin_load_state(plugin_, bytes.data(), bytes.size())
			: SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	}
	soundscaper_pro_status vendor(Reader &reader, Writer &writer)
	{
		uint8_t rawOperation = 0u;
		std::string windowId;
		if (plugin_ == nullptr || !reader.byte(rawOperation) || !reader.text(windowId, 128u)
			|| (rawOperation != static_cast<uint8_t>(VendorOperation::open)
				&& rawOperation != static_cast<uint8_t>(VendorOperation::close))) {
			return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		}
		if (rawOperation == static_cast<uint8_t>(VendorOperation::open)) {
			if (!vendorWindowId_.empty()) return vendorWindowId_ == windowId
				? (writer.byte(1u) ? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_STATE_TOO_LARGE)
				: SOUNDSCAPER_PRO_MODE_REFUSED;
			const auto status = soundscaper_pro_plugin_open_vendor_window(plugin_, windowId.c_str());
			if (status != SOUNDSCAPER_PRO_OK) return status;
			vendorWindowId_ = windowId;
			return writer.byte(1u) ? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_STATE_TOO_LARGE;
		}
		if (vendorWindowId_ != windowId) return SOUNDSCAPER_PRO_MODE_REFUSED;
		soundscaper_pro_plugin_close_vendor_window(plugin_);
		vendorWindowId_.clear();
		return writer.byte(1u) ? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	}
	void close()
	{
		if (plugin_ != nullptr && !vendorWindowId_.empty()) {
			soundscaper_pro_plugin_close_vendor_window(plugin_);
		}
		soundscaper_pro_plugin_close(plugin_);
		plugin_ = nullptr;
		description_ = {};
		vendorWindowId_.clear();
	}
	soundscaper_pro_plugin_instance *plugin_ = nullptr;
	soundscaper_pro_plugin_description description_{};
	std::string vendorWindowId_;
	bool finished_ = false;
};

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

int containmentProbe(int argc, char **argv)
{
	if (argc == 1) return -1;
	constexpr const char prefix[] = "--soundscaper-containment-probe=";
	if (std::strncmp(argv[1], prefix, sizeof(prefix) - 1u) != 0) return 125;
	const char *scenario = argv[1] + sizeof(prefix) - 1u;
	if (std::strcmp(scenario, "filesystem") == 0) return filesystemProbe(argc, argv);
	if (std::strcmp(scenario, "network") == 0) return networkProbe(argc, argv);
	if (std::strcmp(scenario, "child-process") == 0) return childProcessProbe(argc);
	return 125;
}

} // namespace

int main(int argc, char **argv)
{
	const int probe = containmentProbe(argc, argv);
	if (probe >= 0) return probe;
#if defined(_WIN32)
	(void)_setmode(_fileno(stdin), _O_BINARY);
	(void)_setmode(_fileno(stdout), _O_BINARY);
#endif
	Peer peer;
	for (;;) {
		std::vector<uint8_t> request, answer;
		if (!readFrame(request)) return std::feof(stdin) ? 0 : 125;
		if (!peer.dispatch(request, answer) || !writeFrame(answer)) return 125;
		if (peer.finished()) return 0;
	}
}
