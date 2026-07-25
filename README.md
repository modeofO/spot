# Spot - Terminal Spotify Player

A beautiful terminal-based Spotify music player that lets you control your music playback directly from the command line, complete with album art display.

## Features

- 🎵 Full playback control (play/pause, next/previous, shuffle, repeat)
- 🎨 Album art display in terminal
- 🔊 Volume control
- 🔍 Search functionality
- 📱 Device management
- 🎛️ Real-time progress tracking
- ⌨️ Keyboard shortcuts for everything

## Setup

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click "Create App"
3. Fill in the details:
   - App name: `Spot Terminal Player`
   - App description: `Terminal-based Spotify player`
   - Redirect URI: `http://127.0.0.1:8888/callback`
4. Save your `Client ID` and `Client Secret`

> Spotify stopped accepting `localhost` as a redirect URI on 2025-04-09. Loopback
> redirects must use a literal IP (`127.0.0.1` or `[::1]`); everything else must be HTTPS.

### 2. Install Dependencies

```bash
bun install
```

### 3. Configure Environment

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Spotify credentials:
   ```
   SPOTIFY_CLIENT_ID=your_spotify_client_id_here
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
   REDIRECT_URI=http://127.0.0.1:8888/callback
   PORT=8888
   ```

`REDIRECT_URI` must match the one registered in the Spotify dashboard exactly.

### 4. Run the Application

```bash
bun start
```

On first run, the app will:
1. Start a one-shot loopback server on `127.0.0.1:8888`
2. Open your browser for Spotify authentication
3. Catch the callback, exchange the code (PKCE), and save the token to `.spotify_token`

Tokens refresh automatically. Spotify rotates the refresh token on every refresh,
so the file is rewritten each time.

## Controls

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `n` | Next track |
| `p` | Previous track |
| `s` | Toggle shuffle |
| `r` | Cycle repeat mode (off → context → track → off) |
| `+` / `=` | Increase volume |
| `-` | Decrease volume |
| `/` | Focus search box |
| `d` | Show available devices |
| `q` | Quit |

In the search results list:

| Key | Action |
|-----|--------|
| `↑` / `↓` (or `j` / `k`) | Move selection |
| `Enter` | Play the selected track |
| `Esc` | Close the list |

Volume keys only work on devices that accept remote volume control. Phones
usually report `supports_volume: false`, and Spotify rejects the request with
`403 Cannot control device volume`; change the volume on the device itself.

## Interface

The terminal interface is divided into several sections:

- **Now Playing**: Current track information
- **Album Art**: Visual representation of the current album
- **Controls**: Available keyboard shortcuts
- **Progress**: Track progress bar
- **Volume**: Current volume level
- **Device**: Active playback device
- **Search**: Search for tracks, artists, or albums
- **Log**: Application messages and search results

## Requirements

- Node.js 18 or higher (the Spotify client uses global `fetch`)
- Active Spotify Premium account (required for playback control)
- Terminal that supports 256 colors and Unicode block characters

## Troubleshooting

### "No active device found"
- Make sure Spotify is open on at least one device
- Try playing a song on your phone/computer first
- Use the `d` key to see available devices

### Authentication issues
- Check your Client ID and Client Secret in `.env`
- Make sure the redirect URI matches exactly: `http://127.0.0.1:8888/callback`
- `Refresh token revoked` — delete `.spotify_token` and re-authenticate
- `Port 8888 is already in use` — free the port or change `PORT` in `.env` (and the dashboard)

### Album art not displaying
- Covers are drawn with half-block characters (`▀`) and 256-color output; your
  terminal needs both
- Check the log pane for the underlying error (usually a failed image fetch)

## License

MIT