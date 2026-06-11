import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.BASE_URL || 'https://api.lk888.ai';
const API_KEY = process.env.API_KEY;

export default async function handler(req, res) {
  const { method } = req;
  const path = req.url.replace(/^\/api\/?/, '').split('?')[0];

  // POST /api/generate
  if (method === 'POST' && path === 'generate') {
    try {
      const { prompt, params } = req.body;
      const resp = await fetch(`${BASE_URL}/v1/media/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ model: 'gpt-image-2', prompt, params }),
      });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch {
        return res.status(502).json({ error: 'Upstream API returned non-JSON', status: resp.status, body: text.slice(0, 500) });
      }
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // GET /api/proxy-image
  if (method === 'GET' && path === 'proxy-image') {
    try {
      const { url } = req.query;
      if (!url) return res.status(400).json({ error: 'url is required' });

      if (url.startsWith('data:')) {
        const base64 = url.split(',')[1];
        const mime = url.split(';')[0].split(':')[1];
        const buffer = Buffer.from(base64, 'base64');
        res.setHeader('Content-Type', mime);
        return res.send(buffer);
      }

      const resp = await fetch(url);
      if (!resp.ok) return res.status(502).send('Failed to fetch image');
      const buffer = Buffer.from(await resp.arrayBuffer());
      const mime = resp.headers.get('content-type') || 'image/png';
      res.setHeader('Content-Type', mime);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return res.send(buffer);
    } catch (err) {
      return res.status(500).send(err.message);
    }
  }

  // POST /api/upload — upload base64 image to 0x0.st, return public URL
  if (method === 'POST' && path === 'upload') {
    try {
      const { dataURL } = req.body;
      if (!dataURL || !dataURL.startsWith('data:')) {
        return res.status(400).json({ error: 'valid dataURL required' });
      }
      const base64 = dataURL.split(',')[1];
      const buffer = Buffer.from(base64, 'base64');
      // Upload to 0x0.st (no auth needed, returns URL in response body)
      const uploadResp = await fetch('https://0x0.st', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      });
      const url = await uploadResp.text();
      if (!url.startsWith('http')) {
        return res.status(500).json({ error: 'upload failed', detail: url });
      }
      return res.json({ url: url.trim() });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // GET /api/status
  if (method === 'GET' && path === 'status') {
    try {
      const { task_id } = req.query;
      const resp = await fetch(`${BASE_URL}/v1/media/status?task_id=${encodeURIComponent(task_id)}`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
      });
      const data = await resp.json();
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(404).json({ error: 'Not found' });
}
