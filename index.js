const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for local testing
    methods: ["GET", "POST"]
  }
});

// Store active host sessions: { id: { password, socketId } }
const activeHosts = {};

// Helper: Generate a random 9-digit ID (XXX XXX XXX format for UI, but raw string here)
function generateHostId() {
  let id;
  do {
    id = Math.floor(100000000 + Math.random() * 900000000).toString();
  } while (activeHosts[id]);
  return id;
}

// Helper: Generate a random 8-char alphanumeric password
function generatePassword() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const allChars = letters + numbers;

  let password = '';
  // Ensure at least one letter and one number
  password += letters[crypto.randomInt(0, letters.length)];
  password += numbers[crypto.randomInt(0, numbers.length)];

  // Fill the rest
  for (let i = 2; i < 8; i++) {
    password += allChars[crypto.randomInt(0, allChars.length)];
  }

  // Shuffle the password so the predictable characters aren't always at the start
  return password.split('').sort(() => 0.5 - Math.random()).join('');
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // === HOST ENDPOINT ===
  // Host requests an ID and Password to start listening
  socket.on('request-host-credentials', () => {
    const id = generateHostId();
    const password = generatePassword();

    activeHosts[id] = { password, socketId: socket.id };
    socket.join(id); // Host joins a room with their own ID

    console.log(`Host registered - ID: ${id}, Pass: ${password}, Socket: ${socket.id}`);

    // Send credentials back to the host UI
    socket.emit('host-credentials', { id, password });
  });

  // === CLIENT ENDPOINT ===
  // Client attempts to connect using ID and Password
  socket.on('verify-connection', ({ id, password }, callback) => {
    const host = activeHosts[id];

    if (host && host.password === password) {
      console.log(`Client ${socket.id} verified for Host ${id}`);

      // Client joins the same room as the host (for cleanup/tracking)
      socket.join(id);

      // Notify the host that a client has connected successfully, pass the client's socket ID
      io.to(host.socketId).emit('client-connected', { callerId: socket.id });

      callback({ success: true });
    } else {
      console.log(`Failed connection attempt for Host ${id}`);
      callback({ success: false, message: 'Invalid ID or Password' });
    }
  });

  // === WEBRTC SIGNALING ===
  // Forward signaling data (offer/answer/ice candidates) within the room
  // Both host and client will use this
  socket.on('signal', (data) => {
    // Attach the sender's socket ID so the recipient can route it to the correct PeerConnection
    data.from = socket.id;

    // If a specific target socket ID is provided, send it directly to them (Multi-Client support)
    if (data.to) {
      socket.to(data.to).emit('signal', data);
    } else {
      // Fallback to room broadcast
      socket.to(data.room).emit('signal', data);
    }
  });

  // === CLEANUP ===
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // If the disconnecting socket was a host, remove their active session
    for (const [id, hostData] of Object.entries(activeHosts)) {
      if (hostData.socketId === socket.id) {
        delete activeHosts[id];
        console.log(`Host ${id} session removed.`);
        // Notify any remaining clients in the room that the host left
        socket.to(id).emit('host-disconnected');
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
