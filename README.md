# 🎥 CodeAlpha VideoChat

A **real-time communication app** — multi-user video conferencing plus live collaboration
(group chat, file sharing and a shared whiteboard) built with **WebRTC**, **Socket.io**,
**Express** and **Prisma/SQLite**.

Video and audio flow **peer-to-peer in a mesh topology** (no media server), so every
participant's media is **end-to-end encrypted** by WebRTC's mandatory DTLS-SRTP. The
Node server only does authentication, signaling and serving the static frontend.

---

## ✨ Features

| Feature | How it works |
| --- | --- |
| 👥 **Multi-user video calling** | WebRTC **mesh** — each browser opens a direct `RTCPeerConnection` to every other peer. `getUserMedia` captures camera/mic; remote tracks render into a responsive video grid. Best for small rooms (~4–5 people). |
| 🖥️ **Screen sharing** | `getDisplayMedia` + `RTCRtpSender.replaceTrack()` swaps the outgoing video track for your screen, then back to the camera. No renegotiation needed. |
| 📎 **File sharing** | Files upload over HTTP via **Multer**, are stored on disk + recorded in SQLite, then a `file-shared` Socket.io event broadcasts a download link into the chat/files panel. |
| 🎨 **Shared whiteboard** | HTML5 `<canvas>`; each stroke segment is broadcast over Socket.io using normalised coordinates so all participants stay in sync. Tools: pen, colour, eraser, brush size, clear. |
| 🔐 **Data encryption** | WebRTC media **and** data channels are encrypted by default (DTLS-SRTP) — mesh media is end-to-end encrypted between participants. Passwords are **bcrypt**-hashed. Serve over **HTTPS** in production. |
| 🔑 **User authentication** | Register/login with **JWT** (Bearer) + bcrypt. The Socket.io handshake is authenticated with the same JWT, so only signed-in users can join rooms. |

---

## 🧱 Tech stack

- **Backend:** Node.js + Express (static host **and** Socket.io signaling server)
- **Database:** SQLite via **Prisma ORM**
- **Auth:** JWT (Bearer) + bcrypt (`bcryptjs`)
- **Real-time media:** WebRTC (mesh), STUN `stun:stun.l.google.com:19302`
- **Signaling / chat / whiteboard:** Socket.io
- **Frontend:** vanilla HTML + CSS + JavaScript (ES modules, no framework, no TypeScript)

---

## 📂 Project structure

```
CodeAlpha_VideoChat/
├─ prisma/
│  └─ schema.prisma          # User, Room, SharedFile models (SQLite)
├─ src/
│  ├─ server.js              # Express + Socket.io bootstrap
│  ├─ signaling.js           # Socket.io events (signaling, chat, whiteboard)
│  ├─ routes/
│  │  ├─ auth.js             # /api/auth/register | login | me
│  │  └─ rooms.js            # /api/rooms ... (+ Multer file upload)
│  ├─ middleware/auth.js     # JWT Bearer guard
│  └─ lib/                   # prisma, jwt, paths helpers
├─ public/                   # static frontend
│  ├─ login.html  register.html  lobby.html  room.html
│  ├─ css/styles.css
│  └─ js/  api.js  room.js  webrtc.js  chat.js  whiteboard.js  ui.js
├─ uploads/                  # uploaded files (gitignored)
├─ seed.js                   # demo users (alice / bob)
├─ .env.example
└─ package.json
```

---

## 🚀 Setup & run

> Requires **Node.js 18+**.

```bash
# 1. Install dependencies
npm install

# 2. Create your env file (or copy .env.example)
#    DATABASE_URL="file:./dev.db"
#    JWT_SECRET="a-long-random-secret"
#    PORT=3000
cp .env.example .env        # Windows: copy .env.example .env

# 3. Create the database + tables (and generate the Prisma client)
npm run migrate             # prisma migrate dev

# 4. (optional) seed demo accounts alice / bob (password: password123)
npm run seed

# 5. Start the server
npm run dev
```

Then open **http://localhost:3000** → you'll land on the login page.

**One-command run after migrate:** `npm run dev`.

---

## 🎬 Demo (try it in 60 seconds)

1. Run `npm run migrate` then `npm run seed`, then `npm run dev`.
2. Open **two or three browser windows** at `http://localhost:3000`
   (use separate windows or profiles so each gets its own camera/login).
3. Log in as **alice** in one and **bob** in another (`password123`), or register new users.
4. In the **lobby**, one person clicks **Create & join** to get a room **code**.
5. The others **Join room** with that same code.
6. **Allow camera & microphone** when prompted — you'll see and hear each other.
7. Try it all:
   - 🖥️ **Share screen** — your screen replaces your camera tile for everyone, then click again to switch back.
   - 📎 **Chat tab → 📎** — upload a file; a download link appears for everyone.
   - 🎨 **Whiteboard tab** — draw; strokes appear live on every screen.
   - 🎙️ / 📷 — toggle mic and camera.
   - 📞 **Leave** — your tile disappears for the others.

> Testing on one machine? Open multiple windows — each prompts for camera access
> independently. Two tabs may fight over the same webcam; separate windows/profiles
> work best.

---

## ✅ Requirements mapping

| Requirement | Implementation |
| --- | --- |
| **Video conferencing** | `public/js/webrtc.js` — WebRTC mesh, `getUserMedia`, per-peer `RTCPeerConnection`, video grid in `room.html` |
| **Screen sharing** | `webrtc.js → toggleScreen()` — `getDisplayMedia` + `sender.replaceTrack()` |
| **File sharing** | `src/routes/rooms.js` (Multer upload + `SharedFile` record) → `file-shared` Socket.io broadcast → `public/js/chat.js` |
| **Shared whiteboard** | `public/js/whiteboard.js` + `whiteboard-draw` / `whiteboard-clear` events in `src/signaling.js` |
| **Data encryption** | WebRTC DTLS-SRTP (media, peer-to-peer/E2E in mesh) + bcrypt password hashing + HTTPS in production |
| **User authentication** | `src/routes/auth.js` (JWT + bcrypt), `src/middleware/auth.js`, JWT-authenticated Socket.io handshake in `src/signaling.js` |
| **WebRTC + Socket.io** | WebRTC carries media P2P; Socket.io carries signaling (offer/answer/ICE), chat, files and whiteboard |

---

## 🔌 API reference (prefix `/api`)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | — | Create account → `{ token, user }` |
| `POST` | `/auth/login` | — | Log in (username **or** email) → `{ token, user }` |
| `GET`  | `/auth/me` | Bearer | Current user |
| `POST` | `/rooms` | Bearer | Create a room → `{ code, ... }` |
| `GET`  | `/rooms/:code` | Bearer | Room info / existence |
| `POST` | `/rooms/:code/files` | Bearer | Multipart upload (`file`) → `{ filename, url }` |
| `GET`  | `/rooms/:code/files` | Bearer | List shared files |

Uploaded files are served statically from **`/uploads/...`**.

### Socket.io events

- **Client → server:** `join-room`, `offer`, `answer`, `ice-candidate`,
  `chat-message`, `file-shared`, `whiteboard-draw`, `whiteboard-clear`, `leave-room`
- **Server → client:** `existing-participants`, `user-joined`, `user-left`,
  `offer`, `answer`, `ice-candidate`, `chat-message`, `file-shared`,
  `whiteboard-draw`, `whiteboard-clear`

The handshake requires `auth: { token }` (the JWT). Unauthenticated sockets are rejected.

---

## 🗃️ Data model (Prisma / SQLite)

```prisma
User       { id, username (unique), email (unique), passwordHash, displayName, createdAt }
Room       { id, code (unique), name, hostId → User, createdAt }
SharedFile { id, roomId → Room, filename, url, uploadedById → User, createdAt }
```

---

## 🔐 Encryption & security notes

- **Media is end-to-end encrypted.** WebRTC mandates **DTLS-SRTP** for all audio/video
  and data channels. In a **mesh**, media goes straight between participants and never
  touches our server — so it is end-to-end encrypted between peers. The server only
  relays signaling text (SDP/ICE).
- **Passwords** are hashed with **bcrypt** (`bcryptjs`, cost 10) — plaintext is never stored.
- **Auth tokens** are JWTs, required for both the REST API (Bearer header) and the
  Socket.io handshake.
- **Production:** serve over **HTTPS**. Browsers only grant `getUserMedia` /
  `getDisplayMedia` on a **secure context** — `http://localhost` is treated as secure for
  same-machine testing, but any other host (e.g. a LAN IP) **must** be HTTPS.

### Testing across devices on a LAN (self-signed HTTPS)

`getUserMedia`/`getDisplayMedia` work on `http://localhost` for same-machine testing.
To test from your phone or another laptop on the same network, serve over HTTPS:

```bash
# 1. Generate a self-signed certificate (valid 365 days)
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
```

Then enable HTTPS in `src/server.js` by swapping the HTTP server for:

```js
import https from 'node:https';
import fs from 'node:fs';
const server = https.createServer(
  { key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem') },
  app
);
```

Visit `https://<your-lan-ip>:3000` on each device and accept the certificate warning.

### TURN (out of scope)

This demo uses only a public **STUN** server, which is enough for most networks.
Peers behind **strict/symmetric NATs or restrictive firewalls** may fail to connect
directly and would need a **TURN** relay (e.g. `coturn`). Adding TURN is out of scope
for this project — add a `turn:` entry to the `iceServers` array in
`public/js/webrtc.js` if you need it.

---

## 🧰 npm scripts

| Script | Action |
| --- | --- |
| `npm run dev` / `npm start` | Start the Express + Socket.io server |
| `npm run migrate` | `prisma migrate dev` — create/apply the SQLite schema |
| `npm run generate` | `prisma generate` — regenerate the Prisma client |
| `npm run seed` | Seed demo users (alice / bob) |

---

## 📜 License

MIT — built for the **CodeAlpha** internship task.
