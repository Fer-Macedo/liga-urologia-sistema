// ═══ EVENTOS ════════════════════════════════════════════════════════════════
const rateLimit = require('express-rate-limit');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { enviarEmail, emailBonito } = require('../services/email');
const { criarPixEvento, consultarPagamento, obterChavePublica, pagarComCartao } = require('../services/pagbank');
const { enviarEmailConfirmacaoEvento, TEXTO_CONFIRMACAO_PADRAO } = require('../services/eventos-email');
const { limiterPagamentoCartao } = require('../services/rate-limiters');

// /inscricao e /checkout ficam de fora do rate-limit geral (src/routes/index.js) porque
// alguém legitimamente pode recarregar/tentar de novo várias vezes numa fila de evento —
// mas isso não pode significar SEM limite nenhum. Um teto mais folgado que o geral, só
// pra essas rotas públicas específicas.
//
// GET (ver a página) e POST (enviar o formulário/pagar) têm perfis MUITO diferentes: um
// pico de gente abrindo o link — inclusive várias pessoas atrás do mesmo IP (rede de
// faculdade, hospital, operadora de celular) — gera dezenas de GETs legítimos em minutos.
// O que precisa de teto apertado é o POST (inscrição repetida, tentativa de pagamento em
// série) — foi misturar os dois no mesmo limite de 60 que derrubou gente de verdade numa
// inscrição concorrida (11/08/2026).
const limiterVisualizacaoEvento = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});
const limiterInscricaoEvento = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});
// Formulário de contato — poucas mensagens legítimas por pessoa; teto mais apertado.
const limiterContatoEvento = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Muitas mensagens. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = function (router) {

// ─── EVENTOS ──────────────────────────────────────────────────────────────────

async function getEventoStats(eventoId) {
  const [t, conf, chk, rec] = await Promise.all([
    query('SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=$1', [eventoId]),
    query("SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado'", [eventoId]),
    query('SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=$1 AND checkin_em IS NOT NULL', [eventoId]),
    query("SELECT COALESCE(SUM(p.valor),0) as total FROM evento_pagamentos p JOIN evento_inscricoes i ON i.id=p.inscricao_id WHERE i.evento_id=$1 AND p.status='pago'", [eventoId])
  ]);
  return { total: parseInt(t.rows[0].count), confirmados: parseInt(conf.rows[0].count), checkins: parseInt(chk.rows[0].count), receita: rec.rows[0].total };
}

router.get('/eventos', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const r = await query(`SELECT e.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id) as total_inscritos, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id AND checkin_em IS NOT NULL) as total_checkins, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id AND status='confirmado') as total_pagos, (SELECT COALESCE(SUM(p.valor),0) FROM evento_pagamentos p JOIN evento_inscricoes i ON i.id=p.inscricao_id WHERE i.evento_id=e.id AND p.status='pago') as receita FROM eventos e ORDER BY e.criado_em DESC`);
  const totalInscritos = r.rows.reduce((a,b)=>a+parseInt(b.total_inscritos||0),0);
  const totalReceita = r.rows.reduce((a,b)=>a+parseFloat(b.receita||0),0);
  const totalCheckins = r.rows.reduce((a,b)=>a+parseInt(b.total_checkins||0),0);
  res.render('pages/eventos', { config, usuario: req.session.usuario, msg, erro, eventos: r.rows, totalInscritos, totalReceita, totalCheckins });
});

router.post('/eventos', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const {upload, uploadArquivo} = require('../services/arquivos');
    upload.single('banner')(req, res, async (err) => {
      const {nome,descricao,data_inicio,data_fim,local,endereco,vagas_total,status,publico,cor_tema,tipo_evento} = req.body;
      let bannerChave = null;
      if (req.file) { const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'eventos'); bannerChave=r.chave; }
      // email_inscricao já nasce com o texto padrão (mesma regra usada como fallback no
      // envio) — sem isso, todo evento novo tinha o campo vazio e exigia copiar e colar
      // manualmente o texto de um evento anterior.
      await query('INSERT INTO eventos (nome,descricao,data_inicio,data_fim,local,endereco,vagas_total,status,publico,banner_chave,cor_tema,tipo_evento,criado_por,email_inscricao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [nome,descricao||null,data_inicio||null,data_fim||null,local||null,endereco||null,parseInt(vagas_total)||100,status||'rascunho',publico==='true',bannerChave,cor_tema||'#1a3d2b',tipo_evento||'presencial',req.session.usuario.id,TEXTO_CONFIRMACAO_PADRAO]);
      req.session.msg=['Evento criado!']; res.redirect('/eventos');
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos'); }
});

router.get('/eventos/:id', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const [evR, lotesR, inscrR, pgR, certR, progR, palesR, patrocR] = await Promise.all([
    query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
    query('SELECT l.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE lote_id=l.id) as inscritos FROM evento_lotes l WHERE l.evento_id=$1 ORDER BY l.ordem',[req.params.id]),
    query('SELECT i.*, l.nome as lote_nome FROM evento_inscricoes i LEFT JOIN evento_lotes l ON l.id=i.lote_id WHERE i.evento_id=$1 ORDER BY i.criado_em DESC',[req.params.id]),
    query('SELECT p.*, i.nome as inscrito_nome FROM evento_pagamentos p JOIN evento_inscricoes i ON i.id=p.inscricao_id WHERE i.evento_id=$1 ORDER BY p.criado_em DESC',[req.params.id]),
    query('SELECT c.*, i.nome as inscrito_nome FROM evento_certificados c JOIN evento_inscricoes i ON i.id=c.inscricao_id WHERE i.evento_id=$1 ORDER BY c.emitido_em DESC',[req.params.id]),
    query('SELECT * FROM evento_programacao WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
    query('SELECT * FROM evento_palestrantes WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
    query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY ordem',[req.params.id])
  ]);
  if (!evR.rows[0]) { req.session.erro=['Evento não encontrado']; return res.redirect('/eventos'); }
  const stats = await getEventoStats(req.params.id);
  const camposR = await query('SELECT * FROM evento_campos WHERE evento_id=$1 ORDER BY ordem',[req.params.id]);
  const cuponsR = await query('SELECT ec.*, ec.criado_em AS cupom_criado_em, ei.nome AS usado_nome, ei.criado_em AS usado_em, COALESCE(l.nome, d.nome, mb.nome) AS dono_nome FROM evento_cupons ec LEFT JOIN evento_inscricoes ei ON ei.id = ec.usado_por_inscricao_id LEFT JOIN ligantes l ON ec.ligante_id = l.id LEFT JOIN diretivos d ON ec.diretivo_id = d.id LEFT JOIN membros mb ON ec.membro_id = mb.id WHERE ec.evento_id=$1 ORDER BY ec.criado_em DESC',[req.params.id]);
  res.render('pages/evento-detalhe', { config, usuario: req.session.usuario, msg, erro, evento: evR.rows[0], lotes: lotesR.rows, inscricoes: inscrR.rows, pagamentos: pgR.rows, certificados: certR.rows, stats, campos: camposR.rows, programacao: progR.rows, palestrantes: palesR.rows, patrocinadores: patrocR.rows, cupons: cuponsR.rows });
});

router.post('/eventos/:id/editar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const {upload, uploadArquivo} = require('../services/arquivos');
    upload.single('banner')(req, res, async (err) => {
      const {nome,descricao,data_inicio,data_fim,local,endereco,vagas_total,status,publico,carga_horaria,duracao_minutos,youtube_url} = req.body;
      let bannerChave = null;
      if (req.file) { const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'eventos'); bannerChave=r.chave; }
      const bannerUpdate = bannerChave ? ',banner_chave=$11' : '';
      const idxParam = bannerChave ? 12 : 11;
      const params = [nome,descricao||null,data_inicio||null,data_fim||null,local||null,endereco||null,parseInt(vagas_total),status,publico==='true',parseInt(carga_horaria)||null,req.params.id];
      if (bannerChave) params.splice(10,0,bannerChave);
      params.push(parseInt(duracao_minutos)||null);
      params.push(youtube_url||null);
      await query(`UPDATE eventos SET nome=$1,descricao=$2,data_inicio=$3,data_fim=$4,local=$5,endereco=$6,vagas_total=$7,status=$8,publico=$9,carga_horaria=$10${bannerUpdate},duracao_minutos=$${idxParam+1},youtube_url=$${idxParam+2} WHERE id=$${idxParam}`, params);
      req.session.msg=['Evento atualizado!']; res.redirect('/eventos/'+req.params.id);
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id); }
});

router.post('/eventos/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  await query('DELETE FROM eventos WHERE id=$1',[req.params.id]);
  req.session.msg=['Evento excluído!']; res.redirect('/eventos');
});

router.get('/eventos/:id/banner', async (req, res) => {
  try {
    const r = await query('SELECT banner_chave FROM eventos WHERE id=$1',[req.params.id]);
    if (!r.rows[0]?.banner_chave) return res.status(404).send('');
    const {getUrlAssinada} = require('../services/desligamento');
    res.redirect(await getUrlAssinada(r.rows[0].banner_chave));
  } catch(e) { res.status(500).send(''); }
});

