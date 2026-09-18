#!/bin/bash
# Usage: fit1280.sh <input image> <output.jpg>
# Scales the image to fit inside 1280x800 (no distortion), then pads it onto a
# 1280x800 canvas in the app's dark background colour, saved as JPEG (no alpha).
set -euo pipefail
in="$1"; out="$2"
W=1280; H=800
w=$(sips -g pixelWidth  "$in" | awk '/pixelWidth/{print $2}')
h=$(sips -g pixelHeight "$in" | awk '/pixelHeight/{print $2}')
# scale = min(W/w, H/h), in integer math via awk
read -r tw th <<<"$(awk -v w="$w" -v h="$h" -v W="$W" -v H="$H" 'BEGIN{s=W/w; if(H/h<s)s=H/h; printf "%d %d", int(w*s+0.5), int(h*s+0.5)}')"
tmp="$(mktemp -t fit).png"
sips -z "$th" "$tw" "$in" --out "$tmp" >/dev/null
sips -p "$H" "$W" --padColor 0A0B0F "$tmp" --out "$tmp" >/dev/null
sips -s format jpeg -s formatOptions 92 "$tmp" --out "$out" >/dev/null
rm -f "$tmp"
printf "%-40s %sx%s -> %s\n" "$(basename "$out")" "$w" "$h" "$(sips -g pixelWidth -g pixelHeight "$out" | awk '/pixel/{printf "%s ", $2}')"
