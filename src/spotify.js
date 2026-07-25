const axios = require('axios');

class SpotifyAPI {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseURL = 'https://api.spotify.com/v1';
  }

  async request(endpoint, method = 'GET', data = null) {
    try {
      const headers = {
        'Authorization': `Bearer ${this.accessToken}`
      };

      const config = {
        method,
        headers
      };

      // Only add Content-Type and body for non-GET requests
      if (method !== 'GET' && data) {
        headers['Content-Type'] = 'application/json';
        config.body = JSON.stringify(data);
      }

      const response = await fetch(`${this.baseURL}${endpoint}`, config);
      
      // Handle 204 No Content responses
      if (response.status === 204) {
        return null;
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: { message: 'API request failed' } };
        }
        
        const errorMessage = errorData.error?.message || 'Unknown error';
        throw new Error(`Spotify API Error: ${response.status} - ${errorMessage}`);
      }
      
      // Some endpoints return empty responses, handle gracefully
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const text = await response.text();
        if (text.trim()) {
          return JSON.parse(text);
        }
        return null;
      }
      
      return null;
    } catch (error) {
      if (error.message.includes('Spotify API Error')) {
        throw error;
      }
      throw new Error(`Network error: ${error.message}`);
    }
  }

  async getCurrentPlayback() {
    return await this.request('/me/player');
  }

  async getCurrentTrack() {
    return await this.request('/me/player/currently-playing');
  }

  async play({ deviceId = null, uris = null, contextUri = null } = {}) {
    const endpoint = deviceId ? `/me/player/play?device_id=${deviceId}` : '/me/player/play';

    let body = null;
    if (uris) {
      body = { uris };
    } else if (contextUri) {
      body = { context_uri: contextUri };
    }

    await this.request(endpoint, 'PUT', body);
    return true;
  }

  async pause() {
    await this.request('/me/player/pause', 'PUT');
    return true;
  }

  async next() {
    await this.request('/me/player/next', 'POST');
    return true;
  }

  async previous() {
    await this.request('/me/player/previous', 'POST');
    return true;
  }

  async setVolume(volume) {
    await this.request(`/me/player/volume?volume_percent=${volume}`, 'PUT');
    return true;
  }

  async setShuffle(state) {
    await this.request(`/me/player/shuffle?state=${state}`, 'PUT');
    return true;
  }

  async setRepeat(state) {
    await this.request(`/me/player/repeat?state=${state}`, 'PUT');
    return true;
  }

  async getDevices() {
    return await this.request('/me/player/devices');
  }

  async transferPlayback(deviceId) {
    return await this.request('/me/player', 'PUT', {
      device_ids: [deviceId],
      play: true
    });
  }

  async search(query, type = 'track', limit = 20) {
    const params = new URLSearchParams({
      q: query,
      type,
      limit
    });
    return await this.request(`/search?${params.toString()}`);
  }

  async getUserPlaylists(limit = 20) {
    return await this.request(`/me/playlists?limit=${limit}`);
  }

  async getPlaylistTracks(playlistId, limit = 50) {
    return await this.request(`/playlists/${playlistId}/tracks?limit=${limit}`);
  }

  async testConnection() {
    return await this.request('/me');
  }
}

module.exports = SpotifyAPI;