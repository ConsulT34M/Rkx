import express from 'express';
import { isUuid } from './mk-chat.js';

export function supportRoutes(mk, route) {
  const router = express.Router();
  router.use((_req, res, next) => mk ? next() : res.status(503).json({ error: '말결 상담 서비스 연결이 설정되지 않았습니다.' }));

  const assets = new Map([
    ['voice.js', ['/static/voice.js', 'application/javascript']],
    ['voice-recording.js', ['/static/voice-recording.js', 'application/javascript']],
    ['voice-pcm.js', ['/static/voice-pcm.js', 'application/javascript']],
    ['ringback', ['/inquiry/voice/ringback', 'audio/mpeg']]
  ]);
  router.get('/assets/:name', route(async (req, res) => {
    const asset = assets.get(req.params.name);
    if (!asset) return res.sendStatus(404);
    const { data, status } = await mk.asset(asset[0]);
    res.status(status).type(asset[1]).send(data);
  }));

  async function relay(req, res, path, headers) {
    const result = await mk.support(req.user.id, path, req.method === 'GET' ? undefined : req.body ?? {}, headers);
    if (result.status === 204) return res.status(204).end();
    res.status(result.status).json(result.data);
  }
  router.get('/ai-chat', route((req, res) => relay(req, res, '/partner/ai-chat' + (req.query.new === '1' ? '?new=1' : ''))));
  router.post('/ai-chat/messages', route((req, res) => relay(req, res, '/partner/ai-chat/messages')));
  router.post('/ai-chat/:id/resolve', route((req, res) => relay(req, res, '/partner/ai-chat/' + req.params.id + '/resolve')));
  router.post('/ai-chat/:id/handoff', route(async (req, res) => {
    res.json({ caseId: await mk.handoffChat(req.user.id, req.params.id) });
  }));
  router.get('/availability', route(async (_req, res) => res.json((await mk.availability()).data)));
  const sessions = '/inquiry/voice/sessions';
  router.post('/voice/sessions', route((req, res) => relay(req, res, sessions)));
  router.param('id', (req, res, next, id) => isUuid(id) ? next() : res.sendStatus(400));
  for (const action of ['connected', 'end', 'handoff', 'resolve']) {
    router.post('/voice/sessions/:id/' + action, route((req, res) => relay(req, res, sessions + '/' + req.params.id + '/' + action)));
  }
  router.post('/voice/sessions/:id/recording/:offset', express.raw({ type: 'application/octet-stream', limit: '64kb' }),
    route((req, res) => {
      if (!Buffer.isBuffer(req.body) || !/^\d{1,12}$/.test(req.params.offset)) return res.sendStatus(400);
      const headers = { 'Content-Type': 'application/octet-stream' };
      if (req.get('X-Call-Started-At')) headers['X-Call-Started-At'] = req.get('X-Call-Started-At');
      return relay(req, res, sessions + '/' + req.params.id + '/recording/' + req.params.offset, headers);
    }));
  return router;
}
