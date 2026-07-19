# CMake toolchain file for the bundled whisper.cpp build (whisper-rs-sys).
#
# Why this exists: whisper-rs-sys builds whisper.cpp with GGML_NATIVE=ON, i.e.
# -march=native — optimized for whatever CPU ran the compiler. That is fine for
# a local `tauri dev` build, but release installers are built on GitHub Actions
# runners, so the shipped binary ends up tuned for the runner's CPU and can fall
# back to slow scalar GEMM kernels on the user's machine (reported ~4x slower
# transcription than a locally built ScribeDog).
#
# The fix is to stop tuning for the build host and instead compile a fixed SIMD
# baseline that every target machine is guaranteed to support: AVX2 + FMA +
# F16C, i.e. Intel Haswell (2013) / AMD Excavator (2015) and newer. That covers
# effectively the whole install base while keeping the vectorized matrix
# kernels that make transcription fast.
#
# Note: ggml's GGML_CPU_ALL_VARIANTS (compile several backends, pick the best at
# runtime) would be the nicer option, but it requires GGML_BACKEND_DL, which
# needs shared libraries — and whisper-rs-sys hardcodes BUILD_SHARED_LIBS=OFF
# and links ggml statically. Revisit if whisper-rs gains a feature flag for it.
#
# Wired up via CMAKE_TOOLCHAIN_FILE in .cargo/config.toml.

set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_AVX ON CACHE BOOL "" FORCE)
set(GGML_AVX2 ON CACHE BOOL "" FORCE)
set(GGML_FMA ON CACHE BOOL "" FORCE)
set(GGML_F16C ON CACHE BOOL "" FORCE)
