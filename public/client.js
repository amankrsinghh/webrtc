// WebRTC configurations with free public STUN servers
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// UI State & Global Variables
let socket = null;
let peerConnection = null;
let localStream = null;
let clientRole = null; // 'broadcaster' or 'viewer'
let remoteDescriptionSet = false;
let iceQueue = [];

// DOM Elements
const sectionRoleSelection = document.getElementById('role-selection');
const sectionBroadcasterUi = document.getElementById('broadcaster-ui');
const sectionViewerUi = document.getElementById('viewer-ui');
const roleBadge = document.getElementById('role-badge');

// Check URL parameters for auto-joining as a viewer
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roleParam = urlParams.get('role');
  if (roleParam === 'viewer') {
    selectRole('viewer');
  } else if (roleParam === 'broadcaster') {
    selectRole('broadcaster');
  }
});

// Role selection interface transition
async function selectRole(role) {
  clientRole = role;
  
  // Update UI Badge
  roleBadge.innerText = role === 'broadcaster' ? 'Host Mode' : 'Viewer Mode';
  roleBadge.style.display = 'inline-block';

  // Transition Screens
  sectionRoleSelection.classList.remove('active');
  
  if (role === 'broadcaster') {
    sectionBroadcasterUi.classList.add('active');
    await startBroadcaster();
  } else if (role === 'viewer') {
    sectionViewerUi.classList.add('active');
    startViewer();
  }
}

// WebSocket Connection Instantiation
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    logEvent(`Connected to signaling server.`, 'success');
    socket.send(JSON.stringify({ type: 'register', role: clientRole }));
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'status':
          logEvent(data.message, 'info');
          updateStatusText(data.message);
          break;

        case 'viewer-ready':
          logEvent('A viewer connected. Starting WebRTC handshake...', 'info');
          updateStatusText('Viewer connected. Initializing stream...');
          setConnectionPulse('ready');
          await initiateWebRTCConnection();
          break;

        case 'offer':
          logEvent('Received video stream offer from host.', 'info');
          updateStatusText('Handshaking stream...');
          setConnectionPulse('ready');
          await handleSDPOffer(data.sdp);
          break;

        case 'answer':
          logEvent('Received handshake confirmation from viewer.', 'success');
          updateStatusText('Stream connected (Active).');
          setConnectionPulse('live');
          await handleSDPAnswer(data.sdp);
          break;

        case 'candidate':
          await handleRemoteICECandidate(data.candidate);
          break;

        case 'broadcaster-left':
          logEvent('Host disconnected. Stream stopped.', 'warn');
          updateStatusText('Broadcaster disconnected.');
          setConnectionPulse('idle');
          resetViewerConnection();
          break;

        case 'viewer-left':
          logEvent('Viewer disconnected. Standing by...', 'warn');
          updateStatusText('Viewer disconnected. Standing by...');
          setConnectionPulse('idle');
          resetHostConnection();
          break;
      }
    } catch (err) {
      console.error('Error handling signaling server message:', err);
      logEvent('Error handling signaling message.', 'error');
    }
  };

  socket.onclose = () => {
    logEvent('Disconnected from signaling server. Reconnecting in 3s...', 'error');
    updateStatusText('Server connection lost.');
    setConnectionPulse('idle');
    setTimeout(connectWebSocket, 3000);
  };
}

// -----------------------------------------------------------------------------
// Broadcaster (Host) Logic
// -----------------------------------------------------------------------------
async function startBroadcaster() {
  logEvent('Starting broadcaster profile...', 'system');
  setupHostUIControls();

  // Try to grab camera feed
  try {
    const videoConstraints = {
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: true
    };
    
    localStream = await navigator.mediaDevices.getUserMedia(videoConstraints);
    
    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;
    document.getElementById('local-placeholder').style.display = 'none';
    
    logEvent('Camera and microphone access granted.', 'success');
    updateStatusText('Camera active. Ready to broadcast.');
    
    // Connect to WebSocket signaling server
    connectWebSocket();
    generateShareLink();
  } catch (error) {
    console.error('Camera access failed:', error);
    logEvent(`Media Access Error: ${error.message}`, 'error');
    updateStatusText('Camera access blocked.');
    alert('Failed to access camera/microphone. Please ensure permissions are granted and that you are using a secure origin (localhost or HTTPS).');
  }
}

