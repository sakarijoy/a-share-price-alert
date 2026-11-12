"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const webpush = require("web-push");

const subject = "https://sakarijoy.github.io/a-share-price-alert/";
const statePath = ".alert-state/sent.json";
const symbolFor = (code) => /^6\d{5}$/.test(code) ? "sh" + code :
  /^[03]\d{5}$/.test(code) ? "sz" + code : null;
const chinaTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function session(stamp) {
  const local = new Date(stamp + 28800000);
  const day = local.getUTCDay();
  if (day === 0 || day === 6) return 0;
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (minute >= 570 && minute < 690) return 1;
  if (minute >= 780 && minute < 900) return 2;
  return 0;
}

function parseQuotes(raw) {
  const quotes = new Map();
  for (const match of raw.matchAll(/v_((?:sh|sz)\d{6})="([^"]*)"/g)) {
    const fields = match[2].split("~");
    const code = match[1].slice(2);
    const price = Number(fields[3]);
    const date = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(fields[30]);
    if (fields[2] !== code || !Number.isFinite(price) || price <= 0 || !date) continue;
    const [, year, month, day, hour, minute, second] = date;
    const stamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
    if (Number.isFinite(stamp)) quotes.set(code, { name: fields[1] || code, price, stamp });
  }
  return quotes;
}

async function send(config, title, body, tag) {
  try {
    await webpush.sendNotification(config.subscription, JSON.stringify({ title, body, tag }), {
      vapidDetails: { subject, publicKey: config.publicKey, privateKey: config.privateKey },
      timeout: 12000,
      TTL: 600,
    });
    return true;
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      console.error("Phone subscription expired. Rebind the phone and replace the GitHub secret.");
    } else {
      const status = Number.isInteger(error.statusCode) ? " HTTP " + error.statusCode : "";
      console.error("Push delivery failed." + status);
    }
    process.exitCode = 1;
    return false;
  }
}

async function fetchQuotes(codes) {
  const response = await fetch("https://qt.gtimg.cn/q=" + codes.map(symbolFor).join(","), {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Quote request failed");
  const quotes = parseQuotes(new TextDecoder("gbk").decode(await response.arrayBuffer()));
  if (!quotes.size) throw new Error("No usable quotes");
  return quotes;
}

function readConfig(value) {
  const config = JSON.parse(value);
  const endpoint = new URL(config.subscription.endpoint);
  const host = endpoint.hostname;
  if (endpoint.protocol !== "https:" || endpoint.port || endpoint.username || endpoint.password ||
      !(host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
        host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"))) {
    throw new Error("Unsupported browser push endpoint");
  }
  return config;
}

async function main() {
  if (process.env.CHECK_FEED === "true") {
    const quotes = await fetchQuotes(["600941"]);
    if (!quotes.has("600941")) throw new Error("Expected quote missing");
    console.log("The runner can read and parse Tencent quotes.");
    return;
  }
  const config = readConfig(process.env.STOCK_PUSH_CONFIG);
  if (process.env.SEND_TEST === "true") {
    if (await send(config, "A 股到价提醒", "后台推送测试成功。", "stock-alert-test")) {
      console.log("Push service accepted the test notification.");
    }
    return;
  }
  if (!session(Date.now())) return;
  const targets = new Map(config.targets.filter(([code, value]) =>
    typeof code === "string" && symbolFor(code) && Number.isFinite(value) && value > 0));
  if (!targets.size) return;
  const sent = new Set(fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : []);
  const codes = [...targets.keys()];
  for (let i = 0; i < codes.length; i += 40) {
    const batch = codes.slice(i, i + 40);
    const quotes = await fetchQuotes(batch);
    const now = Date.now();
    const trading = session(now);
    for (const code of batch) {
      const quote = quotes.get(code);
      const target = targets.get(code);
      if (!quote || quote.price > target || !trading || session(quote.stamp) !== trading ||
          now - quote.stamp > 180000 || quote.stamp - now > 10000) continue;
      const key = createHash("sha256").update(config.privateKey + "|" + code + "|" + target).digest("hex");
      if (sent.has(key)) continue;
      const body = `${quote.name} ${quote.price.toFixed(2)} 元，提醒价 ${target.toFixed(2)} 元（${chinaTime.format(quote.stamp)}）`;
      if (await send(config, "股价已到提醒价", body, "stock-alert-" + code)) {
        sent.add(key);
        fs.mkdirSync(".alert-state", { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify([...sent]));
        fs.appendFileSync(process.env.GITHUB_OUTPUT, "state_changed=true\n");
      }
    }
  }
}

main().catch(() => {
  console.error("Could not check quotes or read the push settings. Check the GitHub secret and try again.");
  process.exitCode = 1;
});
