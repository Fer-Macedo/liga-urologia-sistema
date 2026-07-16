// ═══ ATENDIMENTOS WHATSAPP ══════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// ─── ATENDIMENTOS WHATSAPP ────────────────────────────────────────────────────
router.get('/atendimentos', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const config = await getConfig();
    const msg = req.session.msg||[]; req.session.msg=[];
    const erro = req.session.erro||[]; req.session.erro=[];
    const _perfil = req.session.usuario && req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    // Admin e presidência veem tudo; demais áreas veem só os atendimentos da sua área
    const _filtroArea = _isAdmin ? '' : ' WHERE area=$1';
    const _params = _isAdmin ? [] : [_perfil];
    const [statsR, atendR, contatosR] = await Promise.all([
      query("SELECT COUNT(*) FILTER (WHERE status='aguardando') AS aguardando, COUNT(*) FILTER (WHERE status='transferido' AND DATE(encerrado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Asuncion')=DATE(NOW() AT TIME ZONE 'America/Asuncion')) AS transferidos_hoje, COUNT(*) FILTER (WHERE status='encerrado' AND DATE(encerrado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Asuncion')=DATE(NOW() AT TIME ZONE 'America/Asuncion')) AS encerrados_hoje, COUNT(*) AS total, ROUND(AVG(EXTRACT(EPOCH FROM (encerrado_em - criado_em))/60) FILTER (WHERE status='encerrado' AND criado_em >= NOW() - INTERVAL '7 days'))::int AS tempo_medio_semanal, ROUND(AVG(EXTRACT(EPOCH FROM (encerrado_em - criado_em))/60) FILTER (WHERE status='encerrado' AND criado_em >= NOW() - INTERVAL '30 days'))::int AS tempo_medio_mensal FROM lauro_atendimentos" + _filtroArea, _params),
      query("SELECT a.*, COALESCE((SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g')=a.numero_membro LIMIT 1),(SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g')=a.numero_membro LIMIT 1),(SELECT nome FROM membros WHERE RIGHT(regexp_replace(whatsapp,'[^0-9]','','g'),8)=RIGHT(a.numero_membro,8) LIMIT 1),(SELECT nome FROM ligantes WHERE RIGHT(regexp_replace(whatsapp,'[^0-9]','','g'),8)=RIGHT(a.numero_membro,8) LIMIT 1),a.nome_contato) as nome_membro, TO_CHAR(a.criado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Asuncion', 'DD/MM, HH24:MI') as inicio_fmt, TO_CHAR(a.encerrado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Asuncion', 'DD/MM, HH24:MI') as fim_fmt, ROUND(EXTRACT(EPOCH FROM (COALESCE(a.encerrado_em, NOW()) - a.criado_em))/60)::int as duracao_min FROM lauro_atendimentos a" + (_filtroArea ? _filtroArea.replace('area', 'a.area') : '') + " ORDER BY CASE WHEN a.status='aguardando' THEN 0 WHEN a.status='transferido' THEN 1 ELSE 2 END, a.criado_em DESC LIMIT 200", _params),
      query('SELECT area, numero FROM lauro_contatos ORDER BY area')
    ]);
    res.render('pages/atendimentos', { config, msg, erro, usuario: req.session.usuario, stats: statsR.rows[0]||{}, atendimentos: atendR.rows, contatos: contatosR.rows }, function(err, html){
      console.log('RENDER CALLBACK: err=', err&&err.message, 'html_len=', html&&html.length);
      if(err){ console.error('RENDER ATEND ERRO:', err.message); return res.status(500).send('Erro render: '+err.message); }
      res.send(html);
    });
  } catch(e) { console.error('CATCH ATEND:', e.message); res.status(500).send(e.message); }
});

