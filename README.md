# Spot

A Spotify client for the terminal. Playback control, library browsing, search,
and album art rendered in the terminal itself.

Requires a Spotify Premium account — the Web API refuses playback control
without one.

## Setup

**1. Register an app** at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
with the redirect URI `http://127.0.0.1:8888/callback`, and note the client ID.

Spotify stopped accepting `localhost` as a redirect URI on 2025-04-09. Loopback
redirects must use a literal IP (`127.0.0.1` or `[::1]`); anything else must be
HTTPS.

**2. Configure and run:**

```bash
bun install
cp .env.example .env   # then set SPOTIFY_CLIENT_ID
bun start
```

`REDIRECT_URI` must match the dashboard entry exactly. There is no client
secret — the app uses the PKCE flow.

On first run it starts a one-shot loopback server, opens the browser for
authorization, catches the callback, and writes the token to `.spotify_token`.
Tokens refresh on their own. Spotify rotates the refresh token each time, so the
file is rewritten on every refresh.

## Controls

| Key | Action |
|-----|--------|
| `Space` | Play/pause |
| `n` / `p` | Next / previous track |
| `←` / `→` | Seek 10 seconds |
| `+` / `-` | Volume |
| `s` | Toggle shuffle |
| `r` | Cycle repeat (off → context → track) |
| `f` | Like / unlike the current track |
| `l` | Browse library — Liked Songs and playlists |
| `u` | Show what's up next |
| `/` | Search |
| `d` | Switch playback device |
| `q` | Quit |

Lists — library, playlist contents, search results — share one overlay:
`↑`/`↓` (or `j`/`k`) to move, `Enter` to open or play, `Esc` to go back a level.

Playing a track from a playlist starts the playlist *at* that track, so the rest
stays queued behind it; albums and artists from search behave the same way.
Liked Songs has no playable context URI, so it queues the selection plus the
following fifty explicitly.

Search covers tracks, albums and artists, tagged by type in the results.

## Notes

**Volume.** The keys only work on devices that accept remote volume control.
Phones report `supports_volume: false` and Spotify answers `403 Cannot control
device volume`; the device list marks these. Change the volume on the device.

**Album art.** On iTerm2 the cover is sent through the inline image protocol, so
resolution is bounded by the pane rather than the character grid. Elsewhere it
falls back to half-block characters (`▀`), in 24-bit color when `COLORTERM`
advertises it and the xterm 256-color cube otherwise. `SPOT_ART=blocks` forces
the fallback.

**Requirements.** Node 18 or newer (the API client uses global `fetch`), and a
terminal with 256-color and Unicode block support.

## Troubleshooting

**No active device.** Spotify has to be running somewhere before it can be
controlled. Start playback on any device, then press `d`.

**`Refresh token revoked`.** Delete `.spotify_token` and re-authenticate.

**`Token is missing permissions`.** A stored token only carries the scopes it
was issued with, so a new feature can require fresh consent. Handled
automatically — the token is cleared and authorization re-runs.

**`Port 8888 is already in use`.** Free it, or change `PORT` in `.env` and the
redirect URI in the dashboard to match.

**Album art missing.** Check the log pane; it is usually a failed image fetch.

## License

MIT
