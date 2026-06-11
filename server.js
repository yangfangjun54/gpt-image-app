import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://api.lk888.ai';
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error('❌ API_KEY 未设置，请复制 .env.example 为 .env 并填入 key');
  process.exit(1);
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, 'public')));

// 代理：创建生成任务
app.post('/api/generate', async (req, res) => {
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
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 代理：拉取图片（解决跨域 canvas 污染）
app.get('/api/proxy-image', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url is required' });

    // 如果是 dataURL，直接解码返回
    if (url.startsWith('data:')) {
      const base64 = url.split(',')[1];
      const mime = url.split(';')[0].split(':')[1];
      const buffer = Buffer.from(base64, 'base64');
      res.set('Content-Type', mime);
      return res.send(buffer);
    }

    // 如果是同源路径，直接代理（不带 auth）
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
      const filePath = join(__dirname, 'public', url.replace(/^\.?\//, ''));
      return res.sendFile(filePath);
    }

    // 图片 CDN URL 不需要 auth header，加上反而可能被拒绝
    const resp = await fetch(url);
    if (!resp.ok) return res.status(502).send('Failed to fetch image');
    const buffer = Buffer.from(await resp.arrayBuffer());
    const mime = resp.headers.get('content-type') || 'image/png';
    res.set('Content-Type', mime);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(buffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 代理：查询任务状态
app.get('/api/status', async (req, res) => {
  try {
    const { task_id } = req.query;
    const resp = await fetch(`${BASE_URL}/v1/media/status?task_id=${encodeURIComponent(task_id)}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 GPT Image 2 App running at http://localhost:${PORT}`);
});