router.post('/eventos/:id/lotes', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const {nome,preco,vagas,data_inicio,data_fim,exige_catraca} = req.body;
  const ordem = await query('SELECT COUNT(*) FROM evento_lotes WHERE evento_id=$1',[req.params.id]);
  await query('INSERT INTO evento_lotes (evento_id,nome,preco,vagas,data_inicio,data_fim,ordem,exige_catraca) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [req.params.id,nome,parseFloat(preco)||0,parseInt(vagas)||50,data_inicio||null,data_fim||null,parseInt(ordem.rows[0].count)+1,exige_catraca==='on']);
  req.session.msg=['Lote criado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/lotes/:lid/deletar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query('DELETE FROM evento_lotes WHERE id=$1',[req.params.lid]);
  req.session.msg=['Lote excluído!']; res.redirect('/eventos/'+req.params.id);
});

// INSCRIÇÕES - Página Pública
router.get('/inscricao/:id', limiterVisualizacaoEvento, async (req, res) => {
  try {
    const [evR, lotesR] = await Promise.all([
      query(`SELECT e.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id) as total_inscritos FROM eventos e WHERE id=$1`,[req.params.id]),
      query('SELECT l.*, (SELECT COUNT(*) FROM evento_inscricoes WHERE lote_id=l.id) as inscritos FROM evento_lotes l WHERE l.evento_id=$1 ORDER BY l.ordem',[req.params.id])
    ]);
    // Evento não existe de fato
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado.');
    const _eventoEncerrado = evR.rows[0].status !== 'ativo';
    const camposR = await query('SELECT * FROM evento_campos WHERE evento_id=$1 ORDER BY ordem',[req.params.id]);
    const [progPubR, palesPubR, patrocPubR] = await Promise.all([
      query('SELECT * FROM evento_programacao WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
      query('SELECT * FROM evento_palestrantes WHERE evento_id=$1 ORDER BY ordem',[req.params.id]),
      query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY ordem',[req.params.id])
    ]);
    const cfgPub = await getConfig();
    const cupomUrl = req.query.cupom ? req.query.cupom.toUpperCase() : null;
    res.render('pages/evento-inscricao-publica', { evento: evR.rows[0], lotes: lotesR.rows, sucesso: false, qrcode: null, campos: camposR.rows, codigoInscricao: null, config: cfgPub, programacao: progPubR.rows, palestrantes: palesPubR.rows, patrocinadores: patrocPubR.rows, pixData: null, cupomUrl, encerrado: _eventoEncerrado });
  } catch(e) { console.error('GET /inscricao:', e.message); res.status(500).send('Erro ao carregar a inscrição.'); }
});

// INSCRIÇÕES — POST: salva dados e redireciona para pagamento
router.post('/inscricao/:id', limiterInscricaoEvento, async (req, res) => {
  try {
    const { nome, email, whatsapp, rg, cpf, instituicao, lote_id, tipo_participante, catraca, semestre, turma } = req.body;
    if (!nome || !email) return res.status(400).send('Nome e e-mail são obrigatórios.');

    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado');
    const evento = evR.rows[0];

    const loteR = await query('SELECT * FROM evento_lotes WHERE id=$1', [lote_id]);
    const lote = loteR.rows[0];

    // ── VALIDAÇÃO DE DUPLICATA — email OU rg já cadastrado neste evento
    const emailNorm = (email || '').toLowerCase().trim();
    const rgNorm    = (rg || '').replace(/\D/g, '').trim();

    const dupEmail = await query(
      "SELECT id FROM evento_inscricoes WHERE evento_id=$1 AND LOWER(TRIM(email))=$2 AND status != 'cancelado'",
      [req.params.id, emailNorm]
    );
    const dupRg = rgNorm ? await query(
      "SELECT id FROM evento_inscricoes WHERE evento_id=$1 AND REGEXP_REPLACE(rg,'[^0-9]','','g')=$2 AND status != 'cancelado'",
      [req.params.id, rgNorm]
    ) : { rows: [] };

    if (dupEmail.rows.length > 0 || dupRg.rows.length > 0) {
      const motivo = dupEmail.rows.length > 0 ? 'e-mail' : 'RG/CI';
      const config = await getConfig();
      const [camposR, progR, palesR, patrocR, lotesR] = await Promise.all([
        query('SELECT * FROM evento_campos WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_programacao WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_palestrantes WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_lotes WHERE evento_id=$1 AND ativo=true ORDER BY ordem', [req.params.id])
      ]);
      return res.render('pages/evento-inscricao-publica', {
        evento, lotes: lotesR.rows, sucesso: false, qrcode: null,
        codigoInscricao: null, config, programacao: progR.rows,
        palestrantes: palesR.rows, patrocinadores: patrocR.rows, pixData: null,
        campos: camposR.rows,
        erro: `Já existe uma inscrição neste evento com este ${motivo}. Cada participante pode se inscrever apenas uma vez para garantir a unicidade do certificado.`
      });
    }

    const qrcode = 'LAURO-' + req.params.id + '-' + Date.now();
    const cupomCodigo = (req.body.cupom_codigo || '').toUpperCase().trim();
    let ehGratuito = !lote || parseFloat(lote.preco) === 0;
    let isento = false;
    let cupomValido = null;

    // Validar e aplicar cupom
    if (cupomCodigo) {
      const cupomR = await query('SELECT * FROM evento_cupons WHERE evento_id=$1 AND codigo=$2 AND ativo=true', [req.params.id, cupomCodigo]);
      cupomValido = cupomR.rows[0];
      if (cupomValido && cupomValido.usos_atual < cupomValido.usos_max) {
        if (cupomValido.tipo === 'percentual' && parseFloat(cupomValido.valor) === 100) {
          ehGratuito = true;
          isento = true;
        }
      }
    }

    const inscR = await query(
      'INSERT INTO evento_inscricoes (evento_id,lote_id,nome,email,whatsapp,rg,cpf,instituicao,tipo_participante,catraca,semestre,turma,status,qrcode,cupom_codigo,isento) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id',
      [req.params.id, lote_id||null, nome, emailNorm, whatsapp||null, rg||null, cpf||null, instituicao||null, tipo_participante||'externo', catraca||null, semestre||null, turma||null, ehGratuito ? 'confirmado' : 'pendente', qrcode, cupomCodigo||null, isento]
    );
    const inscricaoId = inscR.rows[0].id;

    // Marcar cupom como usado
    if (cupomValido && isento) {
      await query(
        'UPDATE evento_cupons SET usos_atual=usos_atual+1, usado_por_inscricao_id=$1 WHERE id=$2',
        [inscricaoId, cupomValido.id]
      );
    }

    // Evento gratuito → confirma direto, envia email e mostra confirmação
    if (ehGratuito) {
      await enviarEmailConfirmacaoEvento(inscricaoId);
      const config = await getConfig();
      const camposR = await query('SELECT * FROM evento_campos WHERE evento_id=$1 ORDER BY ordem', [req.params.id]);
      const [progR, palesR, patrocR] = await Promise.all([
        query('SELECT * FROM evento_programacao WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_palestrantes WHERE evento_id=$1 ORDER BY ordem', [req.params.id]),
        query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY ordem', [req.params.id])
      ]);
      return res.render('pages/evento-inscricao-publica', {
        evento, lotes: loteR.rows, sucesso: true, qrcode, campos: camposR.rows,
        codigoInscricao: qrcode, config, programacao: progR.rows,
        palestrantes: palesR.rows, patrocinadores: patrocR.rows, pixData: null, erro: null
      });
    }

    // Evento pago → gerar PIX, salvar no banco e redirecionar para /pagamento/:inscricaoId
    const pixData = await criarPixEvento({
      inscricao: { id: inscricaoId, nome, email: emailNorm, cpf },
      lote,
      eventoNome: evento.nome
    });

    await query(
      `INSERT INTO evento_pagamentos (inscricao_id, valor, metodo, status, pagbank_order_id, pix_copia_cola, pix_qr_image)
       VALUES ($1, $2, 'pix', 'pendente', $3, $4, $5)`,
      [inscricaoId, lote.preco, pixData?.order_id||null, pixData?.pix_copia_cola||null, pixData?.pix_qr_image||null]
    );

    res.redirect('/pagamento/' + inscricaoId);

  } catch(e) {
    console.error('POST /inscricao erro:', e.message);
    res.status(500).send('Erro ao processar inscrição. Tente novamente.');
  }
});

// ─── PAGAMENTO DE EVENTOS ─────────────────────────────────────────────────────

// Chave pública p/ criptografar o cartão no navegador (PagSeguro.encryptCard) — o
// número/CVV nunca chegam em texto puro no nosso servidor. Precisa vir ANTES de
// /pagamento/:inscricaoId, senão "chave-publica" é capturado como inscricaoId.
router.get('/pagamento/chave-publica', async (req, res) => {
  const r = await obterChavePublica();
  if (!r.ok) return res.status(502).json({ ok: false, erro: 'Não foi possível iniciar o pagamento. Tente novamente.' });
  res.json({ ok: true, publicKey: r.publicKey });
});

// Página de pagamento (PIX + Cartão)
router.get('/pagamento/:inscricaoId', async (req, res) => {
  try {
    const inscR = await query(
      'SELECT i.*, e.nome as evento_nome FROM evento_inscricoes i JOIN eventos e ON e.id=i.evento_id WHERE i.id=$1',
      [req.params.inscricaoId]
    );
    const inscricao = inscR.rows[0];
    if (!inscricao) return res.status(404).send('Inscrição não encontrada.');
    if (inscricao.status === 'confirmado') return res.redirect('/pagamento/' + req.params.inscricaoId + '/confirmado');

    const [evR, loteR, pgR] = await Promise.all([
      query('SELECT * FROM eventos WHERE id=$1', [inscricao.evento_id]),
      query('SELECT * FROM evento_lotes WHERE id=$1', [inscricao.lote_id]),
      query('SELECT * FROM evento_pagamentos WHERE inscricao_id=$1 ORDER BY criado_em DESC LIMIT 1', [inscricao.id])
    ]);

    const pagamento = pgR.rows[0];
    const pixData = pagamento ? {
      pix_copia_cola: pagamento.pix_copia_cola || null,
      pix_qr_image:   pagamento.pix_qr_image   || null,
      order_id:       pagamento.pagbank_order_id || null
    } : null;

    const config = await getConfig();
    res.render('pages/evento-pagamento', {
      config, evento: evR.rows[0], inscricao, lote: loteR.rows[0], pixData, qrcode: inscricao.qrcode
    });
  } catch(e) {
    console.error('GET /pagamento erro:', e.message);
    res.status(500).send('Erro ao carregar pagamento.');
  }
});

// Polling de status (PIX) — chamado pelo front a cada 4s
router.get('/pagamento/:inscricaoId/status', async (req, res) => {
  try {
    const r = await query(
      `SELECT i.status, p.pagbank_order_id
       FROM evento_inscricoes i
       LEFT JOIN evento_pagamentos p ON p.inscricao_id=i.id
       WHERE i.id=$1 ORDER BY p.criado_em DESC LIMIT 1`,
      [req.params.inscricaoId]
    );
    const row = r.rows[0];
    if (!row) return res.json({ pago: false });
    if (row.status === 'confirmado') return res.json({ pago: true });

    // Consulta em tempo real no PagBank
    if (row.pagbank_order_id) {
      const result = await consultarPagamento(row.pagbank_order_id);
      if (result.ok && result.status === 'PAID') {
        await query("UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1", [req.params.inscricaoId]);
        await query("UPDATE evento_pagamentos SET status='pago', pago_em=NOW() WHERE inscricao_id=$1", [req.params.inscricaoId]);
        await enviarEmailConfirmacaoEvento(req.params.inscricaoId);
        try {
          const { lancarEventoNoFluxo } = require('../services/fluxo-eventos');
          await lancarEventoNoFluxo(query, req.params.inscricaoId);
        } catch(ef){ console.error('lancar fluxo evento polling:', ef.message); }
        return res.json({ pago: true });
      }
    }
    res.json({ pago: false });
  } catch(e) {
    console.error('Status polling erro:', e.message);
    res.json({ pago: false });
  }
});

// Pagamento via Cartão de Crédito — recebe o cartão já criptografado pelo SDK no navegador.
router.post('/pagamento/:inscricaoId/cartao', limiterPagamentoCartao, async (req, res) => {
  try {
    const { encryptedCard, holder_name, holder_cpf } = req.body;
    if (!encryptedCard || !holder_name) return res.json({ ok: false, erro: 'Dados do cartão incompletos.' });

    const inscR = await query(
      'SELECT i.*, e.nome as evento_nome FROM evento_inscricoes i JOIN eventos e ON e.id=i.evento_id WHERE i.id=$1',
      [req.params.inscricaoId]
    );
    const inscricao = inscR.rows[0];
    if (!inscricao) return res.json({ ok: false, erro: 'Inscrição não encontrada.' });

    const loteR = await query('SELECT * FROM evento_lotes WHERE id=$1', [inscricao.lote_id]);
    const lote = loteR.rows[0];
    const referencia = 'evento-insc-' + inscricao.id;

    const r = await pagarComCartao({
      referencia,
      valor: lote.preco,
      membro: { nome: inscricao.nome, email: inscricao.email, cpf: holder_cpf },
      encryptedCard,
      holderName: holder_name,
      holderCpf: holder_cpf,
      itemName: ('Ingresso — ' + inscricao.evento_nome + ' — ' + lote.nome).substring(0, 100),
      descricao: ('Ingresso — ' + inscricao.evento_nome).substring(0, 64)
    });

    if (!r.ok) return res.json({ ok: false, erro: r.erro });
    if (!r.aprovado) {
      console.error('PagBank cartão recusado:', r.status);
      return res.json({ ok: false, erro: traduzirRecusaCartao(r.status) });
    }

    await query("UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1", [req.params.inscricaoId]);
    await query(
      `INSERT INTO evento_pagamentos (inscricao_id, valor, metodo, status, pagbank_order_id, pago_em)
       VALUES ($1,$2,'cartao','pago',$3,NOW())
       ON CONFLICT DO NOTHING`,
      [req.params.inscricaoId, lote.preco, r.charge_id]
    );
    await enviarEmailConfirmacaoEvento(req.params.inscricaoId);
    res.json({ ok: true });

  } catch(e) {
    console.error('PagBank cartão ERRO:', e.message);
    res.json({ ok: false, erro: 'Erro ao processar cartão. Verifique os dados e tente novamente.' });
  }
});

// Página de confirmação (já pago)
router.get('/pagamento/:inscricaoId/confirmado', async (req, res) => {
  try {
    const r = await query(
      'SELECT i.*, e.nome as evento_nome, e.cor_tema, e.banner_chave, e.local, e.data_inicio FROM evento_inscricoes i JOIN eventos e ON e.id=i.evento_id WHERE i.id=$1',
      [req.params.inscricaoId]
    );
    const inscricao = r.rows[0];
    if (!inscricao) return res.status(404).send('Não encontrado.');
    const config = await getConfig();
    res.render('pages/evento-confirmado', { config, inscricao });
  } catch(e) { console.error('GET /pagamento/confirmado:', e.message); res.status(500).send('Erro ao carregar confirmação.'); }
});

// ─── HELPERS PAGAMENTO ────────────────────────────────────────────────────────

function traduzirRecusaCartao(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('insufficient') || m.includes('saldo')) return 'Saldo insuficiente no cartão.';
  if (m.includes('expired') || m.includes('expir')) return 'Cartão expirado.';
  if (m.includes('security') || m.includes('cvv') || m.includes('cvc')) return 'CVV inválido.';
  if (m.includes('invalid') || m.includes('inválid')) return 'Dados do cartão inválidos.';
  if (m.includes('blocked') || m.includes('bloqueado')) return 'Cartão bloqueado. Contate seu banco.';
  if (m.includes('limit') || m.includes('limite')) return 'Limite do cartão excedido.';
  return 'Pagamento não aprovado. Verifique os dados ou tente outro cartão.';
}


router.post('/eventos/:id/inscricoes/manual', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const {nome,email,whatsapp,cpf,lote_id,status} = req.body;
  const qrcode = 'LAURO-' + req.params.id + '-' + Date.now();
  await query('INSERT INTO evento_inscricoes (evento_id,lote_id,nome,email,whatsapp,cpf,status,qrcode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [req.params.id,lote_id||null,nome,email,whatsapp||null,cpf||null,status||'confirmado',qrcode]);
  req.session.msg=['Inscrição manual adicionada!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/inscricoes/:iid/confirmar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query("UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1",[req.params.iid]);
  req.session.msg=['Inscrição confirmada!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/inscricoes/:iid/deletar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const iid=req.params.iid;
    await query('DELETE FROM evento_pagamentos WHERE inscricao_id=$1',[iid]);
    await query('DELETE FROM evento_certificados WHERE inscricao_id=$1',[iid]);
    await query('DELETE FROM evento_inscricoes WHERE id=$1',[iid]);
    req.session.msg=['Inscrição excluída com sucesso!'];
  } catch(e) { req.session.erro=['Erro ao excluir: '+e.message]; }
  res.redirect('/eventos/'+req.params.id+'?tab=inscritos');
  // Notificar lista de espera em background (sem bloquear resposta)
  setImmediate(async () => {
    try {
      const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
      const ev = evR.rows[0];
      const espR = await query('SELECT * FROM evento_lista_espera WHERE evento_id=$1 AND notificado=false ORDER BY criado_em ASC LIMIT 1',[req.params.id]);
      if (espR.rows[0] && ev) {
        const esp = espR.rows[0];
        const {enviarWhatsApp} = require('../services/notificacoes');
        const config = await getConfig();
        const appUrl = process.env.APP_URL||'https://sistema.lauroucpcde.com';
        const msg = (config.org_nome||'LAURO')+'\n\n*Vaga disponível!*\n\nOlá, *'+esp.nome.split(' ')[0]+'*! Uma vaga abriu no evento *'+ev.nome+'*.\n\nAcesse agora para garantir sua vaga:\n'+appUrl+'/inscricao/'+ev.id;
        if (esp.whatsapp) await enviarWhatsApp(esp.whatsapp, msg);
        await query('UPDATE evento_lista_espera SET notificado=true, notificado_em=NOW() WHERE id=$1',[esp.id]);
      }
    } catch(e) {}
  });
});

router.get('/eventos/:id/checkin', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const [evR, inscrR] = await Promise.all([
    query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
    query('SELECT i.*, l.nome as lote_nome FROM evento_inscricoes i LEFT JOIN evento_lotes l ON l.id=i.lote_id WHERE i.evento_id=$1 ORDER BY i.nome',[req.params.id])
  ]);
  const stats = await getEventoStats(req.params.id);
  res.render('pages/evento-checkin', { config, usuario: req.session.usuario, msg, erro:[], evento: evR.rows[0], inscricoes: inscrR.rows, stats });
});

// ─── CHECK-IN COM TEMPO (ENTRADA/SAIDA) ──────────────────────────────────────
router.post('/eventos/:id/checkin/buscar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const {busca} = req.body;
    const r = await query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND (LOWER(nome) LIKE $2 OR qrcode=$3) LIMIT 1",
      [req.params.id,'%'+(busca||'').toLowerCase()+'%',busca]);
    if (!r.rows[0]) return res.json({ok:false, msg:'Inscrito nao encontrado.'});
    const insc = r.rows[0];

    // Verifica se tem entrada aberta (sem saida)
    const aberto = await query(
      "SELECT id FROM evento_presencas_tempo WHERE inscricao_id=$1 AND saida_em IS NULL ORDER BY entrada_em DESC LIMIT 1",
      [insc.id]
    );

    if (aberto.rows.length > 0) {
      // SAIDA — fecha a sessao aberta
      await query("UPDATE evento_presencas_tempo SET saida_em=NOW() WHERE id=$1", [aberto.rows[0].id]);
      // Calcula tempo total
      const tot = await query(
        "SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(saida_em,NOW())-entrada_em))),0) as segundos FROM evento_presencas_tempo WHERE inscricao_id=$1",
        [insc.id]
      );
      const mins = Math.round(tot.rows[0].segundos / 60);
      return res.json({ok:true, tipo:'saida', msg:'Saida registrada: '+insc.nome+' — '+mins+' min acumulados', nome: insc.nome});
    } else {
      // ENTRADA — abre nova sessao
      await query(
        "INSERT INTO evento_presencas_tempo (inscricao_id, evento_id, entrada_em) VALUES ($1,$2,NOW())",
        [insc.id, req.params.id]
      );
      // Primeiro checkin — marca checkin_em se ainda nao tiver
      if (!insc.checkin_em) {
        await query("UPDATE evento_inscricoes SET checkin_em=NOW() WHERE id=$1", [insc.id]);
      }
      return res.json({ok:true, tipo:'entrada', msg:'Entrada registrada: '+insc.nome, nome: insc.nome});
    }
  } catch(e) { res.json({ok:false, msg:'Erro: '+e.message}); }
});

