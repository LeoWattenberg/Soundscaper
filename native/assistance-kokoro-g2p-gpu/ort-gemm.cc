// SPDX-License-Identifier: AGPL-3.0-only
// GPU matrix products for the exact learned spaCy G2P models; no weight changes.
#include "onnxruntime_cxx_api.h"
#include "webgpu_probe.h"
#include <array>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#if defined(_WIN32)
#include <windows.h>
#define SCAPE_EXPORT __declspec(dllexport)
#else
#include <dlfcn.h>
#define SCAPE_EXPORT __attribute__((visibility("default")))
#endif

extern "C" SCAPE_EXPORT int scape_g2p_gpu_open(void **output, const char *profile) noexcept;

namespace {
// Self-authored, dynamic float32 matrix product graph; inputs and outputs remain CPU buffers.
static constexpr unsigned char kModel[] = {
  0x08,0x0a,0x3a,0x6c,0x0a,0x16,0x0a,0x01,0x78,0x0a,0x01,0x79,0x12,0x06,0x6f,0x75,
  0x74,0x70,0x75,0x74,0x22,0x06,0x4d,0x61,0x74,0x4d,0x75,0x6c,0x12,0x08,0x67,0x32,
  0x70,0x2d,0x67,0x65,0x6d,0x6d,0x5a,0x15,0x0a,0x01,0x78,0x12,0x10,0x0a,0x0e,0x08,
  0x01,0x12,0x0a,0x0a,0x03,0x12,0x01,0x6d,0x0a,0x03,0x12,0x01,0x6b,0x5a,0x15,0x0a,
  0x01,0x79,0x12,0x10,0x0a,0x0e,0x08,0x01,0x12,0x0a,0x0a,0x03,0x12,0x01,0x6b,0x0a,
  0x03,0x12,0x01,0x6e,0x62,0x1a,0x0a,0x06,0x6f,0x75,0x74,0x70,0x75,0x74,0x12,0x10,
  0x0a,0x0e,0x08,0x01,0x12,0x0a,0x0a,0x03,0x12,0x01,0x6d,0x0a,0x03,0x12,0x01,0x6e,
  0x42,0x02,0x10,0x0d,
};

std::filesystem::path Root() {
#if defined(_WIN32)
  HMODULE module = nullptr;
  if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCWSTR>(&scape_g2p_gpu_open), &module)) throw std::runtime_error("G2P GPU closure is unavailable");
  std::array<wchar_t, 32768> path{};
  const DWORD count = GetModuleFileNameW(module, path.data(), static_cast<DWORD>(path.size()));
  if (!count || count >= path.size()) throw std::runtime_error("G2P GPU closure is unavailable");
  return std::filesystem::path(std::wstring(path.data(), count)).parent_path();
#else
  Dl_info info{};
  if (!dladdr(reinterpret_cast<void *>(&scape_g2p_gpu_open), &info) || !info.dli_fname) throw std::runtime_error("G2P GPU closure is unavailable");
  return std::filesystem::absolute(info.dli_fname).parent_path();
#endif
}

struct Runtime {
  Ort::Env env{ORT_LOGGING_LEVEL_ERROR, "soundscaper-g2p-gpu"};
  std::filesystem::path plugin_path;
  Runtime() {
    const auto root = Root();
#if defined(_WIN32)
    ScapeRunWebGpuProbe(root / "onnx-webgpu-device-probe.exe");
    const auto plugin = root / "onnxruntime_providers_webgpu.dll";
#elif defined(__APPLE__)
    ScapeRunWebGpuProbe(root / "onnx-webgpu-device-probe");
    const auto plugin = root / "libonnxruntime_providers_webgpu.dylib";
#else
    ScapeRunWebGpuProbe(root / "onnx-webgpu-device-probe");
    const auto plugin = root / "libonnxruntime_providers_webgpu.so";
#endif
    plugin_path = plugin;
    env.RegisterExecutionProviderLibrary("soundscaper-g2p-webgpu", plugin.c_str());
  }
};

