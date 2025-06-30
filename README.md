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
   - Redirect URI: `http://localhost:8888/callback`
4. Save your `Client ID` and `Client Secret`

### 2. Install Dependencies

```bash
npm install
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
   REDIRECT_URI=http://localhost:8888/callback
   PORT=8888
   ```

### 4. Run the Application

```bash
npm start
```

On first run, the app will:
1. Open your browser for Spotify authentication
2. Ask for permission to control your Spotify playback
3. Save the authentication token for future use

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

- Node.js 14 or higher
- Active Spotify Premium account (required for playback control)
- Terminal that supports 256 colors for best experience

## Troubleshooting

### "No active device found"
- Make sure Spotify is open on at least one device
- Try playing a song on your phone/computer first
- Use the `d` key to see available devices

### Authentication issues
- Check your Client ID and Client Secret in `.env`
- Make sure the redirect URI matches exactly: `http://localhost:8888/callback`
- Delete `.spotify_token` file and re-authenticate

### Album art not displaying
- Ensure your terminal supports images or has good Unicode support
- Some terminals may show ASCII art instead of actual images

## License

MIT