router.post('/eventos/:id/inscricoes/:iid/reenviar-email', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    await enviarEmailConfirmacaoEvento(req.params.iid);
    req.session.msg = ['E-mail de confirmação reenviado com sucesso!'];
  } catch(e) {
    req.session.erro = ['Erro ao reenviar e-mail: ' + e.message];
  }
  res.redirect('/eventos/' + req.params.id + '?tab=inscritos');
});
// Dispara na hora o mesmo lembrete (WhatsApp + email) que o cron horário manda sozinho pra
// inscrições pendentes há 2-48h — pra equipe poder cutucar alguém específico sem esperar.
router.post('/eventos/:id/inscricoes/:iid/lembrete-pendente', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const { enviarLembreteInscricaoPendente } = require('../services/agendamentos');
    const r = await enviarLembreteInscricaoPendente(req.params.iid);
    if (!r.ok) throw new Error(r.motivo || 'Não foi possível enviar (sem WhatsApp/e-mail cadastrado?).');
    req.session.msg = ['Lembrete de pagamento enviado!'];
  } catch(e) {
    req.session.erro = ['Erro ao enviar lembrete: ' + e.message];
  }
  res.redirect('/eventos/' + req.params.id + '?tab=inscritos');
});

router.post('/eventos/:id/inscricoes/:iid/checkin', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query('UPDATE evento_inscricoes SET checkin_em=NOW() WHERE id=$1',[req.params.iid]);
  req.session.msg=['Check-in realizado!']; res.redirect('/eventos/'+req.params.id+'/checkin');
});

router.post('/eventos/:id/pagamentos/:pid/confirmar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query("UPDATE evento_pagamentos SET status='pago', pago_em=NOW() WHERE id=$1",[req.params.pid]);
  const iR = await query("UPDATE evento_inscricoes SET status='confirmado' WHERE id=(SELECT inscricao_id FROM evento_pagamentos WHERE id=$1) RETURNING id",[req.params.pid]);
  try {
    const { lancarEventoNoFluxo } = require('../services/fluxo-eventos');
    if (iR.rows.length) await lancarEventoNoFluxo(query, iR.rows[0].id);
  } catch(ef){ console.error('lancar fluxo evento (confirmar manual):', ef.message); }
  req.session.msg=['Pagamento confirmado!']; res.redirect('/eventos/'+req.params.id);
});