router.get('/atendimentos/:id/conversa', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const atR = await query('SELECT numero_membro, area, idioma, criado_em, encerrado_em, nome_contato, origem FROM lauro_atendimentos WHERE id=$1', [req.params.id]);
    if (!atR.rows.length) return res.json({msgs:[], area:'', numero:'', idioma:'pt'});
    const {numero_membro, area, idioma, criado_em, encerrado_em, origem} = atR.rows[0];
    // Controle de acesso: só admin/presidência ou usuário da mesma área podem ver o chat
    const _perfil = req.session.usuario && req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    if (!_isAdmin && area !== _perfil) {
      return res.status(403).json({msgs:[], erro:'Sem permissão para ver este atendimento'});
    }
    if (origem === 'portal') {
      const [_p, _tipo, _idMembro] = numero_membro.split('-');
      const msgsR = await query('SELECT autor, texto, criado_em, remetente_nome FROM portal_mensagens WHERE origem_tipo=$1 AND origem_id=$2 ORDER BY criado_em ASC LIMIT 300', [_tipo, _idMembro]);
      await query("UPDATE portal_mensagens SET lido_admin=true WHERE origem_tipo=$1 AND origem_id=$2 AND autor='membro'", [_tipo, _idMembro]);
      const msgs = msgsR.rows.map(m => ({ papel: m.autor === 'membro' ? 'user' : 'area', mensagem: m.texto, criado_em: m.criado_em, remetente_nome: m.remetente_nome }));
      return res.json({ msgs, area, numero: 'Portal', idioma: 'pt', nomeMembro: atR.rows[0].nome_contato, atendId: parseInt(req.params.id), encerrado: !!encerrado_em, origem });
    }
    const [msgsR, membroR] = await Promise.all([
      query('SELECT papel, mensagem, criado_em FROM lauro_conversas WHERE numero=$1 ORDER BY criado_em ASC LIMIT 300', [numero_membro]),
      query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'\\D','','g') = $1 LIMIT 1", [numero_membro])
    ]);
    let nomeMembro = membroR.rows.length > 0 ? membroR.rows[0].nome : null;
    if (!nomeMembro) {
      const _ligR = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g') = $1 LIMIT 1", [numero_membro]);
      if (_ligR.rows.length) nomeMembro = _ligR.rows[0].nome;
    }
    // Fallback: formato BR 8->9 digitos (554688191844 -> 5546988191844)
    if (!nomeMembro && numero_membro.length === 12 && numero_membro.startsWith('55')) {
      const _num9 = numero_membro.slice(0,4) + '9' + numero_membro.slice(4);
      const _mR9 = await query("SELECT nome FROM membros WHERE regexp_replace(whatsapp,'[^0-9]','','g') = $1 LIMIT 1", [_num9]);
      if (_mR9.rows.length) nomeMembro = _mR9.rows[0].nome;
      else {
        const _lR9 = await query("SELECT nome FROM ligantes WHERE regexp_replace(whatsapp,'[^0-9]','','g') = $1 LIMIT 1", [_num9]);
        if (_lR9.rows.length) nomeMembro = _lR9.rows[0].nome;
      }
    }
    if (!nomeMembro && atR.rows[0].nome_contato) nomeMembro = atR.rows[0].nome_contato;
    res.json({ msgs: msgsR.rows, area, numero: '****'+numero_membro.slice(-4), idioma, nomeMembro, atendId: parseInt(req.params.id), encerrado: !!encerrado_em, origem });
  } catch(e) { res.json({msgs:[], erro: e.message}); }
});

