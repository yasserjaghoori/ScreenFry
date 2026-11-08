# Playback fixture

`playing.webm` is a generated two-second black 64x64 video with no audio. It exercises actual muted playback in the isolated Chrome integration test; it contains no downloaded or personal content.

Regenerate with FFmpeg (not required to run tests):

```bash
ffmpeg -f lavfi -i color=c=black:s=64x64:r=5 -t 2 -c:v libvpx -b:v 20k -an playing.webm
```