router.get('/eventos/:id/relatorio-pdf', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const [evR, inscrR, pgR, config] = await Promise.all([
      query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
      query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 ORDER BY nome",[req.params.id]),
      query("SELECT * FROM evento_pagamentos WHERE status='pago' AND inscricao_id IN (SELECT id FROM evento_inscricoes WHERE evento_id=$1)",[req.params.id]),
      getConfig()
    ]);
    const ev = evR.rows[0];
    if (!ev) return res.status(404).send('Evento nao encontrado');
    const inscritos = inscrR.rows;
    const pagamentos = pgR.rows;
    const orgNome = config.org_nome||'LAURO';
    const orgLogo = config.org_logo||null;
    const dataEv = ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'';
    const confirmados = inscritos.filter(i=>i.status==='confirmado').length;
    const checkins = inscritos.filter(i=>i.checkin_em).length;
    let bruto=0, taxas=0;
    pagamentos.forEach(p=>{
      const v=Number(p.valor)||0; bruto+=v;
     if(p.metodo==='pix') taxas+=v*0.018;
      else if(p.metodo==='cartao') taxas+=v*0.04;
    });
    const liquido = bruto-taxas;
    const brl = (v)=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const linhasInscritos = inscritos.map((i,idx)=>{
      const conf = i.status==='confirmado';
      const pillBg = conf?'#EDF6F1':'#FBF3E0';
      const pillCo = conf?'#23704F':'#C98A1E';
      return `<tr style="background:${idx%2===0?'#F6F8F5':'#ffffff'}"><td style="padding:7px 10px;font-size:10.5px;color:#74837C">${idx+1}</td><td style="padding:7px 10px;font-size:11px;font-weight:600;color:#10201A">${i.nome}</td><td style="padding:7px 10px;font-size:10.5px;color:#3A4A43">${i.email||'—'}</td><td style="padding:7px 10px;font-size:10.5px;color:#3A4A43">${i.lote_nome||'—'}</td><td style="padding:7px 10px;text-align:center"><span style="background:${pillBg};color:${pillCo};padding:2px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${i.status}</span></td><td style="padding:7px 10px;font-size:12px;text-align:center;color:${i.checkin_em?'#23704F':'#9ca3af'};font-weight:700">${i.checkin_em?'✓':'—'}</td></tr>`;
    }).join('');
    const estilos=`*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:0}body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#10201A;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{.np{display:none}}.wrap{max-width:820px;margin:0 auto}.header{background:linear-gradient(135deg,#103024,#0C231B);padding:26px 34px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:14px}.logo-chip{width:54px;height:54px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.logo-chip img{width:54px;height:54px;object-fit:cover;border-radius:50%}.org{font-family:'Archivo';font-weight:800;font-size:15px;letter-spacing:.3px;line-height:1.15}.org small{display:block;font-family:'IBM Plex Mono';font-size:8.5px;letter-spacing:2px;color:#37C98B;text-transform:uppercase;margin-top:4px;font-weight:500}.ev{text-align:right}.ev .nm{font-family:'Archivo';font-size:18px;font-weight:800;line-height:1.15}.ev .dt{font-size:11.5px;color:#A9C2B6;margin-top:5px;text-transform:capitalize}.ev .lc{font-size:10.5px;color:#7E988B;margin-top:1px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 34px;background:#F2F4F0;border-bottom:1px solid #E2E6E1}.stat{background:#fff;border:1px solid #E2E6E1;padding:13px 14px;position:relative;overflow:hidden}.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:#2FA873}.stat .n{font-family:'Archivo';font-size:21px;font-weight:800;letter-spacing:-.5px;color:#15402F}.stat .l{font-family:'IBM Plex Mono';font-size:8.5px;color:#74837C;font-weight:500;text-transform:uppercase;letter-spacing:1px;margin-top:4px}.section{padding:20px 34px}.sec-title{font-family:'Archivo';font-size:13px;font-weight:800;letter-spacing:.2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:7px;border-bottom:2px solid #2FA873;color:#10201A}.fin{border:1px solid #E2E6E1}.fin-row{display:flex;justify-content:space-between;padding:11px 16px;font-size:12.5px;border-bottom:1px solid #E2E6E1}.fin-row:last-child{border-bottom:none;background:#F6F8F5}.fin-row .lbl{color:#3A4A43}table{width:100%;border-collapse:collapse;border:1px solid #E2E6E1}thead{display:table-header-group}thead th{background:#15402F;color:#fff;padding:9px 10px;font-family:'IBM Plex Mono';font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:1px;font-weight:600}tbody td{border-bottom:1px solid #EDEFEC}tbody tr{page-break-inside:avoid}.foot{padding:16px 34px;border-top:1px solid #E2E6E1;font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;gap:12px}.btn-p{position:fixed;bottom:22px;right:22px;padding:12px 22px;background:#2FA873;color:#0C231B;border:none;cursor:pointer;font-family:'IBM Plex Sans';font-size:13px;font-weight:700;box-shadow:0 8px 24px -8px rgba(47,168,115,.8)}@media print{@page{margin:14mm 0 12mm}@page :first{margin:0 0 12mm}}`;
    const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"><style>${estilos}</style></head><body>
<div class="wrap">
  <div class="header">
    <div class="brand">${orgLogo?`<div class="logo-chip"><img src="${orgLogo}" alt=""></div>`:''}<div class="org">${orgNome}<small>Relatório de Evento</small></div></div>
    <div class="ev"><div class="nm">${ev.nome}</div><div class="dt">${dataEv}</div><div class="lc">${ev.local||''}</div></div>
  </div>
  <div class="stats">
    <div class="stat"><div class="n">${inscritos.length}</div><div class="l">Inscritos</div></div>
    <div class="stat"><div class="n">${confirmados}</div><div class="l">Confirmados</div></div>
    <div class="stat"><div class="n">${checkins}</div><div class="l">Check-ins</div></div>
    <div class="stat"><div class="n">R$ ${brl(liquido)}</div><div class="l">Receita líquida</div></div>
  </div>
  <div class="section"><div class="sec-title">Resumo financeiro</div><div class="fin">
    <div class="fin-row"><span class="lbl">Receita bruta</span><span style="font-weight:700;color:#23704F">R$ ${brl(bruto)}</span></div>
    <div class="fin-row"><span class="lbl">Taxas (PIX / cartão)</span><span style="font-weight:700;color:#C0392B">− R$ ${brl(taxas)}</span></div>
    <div class="fin-row"><span class="lbl" style="font-weight:700;color:#10201A">Receita líquida</span><span style="font-family:'Archivo';font-weight:800;color:#15402F">R$ ${brl(liquido)}</span></div>
  </div></div>
  <div class="section"><div class="sec-title">Lista de inscritos (${inscritos.length})</div>
    <table><thead><tr><th style="width:34px">#</th><th>Nome</th><th>Email</th><th>Lote</th><th style="text-align:center;width:84px">Status</th><th style="text-align:center;width:66px">Check-in</th></tr></thead><tbody>${linhasInscritos}</tbody></table>
  </div>
  <div class="foot"><span>${orgNome} · Gerado em ${new Date().toLocaleString('pt-BR')}</span><span>${ev.nome}</span></div>
</div>
<button class="btn-p np" onclick="window.print()">Imprimir / Salvar PDF</button>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.get('/eventos/:id/inscritos-pdf', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const [evR, inscrR, config] = await Promise.all([
      query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
      query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 ORDER BY nome",[req.params.id]),
      getConfig()
    ]);
    const ev = evR.rows[0];
    if (!ev) return res.status(404).send('Evento nao encontrado');
    const orgNome = config.org_nome||'LAURO';
    const orgLogo = config.org_logo||null;
    const dataEv = ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'';
    const fBusca = (req.query.busca||'').toString().toLowerCase().trim();
    const fStatus = (req.query.status||'').toString();
    const fTipo = (req.query.tipo||'').toString();
    const fLote = (req.query.lote||'').toString();
    let inscritos = inscrR.rows.filter(i=>{
      const nome=(i.nome||'').toLowerCase(), email=(i.email||'').toLowerCase();
      const isento = i.isento ? 'isento' : 'pagante';
      if (fBusca && !nome.includes(fBusca) && !email.includes(fBusca)) return false;
      if (fStatus && i.status !== fStatus) return false;
      if (fTipo && isento !== fTipo) return false;
      if (fLote && String(i.lote_id||'') !== fLote) return false;
      return true;
    });
    const filtros = [];
    if (fStatus) filtros.push('Status: '+fStatus);
    if (fTipo) filtros.push('Tipo: '+fTipo);
    if (fLote) filtros.push('Lote selecionado');
    if (fBusca) filtros.push('Busca: "'+fBusca+'"');
    const filtroTxt = filtros.length ? filtros.join(' · ') : 'Todos os inscritos';
    const linhas = inscritos.map((i,idx)=>{
      const st=i.status||'';
      const conf = st==='confirmado'; const canc = st==='cancelado';
      const pillBg = conf?'#EDF6F1':canc?'#FBE9E7':'#FBF3E0';
      const pillCo = conf?'#23704F':canc?'#C0392B':'#C98A1E';
      const isentoTag = i.isento ? ` <span style="background:#FBF3E0;color:#C98A1E;padding:1px 6px;font-size:8px;font-weight:700;letter-spacing:.5px">ISENTO</span>` : '';
      const chk = i.checkin_em ? new Date(i.checkin_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
      return `<tr style="background:${idx%2===0?'#F6F8F5':'#ffffff'}"><td style="padding:7px 10px;font-size:10.5px;color:#74837C">${idx+1}</td><td style="padding:7px 10px;font-size:11px;font-weight:600;color:#10201A">${i.nome||''}</td><td style="padding:7px 10px;font-size:10.5px;color:#3A4A43">${i.email||'—'}</td><td style="padding:7px 10px;font-size:10.5px;color:#3A4A43">${i.lote_nome||'—'}</td><td style="padding:7px 10px;text-align:center"><span style="background:${pillBg};color:${pillCo};padding:2px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${st}</span>${isentoTag}</td><td style="padding:7px 10px;font-size:10.5px;text-align:center;color:${i.checkin_em?'#23704F':'#9ca3af'};font-weight:${i.checkin_em?'700':'400'}">${chk}</td></tr>`;
    }).join('');
    const estilos=`*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:0}body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#10201A;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{.np{display:none}}.wrap{max-width:820px;margin:0 auto}.header{background:linear-gradient(135deg,#103024,#0C231B);padding:26px 34px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:14px}.logo-chip{width:54px;height:54px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.logo-chip img{width:54px;height:54px;object-fit:cover;border-radius:50%}.org{font-family:'Archivo';font-weight:800;font-size:15px;letter-spacing:.3px;line-height:1.15}.org small{display:block;font-family:'IBM Plex Mono';font-size:8.5px;letter-spacing:2px;color:#37C98B;text-transform:uppercase;margin-top:4px;font-weight:500}.ev{text-align:right}.ev .nm{font-family:'Archivo';font-size:18px;font-weight:800;line-height:1.15}.ev .dt{font-size:11.5px;color:#A9C2B6;margin-top:5px;text-transform:capitalize}.ev .lc{font-size:10.5px;color:#7E988B;margin-top:1px}.meta{padding:14px 34px;background:#F2F4F0;border-bottom:1px solid #E2E6E1;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.meta .l{font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px}.meta .v{font-family:'Archivo';font-size:14px;font-weight:800;color:#15402F;margin-top:3px}.section{padding:20px 34px}.sec-title{font-family:'Archivo';font-size:13px;font-weight:800;letter-spacing:.2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:7px;border-bottom:2px solid #2FA873;color:#10201A}table{width:100%;border-collapse:collapse;border:1px solid #E2E6E1}thead{display:table-header-group}thead th{background:#15402F;color:#fff;padding:9px 10px;font-family:'IBM Plex Mono';font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:1px;font-weight:600}tbody td{border-bottom:1px solid #EDEFEC}tbody tr{page-break-inside:avoid}.foot{padding:16px 34px;border-top:1px solid #E2E6E1;font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;gap:12px}.btn-p{position:fixed;bottom:22px;right:22px;padding:12px 22px;background:#2FA873;color:#0C231B;border:none;cursor:pointer;font-family:'IBM Plex Sans';font-size:13px;font-weight:700;box-shadow:0 8px 24px -8px rgba(47,168,115,.8)}@media print{@page{margin:14mm 0 12mm}@page :first{margin:0 0 12mm}}`;
    const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"><style>${estilos}</style></head><body>
<div class="wrap">
  <div class="header"><div class="brand">${orgLogo?`<div class="logo-chip"><img src="${orgLogo}" alt=""></div>`:''}<div class="org">${orgNome}<small>Lista de Inscritos</small></div></div><div class="ev"><div class="nm">${ev.nome}</div><div class="dt">${dataEv}</div><div class="lc">${ev.local||''}</div></div></div>
  <div class="meta"><div><div class="l">Registros</div><div class="v">${inscritos.length}</div></div><div style="text-align:right"><div class="l">Filtro aplicado</div><div class="v" style="font-size:11px;font-weight:600;color:#3A4A43;text-transform:none;font-family:'IBM Plex Sans'">${filtroTxt}</div></div></div>
  <div class="section"><div class="sec-title">Inscritos (${inscritos.length})</div>
    <table><thead><tr><th style="width:34px">#</th><th>Nome</th><th>Email</th><th>Lote</th><th style="text-align:center;width:90px">Status</th><th style="text-align:center;width:70px">Check-in</th></tr></thead><tbody>${linhas}</tbody></table>
  </div>
  <div class="foot"><span>${orgNome} · Gerado em ${new Date().toLocaleString('pt-BR')}</span><span>${ev.nome}</span></div>
</div>
<button class="btn-p np" onclick="window.print()">Imprimir / Salvar PDF</button>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
// GET /eventos/:id/inscritos-excel — download planilha Excel dos inscritos
router.get('/eventos/:id/inscritos-excel', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const [evR, inscrR] = await Promise.all([
      query('SELECT * FROM eventos WHERE id=$1', [req.params.id]),
      query('SELECT i.*, l.nome as lote_nome FROM evento_inscricoes i LEFT JOIN evento_lotes l ON l.id=i.lote_id WHERE i.evento_id=$1 ORDER BY i.nome', [req.params.id])
    ]);
    const ev = evR.rows[0];
    if (!ev) return res.status(404).send('Evento nao encontrado');

    const fStatus = (req.query.status||'').toString();
    const fTipo = (req.query.tipo||'').toString();
    const fBusca = (req.query.busca||'').toString().toLowerCase().trim();

    let inscritos = inscrR.rows.filter(i => {
      const nome = (i.nome||'').toLowerCase();
      const email = (i.email||'').toLowerCase();
      const isento = i.isento ? 'isento' : 'pagante';
      if (fBusca && !nome.includes(fBusca) && !email.includes(fBusca)) return false;
      if (fStatus && i.status !== fStatus) return false;
      if (fTipo && isento !== fTipo) return false;
      return true;
    });

    // Gerar CSV (abre no Excel)
    const BOM = '\uFEFF'; // BOM para UTF-8 no Excel
    const cabecalho = ['#','Nome','Email','WhatsApp','CPF','RG','Instituicao','Lote','Status','Isento','Semestre','Turma','Tipo Participante','Check-in','Inscrito em'];
    const linhas = inscritos.map((i, idx) => [
      idx+1,
      i.nome||'',
      i.email||'',
      i.whatsapp||'',
      i.cpf||'',
      i.rg||'',
      i.instituicao||'',
      i.lote_nome||'',
      i.status||'',
      i.isento ? 'Sim' : 'Nao',
      i.semestre||'',
      i.turma||'',
      i.tipo_participante||'',
      i.checkin_em ? new Date(i.checkin_em).toLocaleString('pt-BR') : '',
      i.criado_em ? new Date(i.criado_em).toLocaleString('pt-BR') : ''
    ].map(v => '"'+String(v).replace(/"/g,'""')+'"').join(';'));

    const csv = BOM + cabecalho.map(h=>'"'+h+'"').join(';') + '\n' + linhas.join('\n');
    const nomeArquivo = ev.nome.replace(/[^a-z0-9]/gi,'_').substring(0,40) + '_inscritos.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + nomeArquivo + '"');
    res.send(csv);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

router.get('/eventos/:id/inscricoes/:iid/cracha', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const [inscR, evR, config] = await Promise.all([
      query('SELECT * FROM evento_inscricoes WHERE id=$1',[req.params.iid]),
      query('SELECT * FROM eventos WHERE id=$1',[req.params.id]),
      getConfig()
    ]);
    const insc=inscR.rows[0]; const ev=evR.rows[0];
    if (!insc||!ev) return res.status(404).send('Nao encontrado');
    const orgLogo=config.org_logo||null;
    const orgNome=config.org_nome||'LAURO';
    const orgCor=ev.cor_tema||config.org_cor||'#1a56db';
    const dataEv=ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}):'';
    const qrUrl='https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='+encodeURIComponent(insc.qrcode||insc.id);
    const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
@page{size:85mm 54mm;margin:0}*{margin:0;padding:0;box-sizing:border-box}body{width:85mm;height:54mm;font-family:Arial,sans-serif;overflow:hidden}
.cracha{width:85mm;height:54mm;position:relative;background:white}
.topo{background:${orgCor};height:14mm;display:flex;align-items:center;padding:0 4mm;gap:3mm}
.topo img{height:10mm;max-width:24mm;object-fit:contain;filter:brightness(0) invert(1)}
.topo-nome{color:white;font-size:9pt;font-weight:700}
.corpo{display:flex;height:34mm;padding:3mm 4mm;gap:3mm;align-items:center}
.info{flex:1;min-width:0}
.nome{font-size:11pt;font-weight:800;color:#111;line-height:1.2;margin-bottom:2mm;word-break:break-word}
.tipo{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:white;background:${orgCor};padding:1mm 3mm;border-radius:3mm;display:inline-block;margin-bottom:2mm}
.ev-nome{font-size:7pt;color:#6b7280;line-height:1.3}
.qr{flex-shrink:0;text-align:center}
.qr img{width:22mm;height:22mm}
.qr-lab{font-size:5pt;color:#9ca3af;margin-top:1mm}
.rodape{background:#f8fafc;height:6mm;display:flex;align-items:center;justify-content:space-between;padding:0 4mm;border-top:.3mm solid #e5e7eb}
.rodape span{font-size:6pt;color:#9ca3af}
</style></head><body>
<div class="cracha">
  <div class="topo">
    ${orgLogo?`<img src="${orgLogo}" alt="${orgNome}">`:`<span class="topo-nome">${orgNome}</span>`}
    <span class="topo-nome">${ev.nome.substring(0,35)}</span>
  </div>
  <div class="corpo">
    <div class="info">
      <div class="nome">${insc.nome}</div>
      <div class="tipo">${insc.tipo_participante||'Participante'}</div>
      <div class="ev-nome">${ev.nome}</div>
      ${dataEv?`<div class="ev-nome" style="margin-top:1mm">${dataEv}</div>`:''}
    </div>
    <div class="qr"><img src="${qrUrl}" alt="QR"><div class="qr-lab">Check-in</div></div>
  </div>
  <div class="rodape"><span>${orgNome}</span><span>${insc.qrcode||''}</span></div>
</div>
<script>window.onload=()=>window.print();</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.get('/eventos/:id/inscricoes/:iid/certificado', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const [inscR, evR, config] = await Promise.all([query('SELECT * FROM evento_inscricoes WHERE id=$1',[req.params.iid]), query('SELECT * FROM eventos WHERE id=$1',[req.params.id]), getConfig()]);
    const insc=inscR.rows[0]; const ev=evR.rows[0];
    const {imagemBase64} = require('../services/desligamento');
    config.timbrado_b64 = await imagemBase64(config.timbrado_chave);
    config.assinatura_presidente_b64 = await imagemBase64(config.assinatura_presidente_chave);
    config.assinatura_secretario_b64 = await imagemBase64(config.assinatura_secretario_chave);
    const dataEv = ev.data_inicio ? new Date(ev.data_inicio).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}) : '';
    const timbrado=config.timbrado_b64||null; const presidenteSrc=config.assinatura_presidente_b64||null; const secretarioSrc=config.assinatura_secretario_b64||null;
    const nomePresidente=(config.presidente_nome||'PRESIDENTE').toUpperCase(); const nomeSecretario=(config.secretario_nome||'SECRETÁRIO').toUpperCase();
    // Gerar codigo_validacao unico
    const crypto = require('crypto');
    const codigoVal = crypto.randomBytes(16).toString('hex');
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';
    const urlValidacao = appUrl + '/certificado/validar/' + codigoVal;
    // QR Code como URL de API publica
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(urlValidacao);
    // Fundo: prioriza bg do evento, depois timbrado global
    const certBgB64 = ev.cert_bg_chave ? await imagemBase64(ev.cert_bg_chave) : null;
    const fundoSrc = certBgB64 || timbrado;
    const bgHtml = fundoSrc?`<div style="position:fixed;top:0;left:0;width:210mm;height:297mm;z-index:0"><img src="${timbrado}" style="width:210mm;height:297mm;display:block"></div>`:'';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;color:#000;width:210mm}</style></head><body>${bgHtml}<div style="position:relative;z-index:1;width:210mm;min-height:297mm;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40mm 25mm;text-align:center"><div style="font-size:11pt;color:#666;margin-bottom:8px;text-transform:uppercase;letter-spacing:3px">Liga Académica de Urología — LAURO</div><div style="font-size:28pt;font-weight:bold;color:#1a3d2b;margin:20px 0;text-transform:uppercase;letter-spacing:2px">Certificado</div><div style="font-size:12pt;margin-bottom:16px">Certificamos que</div><div style="font-size:20pt;font-weight:bold;border-bottom:2px solid #1a3d2b;padding-bottom:8px;margin-bottom:16px">${insc.nome}</div><div style="font-size:12pt;line-height:1.8">participou do evento<br><strong style="font-size:14pt">${ev.nome}</strong><br>realizado em ${dataEv}<br>com carga horária de <strong>4 horas</strong></div><div style="display:flex;justify-content:space-around;margin-top:50px;width:100%"><div style="text-align:center"><div style="height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px">${presidenteSrc?`<img src="${presidenteSrc}" style="max-height:50px">`:''}</div><div style="border-top:1.5px solid #000;width:160px;margin:0 auto 4px"></div><div style="font-size:9pt;font-weight:bold">${nomePresidente}</div><div style="font-size:8pt">PRESIDENTE</div></div><div style="text-align:center"><div style="height:50px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px">${secretarioSrc?`<img src="${secretarioSrc}" style="max-height:50px">`:''}</div><div style="border-top:1.5px solid #000;width:160px;margin:0 auto 4px"></div><div style="font-size:9pt;font-weight:bold">${nomeSecretario}</div><div style="font-size:8pt">SECRETÁRIO</div></div></div></div><script>window.onload=function(){window.print()}</script></body></html>`;
    await query('INSERT INTO evento_certificados (inscricao_id, codigo_validacao) VALUES ($1,$2) ON CONFLICT (inscricao_id) DO UPDATE SET codigo_validacao=EXCLUDED.codigo_validacao RETURNING id',[insc.id, codigoVal]);
    // Enviar por WhatsApp
    if (insc.whatsapp) {
      try {
        const {enviarWhatsApp} = require('../services/notificacoes');
        const config2 = await getConfig();
        const msg = (config2.org_nome||'LAURO')+'\n\nOla, *'+insc.nome.split(' ')[0]+'*!\n\nSeu certificado de participacao no evento *'+ev.nome+'* esta disponivel!\n\nAcesse e valide seu certificado:\n'+urlValidacao;
        await enviarWhatsApp(insc.whatsapp, msg);
        await query('UPDATE evento_certificados SET enviado_wpp=true WHERE inscricao_id=$1',[insc.id]);
      } catch(e) {}
    }
    // Enviar por email
    if (insc.email) {
      try {
        const {enviarEmail} = require('../services/notificacoes');
        const config2 = await getConfig();
        const htmlEmail = '<p>Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>!</p><p>Seu certificado de participacao no evento <strong>'+ev.nome+'</strong> foi emitido com sucesso!</p><div style="text-align:center;margin:24px 0"><img src="'+qrUrl+'" style="width:120px;height:120px"><p style="font-size:12px;color:#6b7280;margin-top:8px">Escaneie o QR Code para validar seu certificado</p></div><div style="text-align:center"><a href="'+urlValidacao+'" style="background:'+(config2.org_cor||'#1a56db')+';color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Validar certificado</a></div>';
        await enviarEmail({para:insc.email, assunto:'Seu certificado — '+ev.nome, html:htmlEmail, texto:'Seu certificado esta disponivel: '+urlValidacao, faixaLabel:'SEU CERTIFICADO'});
        await query('UPDATE evento_certificados SET enviado_email=true WHERE inscricao_id=$1',[insc.id]);
      } catch(e) {}
    }
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.post('/eventos/:id/cert-bg', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const {upload, uploadArquivo} = require('../services/arquivos');
    upload.single('cert_bg')(req, res, async (err) => {
      if (req.file) {
        const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'cert-bg');
        await query('UPDATE eventos SET cert_bg_chave=$1 WHERE id=$2', [r.chave, req.params.id]);
      }
      req.session.msg = ['Fundo salvo!'];
      res.redirect('/eventos/'+req.params.id+'?tab=certificados');
    });
  } catch(e) { res.redirect('/eventos/'+req.params.id+'?tab=certificados'); }
});
router.post('/eventos/:id/cert-bg/remover', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query('UPDATE eventos SET cert_bg_chave=NULL WHERE id=$1', [req.params.id]);
  req.session.msg = ['Fundo removido!'];
  res.redirect('/eventos/'+req.params.id+'?tab=certificados');
});
router.get('/eventos/:id/cert-bg', async (req, res) => {
  try {
    const r = await query('SELECT cert_bg_chave FROM eventos WHERE id=$1', [req.params.id]);
    const chave = r.rows[0]?.cert_bg_chave;
    if (!chave) return res.status(404).send('Sem fundo');
    const {downloadArquivo} = require('../services/arquivos');
    const {buffer, contentType} = await downloadArquivo(chave);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch(e) { res.status(500).send('Erro'); }
});
router.post('/eventos/:id/certificados/emitir-todos', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const inscritos = await query("SELECT id FROM evento_inscricoes WHERE evento_id=$1 AND checkin_em IS NOT NULL",[req.params.id]);
  for (const i of inscritos.rows) { await query('INSERT INTO evento_certificados (inscricao_id) VALUES ($1) ON CONFLICT DO NOTHING',[i.id]); }
  req.session.msg=['Certificados emitidos para '+inscritos.rows.length+' participantes!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/campos', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const {label,tipo,opcoes,obrigatorio} = req.body;
  const ord = await query('SELECT COUNT(*) FROM evento_campos WHERE evento_id=$1',[req.params.id]);
  await query('INSERT INTO evento_campos (evento_id,label,tipo,opcoes,obrigatorio,ordem) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.params.id,label,tipo||'text',opcoes||null,obrigatorio==='true',parseInt(ord.rows[0].count)+1]);
  req.session.msg=['Campo adicionado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/campos/:cid/mover', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const { direcao } = req.body;
  const r = await query('SELECT * FROM evento_campos WHERE id=$1', [req.params.cid]);
  const campo = r.rows[0];
  if (!campo) return res.redirect('/eventos/'+req.params.id+'?tab=campos');
  const ordemAtual = campo.ordem;
  const ordemNova = direcao === 'cima' ? ordemAtual - 1 : ordemAtual + 1;
  const outro = await query('SELECT id FROM evento_campos WHERE evento_id=$1 AND ordem=$2', [req.params.id, ordemNova]);
  if (outro.rows[0]) {
    await query('UPDATE evento_campos SET ordem=$1 WHERE id=$2', [ordemAtual, outro.rows[0].id]);
    await query('UPDATE evento_campos SET ordem=$1 WHERE id=$2', [ordemNova, req.params.cid]);
  }
  res.redirect('/eventos/'+req.params.id+'?tab=campos');
});

router.post('/eventos/:id/campos/:cid/deletar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query('DELETE FROM evento_campos WHERE id=$1',[req.params.cid]);
  req.session.msg=['Campo removido!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/lotes/:lid/editar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const {nome,preco,vagas,data_inicio,data_fim,exige_catraca} = req.body;
  await query('UPDATE evento_lotes SET nome=$1,preco=$2,vagas=$3,data_inicio=$4,data_fim=$5,exige_catraca=$6 WHERE id=$7',
    [nome,parseFloat(preco)||0,parseInt(vagas),data_inicio||null,data_fim||null,exige_catraca==='on',req.params.lid]);
  req.session.msg=['Lote atualizado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/contato-evento/:id', limiterContatoEvento, async (req, res) => {
  try {
    const {nome,email,mensagem} = req.body;
    // resend — nome/email/mensagem vem de quem preenche o formulario publico, sem escape
    // isso virava HTML de verdade dentro do e-mail que a liga recebe (injeção de conteúdo/link).
    await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to:'lauroucpcde@lauroucpcde.com', subject:'Contato via evento — '+escapeHtml(nome), html:'<p><strong>Nome:</strong> '+escapeHtml(nome)+'</p><p><strong>Email:</strong> '+escapeHtml(email)+'</p><p><strong>Mensagem:</strong><br>'+escapeHtml(mensagem)+'</p>' });
    res.send('<script>alert("Mensagem enviada! Entraremos em contato em breve.");history.back();</script>');
  } catch(e) { res.send('<script>alert("Erro ao enviar. Tente novamente.");history.back();</script>'); }
});

router.get('/eventos/:id/cupom', async (req, res) => {
  try {
    const cod = req.query.cod?.toUpperCase();
    if (!cod) return res.json({ok:false});
    const r = await query('SELECT * FROM evento_cupons WHERE evento_id=$1 AND codigo=$2 AND ativo=true',[req.params.id,cod]);
    const cupom = r.rows[0];
    if (!cupom) return res.json({ok:false, msg:'Cupom inválido'});
    if (cupom.usos_atual >= cupom.usos_max) return res.json({ok:false, msg:'Cupom esgotado'});
    const desconto = cupom.tipo==='percentual' ? parseFloat(cupom.valor)/100 : null;
    res.json({ok:true, desconto, tipo:cupom.tipo, valor:cupom.valor});
  } catch(e) { res.json({ok:false}); }
});

router.post('/eventos/:id/avancado', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const {email_inscricao,email_confirmacao,notif_email,wpp_grupo,inscricao_gratuita_auto,inscricao_unica,termos_texto,lgpd_texto} = req.body;
  await query('UPDATE eventos SET email_inscricao=$1,email_confirmacao=$2,wpp_grupo=$3,inscricao_gratuita_auto=$4,inscricao_unica=$5,termos_texto=$6,lgpd_texto=$7 WHERE id=$8',
    [email_inscricao||null,email_confirmacao||null,wpp_grupo||null,inscricao_gratuita_auto==='true',inscricao_unica==='true',termos_texto||null,lgpd_texto||null,req.params.id]);
  // carga_horaria salva via rota /editar
  req.session.msg=['Configurações avançadas salvas!']; res.redirect('/eventos/'+req.params.id+'?tab=avancado');
});

router.post('/eventos/:id/programacao', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const {horario,titulo,descricao,local} = req.body;
  const ord = await query('SELECT COUNT(*) FROM evento_programacao WHERE evento_id=$1',[req.params.id]);
  await query('INSERT INTO evento_programacao (evento_id,horario,titulo,descricao,local,ordem) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.params.id,horario,titulo,descricao||null,local||null,parseInt(ord.rows[0].count)+1]);
  req.session.msg=['Item adicionado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/programacao/:pid/deletar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query('DELETE FROM evento_programacao WHERE id=$1',[req.params.pid]);
  req.session.msg=['Item removido!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/palestrantes', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const {upload,uploadArquivo} = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      const {nome,bio,instituicao} = req.body; let fotoChave=null;
      if (req.file) { const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'palestrantes'); fotoChave=r.chave; }
      const ord = await query('SELECT COUNT(*) FROM evento_palestrantes WHERE evento_id=$1',[req.params.id]);
      await query('INSERT INTO evento_palestrantes (evento_id,nome,bio,instituicao,foto_chave,ordem) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.id,nome,bio||null,instituicao||null,fotoChave,parseInt(ord.rows[0].count)+1]);
      req.session.msg=['Palestrante adicionado!']; res.redirect('/eventos/'+req.params.id);
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id); }
});

router.get('/eventos/palestrantes/:id/foto', async (req, res) => {
  try {
    const r = await query('SELECT foto_chave FROM evento_palestrantes WHERE id=$1',[req.params.id]);
    if (!r.rows[0]?.foto_chave) return res.status(404).send('');
    const {getUrlAssinada} = require('../services/desligamento');
    res.redirect(await getUrlAssinada(r.rows[0].foto_chave));
  } catch(e) { res.status(500).send(''); }
});

router.post('/eventos/:id/palestrantes/:pid/deletar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query('DELETE FROM evento_palestrantes WHERE id=$1',[req.params.pid]);
  req.session.msg=['Palestrante removido!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/palestrantes/:pid/editar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const {upload,uploadArquivo} = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      const {nome,bio,instituicao} = req.body;
      if (req.file) {
        const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'palestrantes');
        await query('UPDATE evento_palestrantes SET nome=$1,bio=$2,instituicao=$3,foto_chave=$4 WHERE id=$5',[nome,bio||null,instituicao||null,r.chave,req.params.pid]);
      } else {
        await query('UPDATE evento_palestrantes SET nome=$1,bio=$2,instituicao=$3 WHERE id=$4',[nome,bio||null,instituicao||null,req.params.pid]);
      }
      req.session.msg=['Palestrante atualizado!']; res.redirect('/eventos/'+req.params.id);
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id); }
});

router.post('/eventos/:id/patrocinadores', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const {upload,uploadArquivo} = require('../services/arquivos');
    upload.single('logo')(req, res, async (err) => {
      const {nome,url} = req.body; let logoChave=null;
      if (req.file) { const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'patrocinadores'); logoChave=r.chave; }
      const ord = await query('SELECT COUNT(*) FROM evento_patrocinadores WHERE evento_id=$1',[req.params.id]);
      await query('INSERT INTO evento_patrocinadores (evento_id,nome,url,logo_chave,ordem) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id,nome,url||null,logoChave,parseInt(ord.rows[0].count)+1]);
      req.session.msg=['Patrocinador adicionado!']; res.redirect('/eventos/'+req.params.id);
    });
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id); }
});

router.get('/eventos/patrocinadores/:id/logo', async (req, res) => {
  try {
    const r = await query('SELECT logo_chave FROM evento_patrocinadores WHERE id=$1',[req.params.id]);
    if (!r.rows[0]?.logo_chave) return res.status(404).send('');
    const {getUrlAssinada} = require('../services/desligamento');
    res.redirect(await getUrlAssinada(r.rows[0].logo_chave));
  } catch(e) { res.status(500).send(''); }
});

router.post('/eventos/:id/patrocinadores/:pid/deletar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query('DELETE FROM evento_patrocinadores WHERE id=$1',[req.params.pid]);
  req.session.msg=['Patrocinador removido!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/cupons', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const {codigo,tipo,valor,usos_max} = req.body;
  try {
    await query('INSERT INTO evento_cupons (evento_id,codigo,tipo,valor,usos_max) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id,codigo.toUpperCase(),tipo||'percentual',parseFloat(valor)||100,parseInt(usos_max)||1]);
    req.session.msg=['Cupom criado!'];
  } catch(e) { req.session.erro=['Código já existe!']; }
  res.redirect('/eventos/'+req.params.id+'?tab=cupons');
});

router.post('/eventos/:id/cupons/:cid/reenviar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
    const eventoR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    const evento = eventoR.rows[0];
    const config = await query('SELECT chave,valor FROM configuracoes').then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
    const orgNome = config.org_nome || 'LAURO';
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';

    const cupR = await query('SELECT * FROM evento_cupons WHERE id=$1 AND evento_id=$2', [req.params.cid, req.params.id]);
    const cupom = cupR.rows[0];
    if (!cupom) { req.session.erro=['Cupom não encontrado.']; return res.redirect('/eventos/'+req.params.id+'?tab=cupons'); }

    let pessoa = null;
    if (cupom.ligante_id) {
      const r = await query('SELECT nome,email,whatsapp FROM ligantes WHERE id=$1', [cupom.ligante_id]);
      pessoa = r.rows[0];
    } else if (cupom.diretivo_id) {
      const r = await query('SELECT nome,email,whatsapp FROM diretivos WHERE id=$1', [cupom.diretivo_id]);
      pessoa = r.rows[0];
    }
    if (!pessoa) { req.session.erro=['Este cupom não tem pessoa vinculada para reenvio.']; return res.redirect('/eventos/'+req.params.id+'?tab=cupons'); }

    const codigoFinal = cupom.codigo;
    const msg = `💚💙 *${orgNome}* 💚💙\n\nOlá, *${pessoa.nome.split(' ')[0]}*! 🎉\n\nVocê tem um *cupom de isenção 100%* 🎫 para o evento:\n*${evento.nome}*\n\n🎟️ Seu cupom: *${codigoFinal}*\n\n👉 Inscreva-se pelo link abaixo (o cupom já vem aplicado, é só finalizar):\n${appUrl}/inscricao/${req.params.id}?cupom=${encodeURIComponent(codigoFinal)}\n\n_Cupom válido para uma inscrição._ ✨`;
    let okWpp=false, okEmail=false;
    if (pessoa.whatsapp) { try { await enviarWhatsApp(pessoa.whatsapp, msg, { urgente: true }); okWpp=true; } catch(e) {} }
    if (pessoa.email) {
      const html = (function(){var cor='#1a3d2b';var pn=pessoa.nome.split(' ')[0];var linkCupom=appUrl+'/inscricao/'+req.params.id+'?cupom='+encodeURIComponent(codigoFinal);return '<div style="border-left:3px solid '+cor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+cor+';letter-spacing:1.5px;text-transform:uppercase">Tu invitaci&oacute;n gratuita</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">'+evento.nome+'</h2></div>'+'<p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">&iexcl;Hola, <strong>'+pn+'</strong>! Tienes un <strong>cup&oacute;n de exenci&oacute;n 100%</strong> para participar gratuitamente en este evento.</p>'+'<div style="text-align:center;margin:24px 0;padding:24px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Tu c&oacute;digo de cup&oacute;n</p><div style="font-size:30px;font-weight:900;font-family:monospace;color:'+cor+';letter-spacing:4px">'+codigoFinal+'</div><p style="margin:12px 0 0;font-size:12px;color:'+cor+';font-weight:700">&#128203; Copiar cup&oacute;n</p><p style="margin:4px 0 0;font-size:11px;color:#94a3b8">V&aacute;lido para 1 inscripci&oacute;n</p></div>'+'<div style="text-align:center;padding-top:8px"><a href="'+linkCupom+'" style="display:inline-block;background:'+cor+';color:white;padding:13px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Inscribirme con el cup&oacute;n aplicado</a></div>';})();
      try { await enviarEmail({ para: pessoa.email, assunto: `🎟️ Seu cupom gratuito — ${evento.nome}`, html, texto: msg, faixaLabel: 'CUPOM GRATUITO' }); okEmail=true; } catch(e) {}
    }
    const canais = [okWpp?'WhatsApp':null, okEmail?'email':null].filter(Boolean).join(' e ');
    req.session.msg=[canais ? `Cupom reenviado para ${pessoa.nome} via ${canais}.` : `Não foi possível reenviar (pessoa sem WhatsApp/email).`];
    res.redirect('/eventos/'+req.params.id+'?tab=cupons');
  } catch(e) { req.session.erro=[e.message]; res.redirect('/eventos/'+req.params.id+'?tab=cupons'); }
});

router.post('/eventos/:id/cupons/:cid/deletar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query('DELETE FROM evento_cupons WHERE id=$1',[req.params.cid]);
  req.session.msg=['Cupom excluído!']; res.redirect('/eventos/'+req.params.id);
});