Runtime &GpuRuntime() {
  static Runtime runtime;
  return runtime;
}

struct Context {
  std::unique_ptr<Ort::Session> session;
  bool profiling = false;
  explicit Context(const char *profile) {
    auto &runtime = GpuRuntime();
    auto &env = runtime.env;
    for (const auto &device : env.GetEpDevices()) {
      if (!ScapeIsWebGpuPluginDevice(device, runtime.plugin_path)) continue;
      Ort::SessionOptions options;
      options.AppendExecutionProvider_V2(env, {device}, std::unordered_map<std::string, std::string>{});
      options.AddConfigEntry("session.disable_cpu_ep_fallback", "1");
      options.SetIntraOpNumThreads(1);
      options.SetInterOpNumThreads(1);
      if (profile && *profile) {
        const auto path = std::filesystem::u8path(profile);
        options.EnableProfiling(path.c_str());
        profiling = true;
      }
      session = std::make_unique<Ort::Session>(env, kModel, sizeof(kModel), options);
      return;
    }
    throw std::runtime_error("G2P has no compatible WebGPU adapter");
  }
};

bool Valid(std::int64_t m, std::int64_t k, std::int64_t n) {
  constexpr std::int64_t limit = 16 * 1024 * 1024;
  return m > 0 && k > 0 && n > 0 && m <= 65536 && k <= 65536 && n <= 65536
      && m * k <= limit && k * n <= limit && m * n <= limit;
}
} // namespace

// Status 1 is invalid input/output and terminal; status 2 permits CPU fallback.
extern "C" SCAPE_EXPORT int scape_g2p_gpu_open(void **output, const char *profile) noexcept {
  if (!output) return 1;
  *output = nullptr;
  try {
    static std::once_flag initialized;
    std::call_once(initialized, []() { Ort::InitApi(); });
    *output = new Context(profile);
    return 0;
  } catch (...) { return 2; }
}

extern "C" SCAPE_EXPORT int scape_g2p_gpu_gemm(void *handle, const float *x, const float *y,
    float *output, std::int64_t m, std::int64_t k, std::int64_t n) noexcept {
  if (!handle || !x || !y || !output || !Valid(m, k, n)) return 1;
  for (std::int64_t i = 0; i < m * k; ++i) if (!std::isfinite(x[i])) return 1;
  for (std::int64_t i = 0; i < k * n; ++i) if (!std::isfinite(y[i])) return 1;
  try {
    const std::array<std::int64_t, 2> x_shape{m, k}, y_shape{k, n}, output_shape{m, n};
    auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    std::array<Ort::Value, 2> inputs{
      Ort::Value::CreateTensor<float>(memory, const_cast<float *>(x), static_cast<size_t>(m * k), x_shape.data(), 2),
      Ort::Value::CreateTensor<float>(memory, const_cast<float *>(y), static_cast<size_t>(k * n), y_shape.data(), 2)};
    auto result = Ort::Value::CreateTensor<float>(memory, output, static_cast<size_t>(m * n), output_shape.data(), 2);
    const char *names[] = {"x", "y"};
    const char *results[] = {"output"};
    static_cast<Context *>(handle)->session->Run(Ort::RunOptions{nullptr}, names, inputs.data(), 2, results, &result, 1);
    for (std::int64_t i = 0; i < m * n; ++i) if (!std::isfinite(output[i])) return 1;
    return 0;
  } catch (...) { return 2; }
}

extern "C" SCAPE_EXPORT int scape_g2p_gpu_close(void *handle) noexcept {
  if (!handle) return 0;
  try {
    std::unique_ptr<Context> owned(static_cast<Context *>(handle));
    if (owned->profiling) {
      Ort::AllocatorWithDefaultOptions allocator;
      owned->session->EndProfilingAllocated(allocator);
    }
    return 0;
  } catch (...) { return 2; }
}
