# Room music

Drop audio files in this folder and list them in `music-manifest.json`.
The guitar reads that manifest at runtime, so adding a song never means
touching the interaction code.

    public/music/
        music-manifest.json
        night-drive.mp3
        slow-river.mp3

```json
{
  "tracks": [
    { "title": "Night Drive", "file": "/music/night-drive.mp3" },
    { "title": "Slow River", "file": "/music/slow-river.mp3" }
  ]
}
```

`title` is what the guitar's menu shows; `file` is the public URL, so it
always begins `/music/`. MP3 plays everywhere; OGG and WAV work in most
browsers. Five tracks fit the menu without scrolling.

Static hosting cannot list a directory, which is why the manifest exists
rather than the app discovering files by itself. It is the one line of
bookkeeping per song, and nothing else in the system needs to know.
