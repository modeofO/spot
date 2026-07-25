const http = require('http');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ quiet: true });

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

class SpotifyAuth {
  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID;
    this.port = Number(process.env.PORT) || 8888;
    this.redirectUri = process.env.REDIRECT_URI || `http://127.0.0.1:${this.port}/callback`;
    this.tokenPath = path.join(__dirname, '../.spotify_token');
    this.scopeList = [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-library-read',
      'user-library-modify',
      'user-read-private'
    ];
    this.scopes = this.scopeList.join(' ');

    this.validateRedirectUri();
  }

  // Spotify rejects `localhost` since 2025-04-09. Loopback must be a literal IP.
  validateRedirectUri() {
    let url;
    try {
      url = new URL(this.redirectUri);
    } catch (err) {
      throw new Error(`Invalid REDIRECT_URI: ${this.redirectUri}`);
    }

    if (url.hostname === 'localhost') {
      throw new Error(
        `Spotify no longer accepts "localhost" as a redirect URI.\n` +
        `Use http://127.0.0.1:${this.port}/callback instead — update REDIRECT_URI in .env ` +
        `and the redirect URI in your Spotify app dashboard.`
      );
    }

    const isLoopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !isLoopback) {
      throw new Error(
        `Redirect URI must use HTTPS, or an http:// loopback address (127.0.0.1 / [::1]).\n` +
        `Got: ${this.redirectUri}`
      );
    }
  }

  generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
  }

  generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  generateAuthUrl() {
    this.codeVerifier = this.generateCodeVerifier();
    this.state = crypto.randomBytes(16).toString('base64url');
    const codeChallenge = this.generateCodeChallenge(this.codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: this.scopes,
      redirect_uri: this.redirectUri,
      state: this.state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  // Runs a one-shot loopback server that catches Spotify's redirect and reads
  // the authorization code straight out of the query string.
  waitForAuthCode() {
    const callbackUrl = new URL(this.redirectUri);
    const callbackPath = callbackUrl.pathname;

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url, this.redirectUri);
        if (reqUrl.pathname !== callbackPath) {
          res.writeHead(404).end();
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');

        const finish = (message, err) => {
          res.writeHead(err ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>Spot</title>
<body style="font-family:system-ui;background:#121212;color:#1db954;display:grid;place-items:center;height:100vh;margin:0">
<h1>${message}</h1></body>`);
          clearTimeout(timer);
          server.close();
          if (err) reject(err); else resolve(code);
        };

        if (error) {
          finish('Authorization denied.', new Error(`Spotify returned: ${error}`));
        } else if (!code) {
          finish('No authorization code in callback.', new Error('No authorization code in callback'));
        } else if (state !== this.state) {
          finish('State mismatch — request rejected.', new Error('State mismatch: possible CSRF, aborting'));
        } else {
          finish('Authorized. You can close this tab.');
        }
      });

      const timer = setTimeout(() => {
        server.close();
        reject(new Error('Timed out waiting for Spotify callback (5 minutes)'));
      }, CALLBACK_TIMEOUT_MS);

      server.on('error', (err) => {
        clearTimeout(timer);
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use — free it or set PORT in .env`));
        } else {
          reject(err);
        }
      });

      server.listen(this.port, callbackUrl.hostname === '[::1]' ? '::1' : '127.0.0.1');
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
    fs.writeFileSync(this.tokenPath, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
  }

  loadToken() {
    try {
      const tokenData = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
      return tokenData;
    } catch (err) {
      return null;
    }
  }

  clearToken() {
    try {
      fs.unlinkSync(this.tokenPath);
    } catch (err) {
      // nothing to clear
    }
  }

  async refreshToken(tokenData) {
    const data = {
      grant_type: 'refresh_token',
      refresh_token: tokenData.refresh_token,
      client_id: this.clientId
    };

    const response = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams(data), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    // Spotify rotates the refresh token on PKCE refreshes. Keep whatever it
    // hands back; only fall back to the old one when it omits a new one.
    const newTokenData = {
      ...tokenData,
      ...response.data,
      expires_at: Date.now() + (response.data.expires_in * 1000)
    };
    if (!response.data.refresh_token) {
      newTokenData.refresh_token = tokenData.refresh_token;
    }

    this.saveToken(newTokenData);
    return newTokenData;
  }

  async authorize() {
    const authUrl = this.generateAuthUrl();
    const codePromise = this.waitForAuthCode();

    console.log(`Listening on ${this.redirectUri} for the Spotify callback...`);
    console.log('Opening browser for authentication...');
    const open = (await import('open')).default;
    await open(authUrl);
    console.log(`If the browser did not open, visit:\n${authUrl}\n`);

    const code = await codePromise;
    const tokenData = await this.exchangeCodeForToken(code);
    this.saveToken(tokenData);
    return tokenData;
  }

  // A stored token only carries the scopes it was granted, so adding a feature
  // that needs a new one has to force a fresh consent rather than 403 later.
  missingScopes(tokenData) {
    const granted = new Set((tokenData.scope || '').split(' ').filter(Boolean));
    return this.scopeList.filter((scope) => !granted.has(scope));
  }

  async getValidToken() {
    let tokenData = this.loadToken();

    if (!tokenData) {
      console.log('No token found. Starting authentication...');
      tokenData = await this.authorize();
    }

    const missing = this.missingScopes(tokenData);
    if (missing.length > 0) {
      console.log(`Token is missing permissions (${missing.join(', ')}). Re-authenticating...`);
      this.clearToken();
      tokenData = await this.authorize();
    }

    if (Date.now() >= tokenData.expires_at) {
      console.log('Token expired. Refreshing...');
      try {
        tokenData = await this.refreshToken(tokenData);
      } catch (error) {
        // Only a rejected grant means the stored token is dead. Network errors
        // must not wipe it — that would force a re-auth over a transient blip.
        if (error.response?.data?.error !== 'invalid_grant') {
          throw new Error(
            `Could not refresh token: ${error.response?.data?.error_description || error.message}`
          );
        }
        const reason = error.response.data.error_description || 'invalid_grant';
        console.log(`Stored token rejected (${reason}). Re-authenticating...`);
        this.clearToken();
        tokenData = await this.authorize();
      }
    }

    return tokenData.access_token;
  }
}

module.exports = SpotifyAuth;
