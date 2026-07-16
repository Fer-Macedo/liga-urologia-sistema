// ═══ EVENTOS ════════════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { enviarEmail, emailBonito } = require('../services/email');
const { criarPixEvento, consultarPagamento } = require('../services/pagbank');
const { enviarEmailConfirmacaoEvento } = require('../services/eventos-email');

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
      await query('INSERT INTO eventos (nome,descricao,data_inicio,data_fim,local,endereco,vagas_total,status,publico,banner_chave,cor_tema,tipo_evento,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [nome,descricao||null,data_inicio||null,data_fim||null,local||null,endereco||null,parseInt(vagas_total)||100,status||'rascunho',publico==='true',bannerChave,cor_tema||'#1a3d2b',tipo_evento||'presencial',req.session.usuario.id]);
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
  const {nome,preco,vagas,data_inicio,data_fim} = req.body;
  const ordem = await query('SELECT COUNT(*) FROM evento_lotes WHERE evento_id=$1',[req.params.id]);
  await query('INSERT INTO evento_lotes (evento_id,nome,preco,vagas,data_inicio,data_fim,ordem) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.params.id,nome,parseFloat(preco)||0,parseInt(vagas)||50,data_inicio||null,data_fim||null,parseInt(ordem.rows[0].count)+1]);
  req.session.msg=['Lote criado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/eventos/:id/lotes/:lid/deletar', requireAuth, requirePermissao('eventos'), async (req, res) => {
  await query('DELETE FROM evento_lotes WHERE id=$1',[req.params.lid]);
  req.session.msg=['Lote excluído!']; res.redirect('/eventos/'+req.params.id);
});

// INSCRIÇÕES - Página Pública
router.get('/inscricao/:id', async (req, res) => {
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
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

// INSCRIÇÕES — POST: salva dados e redireciona para pagamento
router.post('/inscricao/:id', async (req, res) => {
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
    res.status(500).send('Erro ao processar inscrição: ' + e.message);
  }
});

// ─── PAGAMENTO DE EVENTOS ─────────────────────────────────────────────────────

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
    res.status(500).send('Erro: ' + e.message);
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

// Pagamento via Cartão de Crédito
router.post('/pagamento/:inscricaoId/cartao', async (req, res) => {
  try {
    const { num, nome, mes, ano, cvv, cpf, parcelas } = req.body;

    const inscR = await query(
      'SELECT i.*, e.nome as evento_nome FROM evento_inscricoes i JOIN eventos e ON e.id=i.evento_id WHERE i.id=$1',
      [req.params.inscricaoId]
    );
    const inscricao = inscR.rows[0];
    if (!inscricao) return res.json({ ok: false, erro: 'Inscrição não encontrada.' });

    const loteR = await query('SELECT * FROM evento_lotes WHERE id=$1', [inscricao.lote_id]);
    const lote = loteR.rows[0];

    const axios = require('axios');
    const isProd = (process.env.PAGBANK_ENV || 'sandbox') === 'production';
    const BASE_URL = isProd ? 'https://api.pagseguro.com' : 'https://sandbox.api.pagseguro.com';
    const TOKEN = process.env.PAGBANK_TOKEN;

    const valorCents = Math.round(parseFloat(lote.preco) * 100);
    const referencia = 'evento-insc-' + inscricao.id;
    const cpfLimpo = (cpf || '').replace(/\D/g, '') || '12345678909';

    const { data } = await axios.post(
      BASE_URL + '/orders',
      {
        reference_id: referencia,
        customer: {
          name: inscricao.nome,
          email: inscricao.email || 'inscrito@ligaurologia.com.br',
          tax_id: cpfLimpo
        },
        items: [{
          name: ('Ingresso — ' + inscricao.evento_nome + ' — ' + lote.nome).substring(0, 100),
          quantity: 1,
          unit_amount: valorCents
        }],
        charges: [{
          reference_id: referencia,
          description: ('Ingresso — ' + inscricao.evento_nome).substring(0, 64),
          amount: { value: valorCents, currency: 'BRL' },
          payment_method: {
            type: 'CREDIT_CARD',
            installments: parseInt(parcelas) || 1,
            capture: true,
            card: {
              number: num,
              exp_month: String(mes).padStart(2, '0'),
              exp_year: String(ano),
              security_code: cvv,
              holder: { name: nome }
            }
          }
        }],
        notification_urls: [(process.env.APP_URL || 'https://liga-urologia.onrender.com') + '/webhook/pagbank']
      },
      { headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, timeout: 20000 }
    );

    const charges = data.charges || [];
    const aprovado = charges.some(c => c.status === 'PAID' || c.status === 'AUTHORIZED');

    if (aprovado) {
      await query("UPDATE evento_inscricoes SET status='confirmado' WHERE id=$1", [req.params.inscricaoId]);
      await query(
        `INSERT INTO evento_pagamentos (inscricao_id, valor, metodo, status, pagbank_order_id, pago_em)
         VALUES ($1,$2,'cartao','pago',$3,NOW())
         ON CONFLICT DO NOTHING`,
        [req.params.inscricaoId, lote.preco, data.id]
      );
      await enviarEmailConfirmacaoEvento(req.params.inscricaoId);
      return res.json({ ok: true });
    }

    const motivoCharge = charges[0];
    const motivo = motivoCharge ? (motivoCharge.payment_response?.message || motivoCharge.status || 'Recusado') : 'Pagamento não aprovado';
    console.error('PagBank cartão recusado:', motivo);
    res.json({ ok: false, erro: traduzirRecusaCartao(motivo) });

  } catch(e) {
    const detail = e.response ? JSON.stringify(e.response.data).substring(0, 300) : e.message;
    console.error('PagBank cartão ERRO:', detail);
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
  } catch(e) { res.status(500).send('Erro: ' + e.message); }
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
  const {nome,preco,vagas,data_inicio,data_fim} = req.body;
  await query('UPDATE evento_lotes SET nome=$1,preco=$2,vagas=$3,data_inicio=$4,data_fim=$5 WHERE id=$6',
    [nome,parseFloat(preco)||0,parseInt(vagas),data_inicio||null,data_fim||null,req.params.lid]);
  req.session.msg=['Lote atualizado!']; res.redirect('/eventos/'+req.params.id);
});

router.post('/contato-evento/:id', async (req, res) => {
  try {
    const {nome,email,mensagem} = req.body;
    // resend
    await enviarEmail({ from: 'LAURO - Liga Urologia <lauroucpcde@lauroucpcde.com>', to:'lauroucpcde@lauroucpcde.com', subject:'Contato via evento — '+nome, html:'<p><strong>Nome:</strong> '+nome+'</p><p><strong>Email:</strong> '+email+'</p><p><strong>Mensagem:</strong><br>'+mensagem+'</p>' });
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

// Gerar cupons em lote para ligantes EM DIA e diretivos com envio via WhatsApp/email
router.post('/eventos/:id/cupons/gerar-ligantes', requireAuth, requirePermissao('eventos'), async (req, res) => {
  // versao nova abaixo
  const _dummy = 1;
});
router.post('/eventos/:id/cupons/gerar-ligantes-v2', requireAuth, requirePermissao('eventos'), async (req, res) => {
  const { prefixo, destino, enviar_wpp, enviar_email } = req.body;
  const pref = (prefixo||'LAURO').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const eventoR = await query('SELECT * FROM eventos WHERE id=$1', [req.params.id]);
  const evento = eventoR.rows[0];
  const { enviarWhatsApp, enviarEmail } = require('../services/notificacoes');
  const config = await query('SELECT chave,valor FROM configuracoes').then(r => { const c={}; r.rows.forEach(x=>c[x.chave]=x.valor); return c; });
  const orgNome = config.org_nome || 'LAURO';
  const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';

  let pessoas = [];

  // Ligantes EM DIA (último pagamento = pago OU sem cobranças = gratuito)
  if (destino === 'ligantes' || destino === 'todos') {
    const ligR = await query(`
      SELECT l.id, l.nome, l.email, l.whatsapp, 'ligante' as tipo,
        (SELECT c.status FROM cobrancas c WHERE c.membro_id IS NULL
         ORDER BY c.criado_em DESC LIMIT 1) as ultimo_status
      FROM ligantes l WHERE l.ativo=1
    `);
    // Verifica em dia: pago ou sem dívidas atrasadas
    for (const lig of ligR.rows) {
      const divR = await query(
        "SELECT COUNT(*) as n FROM cobrancas WHERE status='atrasado' AND referencia LIKE $1",
        ['%-' + lig.id + '-%']
      );
      // Ligantes não têm cobrança direta pelo id neste sistema — incluímos todos ativos
      pessoas.push({ ...lig, em_dia: true });
    }
  }

  // Diretivos — todos (não pagam mensalidade)
  if (destino === 'diretivos' || destino === 'todos') {
    const dirR = await query('SELECT id, nome, email, whatsapp, \'diretivo\' as tipo FROM diretivos WHERE ativo=1');
    dirR.rows.forEach(d => pessoas.push({ ...d, em_dia: true }));
  }

  let criados = 0, enviados = 0, erros = [];

  for (const p of pessoas) {
    if (!p.em_dia) continue;
    // Gera sufixo sem caracteres ambíguos (sem 0,O,1,I,L,8,B,5,S,2,Z)
    const _chars = 'ACDEFGHJKMNPQRTUVWXY3467';
    let sufixo = '';
    for (let _i = 0; _i < 6; _i++) sufixo += _chars[Math.floor(Math.random() * _chars.length)];
    const codigo = pref + '-' + sufixo;
    const campo_pessoa = p.tipo === 'ligante' ? 'ligante_id' : 'diretivo_id';

    // Verifica se ja tem cupom para esta pessoa neste evento
    const jaTemR = await query(
      'SELECT id FROM evento_cupons WHERE evento_id=$1 AND '+campo_pessoa+'=$2',
      [req.params.id, p.id]
    );

    let codigoFinal = codigo;
    if (jaTemR.rows.length > 0) {
      // Reutiliza cupom existente
      const cupomExR = await query('SELECT codigo FROM evento_cupons WHERE evento_id=$1 AND '+campo_pessoa+'=$2', [req.params.id, p.id]);
      codigoFinal = cupomExR.rows[0].codigo;
    }

    try {
      if (jaTemR.rows.length === 0) {
        const col = p.tipo === 'ligante' ? 'ligante_id' : 'diretivo_id';
        await query('INSERT INTO evento_cupons (evento_id,codigo,tipo,valor,usos_max,'+col+') VALUES ($1,$2,$3,$4,$5,$6)',
          [req.params.id, codigoFinal, 'percentual', 100, 1, p.id]);
      }
      criados++;

      const msg = `💚💙 *${orgNome}* 💚💙\n\nOlá, *${p.nome.split(' ')[0]}*! 🎉\n\nVocê tem um *cupom de isenção 100%* 🎫 para o evento:\n*${evento.nome}*\n\n🎟️ Seu cupom: *${codigoFinal}*\n\n👉 Inscreva-se pelo link abaixo (o cupom já vem aplicado, é só finalizar):\n${appUrl}/inscricao/${req.params.id}?cupom=${encodeURIComponent(codigoFinal)}\n\n_Cupom válido para uma inscrição._ ✨`;

      if (enviar_wpp === 'on' && p.whatsapp) {
        try { await enviarWhatsApp(p.whatsapp, msg); enviados++; } catch(e) { erros.push(p.nome); }
      }
      if (enviar_email === 'on' && p.email) {
        const html = (function(){var cor='#1a3d2b';var pn=p.nome.split(' ')[0];var linkCupom=appUrl+'/inscricao/'+req.params.id+'?cupom='+encodeURIComponent(codigoFinal);return '<div style="border-left:3px solid '+cor+';padding-left:14px;margin-bottom:24px"><p style="margin:0;font-size:11px;font-weight:700;color:'+cor+';letter-spacing:1.5px;text-transform:uppercase">Tu invitaci&oacute;n gratuita</p><h2 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#0f172a">'+evento.nome+'</h2></div>'+'<p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7">&iexcl;Hola, <strong>'+pn+'</strong>! Tienes un <strong>cup&oacute;n de exenci&oacute;n 100%</strong> para participar gratuitamente en este evento.</p>'+'<div style="text-align:center;margin:24px 0;padding:24px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Tu c&oacute;digo de cup&oacute;n</p><div style="font-size:30px;font-weight:900;font-family:monospace;color:'+cor+';letter-spacing:4px">'+codigoFinal+'</div><p style="margin:12px 0 0;font-size:12px;color:'+cor+';font-weight:700">&#128203; Copiar cup&oacute;n</p><p style="margin:4px 0 0;font-size:11px;color:#94a3b8">V&aacute;lido para 1 inscripci&oacute;n</p></div>'+'<div style="text-align:center;padding-top:8px"><a href="'+linkCupom+'" style="display:inline-block;background:'+cor+';color:white;padding:13px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase">Inscribirme con el cup&oacute;n aplicado</a></div>';})();
        try { await enviarEmail({ para: p.email, assunto: `🎟️ Seu cupom gratuito — ${evento.nome}`, html, texto: msg, faixaLabel: 'CUPOM GRATUITO' }); } catch(e) {}
      }
    } catch(e) { /* código duplicado — ignora */ }
  }

  req.session.msg=[`${criados} cupons gerados, ${enviados} notificações enviadas!`];
  res.redirect('/eventos/'+req.params.id+'?tab=cupons');
});

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


};