// Host initiates connection upon receiving 'viewer-ready' signal from server
async function initiateWebRTCConnection() {
  resetHostConnection(); // Clean up old peer connections if any

  peerConnection = new RTCPeerConnection(rtcConfig);
  remoteDescriptionSet = false;
  iceQueue = [];

  // Add captured tracks to the connection
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // ICE Candidates generation
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    logEvent(`WebRTC connection state: ${peerConnection.iceConnectionState}`, 'system');
    if (peerConnection.iceConnectionState === 'connected') {
      logEvent('Peer-to-peer audio/video tunnel fully established!', 'success');
      updateStatusText('Broadcasting Live!');
      setConnectionPulse('live');
    } else if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
      updateStatusText('Viewer connection lost.');
      setConnectionPulse('idle');
    }
  };

  try {
    // Generate SDP Offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.send(JSON.stringify({
      type: 'offer',
      sdp: offer
    }));
    logEvent('Offer generated and sent to signaling server.', 'info');
  } catch (err) {
    console.error('Failed to create SDP Offer:', err);
    logEvent('Failed to initialize WebRTC handshake.', 'error');
  }
}

// Broadcaster receives SDP Answer from Viewer
async function handleSDPAnswer(sdp) {
  if (!peerConnection) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    remoteDescriptionSet = true;
    logEvent('Remote description applied. Processing buffered candidates...', 'system');
    
    // Drain queued ICE Candidates
    while (iceQueue.length > 0) {
      const candidate = iceQueue.shift();
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (err) {
    console.error('Error setting remote description (SDP Answer):', err);
    logEvent('Failed to establish peer-to-peer link.', 'error');
  }
}

function resetHostConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteDescriptionSet = false;
  iceQueue = [];
}

// Controls for microphone and camera muting
function setupHostUIControls() {
  const toggleVideoBtn = document.getElementById('toggle-video');
  const toggleAudioBtn = document.getElementById('toggle-audio');

  toggleVideoBtn.addEventListener('click', () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      toggleVideoBtn.classList.toggle('active-off', !videoTrack.enabled);
      toggleVideoBtn.querySelector('.icon-on').style.display = videoTrack.enabled ? 'block' : 'none';
      toggleVideoBtn.querySelector('.icon-off').style.display = videoTrack.enabled ? 'none' : 'block';
      logEvent(`Camera track ${videoTrack.enabled ? 'enabled' : 'disabled'}.`, 'info');
    }
  });

  toggleAudioBtn.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      toggleAudioBtn.classList.toggle('active-off', !audioTrack.enabled);
      toggleAudioBtn.querySelector('.icon-on').style.display = audioTrack.enabled ? 'block' : 'none';
      toggleAudioBtn.querySelector('.icon-off').style.display = audioTrack.enabled ? 'none' : 'block';
      logEvent(`Microphone track ${audioTrack.enabled ? 'enabled' : 'disabled'}.`, 'info');
    }
  });

  // Copy share button behavior
  const copyBtn = document.getElementById('copy-btn');
  const shareUrlInput = document.getElementById('share-url');
  copyBtn.addEventListener('click', () => {
    shareUrlInput.select();
    document.execCommand('copy');
    const originalText = copyBtn.innerText;
    copyBtn.innerText = 'Copied!';
    copyBtn.style.borderColor = 'var(--color-success)';
    setTimeout(() => {
      copyBtn.innerText = originalText;
      copyBtn.style.borderColor = '';
    }, 2000);
  });
}

