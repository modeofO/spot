# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is "Spot", a terminal-based Spotify music player built with Node.js. It provides full playback control, album art display, search functionality, and device management through a terminal interface using the `blessed` library.

## Key Commands

### Development
- `npm start` - Run the application
- `npm run dev` - Run with nodemon for development (auto-restart on changes)
- `npm install` - Install dependencies

### No Build/Test/Lint Commands
This project does not have build, test, or lint scripts configured in package.json.

## Architecture

### Core Components

The application follows a modular architecture with four main classes:

**src/index.js** - Entry point and orchestration
- Handles environment validation
- Manages authentication flow  
- Initializes and connects Spotify API and Terminal UI
- Provides error handling and graceful startup

**src/auth.js** - SpotifyAuth class
- Implements OAuth 2.0 PKCE flow for Spotify authentication
- Manages token storage, refresh, and validation
- Handles manual authorization code collection via browser redirect
- Stores tokens in `.spotify_token` file

**src/spotify.js** - SpotifyAPI class  
- Wrapper for Spotify Web API endpoints
- Handles all playback control (play/pause, next/previous, volume, shuffle, repeat)
- Manages device selection and transfer
- Provides search functionality and playlist access
- Implements proper error handling and response parsing

**src/ui.js** - TerminalUI class
- Creates terminal interface using `blessed` and `blessed-contrib`
- Manages keyboard input and real-time display updates
- Handles album art display (ASCII conversion or fallback representation)
- Coordinates between user input and Spotify API calls
- Updates UI every 10 seconds to reflect current playback state

### Key Dependencies
- `blessed` / `blessed-contrib` - Terminal UI framework
- `express` - For OAuth callback server
- `axios` - HTTP client for Spotify API
- `image-to-ascii` - Album art conversion (requires GraphicsMagick)
- `terminal-image` - Alternative image display
- `open` - Browser launching for authentication

### Configuration
- Environment variables in `.env` file (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)
- OAuth redirect URI: `https://example.com/callback` (hardcoded)
- Token persistence in `.spotify_token` file
- No configuration files for build tools

### Authentication Flow
1. Check for existing valid token in `.spotify_token`
2. If none exists or expired, generate PKCE challenge
3. Open browser to Spotify authorization URL
4. User manually copies redirect URL containing auth code
5. Exchange auth code for access/refresh tokens
6. Save tokens for future use and auto-refresh when needed

### UI Layout
- Grid-based layout (12x12) with sections for:
  - Now Playing info (track/artist/album details)
  - Album Art (ASCII or graphical representation)
  - Controls (keyboard shortcuts)
  - Progress bar and volume
  - Device info and search box
  - Log output for messages and search results