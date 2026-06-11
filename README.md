# AetherStream - WebRTC Camera Streamer

AetherStream is a zero-configuration, high-performance WebRTC-based camera streaming project. It allows you to stream your laptop's camera directly to a phone browser (or another computer) peer-to-peer over the local network or the internet.

It uses a **Node.js Express & WebSocket server** for signaling, while the media transmission flows directly **peer-to-peer (P2P)** between the laptop and the phone using WebRTC.

---

## Technical Features

- **P2P Streaming**: Video and audio streams flow directly between devices via WebRTC (no video data passes through the server).
- **Auto-Signaling**: Automatically exchanges SDP offers/answers and ICE candidates over a WebSocket server.
- **Robust Connection Pipeline**: Implements candidate buffering to eliminate race conditions during negotiation.
- **Glassmorphic Cyberpunk Theme**: Premium responsive dark dashboard with inline SVGs, CSS grids, and real-time status pulses.
- **Instant Sharing**: Dynamically generates client paths and QR codes for quick mobile device connections.

---

## Installation & Running

### 1. Install Dependencies
Run the command below in the project directory:
```bash
npm install
```

### 2. Start the Server
Run the Express static and signaling server:
```bash
npm start
```
By default, the server runs on port **3000** and binds to all interfaces (`0.0.0.0`), meaning it's visible on your local network.

---

## How to Connect Your Devices

### Option A: Local Network (Same Wi-Fi)

1. Open your laptop browser and navigate to:
   ```
   http://localhost:3000
   ```
2. Click **Start Broadcast** (Host) and allow camera/microphone permissions.
3. Once the broadcast page opens, scan the **QR code** on the right with your phone camera, or copy the sharing URL.
   *Note: If your local IP isn't automatically detected, replace `localhost` in the URL with your laptop's local network IP address (e.g., `http://192.168.1.15:3000/?role=viewer`).*
4. Load the page on your phone. It will automatically connect to the signaling server and receive the stream. Tap the **Play** button if your browser blocks auto-play.

---

## Option B: Over the Internet (From Anywhere)

Since WebRTC's camera capture (`getUserMedia`) requires a secure origin (HTTPS), the easiest way to test this from any mobile device over cellular data/external networks is by using an HTTPS tunnel.

You can spin up a secure public tunnel instantly without installing anything:

1. In another terminal, run:
   ```bash
   npx localtunnel --port 3000
   ```
2. Localtunnel will generate a public address like:
   ```
   https://sweet-pandas-jump.loca.lt
   ```
3. Open this secure URL on your laptop. Select **Start Broadcast**.
4. Scan the generated QR code or open that URL with `?role=viewer` on your phone browser.
5. The laptop and phone will establish a WebRTC connection through the public tunnel, traversing NAT routers using Google's public STUN servers!

---

## Troubleshooting

### Camera Not Starting
- **Secure Contexts**: Chrome and Safari block camera access on non-secure origins. Ensure you are using `localhost` on the host, or using an HTTPS tunnel.
- **Permissions**: Double check browser page permissions.
- **Active Camera**: Close other applications (Zoom, Teams, etc.) that might be locking your camera.

### Connection Stuck on "Establishing Connection..."
- Ensure both devices are connected to the internet (for option B) or on the exact same Wi-Fi subnet (for option A).
- Check your local laptop firewall. Make sure traffic on port `3000` is allowed.
- Open the console logs pane inside the UI dashboard to see real-time WebRTC negotiation events.
