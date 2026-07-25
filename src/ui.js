const blessed = require('blessed');
const contrib = require('blessed-contrib');

class TerminalUI {
  constructor(spotifyAPI) {
    this.spotify = spotifyAPI;
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Spot - Terminal Spotify Player'
    });

    this.currentTrack = null;
    this.playbackState = null;
    this.lastAlbumId = null; // Track the last album to avoid reloading same art
    
    this.setupUI();
    this.setupKeybindings();
    this.startUpdateLoop();
  }

  setupUI() {
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    this.trackInfo = this.grid.set(0, 0, 4, 8, blessed.box, {
      label: 'Now Playing',
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      },
      padding: { left: 1, right: 1, top: 1, bottom: 1 }
    });

    this.albumArt = this.grid.set(0, 8, 4, 4, blessed.box, {
      label: 'Album Art',
      border: { type: 'line' },
      tags: true,
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      }
    });

    this.controls = this.grid.set(4, 0, 2, 12, blessed.box, {
      label: 'Controls',
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      },
      content: this.getControlsText()
    });

    // contrib.gauge draws nothing at a one-row grid slot (three cells tall,
    // one of them usable), so both bars are plain boxes we fill ourselves.
    this.progressBar = this.grid.set(6, 0, 1, 12, blessed.box, {
      label: 'Progress',
      border: { type: 'line' },
      tags: true,
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      }
    });

    this.volumeBar = this.grid.set(7, 0, 1, 6, blessed.box, {
      label: 'Volume',
      border: { type: 'line' },
      tags: true,
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      }
    });

    this.deviceInfo = this.grid.set(7, 6, 1, 6, blessed.box, {
      label: 'Device',
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      }
    });

    this.searchBox = this.grid.set(8, 0, 2, 12, blessed.textbox, {
      label: 'Search (Press / to focus)',
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: 'yellow' }
      },
      inputOnFocus: true
    });

    this.logBox = this.grid.set(10, 0, 2, 12, blessed.log, {
      label: 'Log',
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: 'magenta' }
      },
      scrollable: true,
      alwaysScroll: true
    });

    this.screen.render();
  }

  getControlsText() {
    return `
 [Space] Play/Pause  [n] Next  [p] Previous  [s] Shuffle  [r] Repeat
 [+/-] Volume  [/] Search  [d] Devices  [q] Quit
    `.trim();
  }

  setupKeybindings() {
    this.screen.key(['q', 'C-c'], () => {
      return process.exit(0);
    });

    this.screen.key('space', async () => {
      try {
        if (this.playbackState?.is_playing) {
          await this.spotify.pause();
          this.log('Paused playback');
        } else {
          await this.spotify.play();
          this.log('Resumed playback');
        }
      } catch (error) {
        this.log(`Error: ${error.message}`);
      }
    });

    this.screen.key('n', async () => {
      try {
        await this.spotify.next();
        this.log('Skipped to next track');
      } catch (error) {
        this.log(`Error: ${error.message}`);
      }
    });

    this.screen.key('p', async () => {
      try {
        await this.spotify.previous();
        this.log('Skipped to previous track');
      } catch (error) {
        this.log(`Error: ${error.message}`);
      }
    });

    this.screen.key('s', async () => {
      try {
        const newState = !this.playbackState?.shuffle_state;
        await this.spotify.setShuffle(newState);
        this.log(`Shuffle ${newState ? 'enabled' : 'disabled'}`);
      } catch (error) {
        this.log(`Error: ${error.message}`);
      }
    });

    this.screen.key('r', async () => {
      try {
        const currentRepeat = this.playbackState?.repeat_state || 'off';
        const nextRepeat = currentRepeat === 'off' ? 'context' : 
                          currentRepeat === 'context' ? 'track' : 'off';
        await this.spotify.setRepeat(nextRepeat);
        this.log(`Repeat mode: ${nextRepeat}`);
      } catch (error) {
        this.log(`Error: ${error.message}`);
      }
    });

    this.screen.key(['+', '='], async () => {
      try {
        const currentVolume = this.playbackState?.device?.volume_percent || 50;
        const newVolume = Math.min(100, currentVolume + 10);
        await this.spotify.setVolume(newVolume);
        this.log(`Volume: ${newVolume}%`);
      } catch (error) {
        this.log(`Error: ${error.message}`);
      }
    });

    this.screen.key('-', async () => {
      try {
        const currentVolume = this.playbackState?.device?.volume_percent || 50;
        const newVolume = Math.max(0, currentVolume - 10);
        await this.spotify.setVolume(newVolume);
        this.log(`Volume: ${newVolume}%`);
      } catch (error) {
        this.log(`Error: ${error.message}`);
      }
    });

    this.screen.key('/', () => {
      this.searchBox.focus();
    });

    this.searchBox.on('submit', async (text) => {
      if (text.trim()) {
        try {
          const results = await this.spotify.search(text.trim());
          this.displaySearchResults(results);
        } catch (error) {
          this.log(`Search error: ${error.message}`);
        }
      }
      this.searchBox.clearValue();
      this.screen.render();
    });

    this.screen.key('d', async () => {
      try {
        const devices = await this.spotify.getDevices();
        this.displayDevices(devices);
      } catch (error) {
        this.log(`Error getting devices: ${error.message}`);
      }
    });
  }

  async updateTrackInfo() {
    try {
      const [playbackState, currentTrack] = await Promise.all([
        this.spotify.getCurrentPlayback(),
        this.spotify.getCurrentTrack()
      ]);

      this.playbackState = playbackState;
      this.currentTrack = currentTrack;

      // Handle case where no device is active or no track is playing
      if (!playbackState && !currentTrack) {
        this.trackInfo.setContent(`
No active Spotify device found.

Please:
1. Open Spotify on your phone, computer, or web player
2. Start playing a song
3. Press 'd' to see available devices

The player will automatically detect playback once started.
        `.trim());
        this.albumArt.setContent('No album art');
        this.deviceInfo.setContent('No active device');
        this.setBar(this.progressBar, 0, '', 'green');
        this.setBar(this.volumeBar, 0, '', 'blue');
        this.screen.render();
        return;
      }

      if (currentTrack?.item) {
        const track = currentTrack.item;
        const artists = track.artists.map(a => a.name).join(', ');
        const albumName = track.album.name;
        const trackName = track.name;
        
        const trackText = `
Track: ${trackName}
Artist: ${artists}
Album: ${albumName}
Duration: ${this.formatTime(track.duration_ms)}
Popularity: ${track.popularity}/100

Status: ${playbackState?.is_playing ? '▶️ Playing' : '⏸️ Paused'}
Shuffle: ${playbackState?.shuffle_state ? 'On' : 'Off'}
Repeat: ${playbackState?.repeat_state || 'Off'}
        `.trim();

        this.trackInfo.setContent(trackText);

        if (playbackState?.progress_ms && track.duration_ms) {
          const progress = (playbackState.progress_ms / track.duration_ms) * 100;
          const elapsed = this.formatTime(playbackState.progress_ms);
          this.setBar(this.progressBar, progress, `${elapsed} / ${this.formatTime(track.duration_ms)}`, 'green');
        }

        if (playbackState?.device?.volume_percent !== undefined) {
          const volume = playbackState.device.volume_percent;
          this.setBar(this.volumeBar, volume, `${volume}%`, 'blue');
        }

        if (playbackState?.device) {
          this.deviceInfo.setContent(`Device: ${playbackState.device.name}\nType: ${playbackState.device.type}`);
        }

        // Only update album art if it's a different album
        const albumId = track.album.id;
        if (albumId !== this.lastAlbumId) {
          this.lastAlbumId = albumId;
          await this.updateAlbumArt(track.album.images);
        }
      } else if (playbackState) {
        // Device is active but no track playing
        this.trackInfo.setContent(`
Device connected but no track playing.

Press Space to start playback or open Spotify
on this device to start playing music.
        `.trim());
        
        if (playbackState?.device) {
          this.deviceInfo.setContent(`Device: ${playbackState.device.name}\nType: ${playbackState.device.type}`);
        }
        
        this.albumArt.setContent('No album art');
      } else {
        this.trackInfo.setContent('No track currently playing');
        this.albumArt.setContent('No album art');
      }

      this.screen.render();
    } catch (error) {
      this.log(`Update error: ${error.message}`);
    }
  }

  async updateAlbumArt(images) {
    if (!images || images.length === 0) {
      this.albumArt.setContent('No album art data\nfrom Spotify');
      return;
    }

    try {
      // Get the best size image (not too large, not too small)
      const imageUrl = images.find(img => img.width >= 200 && img.width <= 400)?.url || 
                      images.find(img => img.width >= 100)?.url || 
                      images[0]?.url;
      
      if (imageUrl) {
        await this.displayImageInTerminal(imageUrl);
      } else {
        this.albumArt.setContent('No suitable image\nsize found');
      }
    } catch (error) {
      this.albumArt.setContent('Failed to load album art');
    }
  }

  async displayImageInTerminal(imageUrl) {
    try {
      this.albumArt.setContent(await this.renderAlbumArt(imageUrl));
    } catch (error) {
      this.log(`Album art failed: ${error.message}`);
      this.albumArt.setContent('\n  Album art\n  unavailable');
    }
    this.screen.render();
  }

  // Each cell renders two stacked pixels with the upper-half block: the top
  // pixel becomes the foreground, the bottom one the background. That doubles
  // vertical resolution and cancels out the roughly 2:1 aspect of a terminal
  // cell, so a square cover stays square.
  async renderAlbumArt(imageUrl) {
    const sharp = require('sharp');

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`fetch returned ${response.status}`);
    }
    const source = Buffer.from(await response.arrayBuffer());

    const cols = Math.max(8, (this.albumArt.width || 22) - 2);
    const rows = Math.max(4, (this.albumArt.height || 12) - 2);
    const size = Math.max(8, Math.min(cols, rows * 2) & ~1);

    const { data, info } = await sharp(source)
      .resize(size, size, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const hex = (x, y) => {
      const i = (y * info.width + x) * info.channels;
      return data.toString('hex', i, i + 3);
    };

    // The cover is square, so it rarely fills a wider box — centre it.
    const pad = ' '.repeat(Math.max(0, Math.floor((cols - size) / 2)));

    const lines = [];
    for (let y = 0; y < size; y += 2) {
      let line = pad;
      for (let x = 0; x < size; x++) {
        line += `{#${hex(x, y)}-fg}{#${hex(x, y + 1)}-bg}▀{/}`;
      }
      lines.push(line);
    }

    return lines.join('\n');
  }

  displaySearchResults(results) {
    if (results.tracks?.items?.length > 0) {
      const tracks = results.tracks.items.slice(0, 5);
      let searchText = 'Search Results:\n\n';
      tracks.forEach((track, index) => {
        const artists = track.artists.map(a => a.name).join(', ');
        searchText += `${index + 1}. ${track.name} - ${artists}\n`;
      });
      this.log(searchText);
    } else {
      this.log('No search results found');
    }
  }

  displayDevices(devices) {
    if (devices.devices?.length > 0) {
      let deviceText = 'Available Devices:\n\n';
      devices.devices.forEach((device, index) => {
        const active = device.is_active ? ' (Active)' : '';
        deviceText += `${index + 1}. ${device.name} - ${device.type}${active}\n`;
      });
      this.log(deviceText);
    } else {
      this.log('No devices found');
    }
  }

  setBar(box, percent, label, color) {
    const suffix = label ? ` ${label}` : '';
    const width = Math.max(4, (box.width || 20) - 2 - suffix.length);
    const ratio = Math.min(100, Math.max(0, percent)) / 100;
    const filled = Math.round(ratio * width);

    box.setContent(
      `{${color}-fg}${'█'.repeat(filled)}{/}${'░'.repeat(width - filled)}${suffix}`
    );
  }

  formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  log(message) {
    this.logBox.log(`[${new Date().toLocaleTimeString()}] ${message}`);
    this.screen.render();
  }

  startUpdateLoop() {
    this.updateTrackInfo();
    setInterval(() => {
      this.updateTrackInfo();
    }, 10000); // Reduced from 2s to 10s to avoid excessive API calls
  }

  render() {
    this.screen.render();
  }
}

module.exports = TerminalUI;