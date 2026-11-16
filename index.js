const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { createReactionMatcher } = require("./reaction-rules");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const token = process.env.DISCORD_TOKEN || config.token;
if (!token || token === "YOUR_USER_TOKEN") {
  console.error("Put your token in config.json.");
  process.exit(1);
}

const emoji = config.emoji || "💀";
const matchReactions = createReactionMatcher(config);
const minDelay = config.minDelayMs ?? 300;
const maxDelay = Math.max(config.maxDelayMs ?? 900, minDelay);
const only = new Set(config.onlyChannelIds || []);
const ignoreCh = new Set(config.ignoreChannelIds || []);
const ignoreGuilds = new Set(config.ignoreGuildIds || []);

const API = "https://discord.com/api/v9";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const queue = [];
let working = false;

function enqueue(channelId, messageId, reaction) {
  queue.push({ channelId, messageId, reaction });
  if (!working) drain();
}

async function drain() {
  working = true;
  while (queue.length) {
    const job = queue.shift();
    await sleep(rand(minDelay, maxDelay));
    await react(job, 0);
  }
  working = false;
}

async function react({ channelId, messageId, reaction }, attempt) {
  const url = `${API}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(reaction)}/@me`;
  try {
    const res = await fetch(url, { method: "PUT", headers: { Authorization: token } });
    if (res.status === 204) return console.log(`Reacted ${reaction} to ${messageId}`);
    if (res.status === 429 && attempt < 5) {
      const body = await res.json().catch(() => ({}));
      const wait = Math.ceil((body.retry_after ?? 1) * 1000) + 250;
      console.log(`Rate limited, waiting ${wait}ms`);
      await sleep(wait);
      return react({ channelId, messageId, reaction }, attempt + 1);
    }
    if (res.status === 401) {
      console.error("Token rejected (401). Check your token.");
      process.exit(1);
    }
    console.log(`Could not react (${res.status}): ${(await res.text()).slice(0, 200)}`);
  } catch (e) {
    console.log("Reaction request failed:", e.message);
  }
}

let ws, hb, seq = null, myId = null, acked = true;

function connect() {
  ws = new WebSocket("wss://gateway.discord.gg/?v=9&encoding=json");

  ws.on("message", (raw) => {
    const p = JSON.parse(raw.toString());
    if (p.s != null) seq = p.s;

    switch (p.op) {
      case 10: {
        const interval = p.d.heartbeat_interval;
        acked = true;
        clearInterval(hb);
        setTimeout(() => {
          send(1, seq);
          hb = setInterval(() => {
            if (!acked) return ws.terminate();
            acked = false;
            send(1, seq);
          }, interval);
        }, interval * Math.random());
        send(2, {
          token,
          capabilities: 16381,
          properties: { os: "Windows", browser: "Chrome", device: "" },
          presence: { status: "online", since: 0, activities: [], afk: false },
          compress: false,
        });
        break;
      }
      case 11: acked = true; break;
      case 1: send(1, seq); break;
      case 7:
      case 9: ws.terminate(); break;
      case 0: dispatch(p.t, p.d); break;
    }
  });

  ws.on("close", (code) => {
    clearInterval(hb);
    if (code === 4004) {
      console.error("Authentication failed. Check your token.");
      process.exit(1);
    }
    console.log(`Disconnected (${code}), reconnecting in 5s...`); 
    setTimeout(connect, 5000);
  });
  ws.on("error", (e) => console.log("Socket error:", e.message));
}

function send(op, d) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d }));
}

function dispatch(t, d) {
  if (t === "READY") {
    myId = d.user.id;
    console.log(`Logged in as ${d.user.username} self-reactions ${config.selfReact === false ? "off" : `on (${emoji})`}, ${config.keywordReactions?.length ?? 0} keyword rules.`);
    return;
  }
  if (t !== "MESSAGE_CREATE" || !d.author || !myId) return;
  if (d.type !== 0 && d.type !== 19) return; // normal messages and replies only
  if (only.size && !only.has(d.channel_id)) return;
  if (ignoreCh.has(d.channel_id)) return;
  if (d.guild_id ? ignoreGuilds.has(d.guild_id) : config.ignoreDMs) return;
  for (const reaction of matchReactions(d, myId)) enqueue(d.channel_id, d.id, reaction);
}

connect();
