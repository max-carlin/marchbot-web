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


def frame_to_ascii(img_path, cols, rows, invert, flat_opacity=False):
    """Convert a single image to ASCII binary art.

    When flat_opacity is True, returns a plain string (old behavior).
    When False, returns list[list[tuple[str, int]]] — rows of (char, tier) tuples.
    """
    img = Image.open(img_path).convert("L")
    # Resize accounting for character aspect ratio (~2:1)
    img = img.resize((cols, rows * 2), Image.LANCZOS)
    img = img.resize((cols, rows), Image.LANCZOS)

    pixels = img.load()

    if flat_opacity:
        lines = []
        for y in range(rows):
            line = []
            for x in range(cols):
                brightness = pixels[x, y]
                if invert:
                    brightness = 255 - brightness
                char, _tier = _brightness_to_char(brightness, x, y)
                line.append(char)
            lines.append("".join(line).rstrip())
        max_len = max(len(l) for l in lines) if lines else 0
        lines = [l.ljust(max_len) for l in lines]
        return "\n".join(lines)

    # Structured output: list of rows, each row a list of (char, tier)
    structured = []
    for y in range(rows):
        row = []
        for x in range(cols):
            brightness = pixels[x, y]
            if invert:
                brightness = 255 - brightness
            row.append(_brightness_to_char(brightness, x, y))
        # Trim trailing spaces (tier 0)
        while row and row[-1] == (" ", 0):
            row.pop()
        structured.append(row)
    # Pad all rows to the same length
    max_len = max(len(r) for r in structured) if structured else 0
    for row in structured:
        while len(row) < max_len:
            row.append((" ", 0))
    return structured


def _brightness_to_char(brightness, x, y):
    """Map brightness (0-255) to a (char, tier) tuple.

    Tier indicates opacity level: 0=invisible, 1=faintest, 4=full opacity.
    """
    if brightness >= 200:
        # Bright: solid fill with 1s and 0s
        return ("1" if (x + y) % 2 else "0", 4)
    elif brightness >= 140:
        # Medium-bright: ~66% fill
        if (x + y) % 3 != 0:
            return (random.choice("10"), 3)
        return (" ", 0)
    elif brightness >= 80:
        # Medium: ~33% fill
        if (x + y) % 3 == 0:
            return (random.choice("10"), 2)
        return (" ", 0)
    elif brightness >= 40:
        # Medium-dark: ~15% fill
        if (x * 7 + y * 13) % 7 == 0:
            return (random.choice("10"), 1)
        return (" ", 0)
    else:
        # Dark: empty
        return (" ", 0)


_TIER_CLASS = {1: "a", 2: "b", 3: "c", 4: "d"}


def _render_row_html(row):
    """Render a row of (char, tier) tuples as HTML with opacity classes.

    Consecutive same-tier characters are grouped into single <b> tags.
    Spaces are absorbed into adjacent tier runs (spaces are invisible
    regardless of wrapping class), which dramatically reduces tag count.
    """
    if not row:
        return ""

    # Pre-process: reassign each space's tier to its left neighbor's tier
    # (or right neighbor if at the start). This lets spaces merge into
    # adjacent runs instead of breaking them.
    tiers = [t for _, t in row]
    for i in range(len(tiers)):
        if tiers[i] == 0:
            if i > 0 and tiers[i - 1] != 0:
                tiers[i] = tiers[i - 1]
            else:
                # Scan right for a non-zero tier
                for j in range(i + 1, len(tiers)):
                    if tiers[j] != 0:
                        tiers[i] = tiers[j]
                        break

    # Build runs of consecutive same-tier characters
    parts = []
    i = 0
    while i < len(row):
        tier = tiers[i]
        j = i + 1
        while j < len(row) and tiers[j] == tier:
            j += 1
        chars = "".join(row[k][0] for k in range(i, j))
        if tier == 0:
            # Still tier 0 (no neighbors had a tier) — emit as raw text
            parts.append(chars)
        else:
            cls = _TIER_CLASS[tier]
            parts.append(f"<b class={cls}>{chars}</b>")
        i = j
    return "".join(parts)


def _render_frame_html(frame_data):
    """Render structured frame data (list of rows) as HTML."""
    return "\n".join(_render_row_html(row) for row in frame_data)


def build_html(frames_ascii, fps, color, bg, cols, rows):
    """Assemble the final HTML with JS frame-swapping animation."""
    import json

    num_frames = len(frames_ascii)

    # Detect whether frames are structured (per-char opacity) or plain strings
    structured = num_frames > 0 and isinstance(frames_ascii[0], list)

    # Calculate font size to fit the grid within the viewport.
    char_width_ratio = 0.6
    line_height = 1.15
    vw_font = 100.0 / (cols * char_width_ratio)

    frame_ms = round(1000.0 / fps)

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
    font-family: 'Courier New', Courier, monospace;
    font-size: {vw_font:.4f}vw;
    line-height: {line_height};
    color: {color};
    white-space: pre;
    width: {cols}ch;
  }}
""")

    # Per-char opacity tier classes (only needed for structured frames)
    if structured:
        parts.append("""  b { font-weight: inherit; }
  b.a { opacity: 0.2; }
  b.b { opacity: 0.4; }
  b.c { opacity: 0.7; }
  b.d { opacity: 1.0; }
""")

    parts.append("""</style>
</head>
<body>
<div class="container">
<pre id="f"></pre>
</div>
<script>
""")

    # Render each frame to an HTML string and store in a JS array
    rendered_frames = []
    for frame in frames_ascii:
        if structured:
            rendered = _render_frame_html(frame)
        else:
            rendered = html.escape(frame)
        rendered_frames.append(rendered)

    parts.append("var frames=")
    parts.append(json.dumps(rendered_frames))
    parts.append(";\n")

    parts.append(f"""var f=document.getElementById("f"),i=0;
f.innerHTML=frames[0];
setInterval(function(){{i=(i+1)%frames.length;f.innerHTML=frames[i];}},{frame_ms});
</script>
</body>
</html>
""")
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
    parser.add_argument("--flat-opacity", action="store_true", help="Uniform opacity for all characters (old behavior)")
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
            frames_ascii.append(frame_to_ascii(fp, args.cols, rows, args.invert, args.flat_opacity))
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
