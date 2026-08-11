#!/usr/bin/env python3
"""生成 public/fonts/ 下的 woff2 产物。

产物已入库，日常开发不需要跑这个脚本——只有换字体、调子集范围时才重跑。

    pip3 install fonttools brotli
    python3 scripts/build-fonts.py

上游来源见 public/fonts/README.md。字重只出 400/500 两档：src/styles.css 开了
font-synthesis: none，多打的字重不会被用到，少打的也不会被合成。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "fonts"
SRC_DIR = Path("/tmp/belfry-fonts")

# 汉字子集取 GB2312（6763 字），覆盖现代中文约 99.7%。界面上出现的只有项目名、
# 路径、模型名和固定文案，够用；真遇到生僻字会 fallback 到系统字体，可以接受。
# 直接取 U+4E00-9FFF 全段是 20992 字，体积翻三倍，不划算。
def gb2312_charset() -> str:
    chars = set()
    for hi in list(range(0xA1, 0xAA)) + list(range(0xB0, 0xF8)):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return "".join(sorted(chars))


# GB2312 之外界面仍会用到的字符：拉丁扩展、通用标点、货币、箭头、几何图形、
# 制表符（终端画框）、全角区。范围很小，直接按码位补。
EXTRA_RANGES = [
    (0x0020, 0x00FF),  # 基本拉丁 + 补充
    (0x0100, 0x017F),  # 拉丁扩展 A
    (0x2000, 0x206F),  # 通用标点
    (0x20A0, 0x20BF),  # 货币符号
    (0x2100, 0x214F),  # 字母式符号（™ № 等）
    (0x2190, 0x21FF),  # 箭头
    (0x2200, 0x22FF),  # 数学运算符
    (0x2500, 0x257F),  # 制表符
    (0x2580, 0x259F),  # 方块元素
    (0x25A0, 0x25FF),  # 几何图形
    (0x2600, 0x26FF),  # 杂项符号
    (0x3000, 0x303F),  # CJK 符号与标点
    (0xFF00, 0xFFEF),  # 全角字符
]


def unicodes_arg() -> str:
    return ",".join(f"U+{lo:04X}-{hi:04X}" for lo, hi in EXTRA_RANGES)


def subset(src: Path, out: Path, *, text: str = "", unicodes: str = "") -> None:
    if not src.exists():
        sys.exit(f"缺少源文件：{src}\n请先按 public/fonts/README.md 准备上游字体。")

    cmd = [
        "pyftsubset",
        str(src),
        f"--output-file={out}",
        "--flavor=woff2",
        # 保留 hinting：Windows 的 DirectWrite 在小字号下依赖它，去掉会明显发糊。
        "--hinting",
        "--layout-features=+kern,+liga,+clig,+calt",
        # 保留名称与许可记录，字体许可要求随文件分发。
        "--name-IDs=*",
        "--notdef-outline",
    ]
    if unicodes:
        cmd.append(f"--unicodes={unicodes}")
    if text:
        cmd.append(f"--text={text}")

    subprocess.run(cmd, check=True)
    print(f"  {out.name}  {out.stat().st_size / 1024:.0f} KB")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    han = gb2312_charset()
    ranges = unicodes_arg()
    print(f"子集：GB2312 {len(han)} 字 + {len(EXTRA_RANGES)} 个补充区段")

    sc_dir = SRC_DIR / "unpacked" / "HarmonyOS Sans" / "HarmonyOS_Sans_SC"
    for weight in ("Regular", "Medium"):
        subset(
            sc_dir / f"HarmonyOS_Sans_SC_{weight}.ttf",
            OUT_DIR / f"HarmonyOSSansSC-{weight}.woff2",
            text=han,
            unicodes=ranges,
        )

    # 等宽只用于终端和路径，拉丁范围就够，中文会落到上面的 sans。
    subset(
        SRC_DIR / "package" / "files" / "jetbrains-mono-latin-400-normal.woff2",
        OUT_DIR / "JetBrainsMono-Regular.woff2",
        unicodes=unicodes_arg(),
    )


if __name__ == "__main__":
    main()
