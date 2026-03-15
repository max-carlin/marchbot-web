#!/usr/bin/env python3
"""Convert any video file into animated ASCII binary art (HTML, pure CSS animation)."""

import argparse
import html
import os
import random
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image


def extract_frames(video_path, fps, tmp_dir, max_frames):
    """Extract frames from video using ffmpeg."""
    pattern = os.path.join(tmp_dir, "frame_%05d.png")
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"fps={fps}",
        "-frames:v", str(max_frames),
        pattern,
        "-y", "-loglevel", "error",
    ]
    subprocess.run(cmd, check=True)
    frames = sorted(Path(tmp_dir).glob("frame_*.png"))
    print(f"Extracted {len(frames)} frames")
    return frames


def frame_to_ascii(img_path, cols, rows, invert):
    """Convert a single image to ASCII binary art."""
    img = Image.open(img_path).convert("L")
    # Resize accounting for character aspect ratio (~2:1)
    img = img.resize((cols, rows * 2), Image.LANCZOS)
    img = img.resize((cols, rows), Image.LANCZOS)

    pixels = img.load()
    lines = []
    for y in range(rows):
        line = []
        for x in range(cols):
            brightness = pixels[x, y]
            if invert:
                brightness = 255 - brightness
            line.append(_brightness_to_char(brightness, x, y))
        # Pad to uniform width so the art is properly centered
        lines.append("".join(line).rstrip())
    # Pad all lines to the same width (longest line)
    max_len = max(len(l) for l in lines) if lines else 0
    lines = [l.ljust(max_len) for l in lines]
    return "\n".join(lines)


def _brightness_to_char(brightness, x, y):
    """Map brightness (0-255) to a binary digit or space."""
    if brightness >= 200:
        # Bright: solid fill with 1s and 0s
        return "1" if (x + y) % 2 else "0"
    elif brightness >= 140:
        # Medium-bright: ~66% fill
        if (x + y) % 3 != 0:
            return random.choice("10")
        return " "
    elif brightness >= 80:
        # Medium: ~33% fill
        if (x + y) % 3 == 0:
            return random.choice("10")
        return " "
    elif brightness >= 40:
        # Medium-dark: ~15% fill
        if (x * 7 + y * 13) % 7 == 0:
            return random.choice("10")
        return " "
    else:
        # Dark: empty
        return " "


def build_html(frames_ascii, fps, color, bg, cols, rows):
    """Assemble the final HTML with CSS animation."""
    num_frames = len(frames_ascii)
    frame_duration = 1.0 / fps
    total_duration = num_frames * frame_duration
    keyframe_pct = 100.0 / num_frames

    # Calculate font size to fit the grid within the viewport.
    # A monospace char is roughly 0.6em wide and 1.15em tall (line-height).
    # font_w = 100vw / (cols * 0.6), font_h = 100vh / (rows * 1.15)
    # Use min() of both so it fits both dimensions.
    char_width_ratio = 0.6
    line_height = 1.15
    vw_font = 100.0 / (cols * char_width_ratio)
    vh_font = 100.0 / (rows * line_height)

    parts = []
    parts.append(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ASCII Binary Art</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    background: {bg};
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    overflow: hidden;
  }}
  .container {{
    position: relative;
    font-family: 'Courier New', Courier, monospace;
    font-size: min({vw_font:.4f}vw, {vh_font:.4f}vh);
    line-height: {line_height};
    color: {color};
    white-space: pre;
    width: {cols}ch;
  }}
  .frame {{
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0;
  }}
  .frame:first-child {{
    position: relative;
  }}
""")

    # Per-frame animation rules
    for i in range(num_frames):
        delay = i * frame_duration
        parts.append(f"""  .frame:nth-child({i + 1}) {{
    animation: show {total_duration:.4f}s step-end infinite;
    animation-delay: {delay:.4f}s;
  }}
""")

    parts.append(f"""  @keyframes show {{
    0% {{ opacity: 1; }}
    {keyframe_pct:.4f}% {{ opacity: 0; }}
    100% {{ opacity: 0; }}
  }}
</style>
</head>
<body>
<div class="container">
""")

    for ascii_frame in frames_ascii:
        escaped = html.escape(ascii_frame)
        parts.append(f'<pre class="frame">\n{escaped}</pre>\n')

    parts.append("</div>\n</body>\n</html>\n")
    return "".join(parts)


def main():
    parser = argparse.ArgumentParser(
        description="Convert video to animated ASCII binary art (HTML)"
    )
    parser.add_argument("input", help="Input video file")
    parser.add_argument("-o", "--output", default="output.html", help="Output HTML file")
    parser.add_argument("--cols", type=int, default=120, help="Character columns (default: 120)")
    parser.add_argument("--rows", type=int, default=None, help="Character rows (auto from aspect ratio if omitted)")
    parser.add_argument("--fps", type=int, default=10, help="Frames per second (default: 10)")
    parser.add_argument("--color", default="#4466cc", help="Text color hex (default: #4466cc)")
    parser.add_argument("--bg", default="#0a0a1a", help="Background color hex (default: #0a0a1a)")
    parser.add_argument("--max-frames", type=int, default=300, help="Max frames (default: 300)")
    parser.add_argument("--invert", action="store_true", help="Invert brightness mapping")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"Error: '{args.input}' not found", file=sys.stderr)
        sys.exit(1)

    random.seed(args.seed)

    # Auto-detect video dimensions for aspect ratio if rows not specified
    rows = args.rows
    if rows is None:
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "csv=p=0",
                 args.input],
                capture_output=True, text=True, check=True
            )
            w, h = map(int, probe.stdout.strip().split(","))
            # Account for ~2:1 character aspect ratio
            rows = int(args.cols * h / w / 2)
        except Exception:
            rows = 50
    rows = max(rows, 10)

    print(f"Grid: {args.cols}x{rows}, FPS: {args.fps}, max frames: {args.max_frames}")

    with tempfile.TemporaryDirectory() as tmp_dir:
        frame_paths = extract_frames(args.input, args.fps, tmp_dir, args.max_frames)
        if not frame_paths:
            print("Error: no frames extracted", file=sys.stderr)
            sys.exit(1)

        print("Converting frames to ASCII...")
        frames_ascii = []
        for i, fp in enumerate(frame_paths):
            frames_ascii.append(frame_to_ascii(fp, args.cols, rows, args.invert))
            if (i + 1) % 20 == 0:
                print(f"  {i + 1}/{len(frame_paths)}")

    print("Building HTML...")
    html_content = build_html(frames_ascii, args.fps, args.color, args.bg, args.cols, rows)

    with open(args.output, "w") as f:
        f.write(html_content)

    size_mb = os.path.getsize(args.output) / (1024 * 1024)
    print(f"Done! {args.output} ({size_mb:.1f} MB, {len(frames_ascii)} frames)")


if __name__ == "__main__":
    main()
