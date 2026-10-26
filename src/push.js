const crypto = require('crypto');

// Deterministic P-256 (prime256v1) VAPID keypair derived from secret so all Vercel Serverless instances share the exact same VAPID keys
const SECRET_SEED = process.env.JWT_SECRET || 'rave-lampa-z01-vapid-seed-2026';

function generateDeterministicVapidKeys() {
  // Derive a valid 32-byte P-256 private scalar d
  const d = crypto.createHash('sha256').update(SECRET_SEED + ':vapid-p256-key').digest();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pubUncompressed = ecdh.getPublicKey(); // 65 bytes (0x04 || x || y)

  // Construct JWK for Node.js crypto KeyObject creation
  const x = pubUncompressed.subarray(1, 33).toString('base64url');
  const y = pubUncompressed.subarray(33, 65).toString('base64url');
  const dB64 = d.toString('base64url');

  const privateKeyObj = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x, y, d: dB64 },
    format: 'jwk'
  });

  return {
    publicKey: pubUncompressed.toString('base64url'),
    publicKeyBuffer: pubUncompressed,
    privateKeyObj
  };
}

const VAPID = generateDeterministicVapidKeys();

function createVapidAuthHeader(endpoint, subject = 'mailto:admin@ravelampa.app') {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aud, exp, sub: subject })).toString('base64url');
  const unsigned = `${header}.${payload}`;

  // IEEE P1363 format produces the raw 64-byte (r || s) signature required by JWS ES256
  const sig = crypto.sign('sha256', Buffer.from(unsigned), {
    key: VAPID.privateKeyObj,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url');

  const jwt = `${unsigned}.${sig}`;
  return `vapid t=${jwt}, k=${VAPID.publicKey}`;
}

// RFC 8291 Web Push Encryption (aes128gcm)
function encryptWebPushPayload(payloadStr, clientPublicKeyB64, clientAuthB64) {
  const clientPublicKey = Buffer.from(clientPublicKeyB64, 'base64url');
  const authSecret = Buffer.from(clientAuthB64, 'base64url');
  const salt = crypto.randomBytes(16);

  const serverEcdh = crypto.createECDH('prime256v1');
  const serverPublicKey = serverEcdh.generateKeys(); // 65 bytes uncompressed
  const sharedSecret = serverEcdh.computeSecret(clientPublicKey);

  // RFC 8291 Section 3.3: Key derivation using HKDF-SHA-256
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'ascii'),
    clientPublicKey,
    serverPublicKey
  ]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));

  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\0', 'ascii');
  const nonceInfo = Buffer.from('Content-Encoding: nonce\0', 'ascii');

  const contentEncryptionKey = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, cekInfo, 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, nonceInfo, 12));

  // Pad plaintext with delimiter 0x02 (final record)
  const plaintext = Buffer.concat([Buffer.from(payloadStr, 'utf8'), Buffer.from([2])]);

  const cipher = crypto.createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // Construct aes128gcm header: salt (16) || rs (4, uint32BE = 4096) || idlen (1 = 65) || keyid (65, serverPublicKey)
  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0);
  const idLenBuf = Buffer.from([serverPublicKey.length]);

  return Buffer.concat([salt, rsBuf, idLenBuf, serverPublicKey, encrypted]);
}

async function sendWebPush(subscription, payloadObj) {
  if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return { ok: false, status: 0 };
  }
  try {
    const payloadStr = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
    const bodyBuf = encryptWebPushPayload(payloadStr, subscription.keys.p256dh, subscription.keys.auth);
    const authHeader = createVapidAuthHeader(subscription.endpoint);

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bodyBuf.length),
        'TTL': '86400',
        'Urgency': 'high'
      },
      body: bodyBuf,
      signal: AbortSignal.timeout(6000)
    });

    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

module.exports = {
  vapidPublicKey: VAPID.publicKey,
  sendWebPush
};