// Contagem simples pra tela de cupons perceber sozinha quando a geração em segundo plano
// (abaixo) termina, sem precisar a pessoa apertar F5.
router.get('/eventos/:id/cupons/contagem', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const r = await query('SELECT COUNT(*) AS n FROM evento_cupons WHERE evento_id=$1', [req.params.id]);
  res.json({ total: parseInt(r.rows[0].n) || 0 });
});

// Gerar cupons em lote para ligantes EM DIA e diretivos com envio via WhatsApp/email
router.post('/eventos/:id/cupons/gerar-ligantes', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const { prefixo, destino, enviar_wpp, enviar_email } = req.body;
  const pref = (prefixo||'LAURO').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const eventoId = req.params.id;

  let pessoas = [];

  // Ligantes "em dia" pra fim de cupom: até 1 mensalidade atrasada tudo bem, 2+ não recebe.
  // Ligante não tem cobrança/mensalidade própria — o vínculo com o financeiro (tabela
  // membros/cobrancas) é por CPF ou e-mail, mesmo padrão já usado em ligantes.js pra
  // sincronizar status entre as duas tabelas.
  if (destino === 'ligantes' || destino === 'todos') {
    const ligR = await query(`SELECT id, nome, email, whatsapp, cpf, 'ligante' as tipo FROM ligantes WHERE ativo=1`);
    for (const lig of ligR.rows) {
      const atrasoR = await query(
        `SELECT COUNT(*) as n FROM cobrancas c JOIN membros m ON m.id = c.membro_id
         WHERE c.status='atrasado' AND (
           ($1 <> '' AND m.cpf IS NOT NULL AND regexp_replace(m.cpf,'[^0-9]','','g') = regexp_replace($1,'[^0-9]','','g'))
           OR ($2 <> '' AND m.email IS NOT NULL AND LOWER(m.email) = LOWER($2))
         )`,
        [lig.cpf || '', lig.email || '']
      );
      const atrasos = parseInt(atrasoR.rows[0].n) || 0;
      if (atrasos <= 1) pessoas.push(lig);
    }
  }

  // Diretivos — todos (não pagam mensalidade)
  if (destino === 'diretivos' || destino === 'todos') {
    const dirR = await query('SELECT id, nome, email, whatsapp, \'diretivo\' as tipo FROM diretivos WHERE ativo=1');
    dirR.rows.forEach(d => pessoas.push(d));
  }

  // Responde na hora e processa (cupom + WhatsApp/email de cada pessoa) depois — com 48+
  // pessoas, esperar cada envio sequencialmente já estourou o tempo da requisição (502).
  req.session.msg = [`Gerando cupons para ${pessoas.length} pessoa(s) em segundo plano — os envios saem aos poucos, atualize a página em alguns minutos pra ver o resultado.`];
  res.redirect('/eventos/'+eventoId+'?tab=cupons');

  processarGeracaoCupons(eventoId, pessoas, pref, enviar_wpp, enviar_email)
    .catch(e => console.error('[CUPONS] geração em segundo plano ERRO:', e.message));
});

