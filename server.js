const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Keep track of the active broadcaster and viewer connections
let broadcaster = null;
let viewer = null;

// Safe send helper to prevent server crashes if a socket closes mid-handshake
function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      console.error('Failed to send message over WebSocket:', err);
    }
  }
}

wss.on('connection', (ws) => {
  let userRole = null;
  console.log('New WebSocket connection established.');

  ws.on('message', (messageText) => {
    try {
      const data = JSON.parse(messageText);
      
      switch (data.type) {
        case 'register':
          userRole = data.role;
          if (userRole === 'broadcaster') {
            if (broadcaster) {
              console.log('Broadcaster re-registered. Disconnecting old broadcaster.');
              try { broadcaster.close(); } catch(e) {}
            }
            broadcaster = ws;
            console.log('Broadcaster successfully registered.');
            
            // If viewer is already waiting, notify the broadcaster to start connection
            if (viewer) {
              console.log('Viewer is already connected. Triggering offer generation.');
              safeSend(broadcaster, { type: 'viewer-ready' });
              safeSend(viewer, { type: 'status', message: 'Broadcaster is active. Connecting...' });
            } else {
              safeSend(ws, { type: 'status', message: 'Registered as Broadcaster. Waiting for viewer...' });
            }
          } else if (userRole === 'viewer') {
            if (viewer) {
              console.log('Viewer re-registered. Disconnecting old viewer.');
              try { viewer.close(); } catch(e) {}
            }
            viewer = ws;
            console.log('Viewer successfully registered.');
            
            // If broadcaster is available, notify the broadcaster to initiate WebRTC negotiation
            if (broadcaster) {
              console.log('Broadcaster is active. Prompting broadcaster to start offer.');
              safeSend(broadcaster, { type: 'viewer-ready' });
              safeSend(ws, { type: 'status', message: 'Connecting to Broadcaster...' });
            } else {
              safeSend(ws, { type: 'status', message: 'Waiting for Broadcaster to go live...' });
            }
          }
          break;

        case 'offer':
          // Relay offer from broadcaster to viewer
          if (ws === broadcaster && viewer) {
            console.log('Relaying SDP Offer to Viewer.');
            safeSend(viewer, { type: 'offer', sdp: data.sdp });
          } else {
            console.warn('Received offer but no viewer is connected, or sender is not broadcaster.');
          }
          break;

        case 'answer':
          // Relay answer from viewer to broadcaster
          if (ws === viewer && broadcaster) {
            console.log('Relaying SDP Answer to Broadcaster.');
            safeSend(broadcaster, { type: 'answer', sdp: data.sdp });
          } else {
            console.warn('Received answer but no broadcaster is connected, or sender is not viewer.');
          }
          break;

        case 'candidate':
          // Relay ICE candidate to the opposite party
          if (ws === broadcaster) {
            if (viewer) {
              safeSend(viewer, { type: 'candidate', candidate: data.candidate });
            }
          } else if (ws === viewer) {
            if (broadcaster) {
              safeSend(broadcaster, { type: 'candidate', candidate: data.candidate });
            }
          }
          break;

        default:
          console.warn(`Unknown message type: ${data.type}`);
      }
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (ws === broadcaster) {
      console.log('Broadcaster disconnected.');
      broadcaster = null;
      if (viewer) {
        safeSend(viewer, { type: 'broadcaster-left' });
      }
    } else if (ws === viewer) {
      console.log('Viewer disconnected.');
      viewer = null;
      if (broadcaster) {
        safeSend(broadcaster, { type: 'viewer-left' });
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket connection error:', err);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(` Signaling Server running locally on:`);
  console.log(` - Localhost: http://localhost:${PORT}`);
  console.log(`========================================================`);
});