// Share link generation and QR code creation
function generateShareLink() {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('role', 'viewer');
  const shareUrl = currentUrl.toString();
  
  document.getElementById('share-url').value = shareUrl;

  // Use a public QR code API to render the QR code
  const qrWrapper = document.getElementById('qr-code-wrapper');
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}&color=0f0524&bgcolor=ffffff`;
  
  qrWrapper.innerHTML = `<img src="${qrApiUrl}" alt="Scan to connect phone viewer" />`;
  logEvent('Share link and scanning QR code generated.', 'info');
}

// -----------------------------------------------------------------------------
// Viewer Logic
// -----------------------------------------------------------------------------
function startViewer() {
  logEvent('Starting viewer profile...', 'system');
  setupViewerUIControls();
  
  // Setup placeholder
  const placeholderText = document.getElementById('viewer-placeholder-text');
  placeholderText.innerText = 'Connecting to signaling server...';
  
  connectWebSocket();
}

// Viewer handles incoming SDP Offer from Broadcaster
async function handleSDPOffer(sdp) {
  resetViewerConnection(); // Clean up old peer connections if any

  peerConnection = new RTCPeerConnection(rtcConfig);
  remoteDescriptionSet = false;
  iceQueue = [];

  // Stream tracks receiver
  peerConnection.ontrack = (event) => {
    logEvent('Received remote video/audio track stream from host.', 'success');
    const remoteVideo = document.getElementById('remote-video');
    remoteVideo.srcObject = event.streams[0];
    
    // Hide loading screen, enable play controls
    document.getElementById('viewer-placeholder').style.display = 'none';
    document.getElementById('viewer-play').disabled = false;
    
    // Attempt automatic playback
    remoteVideo.play()
      .then(() => {
        logEvent('Live stream audio/video playing.', 'success');
        updateStatusText('Live - Streaming');
        setConnectionPulse('live');
      })
      .catch((err) => {
        console.warn('Autoplay blocked. User action required:', err);
        logEvent('Autoplay blocked by browser. Click Play below.', 'warn');
        updateStatusText('Ready (Awaiting User Play)');
      });
  };

  // ICE Candidates generation
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    logEvent(`WebRTC connection state: ${peerConnection.iceConnectionState}`, 'system');
    if (peerConnection.iceConnectionState === 'connected') {
      logEvent('Secure media pipeline active.', 'success');
      updateStatusText('Live - Streaming');
      setConnectionPulse('live');
    } else if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
      updateStatusText('Lost connection to host.');
      setConnectionPulse('idle');
      document.getElementById('viewer-placeholder').style.display = 'flex';
      document.getElementById('viewer-placeholder-text').innerText = 'Re-establishing stream connection...';
    }
  };

  try {
    // Set remote description (Broadcaster offer)
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    remoteDescriptionSet = true;
    logEvent('Applied host remote configuration. Flushing buffered candidates...', 'system');

    // Drain queued ICE Candidates
    while (iceQueue.length > 0) {
      const candidate = iceQueue.shift();
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    // Create SDP Answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.send(JSON.stringify({
      type: 'answer',
      sdp: answer
    }));
    logEvent('Handshake answer generated and sent to signaling server.', 'info');
  } catch (err) {
    console.error('Failed to create SDP Answer:', err);
    logEvent('Failed to establish WebRTC link.', 'error');
  }
}

function resetViewerConnection() {
  const remoteVideo = document.getElementById('remote-video');
  if (remoteVideo) {
    remoteVideo.srcObject = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteDescriptionSet = false;
  iceQueue = [];
  
  document.getElementById('viewer-placeholder').style.display = 'flex';
  document.getElementById('viewer-placeholder-text').innerText = 'Waiting for live broadcast...';
  document.getElementById('viewer-play').disabled = true;
}

// Viewer specific controls
function setupViewerUIControls() {
  const playBtn = document.getElementById('viewer-play');
  const muteBtn = document.getElementById('viewer-mute');
  const fullscreenBtn = document.getElementById('viewer-fullscreen');
  const remoteVideo = document.getElementById('remote-video');

  playBtn.addEventListener('click', () => {
    if (remoteVideo.paused) {
      remoteVideo.play()
        .then(() => {
          logEvent('Playback started.', 'success');
          updateStatusText('Live - Streaming');
          setConnectionPulse('live');
        })
        .catch(err => logEvent(`Playback error: ${err.message}`, 'error'));
    }
  });

  muteBtn.addEventListener('click', () => {
    remoteVideo.muted = !remoteVideo.muted;
    muteBtn.classList.toggle('active-off', remoteVideo.muted);
    muteBtn.querySelector('.icon-on').style.display = remoteVideo.muted ? 'none' : 'block';
    muteBtn.querySelector('.icon-off').style.display = remoteVideo.muted ? 'block' : 'none';
    logEvent(`Audio ${remoteVideo.muted ? 'muted' : 'unmuted'}.`, 'info');
  });

  fullscreenBtn.addEventListener('click', () => {
    const videoContainer = remoteVideo.parentElement;
    if (!document.fullscreenElement) {
      videoContainer.requestFullscreen()
        .catch(err => logEvent(`Fullscreen error: ${err.message}`, 'error'));
    } else {
      document.exitFullscreen();
    }
  });
}

// -----------------------------------------------------------------------------
// ICE Candidate buffering & Common Utilities
// -----------------------------------------------------------------------------
async function handleRemoteICECandidate(candidate) {
  if (remoteDescriptionSet && peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      logEvent('Injected remote ICE candidate.', 'system');
    } catch (err) {
      console.error('Error adding remote ICE candidate:', err);
    }
  } else {
    logEvent('Buffering remote ICE candidate until descriptions complete...', 'system');
    iceQueue.push(candidate);
  }
}

// Print logs to both client developer screens and browser console
function logEvent(message, type = 'system') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  
  const targetId = clientRole === 'broadcaster' ? 'host-logs' : 'viewer-logs';
  const logsFeed = document.getElementById(targetId);
  if (!logsFeed) return;

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerText = message;
  
  logsFeed.appendChild(entry);
  logsFeed.scrollTop = logsFeed.scrollHeight;
}

function updateStatusText(text) {
  const targetId = clientRole === 'broadcaster' ? 'host-status' : 'viewer-status';
  const statusTextEl = document.getElementById(targetId);
  if (statusTextEl) {
    statusTextEl.innerText = text;
  }
}

function setConnectionPulse(state) {
  const targetId = clientRole === 'broadcaster' ? 'host-pulse' : 'viewer-pulse';
  const pulseEl = document.getElementById(targetId);
  if (pulseEl) {
    pulseEl.className = `pulse-dot ${state}`;
  }
}