async function processarGeracaoCupons(eventoId, pessoas, pref, enviar_wpp, enviar_email) {
  const eventoR = await query('SELECT * FROM eventos WHERE id=$1', [eventoId]);
  const evento = eventoR.rows[0];
  const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
  const config = await query('SELECT chave,valor FROM configuracoes').then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
  const orgNome = config.org_nome || 'LAURO';
  const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';

  let criados = 0, enviados = 0;

  for (const p of pessoas) {
    const campo_pessoa = p.tipo === 'ligante' ? 'ligante_id' : 'diretivo_id';
    let codigoFinal;

    try {
      const existenteR = await query('SELECT codigo FROM evento_cupons WHERE evento_id=$1 AND '+campo_pessoa+'=$2', [eventoId, p.id]);
      if (existenteR.rows.length > 0) {
        codigoFinal = existenteR.rows[0].codigo;
      } else {
        // Gera sufixo sem caracteres ambíguos (sem 0,O,1,I,L,8,B,5,S,2,Z)
        const _chars = 'ACDEFGHJKMNPQRTUVWXY3467';
        let sufixo = '';
        for (let _i = 0; _i < 6; _i++) sufixo += _chars[Math.floor(Math.random() * _chars.length)];
        codigoFinal = pref + '-' + sufixo;
        // ON CONFLICT no índice parcial (evento_id,ligante_id)/(evento_id,diretivo_id):
        // se duas execuções concorrentes chegarem aqui pra mesma pessoa, só uma insere — a
        // outra não erra, só não retorna linha, e busca embaixo o código que a primeira criou.
        // Foi a falta disso que gerou cupom duplicado de verdade em produção (11/08/2026).
        const insR = await query(
          `INSERT INTO evento_cupons (evento_id,codigo,tipo,valor,usos_max,${campo_pessoa})
           VALUES ($1,$2,'percentual',100,1,$3)
           ON CONFLICT (evento_id,${campo_pessoa}) WHERE ${campo_pessoa} IS NOT NULL DO NOTHING
           RETURNING codigo`,
          [eventoId, codigoFinal, p.id]
        );
        if (insR.rows.length === 0) {
          const rebuscaR = await query('SELECT codigo FROM evento_cupons WHERE evento_id=$1 AND '+campo_pessoa+'=$2', [eventoId, p.id]);
          codigoFinal = rebuscaR.rows[0].codigo;
        }
      }
      criados++;

      const msg = `💚💙 *${orgNome}* 💚💙\n\nOlá, *${p.nome.split(' ')[0]}*! 🎉\n\nVocê tem um *cupom de isenção 100%* 🎫 para o evento:\n*${evento.nome}*\n\n🎟️ Seu cupom: *${codigoFinal}*\n\n👉 Inscreva-se pelo link abaixo (o cupom já vem aplicado, é só finalizar):\n${appUrl}/inscricao/${eventoId}?cupom=${encodeURIComponent(codigoFinal)}\n\n_Cupom válido para uma inscrição._ ✨`;

      if (enviar_wpp === 'on' && p.whatsapp) {
        try { await enviarWhatsApp(p.whatsapp, msg); enviados++; } catch(e) {}
      }
      if (enviar_email === 'on' && p.email) {
        const html = (function(){var cor='#1a3d2b';var pn=p.nome.split(' ')[0];var linkCupom=appUrl+'/inscricao/'+eventoId+'?cupom='+encodeURIComponent(codigoFinal);return '<div style="border-left:3px solid '+cor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+cor+';letter-spacing:1.5px;text-transform:uppercase">Tu invitaci&oacute;n gratuita</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">'+evento.nome+'</h2></div>'+'<p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">&iexcl;Hola, <strong>'+pn+'</strong>! Tienes un <strong>cup&oacute;n de exenci&oacute;n 100%</strong> para participar gratuitamente en este evento.</p>'+'<div style="text-align:center;margin:24px 0;padding:24px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Tu c&oacute;digo de cup&oacute;n</p><div style="font-size:30px;font-weight:900;font-family:monospace;color:'+cor+';letter-spacing:4px">'+codigoFinal+'</div><p style="margin:12px 0 0;font-size:12px;color:'+cor+';font-weight:700">&#128203; Copiar cup&oacute;n</p><p style="margin:4px 0 0;font-size:11px;color:#94a3b8">V&aacute;lido para 1 inscripci&oacute;n</p></div>'+'<div style="text-align:center;padding-top:8px"><a href="'+linkCupom+'" style="display:inline-block;background:'+cor+';color:white;padding:13px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Inscribirme con el cup&oacute;n aplicado</a></div>';})();
        try { await enviarEmail({ para: p.email, assunto: `🎟️ Seu cupom gratuito — ${evento.nome}`, html, texto: msg, faixaLabel: 'CUPOM GRATUITO' }); } catch(e) {}
      }
    } catch(e) { console.error('[CUPONS] pessoa ' + p.id + ' (' + p.tipo + ') erro:', e.message); }
  }

  console.log(`[CUPONS] Geração concluída — evento ${eventoId}: ${criados} cupons, ${enviados} notificações enviadas.`);
}

// ─── EDITAR INSCRITO ──────────────────────────────────────────────────────────
router.post('/eventos/:id/inscricoes/:iid/editar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const { nome, email, whatsapp, cpf, instituicao, status, rg, semestre, turma, catraca, tipo_participante, lote_id, cupom_codigo, isento } = req.body;
  await query(
    'UPDATE evento_inscricoes SET nome=$1, email=$2, whatsapp=$3, cpf=$4, instituicao=$5, status=$6, rg=$7, semestre=$8, turma=$9, catraca=$10, tipo_participante=$11, lote_id=$12, cupom_codigo=$13, isento=$14 WHERE id=$15',
    [nome, email, whatsapp||null, cpf||null, instituicao||null, status, rg||null, semestre||null, turma||null, catraca||null, tipo_participante||'externo', lote_id||null, cupom_codigo||null, isento==='true', req.params.iid]
  );
  req.session.msg=['Inscrito atualizado!'];
  res.redirect('/eventos/'+req.params.id+'?tab=inscritos');
});

// ─── EMAIL EM MASSA PARA INSCRITOS ────────────────────────────────────────────
router.post('/eventos/:id/campos/ordem', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const { campos } = req.body;
    const lista = JSON.parse(campos);
    for (let i = 0; i < lista.length; i++) {
      await query(
        'INSERT INTO evento_campos_ordem (evento_id, campo, ordem) VALUES ($1,$2,$3) ON CONFLICT (evento_id,campo) DO UPDATE SET ordem=$3',
        [req.params.id, lista[i], i + 1]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, msg: e.message }); }
});

router.get('/eventos/:id/mala-direta/historico', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const r = await query(
      'SELECT e.*, u.nome as enviado_por_nome FROM mala_direta_envios e LEFT JOIN usuarios u ON u.id=e.enviado_por WHERE e.evento_id=$1 ORDER BY e.criado_em DESC',
      [req.params.id]
    );
    res.json({ ok: true, envios: r.rows });
  } catch(e) { res.json({ ok: false }); }
});

router.get('/eventos/:id/mala-direta/:envio_id/logs', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM mala_direta_logs WHERE envio_id=$1 ORDER BY criado_em',
      [req.params.envio_id]
    );
    res.json({ ok: true, logs: r.rows });
  } catch(e) { res.json({ ok: false }); }
});

router.post('/eventos/:id/mala-direta', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const { assunto, conteudo_html, destinatarios } = req.body;
  try {
    const config = await getConfig();
    // resend
    let where = "WHERE evento_id=$1 AND email IS NOT NULL";
    const params = [req.params.id];
    if (destinatarios === 'confirmados') where += " AND status='confirmado'";
    else if (destinatarios === 'pendentes') where += " AND status='pendente'";
    const r = await query('SELECT * FROM evento_inscricoes '+where, params);
    const envioR = await query(
      'INSERT INTO mala_direta_envios (evento_id,assunto,conteudo_html,destinatarios,enviado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.params.id, assunto, conteudo_html, destinatarios, req.session.usuario.id]
    );
    const envioId = envioR.rows[0].id;
    let enviados = 0, erros = 0;
    for (const insc of r.rows) {
      const conteudo = conteudo_html.replace(/\{nome\}/g, insc.nome.split(' ')[0]);
      const html = '<p style="margin:0 0 20px;font-size:16px">Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>!</p>'
        +conteudo;
      let status = 'enviado';
      try {
        await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to: insc.email, subject: assunto, html, faixaLabel: 'COMUNICADO' });
        enviados++;
        await new Promise(r => setTimeout(r, 200));
      } catch(e) { status = 'erro'; erros++; }
      await query('INSERT INTO mala_direta_logs (envio_id,inscricao_id,email,nome,status) VALUES ($1,$2,$3,$4,$5)',
        [envioId, insc.id, insc.email, insc.nome, status]);
    }
    await query('UPDATE mala_direta_envios SET total_enviados=$1,total_erros=$2 WHERE id=$3',[enviados,erros,envioId]);
    req.flash('msg', 'Email enviado para '+enviados+' inscritos!');
  } catch(e) { req.flash('erro','Erro: '+e.message); }
  res.redirect('/eventos/'+req.params.id+'?tab=mala-direta');
});

router.post('/eventos/:id/mala-direta', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const { assunto, conteudo_html, destinatarios } = req.body;
  try {
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    const ev = evR.rows[0];
    const config = await getConfig();
    // resend
    let where = "WHERE evento_id=$1 AND email IS NOT NULL";
    const params = [req.params.id];
    if (destinatarios === 'confirmados') where += " AND status='confirmado'";
    else if (destinatarios === 'pendentes') where += " AND status='pendente'";
    const r = await query('SELECT * FROM evento_inscricoes '+where, params);
    let enviados = 0;
    for (const insc of r.rows) {
      const html = '<p style="margin:0 0 16px">Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>!</p>'
        +conteudo_html;
      try { await enviarEmail({from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>',to:insc.email,subject:assunto,html, faixaLabel: 'COMUNICADO'}); enviados++; await new Promise(r=>setTimeout(r,200)); } catch(e){}
    }
    req.flash('msg', 'Email enviado para '+enviados+' inscritos!');
  } catch(e) { req.flash('erro', 'Erro: '+e.message); }
  res.redirect('/eventos/'+req.params.id+'?tab=mala-direta');
});

router.post('/eventos/:id/email-massa', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const { assunto, mensagem, apenas_confirmados } = req.body;
  try {
    let sql = 'SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND email IS NOT NULL';
    if (apenas_confirmados === 'on') sql += " AND status='confirmado'";
    const r = await query(sql, [req.params.id]);
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    const evento = evR.rows[0];
    const config = await query('SELECT chave,valor FROM configuracoes').then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
    // resend
    let enviados = 0;
    for (const insc of r.rows) {
      const html = `<p style="color:#555;margin-bottom:20px">Olá, <strong>${insc.nome.split(' ')[0]}</strong>!</p>
            <div style="color:#374151;line-height:1.7">${mensagem.replace(/\n/g,'<br>')}</div>
            <p style="font-size:12px;color:#9ca3af;margin-top:24px;padding-top:16px;border-top:1px solid #f3f4f6">${config.org_nome||'LAURO'} · Dúvidas? Responda este e-mail.</p>`;
      try {
        await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to:insc.email, subject:assunto, html, faixaLabel: 'COMUNICADO' });
        enviados++;
        await new Promise(r=>setTimeout(r,300));
      } catch(e) { console.error('Email massa erro:', insc.email, e.message); }
    }
    req.session.msg=[`Email enviado para ${enviados} inscritos!`];
  } catch(e) {
    req.session.erro=['Erro: '+e.message];
  }
  res.redirect('/eventos/'+req.params.id+'?tab=inscritos');
});

// ─── SALVAR LGPD NO EVENTO (via avançado) ────────────────────────────────────
// Já coberto pela rota /eventos/:id/avancado existente — lgpd_texto salvo junto


// ─── LIVE / PRESENÇAS ONLINE / CERTIFICADO / AVALIAÇÃO / LISTA DE ESPERA ────
router.get('/live/:token', async (req, res) => {
  try {
    const r = await query('SELECT epo.*, i.nome, i.email, e.nome as evento_nome, e.youtube_url, e.duracao_minutos FROM evento_presencas_online epo JOIN evento_inscricoes i ON i.id=epo.inscricao_id JOIN eventos e ON e.id=epo.evento_id WHERE epo.token=$1',[req.params.token]);
    if (!r.rows[0]) return res.status(404).send('Link invalido ou expirado.');
    const p = r.rows[0];
    if (!p.primeiro_acesso) { await query("UPDATE evento_presencas_online SET primeiro_acesso=NOW(),ativo=true WHERE token=$1",[req.params.token]); }
    else { await query("UPDATE evento_presencas_online SET ativo=true,ultimo_ping=NOW() WHERE token=$1",[req.params.token]); }
    const config = await getConfig();
    const patrocR = await query('SELECT * FROM evento_patrocinadores WHERE evento_id=$1 ORDER BY id', [p.evento_id]);
    res.render('pages/evento-live', { token: req.params.token, presenca: p, config, patrocinadores: patrocR.rows });
  } catch(e) { console.error('GET /live:', e.message); res.status(500).send('Erro ao carregar transmissão.'); }
});
router.post('/live/:token/ping', async (req, res) => {
  try {
    const rp = await query("UPDATE evento_presencas_online SET ultimo_ping=NOW(),ativo=true,tempo_total_segundos=tempo_total_segundos+120 WHERE token=$1 RETURNING tempo_total_segundos,ultimo_ping",[req.params.token]);
    const total = rp.rows[0]?.tempo_total_segundos || 0;
    const ult = rp.rows[0]?.ultimo_ping;
    res.json({ok:true, total, ultimoPing: ult});
  } catch(e) { res.json({ok:false}); }
});
router.post('/live/:token/sair', async (req, res) => {
  try {
    await query("UPDATE evento_presencas_online SET ativo=false WHERE token=$1",[req.params.token]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false}); }
});
router.post('/eventos/:id/enviar-link-live', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const crypto = require('crypto');
    const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
    const config = await getConfig();
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.json({ok:false,msg:'Evento nao encontrado'});
    const inscrR = await query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado'",[req.params.id]);
    let enviados = 0;
    for (const insc of inscrR.rows) {
      let token = crypto.randomBytes(24).toString('hex');
      const existe = await query('SELECT token FROM evento_presencas_online WHERE inscricao_id=$1 AND evento_id=$2',[insc.id,ev.id]);
      if (existe.rows.length > 0) { token = existe.rows[0].token; }
      else { await query('INSERT INTO evento_presencas_online (inscricao_id,evento_id,token) VALUES ($1,$2,$3)',[insc.id,ev.id,token]); }
      const link = appUrl+'/live/'+token;
      const msg = (config.org_nome||'LAURO')+'\n\nOla, '+insc.nome.split(' ')[0]+'!\n\nSeu link de acesso ao evento '+ev.nome+':\n\n'+link+'\n\nAcesse para assistir e registrar sua presenca automaticamente.';
      if (insc.whatsapp) { try { await enviarWhatsApp(insc.whatsapp,msg); enviados++; } catch(e){} }
      if (insc.email) {
        const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px"><h2>'+ev.nome+'</h2><p>Ola, <strong>'+insc.nome.split(' ')[0]+'</strong>!</p><p>Clique para assistir e ter sua presenca registrada:</p><div style="text-align:center;margin:24px 0"><a href="'+link+'" style="background:#1a56db;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700">Assistir ao evento</a></div><p style="font-size:12px;color:#6b7280">Link exclusivo — nao compartilhe.</p></div>';
        try { await enviarEmail({para:insc.email,assunto:'Seu link de acesso — '+ev.nome,html,texto:msg}); } catch(e){}
      }
    }
    res.json({ok:true,msg:enviados+' links enviados!'});
  } catch(e) { res.json({ok:false,msg:e.message}); }
});
router.get('/eventos/:id/presencas', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const config = await getConfig();
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.redirect('/eventos');
    const inscrR = await query(
      `SELECT i.*,
        COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(saida_em,NOW())-entrada_em))) FROM evento_presencas_tempo WHERE inscricao_id=i.id),0) as segundos_presencial,
        COALESCE((SELECT tempo_total_segundos FROM evento_presencas_online WHERE inscricao_id=i.id AND evento_id=$1),0) as segundos_online
       FROM evento_inscricoes i WHERE i.evento_id=$1 AND i.status='confirmado' ORDER BY i.nome`,
      [ev.id]
    );
    const duracaoSeg = (ev.duracao_minutos||0)*60;
    res.render('pages/evento-presencas',{config,evento:ev,inscricoes:inscrR.rows,duracaoSeg,usuario:req.session.usuario,msg:req.flash('msg')});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});
