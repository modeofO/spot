const express = require('express');
const https = require('https');
const axios = require('axios');
const open = require('open');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

class SpotifyAuth {
  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID;
    this.redirectUri = 'https://example.com/callback';
    this.tokenPath = path.join(__dirname, '../.spotify_token');
    this.scopes = [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-library-read',
      'user-read-private'
    ].join(' ');
  }

  generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
  }

  generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  generateAuthUrl() {
    this.codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(this.codeVerifier);
    const state = Math.random().toString(36).substring(7);
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: this.scopes,
      redirect_uri: this.redirectUri,
      state: state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge
    });
    
    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async getAuthCodeManually() {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      console.log('\n📋 Manual Authentication Required');
      console.log('=================================');
      console.log('1. The browser will open to Spotify\'s authorization page');
      console.log('2. After you authorize, you\'ll be redirected to a page that won\'t load');
      console.log('3. Copy the ENTIRE URL from your browser\'s address bar');
      console.log('4. Paste it below and press Enter\n');

      readline.question('Paste the redirect URL here: ', (url) => {
        readline.close();
        try {
          const urlObj = new URL(url);
          const code = urlObj.searchParams.get('code');
          if (code) {
            resolve(code);
          } else {
            throw new Error('No authorization code found in URL');
          }
        } catch (error) {
          console.error('❌ Invalid URL. Please try again.');
          process.exit(1);
        }
      });
    });
  }

  async exchangeCodeForToken(code) {
    const data = {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: this.codeVerifier
    };

    const response = await axios.post('https://accounts.spotify.com/api/token', 
      new URLSearchParams(data), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return {
      ...response.data,
      expires_at: Date.now() + (response.data.expires_in * 1000)
    };
  }

  saveToken(tokenData) {
    fs.writeFileSync(this.tokenPath, JSON.stringify(tokenData, null, 2));
  }

  loadToken() {
    try {
      const tokenData = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
      return tokenData;
    } catch (err) {
      return null;
    }
  }

  async refreshToken(refreshToken) {
    const data = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId
    };

    const response = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams(data), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const newTokenData = {
      ...response.data,
      expires_at: Date.now() + (response.data.expires_in * 1000),
      refresh_token: refreshToken
    };

    this.saveToken(newTokenData);
    return newTokenData;
  }

  async getValidToken() {
    let tokenData = this.loadToken();
    
    if (!tokenData) {
      console.log('No token found. Starting authentication...');
      const authUrl = this.generateAuthUrl();
      console.log('Opening browser for authentication...');
      await open(authUrl);
      
      const code = await this.getAuthCodeManually();
      tokenData = await this.exchangeCodeForToken(code);
      this.saveToken(tokenData);
    }

    if (Date.now() >= tokenData.expires_at) {
      console.log('Token expired. Refreshing...');
      tokenData = await this.refreshToken(tokenData.refresh_token);
    }

    return tokenData.access_token;
  }
}

module.exports = SpotifyAuth;