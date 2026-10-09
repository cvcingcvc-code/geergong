# Release Checksums — Gorgon Workbench `1.0.0-competition`

**生成日期** 2026-10-10 · **HEAD** 见 git log（Phase 10 验收，含 1 处数据准确性修复）

> 用 `sha256sum` 计算。复现方式：`desktop/build.ps1` 重建 EXE，再
> `python -c "import shutil; shutil.make_archive(...)"` 打包 ZIP。

```text
# ZIP（整个 Gorgon-Workbench-Windows/ 目录）
35f6c0622d9886863dd28c83c615b5f3588a4948427239d953f782581f7fd642  Gorgon-Workbench-Windows-v1.0.0-competition.zip

# EXE 本体
fb8edb483d71b4273863c00c077cf849bd651fd8d4c0b30823d64890f9822ec9  Gorgon-Workbench-Windows/Gorgon Workbench.exe
```

## 说明

- `release/Gorgon-Workbench-Windows/` 与 ZIP 是**构建产物**（`.gitignore` 已忽略），
  可随时用 `desktop/build.ps1` 复现，故不进 git、不生成额外版本号。
- 前端 bundle hash：`index-CT8rx1Rm.js`（420.36 kB / gzip 123.85 kB），
  对应 HEAD 之后包含 Phase-10 metadata 持久化修复的构建。
- EXE 自检：`--selftest` 8/8 全绿（frozen=true, python=3.14.2）。