router.get('/eventos/:id/presencas-pdf', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const config = await getConfig();
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.status(404).send('Evento nao encontrado');
    const inscrR = await query(
      `SELECT i.*,
        COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(saida_em,NOW())-entrada_em))) FROM evento_presencas_tempo WHERE inscricao_id=i.id),0) as segundos_presencial,
        COALESCE((SELECT tempo_total_segundos FROM evento_presencas_online WHERE inscricao_id=i.id AND evento_id=$1),0) as segundos_online
       FROM evento_inscricoes i WHERE i.evento_id=$1 AND i.status='confirmado' ORDER BY i.nome`,
      [ev.id]
    );
    const inscricoes = inscrR.rows;
    const duracaoSeg = (ev.duracao_minutos||0)*60;
    const orgNome = config.org_nome||'LAURO';
    const orgLogo = config.org_logo||null;
    const tipoEv = ev.tipo_evento||'presencial';
    const dataEv = ev.data_inicio?new Date(ev.data_inicio).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):'';
    const fmtDur = (seg)=>{ const m=Math.floor(seg/60); const h=Math.floor(m/60); const mm=m%60; return h>0?(h+'h '+mm+'min'):(mm+'min'); };
    let aptos=0, risco=0, naoApt=0;
    const linhas = inscricoes.map((i,idx)=>{
      const segP=Number(i.segundos_presencial||0), segO=Number(i.segundos_online||0);
      const seg=Math.max(segP,segO);
      const tipo = segP>segO ? 'presencial' : segO>segP ? 'online' : (tipoEv==='hibrido'?'':tipoEv);
      const tipoLabel = tipo==='presencial'?'Presencial':tipo==='online'?'Online':'—';
      const pct = duracaoSeg>0 ? Math.min(100, Math.round(seg/duracaoSeg*100)) : 0;
      let stTxt, stBg, stCo;
      if (pct>=75){ stTxt='Apto'; stBg='#EDF6F1'; stCo='#23704F'; aptos++; }
      else if (pct>=50){ stTxt='Em risco'; stBg='#FBF3E0'; stCo='#C98A1E'; risco++; }
      else { stTxt='Não apto'; stBg='#FBE9E7'; stCo='#C0392B'; naoApt++; }
      const corPct = pct>=75?'#23704F':pct>=50?'#C98A1E':'#C0392B';
      return `<tr style="background:${idx%2===0?'#F6F8F5':'#ffffff'}"><td style="padding:7px 10px;font-size:10.5px;color:#74837C">${idx+1}</td><td style="padding:7px 10px;font-size:11px;font-weight:600;color:#10201A">${i.nome}<div style="font-size:9px;color:#74837C;font-weight:400">${i.email||''}</div></td><td style="padding:7px 10px;text-align:center"><span style="font-family:'IBM Plex Mono';font-size:9px;color:#3A4A43;border:1px solid #CDD4CE;padding:2px 7px">${tipoLabel}</span></td><td style="padding:7px 10px;font-size:10.5px;text-align:center;color:#3A4A43">${seg>0?fmtDur(seg):'—'}</td><td style="padding:7px 10px;text-align:center;font-family:'Archivo';font-weight:700;font-size:11px;color:${corPct}">${pct}%</td><td style="padding:7px 10px;text-align:center"><span style="background:${stBg};color:${stCo};padding:2px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${stTxt}</span></td></tr>`;
    }).join('');
    const minPct = 75;
    const minSeg = Math.round(duracaoSeg*minPct/100);
    const estilos=`*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:0}body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#10201A;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{.np{display:none}}.wrap{max-width:820px;margin:0 auto}.header{background:linear-gradient(135deg,#103024,#0C231B);padding:26px 34px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:14px}.logo-chip{width:54px;height:54px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.logo-chip img{width:54px;height:54px;object-fit:cover;border-radius:50%}.org{font-family:'Archivo';font-weight:800;font-size:15px;letter-spacing:.3px;line-height:1.15}.org small{display:block;font-family:'IBM Plex Mono';font-size:8.5px;letter-spacing:2px;color:#37C98B;text-transform:uppercase;margin-top:4px;font-weight:500}.ev{text-align:right}.ev .nm{font-family:'Archivo';font-size:18px;font-weight:800;line-height:1.15}.ev .dt{font-size:11.5px;color:#A9C2B6;margin-top:5px;text-transform:capitalize}.ev .lc{font-size:10.5px;color:#7E988B;margin-top:1px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 34px;background:#F2F4F0;border-bottom:1px solid #E2E6E1}.stat{background:#fff;border:1px solid #E2E6E1;padding:13px 14px;position:relative;overflow:hidden}.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--bar,#2FA873)}.stat .n{font-family:'Archivo';font-size:21px;font-weight:800;letter-spacing:-.5px;color:var(--c,#15402F)}.stat .l{font-family:'IBM Plex Mono';font-size:8.5px;color:#74837C;font-weight:500;text-transform:uppercase;letter-spacing:1px;margin-top:4px}.section{padding:20px 34px}.sec-title{font-family:'Archivo';font-size:13px;font-weight:800;letter-spacing:.2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:7px;border-bottom:2px solid #2FA873;color:#10201A}.dur{display:flex;gap:40px;border:1px solid #E2E6E1;padding:16px 20px}.dur .l{font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px}.dur .v{font-family:'Archivo';font-size:16px;font-weight:800;color:#15402F}table{width:100%;border-collapse:collapse;border:1px solid #E2E6E1}thead{display:table-header-group}thead th{background:#15402F;color:#fff;padding:9px 10px;font-family:'IBM Plex Mono';font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:1px;font-weight:600}tbody td{border-bottom:1px solid #EDEFEC}tbody tr{page-break-inside:avoid}.foot{padding:16px 34px;border-top:1px solid #E2E6E1;font-family:'IBM Plex Mono';font-size:9px;color:#74837C;text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;gap:12px}.btn-p{position:fixed;bottom:22px;right:22px;padding:12px 22px;background:#2FA873;color:#0C231B;border:none;cursor:pointer;font-family:'IBM Plex Sans';font-size:13px;font-weight:700;box-shadow:0 8px 24px -8px rgba(47,168,115,.8)}@media print{@page{margin:14mm 0 12mm}@page :first{margin:0 0 12mm}}`;
    const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"><style>${estilos}</style></head><body>
<div class="wrap">
  <div class="header"><div class="brand">${orgLogo?`<div class="logo-chip"><img src="${orgLogo}" alt=""></div>`:''}<div class="org">${orgNome}<small>Relatório de Presenças</small></div></div><div class="ev"><div class="nm">${ev.nome}</div><div class="dt">${dataEv}</div><div class="lc">${ev.local||''}</div></div></div>
  <div class="stats">
    <div class="stat" style="--bar:#2FA873;--c:#15402F"><div class="n">${inscricoes.length}</div><div class="l">Total confirmados</div></div>
    <div class="stat" style="--bar:#2FA873;--c:#23704F"><div class="n">${aptos}</div><div class="l">Aptos (≥75%)</div></div>
    <div class="stat" style="--bar:#C98A1E;--c:#C98A1E"><div class="n">${risco}</div><div class="l">Em risco (50–74%)</div></div>
    <div class="stat" style="--bar:#C0392B;--c:#C0392B"><div class="n">${naoApt}</div><div class="l">Não aptos (&lt;50%)</div></div>
  </div>
  <div class="section"><div class="dur"><div><div class="l">Duração total do evento</div><div class="v">${duracaoSeg>0?fmtDur(duracaoSeg):'Não definida'}</div></div><div><div class="l">Mínimo para certificado</div><div class="v" style="color:#23704F">${minPct}% — ${duracaoSeg>0?fmtDur(minSeg):'—'}</div></div></div></div>
  <div class="section"><div class="sec-title">Lista de presenças (${inscricoes.length})</div>
    <table><thead><tr><th style="width:34px">#</th><th>Participante</th><th style="text-align:center;width:78px">Tipo</th><th style="text-align:center;width:90px">Tempo assistido</th><th style="text-align:center;width:64px">% Presença</th><th style="text-align:center;width:80px">Status</th></tr></thead><tbody>${linhas}</tbody></table>
  </div>
  <div class="foot"><span>${orgNome} · Gerado em ${new Date().toLocaleString('pt-BR')}</span><span>${ev.nome}</span></div>
</div>
<button class="btn-p np" onclick="window.print()">Imprimir / Salvar PDF</button>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.get('/certificado/validar/:codigo', async (req, res) => {
  try {
    const r = await query(
      `SELECT ec.*, ei.nome, ei.email, e.nome as evento_nome, e.data_inicio
       FROM evento_certificados ec
       JOIN evento_inscricoes ei ON ei.id=ec.inscricao_id
       JOIN eventos e ON e.id=ei.evento_id
       WHERE ec.codigo_validacao=$1`,
      [req.params.codigo]
    );
    const cert = r.rows[0];
    const config = await getConfig();
    const orgNome = config.org_nome || 'LAURO';
    const orgLogo = config.org_logo || null;
    const orgCor = config.org_cor || '#2b6803';
    const logoHtml = orgLogo
      ? `<div class="logoring"><img src="${orgLogo}" alt="${orgNome}"></div>`
      : `<div style="font-size:22px;font-weight:800;letter-spacing:-.5px;color:${orgCor}">${orgNome}</div>`;
    const baseCss = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Sora',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#eef1ee;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;color:#1a2e1a}.wrap{width:100%;max-width:520px}.card{background:#fff;border:1px solid #dde3dd;border-top:4px solid var(--ac);box-shadow:0 12px 40px rgba(20,40,20,.09)}.logo{padding:28px 32px 22px;text-align:center;border-bottom:1px solid #e7eee4;background:linear-gradient(180deg,#ffffff,#f4f8f1)}.logoring{width:88px;height:88px;border-radius:50%;margin:0 auto;background:#fff;border:2px solid var(--green);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 5px rgba(43,104,3,.08)}.logoring img{width:76px;height:76px;border-radius:50%;object-fit:contain}.cbody{padding:34px 32px}.badge{width:62px;height:62px;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--ac);margin:0 auto 18px}h1{font-size:21px;font-weight:700;text-align:center;margin-bottom:8px;letter-spacing:-.3px}.sub{text-align:center;color:#5a6b5a;font-size:14px;line-height:1.55;max-width:380px;margin:0 auto}.rows{margin-top:26px;border:1px solid #e4e9e4;border-left:3px solid var(--green)}.row{display:flex;padding:13px 16px;border-bottom:1px solid #eef1ee;font-size:14px;gap:14px;transition:background .15s}.row:last-child{border-bottom:0}.row:hover{background:#f3f8f1}.row .k{flex:0 0 118px;color:#6f8566;font-size:11px;text-transform:uppercase;letter-spacing:.7px;font-weight:600;padding-top:2px}.row .v{flex:1;font-weight:600;color:#1a2e1a;word-break:break-word}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:var(--green)}.foot{display:flex;align-items:center;justify-content:center;gap:7px;padding:14px;background:#1a4f10;font-size:12px;font-weight:500;color:rgba(255,255,255,.95);letter-spacing:.2px}.foot svg{color:#fff}`;
    const head = (titulo, accent) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet"><style>:root{--ac:${accent};--green:${orgCor}}${baseCss}</style></head><body><div class="wrap"><div class="card"><div class="logo">${logoHtml}</div>`;
    const foot = `<div class="foot"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="1"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Verificación de autenticidad · ${orgNome}</div></div></div></body></html>`;
    if (!cert) {
      const iconX = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      return res.send(`${head('Certificado inválido', '#c0392b')}<div class="cbody"><div class="badge">${iconX}</div><h1>Certificado no encontrado</h1><p class="sub">El código ingresado no corresponde a ningún certificado emitido por ${orgNome}. Verifique que lo haya escrito correctamente.</p></div>${foot}`);
    }
    const dt = cert.data_inicio ? new Date(cert.data_inicio).toLocaleDateString('es-PY', {day:'2-digit',month:'long',year:'numeric'}) : '\u2014';
    const emitidoEm = cert.emitido_em ? new Date(cert.emitido_em).toLocaleDateString('es-PY') : '\u2014';
    const iconCheck = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    res.send(`${head('Certificado válido', orgCor)}<div class="cbody"><div class="badge">${iconCheck}</div><h1>Certificado válido</h1><p class="sub">Documento auténtico, emitido y verificado por ${orgNome}.</p><div class="rows"><div class="row"><div class="k">Participante</div><div class="v">${cert.nome}</div></div><div class="row"><div class="k">Evento</div><div class="v">${cert.evento_nome}</div></div><div class="row"><div class="k">Realizado el</div><div class="v">${dt}</div></div><div class="row"><div class="k">Emitido el</div><div class="v">${emitidoEm}</div></div><div class="row"><div class="k">Código</div><div class="v code">${req.params.codigo}</div></div></div></div>${foot}`);
  } catch(e) { console.error('GET /certificado/validar:', e.message); res.status(500).send('Error al validar certificado.'); }
});

