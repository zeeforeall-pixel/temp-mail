const crypto = require("crypto");

// Vercel Serverless Function: /api/create-inbox
// Single inbox creation endpoint. Browser sends { domain } only.
// Server decides VIP vs standard internally based on the domain.
// VIP domains get is_vip:true + auto-generated IMAP/SMTP password.
// Browser never sends a VIP flag, never sees which domains are VIP.

const ADJ = ["swift","calm","dark","keen","pure","bold","cool","deep","fine","glad","灵","快","静","暗","明","烈","柔","刚","寒","暖","远","深","高","轻","重","锐","钝","新","古","奇","玄","妙","幽","清","澈"];
const NOUN = ["fox","owl","bear","wolf","deer","hawk","lynx","swan","crow","dove","龙","凤","虎","鹤","狐","鹰","狼","鹿","蛇","蝶","云","风","雷","雨","雪","月","星","山","海","河"];
const SUFFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// Server-side only — never exposed to the browser
const VIP_DOMAINS = ["moyvip.com", "moyzel.foo"];

function genPrefix() {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  let s = "";
  const len = 4 + Math.floor(Math.random() * 2);
  for (let i = 0; i < len; i++) s += SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)];
  return `${a}.${n}.${s}`;
}

function genPassword(length = 16) {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digit = "0123456789";
  const special = "!@#$%&*";
  const all = alpha + upper + digit + special;
  const pick = (pool) => pool[crypto.randomInt(pool.length)];
  const pw = [pick(alpha), pick(upper), pick(digit), pick(special)];
  for (let i = 4; i < length; i++) pw.push(pick(all));
  for (let i = pw.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pw[i], pw[j]] = [pw[j], pw[i]];
  }
  return pw.join("");
}

const SB_URL = Buffer.from("aHR0cHM6Ly9panJjY3BnaXVscm1mcGF2YXpzbC5zdXBhYmFzZS5jbw==", "base64").toString();
const SB_KEY = Buffer.from("ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW1scWNtTmpjR2RwZFd4eWJXWndZWFpoZW5Oc0lpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTnpJMk5ETXdOVFVzSW1WNGNDSTZNakE0T0RJeE9UQTFOWDAubGpwSEZSM2l5OGhJcVUyZGRPQ3dLbVA3N3hiTjgtbGs4TXBDcHVQTzZ0Yw==", "base64").toString();

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200)
      .setHeader("Access-Control-Allow-Origin", "*")
      .setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
      .setHeader("Access-Control-Allow-Headers", "Content-Type")
      .end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { owner_token, desired_local, domain } = req.body || {};

  if (!domain) {
    return res.status(400).json({ error: "domain required" });
  }

  // Server-side VIP decision — invisible to the browser
  const isVip = VIP_DOMAINS.includes(domain.toLowerCase());
  const token = owner_token || "srv_" + crypto.randomBytes(12).toString("hex");
  const password = isVip ? genPassword() : null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const local = (attempt === 0 && desired_local
      ? desired_local
      : genPrefix()
    ).toLowerCase().replace(/[^a-z0-9._-]/g, "")
     .replace(/^[._-]+|[._-]{2,}|[._-]+$/g, "");

    if (!local) continue;

    const address = `${local}@${domain}`;

    const payload = { address, domain, owner_token: token };
    if (isVip) {
      payload.password_plain = password;
      payload.is_vip = true;
    }

    try {
      const response = await fetch(`${SB_URL}/rest/v1/temp_inboxes`, {
        method: "POST",
        headers: {
          "apikey": SB_KEY,
          "Authorization": `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        const inbox = Array.isArray(data) ? data[0] : data;
        const result = {
          address: inbox.address,
          expires_at: inbox.expires_at,
        };
        if (isVip) {
          result.password = password;
          result.imap = { host: `mail.${domain}`, port: 993, encryption: "SSL/TLS" };
          result.smtp = { host: `mail.${domain}`, port: 465, portAlt: 587, encryption: "SSL/TLS", encryptionAlt: "STARTTLS" };
        }
        return res.status(200).json(result);
      }

      const errText = await response.text();
      if (/duplicate|already exists|unique/i.test(errText)) continue;
      return res.status(500).json({ error: errText.slice(0, 300) });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(500).json({ error: "All prefixes exhausted" });
};
