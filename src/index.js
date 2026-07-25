#!/usr/bin/env node

const SpotifyAuth = require('./auth');
const SpotifyAPI = require('./spotify');
const TerminalUI = require('./ui');

async function main() {
  console.log('🎵 Spot - Terminal Spotify Player');
  console.log('================================\n');

  if (!process.env.SPOTIFY_CLIENT_ID) {
    console.error('❌ Missing Spotify Client ID!');
    console.error('Please create a .env file with your Spotify app credentials:');
    console.error('SPOTIFY_CLIENT_ID=your_client_id');
    console.error('\nGet your credentials at: https://developer.spotify.com/dashboard');
    process.exit(1);
  }

  try {
    const auth = new SpotifyAuth();
    console.log('🔐 Authenticating with Spotify...');
    
    const accessToken = await auth.getValidToken();
    console.log('✅ Authentication successful!');
    
    const spotify = new SpotifyAPI(accessToken);
    
    // Test the connection first
    console.log('🔍 Testing Spotify API connection...');
    try {
      const userInfo = await spotify.testConnection();
      console.log(`✅ Connected as: ${userInfo.display_name || userInfo.id}`);
    } catch (error) {
      console.error('❌ Failed to connect to Spotify API:', error.message);
      auth.clearToken();
      console.log('🔄 Deleted stored token. Restart the app to re-authenticate.');
      process.exit(1);
    }
    
    console.log('🎮 Starting terminal interface...\n');
    
    const ui = new TerminalUI(spotify);
    ui.log('Welcome to Spot! Use keyboard shortcuts to control playback.');
    ui.log('Press Space to play/pause, n/p for next/previous, q to quit.');
    
  } catch (error) {
    console.error('❌ Error starting Spot:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };