/* ------------------------------------------------------------------
 * Kickoff Tactics — self-hosted signaling server (optional but
 * recommended for production).
 *
 * The game client speaks WebRTC (PeerJS). By default it uses the free
 * public PeerJS cloud for the initial "handshake" (signaling). For a
 * reliable, private deployment you run THIS tiny server and point the
 * client at it (see DEPLOY.md, step 4).
 *
 * Run locally:   npm install && npm start     (listens on :9000)
 * ------------------------------------------------------------------ */
import express from "express";
import http from "http";
import { ExpressPeerServer } from "peer";

const app = express();
const server = http.createServer(app);

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: "/",
  allow_discovery: false,
});

app.use("/signaling", peerServer);

app.get("/", (_req, res) => {
  res.send("Kickoff Tactics signaling server is running. Client path: /signaling");
});

const port = process.env.PORT || 9000;
server.listen(port, () => {
  console.log(`[kickoff] signaling server listening on :${port} (path /signaling)`);
});