// ─── AVALIACAO POS-EVENTO ────────────────────────────────────────────────────
router.post('/eventos/:id/enviar-avaliacao', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const crypto = require('crypto');
    const {enviarWhatsApp} = require('../services/notificacoes');
    const config = await getConfig();
    const appUrl = process.env.APP_URL||'https://liga-urologia.onrender.com';
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.json({ok:false,msg:'Evento nao encontrado'});
    const inscrR = await query("SELECT * FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado'",[req.params.id]);
    let enviados = 0;
    for (const insc of inscrR.rows) {
      const token = crypto.randomBytes(20).toString('hex');
      await query('INSERT INTO evento_avaliacoes (evento_id,inscricao_id,token) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING',[ev.id,insc.id,token]);
      const link = appUrl+'/avaliacao/'+token;
      const msg = (config.org_nome||'LAURO')+'\n\nOla, *'+insc.nome.split(' ')[0]+'*!\n\nObrigado por participar de *'+ev.nome+'*!\n\nResponda nossa pesquisa rapida:\n'+link+'\n\nLeva menos de 2 minutos!';
      if (insc.whatsapp) { try { await enviarWhatsApp(insc.whatsapp,msg); enviados++; } catch(e){} }
    }
    res.json({ok:true,msg:enviados+' pesquisas enviadas!'});
  } catch(e) { res.json({ok:false,msg:e.message}); }
});
router.get('/avaliacao/:token', async (req, res) => {
  try {
    const r = await query('SELECT a.*, e.nome as evento_nome, e.data_inicio, i.nome as participante FROM evento_avaliacoes a JOIN eventos e ON e.id=a.evento_id LEFT JOIN evento_inscricoes i ON i.id=a.inscricao_id WHERE a.token=$1',[req.params.token]);
    if (!r.rows[0]) return res.status(404).send('Link invalido ou expirado.');
    const aval = r.rows[0];
    const config = await getConfig();
    if (aval.respondido) return res.render('pages/avaliacao-respondida',{config,aval});
    res.render('pages/avaliacao-form',{config,aval,token:req.params.token});
  } catch(e) { console.error('GET /avaliacao:', e.message); res.status(500).send('Erro ao carregar avaliação.'); }
});
router.post('/avaliacao/:token', async (req, res) => {
  try {
    const {nota_geral,nota_conteudo,nota_organizacao,nota_palestrantes,indicaria,gostou,melhorar,sugestoes} = req.body;
    await query(
      'UPDATE evento_avaliacoes SET nota_geral=$1,nota_conteudo=$2,nota_organizacao=$3,nota_palestrantes=$4,indicaria=$5,gostou=$6,melhorar=$7,sugestoes=$8,respondido=true,respondido_em=NOW() WHERE token=$9',
      [parseInt(nota_geral)||null,parseInt(nota_conteudo)||null,parseInt(nota_organizacao)||null,parseInt(nota_palestrantes)||null,indicaria||null,gostou||null,melhorar||null,sugestoes||null,req.params.token]
    );
    const config = await getConfig();
    res.render('pages/avaliacao-obrigado',{config});
  } catch(e) { console.error('POST /avaliacao:', e.message); res.status(500).send('Erro ao enviar avaliação.'); }
});
router.get('/eventos/:id/avaliacoes', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const config = await getConfig();
    const evR = await query('SELECT * FROM eventos WHERE id=$1',[req.params.id]);
    const av = await query('SELECT a.*, i.nome as participante FROM evento_avaliacoes a LEFT JOIN evento_inscricoes i ON i.id=a.inscricao_id WHERE a.evento_id=$1 ORDER BY a.respondido_em DESC',[req.params.id]);
    res.render('pages/evento-avaliacoes',{config,evento:evR.rows[0],avaliacoes:av.rows,usuario:req.session.usuario});
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

// ─── LISTA DE ESPERA ─────────────────────────────────────────────────────────
router.post('/inscricao/:id/lista-espera', limiterInscricaoEvento, async (req, res) => {
  try {
    const { nome, email, whatsapp } = req.body;
    if (!nome) return res.json({ok:false, msg:'Nome obrigatório.'});
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    const ev = evR.rows[0];
    if (!ev) return res.json({ok:false, msg:'Evento não encontrado.'});
    // Verifica se ja esta na lista
    const jaR = await query('SELECT id FROM evento_lista_espera WHERE evento_id=$1 AND (email=$2 OR whatsapp=$3)', [req.params.id, email||'', whatsapp||'']);
    if (jaR.rows.length > 0) return res.json({ok:false, msg:'Você já está na lista de espera!'});
    await query('INSERT INTO evento_lista_espera (evento_id,nome,email,whatsapp) VALUES ($1,$2,$3,$4)', [req.params.id, nome, email||null, whatsapp||null]);
    // Notifica por WhatsApp
    if (whatsapp) {
      try {
        const {enviarWhatsApp} = require('../services/notificacoes');
        const config = await getConfig();
        const msg = (config.org_nome||'LAURO')+'\n\nOla, *'+nome.split(' ')[0]+'*!\n\nVoce foi adicionado(a) a lista de espera do evento *'+ev.nome+'*.\n\nAssim que uma vaga abrir, voce sera notificado(a) automaticamente!';
        await enviarWhatsApp(whatsapp, msg);
      } catch(e) {}
    }
    res.json({ok:true, msg:'Você foi adicionado(a) à lista de espera! Avisaremos quando uma vaga abrir.'});
  } catch(e) { res.json({ok:false, msg:'Erro: '+e.message}); }
});

router.get('/eventos/:id/lista-espera', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM evento_lista_espera WHERE evento_id=$1 ORDER BY criado_em ASC', [req.params.id]);
    res.json({ok:true, espera: r.rows});
  } catch(e) { res.json({ok:false}); }
});


// ═══════════════════════════════════════════════════════════════════════════
// CHECK-OUT DE EVENTOS — confirmação de presença
// ═══════════════════════════════════════════════════════════════════════════

// Página pública de check-out
router.get('/checkout/:id', limiterVisualizacaoEvento, async (req, res) => {
  try {
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado.');
    const evento = evR.rows[0];
    const cfgPub = await getConfig();
    // Verifica se está aberto (flag manual) e dentro do prazo (se houver)
    let aberto = evento.checkout_aberto === true;
    if (aberto && evento.checkout_fecha_em && new Date(evento.checkout_fecha_em) < new Date()) aberto = false;
    res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto, sucesso: false, jaConfirmado: false, erro: null, nome: null });
  } catch(e) { console.error('Checkout GET erro:', e.message); res.status(500).send('Erro ao carregar.'); }
});

// Registrar check-out (público)
router.post('/checkout/:id', limiterInscricaoEvento, async (req, res) => {
  try {
    const evR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.status(404).send('Evento não encontrado.');
    const evento = evR.rows[0];
    const cfgPub = await getConfig();

    // Revalida abertura no servidor (segurança)
    let aberto = evento.checkout_aberto === true;
    if (aberto && evento.checkout_fecha_em && new Date(evento.checkout_fecha_em) < new Date()) aberto = false;
    if (!aberto) {
      return res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: false, sucesso: false, jaConfirmado: false, erro: 'O check-out deste evento está encerrado.', nome: null });
    }

    const email = (req.body.email || '').trim().toLowerCase();
    const docLimpo = (req.body.documento || req.body.rg || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!email || !docLimpo) {
      return res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: true, sucesso: false, jaConfirmado: false, erro: 'Completa el correo y el RG/CI/DNI.', nome: null });
    }

    // Busca a inscrição por email OU documento (RG/CI/DNI) no evento
    const insR = await query(
      `SELECT id, nome, status, isento, email, rg FROM evento_inscricoes
       WHERE evento_id=$1 AND (LOWER(email)=$2 OR regexp_replace(LOWER(COALESCE(rg,'')),'[^a-z0-9]','','g')=$3)`,
      [req.params.id, email, docLimpo]
    );
    const inscricao = insR.rows[0] || null;

    // Verifica se já existe check-out para esta pessoa (evita duplicata)
    let jaExiste;
    if (inscricao) {
      jaExiste = await query('SELECT id FROM evento_checkouts WHERE evento_id=$1 AND inscricao_id=$2 LIMIT 1', [req.params.id, inscricao.id]);
    } else {
      jaExiste = await query("SELECT id FROM evento_checkouts WHERE evento_id=$1 AND (LOWER(email)=$2 OR regexp_replace(LOWER(COALESCE(cpf,'')),'[^a-z0-9]','','g')=$3) LIMIT 1", [req.params.id, email, docLimpo]);
    }
    if (jaExiste.rows.length > 0) {
      const nomeJa = inscricao ? inscricao.nome.split(' ')[0] : null;
      return res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: true, sucesso: false, jaConfirmado: true, erro: null, nome: nomeJa });
    }

    // Registra o check-out (vinculando à inscrição se achou)
    await query(
      'INSERT INTO evento_checkouts (evento_id, inscricao_id, email, cpf, nome_informado, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.params.id, inscricao ? inscricao.id : null, email, docLimpo, inscricao ? inscricao.nome : null, (req.headers['x-forwarded-for']||req.ip||'').toString().split(',')[0].trim()]
    );

    const nome = inscricao ? inscricao.nome.split(' ')[0] : null;

    // Email de confirmação (só quando bateu com inscrição válida)
    if (inscricao && inscricao.email) {
      try {
        const { enviarEmail } = require('../services/notificacoes');
        const primeiro = inscricao.nome.split(' ')[0];
        const htmlCk = '<h2 style="margin:0 0 8px;font-size:20px;color:#0f172a">¡Hola, '+primeiro+'!</h2><p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.7">Tu <strong>asistencia</strong> al evento <strong>'+evento.nome+'</strong> fue registrada con éxito. ✅</p><div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:24px"><p style="margin:0;font-size:13px;color:#166534">Este registro confirma que estuviste presente en el evento. Tu certificado será procesado conforme las reglas del evento.</p></div><p style="margin:0;font-size:12px;color:#94a3b8">¿Dudas? Contáctanos por WhatsApp o responde a este correo.</p>';
        const textoCk = 'Hola, '+primeiro+'! Tu asistencia al evento '+evento.nome+' fue registrada con éxito.';
        enviarEmail({ para: inscricao.email, assunto: '✅ Asistencia confirmada — '+evento.nome, html: htmlCk, texto: textoCk, faixaLabel: 'ASISTENCIA CONFIRMADA' }).catch(function(e){ console.error('Email checkout erro:', e.message); });
      } catch(e) { console.error('Email checkout falhou:', e.message); }
    }

    res.render('pages/evento-checkout-publico', { evento, config: cfgPub, aberto: true, sucesso: true, jaConfirmado: false, erro: null, nome });
  } catch(e) { console.error('Checkout POST erro:', e.message); res.status(500).send('Erro ao registrar.'); }
});

// Abrir / Encerrar check-out (painel)
router.post('/eventos/:id/checkout-toggle', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const acao = req.body.acao;
    if (acao === 'abrir') {
      const fecha = req.body.fecha_em ? req.body.fecha_em : null;
      await query('UPDATE eventos SET checkout_aberto=true, checkout_fecha_em=$1 WHERE id=$2', [fecha, req.params.id]);
      req.session.msg = ['Check-out ABERTO para recebimento.'];
    } else {
      await query('UPDATE eventos SET checkout_aberto=false WHERE id=$1', [req.params.id]);
      req.session.msg = ['Check-out ENCERRADO.'];
    }
  } catch(e) { req.session.erro = [e.message]; }
  res.redirect('/eventos/' + req.params.id + '?tab=checkout');
});

// Relatório de check-out (painel) — JSON consumido pela aba
router.get('/eventos/:id/checkout-relatorio', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const evR = await query('SELECT id, nome, checkout_aberto, checkout_fecha_em FROM eventos WHERE id=$1', [req.params.id]);
    if (!evR.rows[0]) return res.json({ok:false, erro:'Evento não encontrado'});

    // Inscritos válidos (confirmado, pago ou isento)
    const inscritos = await query(
      `SELECT id, nome, email, cpf, status, isento FROM evento_inscricoes WHERE evento_id=$1`,
      [req.params.id]
    );
    // Check-outs do evento
    const checkouts = await query(
      `SELECT inscricao_id, email, cpf, nome_informado, criado_em FROM evento_checkouts WHERE evento_id=$1 ORDER BY criado_em`,
      [req.params.id]
    );

    // Conjunto de inscrição_ids que fizeram check-out
    const fezCheckout = new Set(checkouts.rows.filter(c => c.inscricao_id).map(c => c.inscricao_id));

    const aptos = [];        // inscrição válida + fez check-out
    const naoCompareceu = []; // inscrição válida + NÃO fez check-out
    inscritos.rows.forEach(i => {
      const valida = i.status === 'confirmado'; // confirmado cobre pago e isento (ambos ficam confirmado)
      if (!valida) return;
      if (fezCheckout.has(i.id)) aptos.push({ id: i.id, nome: i.nome, email: i.email, isento: i.isento });
      else naoCompareceu.push({ nome: i.nome, email: i.email, isento: i.isento });
    });

    // Check-outs sem inscrição válida (não bateu) — pra revisar
    const semInscricao = checkouts.rows.filter(c => !c.inscricao_id).map(c => ({ email: c.email, cpf: c.cpf, quando: c.criado_em }));
    // Ordena alfabeticamente por nome (pt-BR, ignora acentos na ordenação)
    const _ord = (a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
    aptos.sort(_ord);
    naoCompareceu.sort(_ord);

    res.json({
      ok: true,
      evento: evR.rows[0],
      resumo: { aptos: aptos.length, nao_compareceu: naoCompareceu.length, sem_inscricao: semInscricao.length, total_checkouts: checkouts.rows.length },
      aptos, naoCompareceu, semInscricao
    });
  } catch(e) { console.error('Relatorio checkout erro:', e.message); res.json({ok:false, erro:e.message}); }
});

router.post('/eventos/:id/inscricao/:inscricao_id/desfazer-checkout', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    await query('DELETE FROM evento_checkouts WHERE evento_id=$1 AND inscricao_id=$2', [req.params.id, req.params.inscricao_id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false, erro:e.message}); }
});

// Exportar lista de aptos em CSV (painel)
router.get('/eventos/:id/checkout-export', requireAuth, requirePermissao('eventos'), async (req, res) => {
  try {
    const [evR, inscritos] = await Promise.all([
      query('SELECT nome FROM eventos WHERE id=$1', [req.params.id]),
      query(
        `SELECT i.nome, i.email, i.cpf, i.rg, i.catraca, i.tipo_participante,
                i.isento,
                to_char(c.criado_em, 'DD/MM/YYYY HH24:MI') as checkout_em
         FROM evento_inscricoes i
         LEFT JOIN evento_checkouts c ON c.inscricao_id=i.id
         WHERE i.evento_id=$1 AND i.status='confirmado'
           AND EXISTS (SELECT 1 FROM evento_checkouts ec WHERE ec.inscricao_id=i.id)
         ORDER BY i.nome`,
        [req.params.id]
      )
    ]);
    const nomeEv = (evR.rows[0]?.nome || 'evento').replace(/[^a-z0-9]/gi,'_').substring(0,30);
    const cabecalho = ['Nome Completo','Email','CPF','RG','Catraca','Tipo Participante','Pagamento','Check-out em'];
    let csv = cabecalho.join(';') + '\n';
    inscritos.rows.forEach(r => {
      const tipoRaw = (r.tipo_participante || 'externo').toLowerCase().trim();
      const tipo = tipoRaw === 'ucp' ? 'Aluno UCP' : tipoRaw === 'externo' ? 'Externo' : r.tipo_participante || 'Externo';
      csv += [
        r.nome || '',
        r.email || '',
        r.cpf || '',
        r.rg || '',
        r.catraca || '',
        tipo,
        r.isento ? 'Isento' : 'Pago',
        r.checkout_em || ''
      ].map(v => '"' + String(v).replace(/"/g,'""') + '"').join(';') + '\n';
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="aptos-' + nomeEv + '.csv"');
    res.send('\uFEFF' + csv);
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
});

};
