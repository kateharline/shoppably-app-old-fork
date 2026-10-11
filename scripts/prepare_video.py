"""Download the requested 12:11–12:19 wedding-dress excerpt as a browser-friendly MP4."""
import argparse
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", help="Use a local video if YouTube blocks downloads")
    parser.add_argument("--start", type=float, default=731)
    parser.add_argument("--duration", type=float, default=8)
    args = parser.parse_args()
    Path("artifacts").mkdir(exist_ok=True)
    Path("static").mkdir(exist_ok=True)
    if args.source:
        source = args.source
        start = args.start
    else:
        source_stem = f"source-{args.start:g}-{args.duration:g}"
        subprocess.run([
            "yt-dlp", "--js-runtimes", "node", "--no-playlist", "--force-keyframes-at-cuts", "--download-sections", f"*{args.start}-{args.start + args.duration}",
            "-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4",
            "-o", f"artifacts/{source_stem}.%(ext)s", "https://www.youtube.com/watch?v=LegHU2why0Y",
        ], check=True)
        source = str(next(Path("artifacts").glob(f"{source_stem}.*")))
        start = 0
    subprocess.run([
        "ffmpeg", "-y", "-ss", str(start), "-i", source, "-t", str(args.duration),
        "-vf", "scale=1280:-2", "-c:v", "libx264", "-preset", "fast", "-crf", "25",
        "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", "static/demo.mp4",
    ], check=True)
    subprocess.run(["ffmpeg", "-y", "-i", "static/demo.mp4", "-frames:v", "1", "static/demo-poster.jpg"], check=True)
    print(f"Prepared static/demo.mp4 (source starts at {args.start:g}s, duration {args.duration:g}s).")


if __name__ == "__main__":
    main()