router.post('/atendimentos/:id/responder', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem || !mensagem.trim()) return res.json({ok:false, erro:'Mensagem vazia'});
    const atR = await query("SELECT numero_membro, area, idioma, numero_area, origem FROM lauro_atendimentos WHERE id=$1 AND status='aguardando'", [req.params.id]);
    if (!atR.rows.length) return res.json({ok:false, erro:'Atendimento nao encontrado ou encerrado'});
    const { numero_membro, area, numero_area, origem } = atR.rows[0];
    const _perfilR = req.session.usuario && req.session.usuario.perfil;
    if (_perfilR !== 'admin' && _perfilR !== 'presidencia' && area !== _perfilR) return res.json({ok:false, erro:'Sem permissão para este atendimento'});
    const nomeArea = area.charAt(0).toUpperCase() + area.slice(1);
    if (origem === 'portal') {
      const [_p, _tipo, _idMembro] = numero_membro.split('-');
      const nomeAdmin = (req.session.usuario && req.session.usuario.nome) || nomeArea;
      const r = await query(
        'INSERT INTO portal_mensagens (origem_tipo, origem_id, autor, texto, remetente_nome, atendimento_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, criado_em',
        [_tipo, _idMembro, 'admin', mensagem.trim(), nomeAdmin, req.params.id]
      );
      const io = req.app._io;
      if (io) io.to('membro_' + _tipo + '_' + _idMembro).emit('chat_msg_ok', { id: r.rows[0].id, texto: mensagem.trim(), criado_em: r.rows[0].criado_em, autor: 'admin' });
      return res.json({ok:true, enviado: mensagem.trim(), area: nomeArea});
    }
    const lauro = require('../services/lauro');
    await lauro.enviarMensagemDireta(numero_membro, mensagem.trim());
    if (numero_area) await lauro.enviarMensagemDireta(numero_area, mensagem.trim()).catch(()=>{});
    await query('INSERT INTO lauro_conversas (numero,papel,mensagem) VALUES ($1,$2,$3)', [numero_membro, 'area', mensagem.trim()]).catch(()=>{});
    res.json({ok:true, enviado: mensagem.trim(), area: nomeArea});
  } catch(e) { res.json({ok:false, erro: e.message}); }
});
router.post('/atendimentos/:id/responder-arquivo', requireAuth, requirePermissao('atendimentos'), (req, res) => {
  const { upload } = require('../services/arquivos');
  upload.single('arquivo')(req, res, async function(errUp){
    try {
      if (errUp) return res.json({ok:false, erro: errUp.message});
      if (!req.file) return res.json({ok:false, erro:'Nenhum arquivo recebido'});
      const atR = await query("SELECT numero_membro, area, numero_area FROM lauro_atendimentos WHERE id=$1 AND status='aguardando'", [req.params.id]);
      if (!atR.rows.length) return res.json({ok:false, erro:'Atendimento nao encontrado ou encerrado'});
      const { numero_membro, area, numero_area } = atR.rows[0];
      const _perfil = req.session.usuario && req.session.usuario.perfil;
      if (_perfil !== 'admin' && _perfil !== 'presidencia' && area !== _perfil) return res.json({ok:false, erro:'Sem permissao para este atendimento'});
      const { uploadArquivo } = require('../services/arquivos');
      const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'atendimentos');
      const lauro = require('../services/lauro');
      const dataUri = 'data:' + req.file.mimetype + ';base64,' + req.file.buffer.toString('base64');
      let tipo;
      if (req.file.mimetype.indexOf('image/') === 0) { tipo = 'image'; await lauro.enviarImagem(numero_membro, dataUri, ''); }
      else { tipo = 'document'; await lauro.enviarDocumento(numero_membro, dataUri, req.file.originalname); }
      if (numero_area) {
        if (tipo === 'image') await lauro.enviarImagem(numero_area, dataUri, '').catch(()=>{});
        else await lauro.enviarDocumento(numero_area, dataUri, req.file.originalname).catch(()=>{});
      }
      await query('INSERT INTO lauro_conversas (numero, papel, mensagem) VALUES ($1,$2,$3)', [numero_membro, 'area', '[[MIDIA]]'+tipo+'|||'+r.chave+'|||'+req.file.originalname]);
      res.json({ok:true, tipo, chave: r.chave, nome: req.file.originalname});
    } catch(e) { res.json({ok:false, erro: e.message}); }
  });
});

router.get('/atendimentos/midia', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const chave = req.query.chave;
    if (!chave) return res.status(400).send('chave ausente');
    // A midia pertence a uma conversa de uma area especifica - so quem e da mesma area
    // (ou admin/presidencia) pode abrir, mesmo tendo a permissao geral de atendimentos.
    const _perfil = req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    if (!_isAdmin) {
      const convR = await query("SELECT numero FROM lauro_conversas WHERE mensagem LIKE '%'||$1||'%' LIMIT 1", [chave]);
      const numero = convR.rows[0]?.numero;
      const areaR = numero ? await query('SELECT area FROM lauro_atendimentos WHERE numero_membro=$1 ORDER BY criado_em DESC LIMIT 1', [numero]) : { rows: [] };
      const area = areaR.rows[0]?.area;
      if (!area || area !== _perfil) return res.status(403).send('Sem permissao para este arquivo.');
    }
    const { gerarUrlInline } = require('../services/arquivos');
    const url = await gerarUrlInline(chave);
    res.redirect(url);
  } catch(e) { res.status(500).send('erro'); }
});

