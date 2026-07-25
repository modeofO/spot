const blessed = require('blessed');
const contrib = require('blessed-contrib');

const RESET = '\x1b[0m';
const TRUECOLOR = /^(truecolor|24bit)$/i.test(process.env.COLORTERM || '');

// Terminal font size is global, so a pane cannot use smaller text to get more
// detail. iTerm2's inline image protocol sidesteps the cell grid entirely.
// Set SPOT_ART=blocks to force the half-block renderer.
const INLINE_IMAGES = process.env.SPOT_ART !== 'blocks' &&
  (process.env.LC_TERMINAL === 'iTerm2' || process.env.TERM_PROGRAM === 'iTerm.app');

// Nearest entry in the xterm 6x6x6 colour cube, used when the terminal has not
// advertised 24-bit colour.
function xterm256(r, g, b) {
  const level = (v) => (v < 48 ? 0 : v < 114 ? 1 : Math.floor((v - 35) / 40));
  return 16 + 36 * level(r) + 6 * level(g) + level(b);
}

function sgr(layer, [r, g, b]) {
  return TRUECOLOR
    ? `\x1b[${layer};2;${r};${g};${b}m`
    : `\x1b[${layer};5;${xterm256(r, g, b)}m`;
}

function sameColor(a, b) {
  return b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function trackEntry(track) {
  const artists = track.artists.map((artist) => artist.name).join(', ');
  return { label: `${track.name} — ${artists}`, track };
}

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
    this.art = null;
    this.pickerStack = [];

    // Repaint the cover after every frame; blessed draws the pane empty and
    // knows nothing about the raw escape sequences layered on top of it.
    this.screen.on('render', () => this.paintAlbumArt());

    // The cover is rendered for a specific pane size, so a resize invalidates
    // it; clearing lastAlbumId makes the next poll fetch and re-render it.
    this.screen.on('resize', () => {
      this.art = null;
      this.lastAlbumId = null;
    });

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

    // Six rows, not four: the renderer is height-bound, so a taller pane is
    // the only way to get more pixels into the cover.
    this.albumArt = this.grid.set(0, 8, 6, 4, blessed.box, {
      label: 'Album Art',
      border: { type: 'line' },
      tags: true,
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      }
    });

    this.controls = this.grid.set(4, 0, 2, 8, blessed.box, {
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

    // One overlay serves search results, the library and playlist contents;
    // pickerStack keeps the trail so Esc walks back a level at a time.
    this.picker = blessed.list({
      parent: this.screen,
      border: { type: 'line' },
      top: 'center',
      left: 'center',
      width: '70%',
      height: '60%',
      hidden: true,
      keys: true,
      vi: true,
      scrollable: true,
      style: {
        fg: 'white',
        border: { fg: 'yellow' },
        selected: { bg: 'green', fg: 'black' }
      }
    });

    this.screen.render();
  }

  getControlsText() {
    return `
 [Space] Play/Pause  [n] Next  [p] Previous  [s] Shuffle  [r] Repeat
 [+/-] Volume  [l] Library  [/] Search  [d] Devices  [q] Quit
 In a list: [↑/↓] Move  [Enter] Play  [Esc] Back
    `.trim();
  }

  // Global shortcuts fire regardless of focus, so typing "n" in the search box
  // used to skip the track. Suppress them whenever a widget owns the keyboard.
  isCapturingInput() {
    return this.screen.focused === this.searchBox || !this.picker.hidden;
  }

  bindKey(keys, handler) {
    this.screen.key(keys, async () => {
      if (this.isCapturingInput()) return;
      try {
        await handler();
      } catch (error) {
        this.log(`Error: ${error.message}`);
      }
    });
  }

  setupKeybindings() {
    this.screen.key(['q', 'C-c'], () => {
      if (this.isCapturingInput()) return;
      return process.exit(0);
    });

    this.bindKey('space', async () => {
      if (this.playbackState?.is_playing) {
        await this.spotify.pause();
        this.log('Paused playback');
      } else {
        await this.spotify.play();
        this.log('Resumed playback');
      }
    });

    this.bindKey('n', async () => {
      await this.spotify.next();
      this.log('Skipped to next track');
    });

    this.bindKey('p', async () => {
      await this.spotify.previous();
      this.log('Skipped to previous track');
    });

    this.bindKey('s', async () => {
      const newState = !this.playbackState?.shuffle_state;
      await this.spotify.setShuffle(newState);
      this.log(`Shuffle ${newState ? 'enabled' : 'disabled'}`);
    });

    this.bindKey('r', async () => {
      const currentRepeat = this.playbackState?.repeat_state || 'off';
      const nextRepeat = currentRepeat === 'off' ? 'context' :
                        currentRepeat === 'context' ? 'track' : 'off';
      await this.spotify.setRepeat(nextRepeat);
      this.log(`Repeat mode: ${nextRepeat}`);
    });

    this.bindKey(['+', '='], () => this.changeVolume(10));
    this.bindKey('-', () => this.changeVolume(-10));

    this.bindKey('/', () => {
      this.searchBox.focus();
    });

    this.searchBox.on('submit', async (text) => {
      this.searchBox.clearValue();
      this.logBox.focus(); // release the keyboard so global shortcuts work again
      this.screen.render();
      if (!text.trim()) return;

      try {
        const results = await this.spotify.search(text.trim());
        this.displaySearchResults(results);
      } catch (error) {
        this.log(`Search error: ${error.message}`);
      }
    });

    this.searchBox.key('escape', () => {
      this.searchBox.cancel();
      this.screen.render();
    });

    this.picker.on('select', async (item, index) => {
      const frame = this.pickerStack[this.pickerStack.length - 1];
      if (!frame) return;

      try {
        await frame.onSelect(frame.items[index], index);
      } catch (error) {
        this.log(`Error: ${error.message}`);
      }
    });

    this.picker.key('escape', () => this.popPicker());
    this.picker.key('q', () => this.closePicker());

    this.bindKey('l', () => this.openLibrary());

    this.bindKey('d', async () => {
      const devices = await this.spotify.getDevices();
      this.displayDevices(devices);
    });
  }

  openPicker(title, items, onSelect) {
    if (items.length === 0) {
      this.log(`${title}: nothing to show`);
      return;
    }

    this.pickerStack.push({ title, items, onSelect });
    this.showPicker();
  }

  showPicker() {
    const frame = this.pickerStack[this.pickerStack.length - 1];
    if (!frame) {
      this.closePicker();
      return;
    }

    const back = this.pickerStack.length > 1 ? 'Esc back' : 'Esc close';
    this.picker.setLabel(` ${frame.title} — Enter to play, ${back} `);
    this.picker.setItems(frame.items.map((item) => item.label));
    this.picker.select(0);
    this.picker.show();
    this.picker.setFront();
    this.picker.focus();
    this.screen.render();
  }

  popPicker() {
    this.pickerStack.pop();
    if (this.pickerStack.length > 0) {
      this.showPicker();
    } else {
      this.closePicker();
    }
  }

  closePicker() {
    this.pickerStack = [];
    this.picker.hide();
    this.artDirty = true; // the overlay covered the pane
    this.logBox.focus();
    this.screen.render();
  }

  async openLibrary() {
    this.log('Loading your library...');
    const playlists = await this.spotify.getUserPlaylists();

    const items = [
      { label: 'Liked Songs', liked: true },
      ...(playlists.items || [])
        .filter(Boolean)
        .map((playlist) => ({
          label: `${playlist.name}  (${playlist.tracks?.total ?? '?'} tracks)`,
          playlist
        }))
    ];

    this.openPicker('Your Library', items, (item) => this.openCollection(item));
  }

  async openCollection(entry) {
    if (entry.liked) {
      const saved = await this.spotify.getSavedTracks();
      const tracks = (saved.items || []).map((item) => item.track).filter(Boolean);

      // Liked Songs has no playable context URI, so hand Spotify the selected
      // track plus everything after it to keep a queue behind it.
      this.openPicker('Liked Songs', tracks.map(trackEntry), (item, index) =>
        this.playTracks(tracks.slice(index, index + 50).map((track) => track.uri), item.track)
      );
      return;
    }

    const playlist = entry.playlist;
    const page = await this.spotify.getPlaylistTracks(playlist.id);
    const tracks = (page.items || []).map((item) => item.track).filter(Boolean);

    // A context URI plus an offset leaves the rest of the playlist queued.
    this.openPicker(playlist.name, tracks.map(trackEntry), (item, index) =>
      this.playContext(playlist.uri, index, item.track)
    );
  }

  async playTracks(uris, track) {
    await this.spotify.play({ uris });
    this.afterPlay(track);
  }

  async playContext(contextUri, offset, track) {
    await this.spotify.play({ contextUri, offset });
    this.afterPlay(track);
  }

  afterPlay(track) {
    this.closePicker();
    this.log(`Playing: ${track.name}`);
    setTimeout(() => this.updateTrackInfo(), 500);
  }

  async changeVolume(delta) {
    const device = this.playbackState?.device;

    // Phones and speakers routinely refuse remote volume changes; Spotify
    // advertises this up front, so check before eating a 403.
    if (device && device.supports_volume === false) {
      this.log(`${device.name} does not accept remote volume control — use the device itself`);
      return;
    }

    // playbackState only refreshes on the poll, so stepping off it made every
    // press inside a poll window compute the same target. Step off our own
    // pending value instead and let the poll reconcile once it catches up.
    const current = this.volumeTarget ?? device?.volume_percent ?? 50;
    const target = Math.min(100, Math.max(0, current + delta));

    this.volumeTarget = target;
    this.volumeChangedAt = Date.now();
    this.setBar(this.volumeBar, target, `${target}%`, 'blue');
    this.screen.render();

    await this.spotify.setVolume(target);
    this.log(`Volume: ${target}%`);
  }

  async updateTrackInfo() {
    try {
      // /me/player already carries the track, so the extra
      // /me/player/currently-playing call was doubling the request rate for
      // nothing.
      const playbackState = await this.spotify.getCurrentPlayback();

      this.playbackState = playbackState;
      this.currentTrack = playbackState;

      // Handle case where no device is active or no track is playing
      if (!playbackState) {
        this.trackInfo.setContent(`
No active Spotify device found.

Please:
1. Open Spotify on your phone, computer, or web player
2. Start playing a song
3. Press 'd' to see available devices

The player will automatically detect playback once started.
        `.trim());
        this.art = null;
        this.albumArt.setContent('No album art');
        this.deviceInfo.setContent('No active device');
        this.progressAnchor = null;
        this.setBar(this.progressBar, 0, '', 'green');
        this.setBar(this.volumeBar, 0, '', 'blue');
        this.screen.render();
        return;
      }

      if (playbackState.item) {
        const track = playbackState.item;
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

        if (playbackState?.progress_ms !== undefined && track.duration_ms) {
          this.progressAnchor = {
            ms: playbackState.progress_ms,
            duration: track.duration_ms,
            at: Date.now(),
            playing: !!playbackState.is_playing
          };
          this.renderProgress();
        }

        if (playbackState?.device?.volume_percent !== undefined) {
          const reported = playbackState.device.volume_percent;

          // Drop the optimistic value once the device agrees, or once it has
          // had long enough to and clearly is not going to.
          if (this.volumeTarget === reported || Date.now() - (this.volumeChangedAt || 0) > 3000) {
            this.volumeTarget = null;
          }

          const volume = this.volumeTarget ?? reported;
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
        
        this.art = null;
        this.albumArt.setContent('No album art');
      } else {
        this.trackInfo.setContent('No track currently playing');
        this.art = null;
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
      this.art = await this.renderAlbumArt(imageUrl);
      this.artDirty = true;
      this.albumArt.setContent('');
    } catch (error) {
      this.art = null;
      this.log(`Album art failed: ${error.message}`);
      this.albumArt.setContent('\n  Album art\n  unavailable');
    }
    this.screen.render();
  }

  // Blocks cap out at one cell = 1x2 pixels, which is why the cover looks
  // coarse no matter how large the pane is. iTerm2 can draw a real image into
  // a cell region instead, at whatever resolution the pane is worth.
  async renderAlbumArt(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`fetch returned ${response.status}`);
    }
    const source = Buffer.from(await response.arrayBuffer());

    const cols = Math.max(8, (this.albumArt.width || 22) - 2);
    const rows = Math.max(4, (this.albumArt.height || 12) - 2);
    const size = Math.max(8, Math.min(cols, rows * 2) & ~1);
    const left = Math.max(0, Math.floor((cols - size) / 2));
    const top = Math.max(0, Math.floor((rows - size / 2) / 2));

    const art = INLINE_IMAGES
      ? await this.renderInlineImage(source, size)
      : await this.renderBlocks(source, size);

    return { ...art, left, top };
  }

  // iTerm2's inline image protocol: the terminal scales the image into the
  // given cell box itself, so the only limit is the pane size in pixels.
  async renderInlineImage(source, size) {
    const sharp = require('sharp');

    const encoded = await sharp(source)
      .resize(Math.min(600, size * 12), Math.min(600, size * 12), { fit: 'fill', kernel: 'lanczos3' })
      .jpeg({ quality: 85 })
      .toBuffer();

    const args = [
      'inline=1',
      `size=${encoded.length}`,
      `width=${size}`,
      `height=${size / 2}`,
      'preserveAspectRatio=1'
    ].join(';');

    return {
      rows: size / 2,
      payload: `\x1b]1337;File=${args}:${encoded.toString('base64')}\x07`
    };
  }

  // Fallback for everything else. Each cell renders two stacked pixels with the
  // upper-half block: the top pixel becomes the foreground, the bottom one the
  // background. That doubles vertical resolution and cancels out the roughly
  // 2:1 aspect of a terminal cell, so a square cover stays square.
  //
  // blessed quantises every colour to the 256-colour palette, which turns any
  // gradient into visible banding, so rows are emitted as raw SGR and painted
  // over the pane after blessed has drawn (see paintAlbumArt).
  async renderBlocks(source, size) {
    const sharp = require('sharp');

    const { data, info } = await sharp(source)
      .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const at = (x, y) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };

    const lines = [];
    for (let y = 0; y < size; y += 2) {
      let line = '';
      let lastTop = null;
      let lastBottom = null;

      for (let x = 0; x < size; x++) {
        const top = at(x, y);
        const bottom = at(x, y + 1);

        // Only re-emit a colour when it actually changes; flat regions collapse
        // to a run of bare block characters.
        if (!sameColor(top, lastTop)) {
          line += sgr(38, top);
          lastTop = top;
        }
        if (!sameColor(bottom, lastBottom)) {
          line += sgr(48, bottom);
          lastBottom = bottom;
        }
        line += '▀';
      }

      lines.push(line + RESET);
    }

    return { lines, rows: lines.length };
  }

  // blessed has no 24-bit colour path and no concept of an inline image, so the
  // art goes straight to the terminal once blessed has painted the frame under
  // it.
  //
  // Two traps here. blessed's program.write() bypasses its output buffer while
  // cursorPos() goes through it, so mixing them emits the rows with no
  // positioning at all — the image ends up smeared across the whole screen. And
  // blessed's own frame is still sitting in that buffer when the render event
  // fires. So: flush blessed first, then write one pre-built string, cursor
  // moves included, directly to the output.
  paintAlbumArt() {
    if (!this.art || !this.albumArt.visible) return;
    if (!this.picker.hidden) return;

    const program = this.screen.program;
    program.flush();

    const top = this.albumArt.atop + 1 + this.art.top;
    const left = this.albumArt.aleft + 1 + this.art.left;
    const cup = (row) => `\x1b[${row + 1};${left + 1}H`;

    // DECSC/DECRC around the paint, and autowrap off so a row that runs long
    // cannot spill into the pane below.
    let out = '\x1b7\x1b[?7l';

    if (this.art.payload) {
      // The image payload is ~60KB. blessed leaves the pane alone once drawn
      // (its content never changes), so repaint only when something could have
      // covered it, with a slow heartbeat as insurance.
      const stale = Date.now() - (this.artPaintedAt || 0) > 5000;
      if (!this.artDirty && !stale) {
        program.output.write('\x1b[?7h\x1b8');
        return;
      }

      this.artDirty = false;
      this.artPaintedAt = Date.now();
      out += cup(top) + this.art.payload;
    } else {
      this.art.lines.forEach((line, index) => {
        out += cup(top + index) + line;
      });
    }

    program.output.write(out + '\x1b[?7h\x1b8');
  }

  displaySearchResults(results) {
    const tracks = results.tracks?.items || [];

    if (tracks.length === 0) {
      this.log('No search results found');
      return;
    }

    this.openPicker('Search Results', tracks.map(trackEntry), (item) =>
      this.playTracks([item.track.uri], item.track)
    );
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

  // Extrapolate between polls so the bar moves every second instead of jumping
  // once per API round trip.
  renderProgress() {
    const anchor = this.progressAnchor;
    if (!anchor) return;

    const drift = anchor.playing ? Date.now() - anchor.at : 0;
    const elapsed = Math.min(anchor.duration, anchor.ms + drift);
    const percent = (elapsed / anchor.duration) * 100;

    this.setBar(
      this.progressBar,
      percent,
      `${this.formatTime(elapsed)} / ${this.formatTime(anchor.duration)}`,
      'green'
    );
  }

  startUpdateLoop() {
    this.updateTrackInfo();
    setInterval(() => this.updateTrackInfo(), 2000);
    setInterval(() => {
      this.renderProgress();
      this.screen.render();
    }, 1000);
  }

  render() {
    this.screen.render();
  }
}

module.exports = TerminalUI;