router.post('/atendimentos/contatos', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const { area, numero } = req.body;
    const n = (numero||'').replace(/\D/g,'');
    await query('INSERT INTO lauro_contatos (area,numero) VALUES ($1,$2) ON CONFLICT (area) DO UPDATE SET numero=$2, updated_at=NOW()', [area, n]);
    const lauro = require('../services/lauro');
    if (lauro.recarregarContatos) await lauro.recarregarContatos();
    req.session.msg = ['Contato da area ' + area + ' atualizado!'];
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/atendimentos');
});
router.post('/atendimentos/:id/encerrar', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const atR = await query('SELECT numero_membro, area, idioma, origem FROM lauro_atendimentos WHERE id=$1', [req.params.id]);
    if (atR.rows.length > 0) {
      const { numero_membro, area, idioma, origem } = atR.rows[0];
      const _perfilE = req.session.usuario && req.session.usuario.perfil;
      if (_perfilE !== 'admin' && _perfilE !== 'presidencia' && area !== _perfilE) { req.session.erro=['Sem permissão para este atendimento']; return res.redirect('/atendimentos'); }
      await query("UPDATE lauro_atendimentos SET status='encerrado', encerrado_em=NOW() WHERE id=$1", [req.params.id]);
      const _areaCap = area ? (area.charAt(0).toUpperCase() + area.slice(1)) : 'Secretaria';
      const m = idioma==='es'
        ? 'Tu atención fue finalizada por ' + _areaCap + '. ¡Cualquier duda o información, puedes volver a contactarnos aquí que atenderemos tu solicitud!'
        : 'Seu atendimento foi encerrado pela ' + _areaCap + '. Qualquer dúvida ou informação, você pode voltar a nos contatar aqui que atenderemos a sua solicitação!';
      if (origem === 'portal') {
        const [_p, _tipo, _idMembro] = numero_membro.split('-');
        const r = await query(
          'INSERT INTO portal_mensagens (origem_tipo, origem_id, autor, texto, remetente_nome, atendimento_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, criado_em',
          [_tipo, _idMembro, 'admin', m, _areaCap, req.params.id]
        );
        const io = req.app._io;
        if (io) io.to('membro_' + _tipo + '_' + _idMembro).emit('chat_msg_ok', { id: r.rows[0].id, texto: m, criado_em: r.rows[0].criado_em, autor: 'admin' });
      } else {
        const lauro = require('../services/lauro');
        await lauro.enviarMensagemDireta(numero_membro, m).catch(()=>{});
      }
    }
    req.session.msg = ['Atendimento encerrado!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/atendimentos');
});
router.post('/atendimentos/:id/transferir', requireAuth, requirePermissao('atendimentos'), async (req, res) => {
  try {
    const { area_destino } = req.body;
    const atR = await query("SELECT numero_membro, area, idioma, origem FROM lauro_atendimentos WHERE id=$1 AND status='aguardando'", [req.params.id]);
    if (atR.rows.length > 0) {
      const { numero_membro, area, idioma, origem } = atR.rows[0];
      const _perfilT = req.session.usuario && req.session.usuario.perfil;
      if (_perfilT !== 'admin' && _perfilT !== 'presidencia' && area !== _perfilT) { req.session.erro=['Sem permissão para este atendimento']; return res.redirect('/atendimentos'); }
      if (origem === 'portal') {
        const [_p, _tipo, _idMembro] = numero_membro.split('-');
        await query('UPDATE lauro_atendimentos SET area=$1 WHERE id=$2', [area_destino, req.params.id]);
        const nomeAreaDestino = area_destino.charAt(0).toUpperCase() + area_destino.slice(1);
        const m = 'Sua solicitação foi encaminhada para a equipe de ' + nomeAreaDestino + '. Em breve alguém vai te responder aqui mesmo!';
        const r = await query(
          'INSERT INTO portal_mensagens (origem_tipo, origem_id, autor, texto, remetente_nome, atendimento_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, criado_em',
          [_tipo, _idMembro, 'admin', m, nomeAreaDestino, req.params.id]
        );
        const io = req.app._io;
        if (io) io.to('membro_' + _tipo + '_' + _idMembro).emit('chat_msg_ok', { id: r.rows[0].id, texto: m, criado_em: r.rows[0].criado_em, autor: 'admin' });
      } else {
        await query("UPDATE lauro_atendimentos SET status='transferido', encerrado_em=NOW() WHERE id=$1", [req.params.id]);
        const lauro = require('../services/lauro');
        await lauro.redirecionarArea(numero_membro, area_destino, idioma||'pt');
      }
    }
    req.session.msg = ['Transferido para ' + area_destino + '!'];
  } catch(e) { req.session.erro=[e.message]; }
  res.redirect('/atendimentos');
});


};
