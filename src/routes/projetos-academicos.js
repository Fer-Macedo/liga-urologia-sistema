// ═══ PROJETOS ACADÊMICOS — ENSINO & EXTENSÃO ═══
const { query } = require('../models/database');
const { requireAuth } = require('../middleware/auth');

async function temPermissaoModulo(usuarioId, modulo) {
  try {
    const r = await query('SELECT id FROM usuario_permissoes WHERE usuario_id=$1 AND modulo=$2', [usuarioId, modulo]);
    return r.rows.length > 0;
  } catch(e) { return false; }
}

async function podeVer(usuario, tipo) {
  if (['admin','presidencia','secretaria'].includes(usuario.perfil)) return true;
  return await temPermissaoModulo(usuario.id, tipo);
}

async function podeEditar(usuario, tipo) {
  if (['admin','presidencia'].includes(usuario.perfil)) return true;
  return await temPermissaoModulo(usuario.id, tipo);
}

async function getConfig() {
  let config = {};
  try {
    const c = await query('SELECT chave, valor FROM configuracoes');
    c.rows.forEach(r => config[r.chave] = r.valor);
  } catch(e) {}
  return config;
}

async function buscarProjeto(id) {
  const r = await query('SELECT * FROM projetos_academicos WHERE id=$1', [id]);
  if (!r.rows.length) return null;
  const p = r.rows[0];
  const c = await query('SELECT * FROM projetos_cronograma WHERE projeto_id=$1 ORDER BY ordem', [id]);
  p.cronograma = c.rows;
  return p;
}

async function logHist(pid, de, para, obs, uid) {
  await query('INSERT INTO projetos_historico(projeto_id,status_de,status_para,observacao,usuario_id) VALUES($1,$2,$3,$4,$5)', [pid, de, para, obs||'', uid]);
}

const dnull = v => (v && String(v).trim()) ? String(v).trim() : null;

module.exports = function(router) {

  // ── Listas
  ['ensino','extensao'].forEach(tipo => {
    router.get('/'+tipo, requireAuth, async (req, res) => {
      try {
        if (!await podeVer(req.session.usuario, tipo)) {
          req.flash('erro','Você não tem permissão para este módulo.');
          return res.redirect('/dashboard');
        }
        const { status, q } = req.query;
        let where = 'WHERE tipo=$1'; const params = [tipo];
        if (status) { params.push(status); where += ' AND status=$'+params.length; }
        if (q) { params.push('%'+q+'%'); where += ' AND LOWER(nome) LIKE LOWER($'+params.length+')'; }
        // Inativados: só admin/presidência veem; demais não veem os inativados
        const ehAdminLista = ['admin','presidencia'].includes(req.session.usuario.perfil);
        if (!ehAdminLista) { where += ' AND COALESCE(p.inativado,false)=false'; }
        const proj = await query(
          'SELECT p.*, u.nome AS criador_nome FROM projetos_academicos p LEFT JOIN usuarios u ON u.id=p.criado_por '+where+' ORDER BY p.created_at DESC', params);
        const editavel = await podeEditar(req.session.usuario, tipo);
        const cnt = await query("SELECT status, COUNT(*) AS n FROM projetos_academicos WHERE tipo=$1 AND status IN ('pendente','liberado') GROUP BY status", [tipo]);
        const pend = {}; cnt.rows.forEach(function(x){ pend[x.status] = parseInt(x.n); });
        res.render('pages/projetos-lista', {
          config: await getConfig(), usuario: req.session.usuario,
          projetos: proj.rows, filtros: {status: status||'', q: q||''},
          tipo, editavel, pendencias: pend
        });
      } catch(e) { console.error(e); req.flash('erro', e.message); res.redirect('/dashboard'); }
    });
  });

  // ── Form novo
  router.get('/projetos/novo/:tipo', requireAuth, async (req, res) => {
    const tipo = req.params.tipo;
    if (!['ensino','extensao'].includes(tipo)) return res.redirect('/dashboard');
    if (!await podeEditar(req.session.usuario, tipo)) {
      req.flash('erro','Sem permissão para criar projetos.');
      return res.redirect('/'+tipo);
    }
    res.render('pages/projeto-form', {
      config: await getConfig(), usuario: req.session.usuario, p: null, tipo
    });
  });

  // ── Form editar
  router.get('/projetos/:id/editar', requireAuth, async (req, res) => {
    try {
      if (isNaN(req.params.id)) return res.redirect('/dashboard');
      const p = await buscarProjeto(req.params.id);
      if (!p) return res.redirect('/dashboard');
      if (!await podeEditar(req.session.usuario, p.tipo)) {
        req.flash('erro','Sem permissão para editar.');
        return res.redirect('/projetos/'+p.id);
      }
      res.render('pages/projeto-form', {
        config: await getConfig(), usuario: req.session.usuario, p, tipo: p.tipo
      });
    } catch(e) { console.error(e); res.redirect('/dashboard'); }
  });

  // ── Detalhe
  router.get('/projetos/:id', requireAuth, async (req, res) => {
    try {
      if (isNaN(req.params.id)) return res.redirect('/dashboard');
      const p = await buscarProjeto(req.params.id);
      if (!p) return res.redirect('/dashboard');
      if (!await podeVer(req.session.usuario, p.tipo)) {
        req.flash('erro','Sem permissão.');
        return res.redirect('/dashboard');
      }
      const hist = await query(
        'SELECT h.*, u.nome AS unom FROM projetos_historico h LEFT JOIN usuarios u ON u.id=h.usuario_id WHERE h.projeto_id=$1 ORDER BY h.created_at DESC', [p.id]);
      const totalHoras = p.cronograma.reduce((a,c)=>a+parseFloat(c.horas_total||0),0);
      // Anexos do fluxo (documentos por etapa)
      let anexos = [];
      try { const ax = await query('SELECT id,tipo,nome_original,observacao,created_at FROM projetos_anexos WHERE projeto_id=$1 ORDER BY id DESC',[p.id]); anexos = ax.rows; } catch(e){}
      res.render('pages/projeto-detalhe', {
        config: await getConfig(), usuario: req.session.usuario,
        p, historico: hist.rows, totalHoras, anexos,
        editavel: await podeEditar(req.session.usuario, p.tipo)
      });
    } catch(e) { console.error(e); res.redirect('/dashboard'); }
  });

  // ── Salvar
  router.post('/projetos/salvar', requireAuth, async (req, res) => {
    try {
      const b = req.body;
      const tipo = b.tipo;
      if (!await podeEditar(req.session.usuario, tipo)) {
        req.flash('erro','Sem permissão.');
        return res.redirect('/'+tipo);
      }
      const uid = req.session.usuario.id;
      const arr = v => Array.isArray(v) ? v : (v !== undefined && v !== '' ? [v] : []);
      const objEsp  = arr(b.objetivos_especificos).filter(x=>x&&x.trim());
      const pubAlvo = arr(b.publico_alvo).filter(Boolean);

      // Temário (ensino)
      const temTit = arr(b.temario_titulo), temPon = arr(b.temario_ponente),
            temPer = arr(b.temario_perfil), temDes = arr(b.temario_descricao),
            temDur = arr(b.temario_duracao);
      const temario = temTit.map((t,i)=>({
        titulo:t, ponente:temPon[i]||'', perfil_ponente:temPer[i]||'',
        descricao:temDes[i]||'', duracao_min:temDur[i]||''
      })).filter(t=>t.titulo&&t.titulo.trim());

      const vals = [
        b.nome, dnull(b.data_execucao_inicio), dnull(b.data_execucao_fim),
        dnull(b.horario_inicio), dnull(b.horario_fim), dnull(b.local),
        dnull(b.modalidade), dnull(b.plataforma),
        dnull(b.docente_responsavel), dnull(b.docente_orientador),
        dnull(b.antecedentes), dnull(b.objetivo_geral), dnull(b.metodologia),
        dnull(b.recursos_necessarios), dnull(b.referencias),
        JSON.stringify(pubAlvo), JSON.stringify(objEsp), JSON.stringify(temario),
        dnull(b.lugar_execucao), dnull(b.atividades_realizar), dnull(b.resultados_esperados),
        b.inscricao_gratuita !== 'false',
        dnull(b.inscricao_valor), dnull(b.inscricao_inicio), dnull(b.inscricao_fim),
        uid
      ];

      let pid;
      if (b.id) {
        pid = b.id;
        await query(`UPDATE projetos_academicos SET
          nome=$1,data_execucao_inicio=$2,data_execucao_fim=$3,horario_inicio=$4,horario_fim=$5,
          local=$6,modalidade=$7,plataforma=$8,docente_responsavel=$9,docente_orientador=$10,
          antecedentes=$11,objetivo_geral=$12,metodologia=$13,recursos_necessarios=$14,referencias=$15,
          publico_alvo=$16,objetivos_especificos=$17,temario=$18,
          lugar_execucao=$19,atividades_realizar=$20,resultados_esperados=$21,
          inscricao_gratuita=$22,inscricao_valor=$23,inscricao_inicio=$24,inscricao_fim=$25,
          atualizado_por=$26,updated_at=NOW() WHERE id=$27`, [...vals, pid]);
      } else {
        const r = await query(`INSERT INTO projetos_academicos
          (nome,data_execucao_inicio,data_execucao_fim,horario_inicio,horario_fim,
           local,modalidade,plataforma,docente_responsavel,docente_orientador,
           antecedentes,objetivo_geral,metodologia,recursos_necessarios,referencias,
           publico_alvo,objetivos_especificos,temario,
           lugar_execucao,atividades_realizar,resultados_esperados,
           inscricao_gratuita,inscricao_valor,inscricao_inicio,inscricao_fim,
           criado_por,atualizado_por,tipo)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$26,$27)
          RETURNING id`, [...vals, tipo]);
        pid = r.rows[0].id;
        await logHist(pid, null, 'rascunho', 'Projeto criado', uid);
      }

      // Cronograma
      await query('DELETE FROM projetos_cronograma WHERE projeto_id=$1', [pid]);
      const cAtiv = arr(b.cronograma_atividade), cResp = arr(b.cronograma_responsavel),
            cData = arr(b.cronograma_data), cHi = arr(b.cronograma_hora_inicio),
            cHf = arr(b.cronograma_hora_fim), cH = arr(b.cronograma_horas);
      for (let i=0; i<cAtiv.length; i++) {
        if (!cAtiv[i] || !cAtiv[i].trim()) continue;
        await query('INSERT INTO projetos_cronograma(projeto_id,ordem,atividade,responsavel,data,hora_inicio,hora_fim,horas_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [pid, i, cAtiv[i], dnull(cResp[i]), dnull(cData[i]), dnull(cHi[i]), dnull(cHf[i]), dnull(cH[i])]);
      }
      if (b.inscricao_valor_brl !== undefined) {
        await query('UPDATE projetos_academicos SET inscricao_valor_brl=$1 WHERE id=$2', [dnull(b.inscricao_valor_brl), pid]);
      }
      if (b.integrantes !== undefined) {
        const intLinhas = String(b.integrantes).split('\n').map(function(s){return s.trim()}).filter(Boolean);
        await query('UPDATE projetos_academicos SET integrantes=$1 WHERE id=$2', [JSON.stringify(intLinhas), pid]);
      }
      res.redirect('/projetos/'+pid);
    } catch(e) { console.error('salvar projeto:', e); req.flash('erro', e.message); res.redirect('/dashboard'); }
  });

  // ── Status
  router.post('/projetos/:id/status', requireAuth, async (req, res) => {
    try {
      const u = req.session.usuario;
      const { novoStatus, observacao } = req.body;
      const p = await buscarProjeto(req.params.id);
      if (!p) return res.status(404).json({erro:'Não encontrado'});

      let permitidos = [];
      if (['admin','presidencia'].includes(u.perfil)) {
        permitidos = ['rascunho','pendente','liberado','revisao','aprovado','andamento','concluido','cancelado'];
      } else if (u.perfil === 'secretaria') {
        permitidos = ['revisao','aprovado','concluido'];
      } else if (await temPermissaoModulo(u.id, p.tipo)) {
        permitidos = ['rascunho','pendente','andamento'];
      }
      if (!permitidos.includes(novoStatus)) return res.status(403).json({erro:'Sem permissão para esta transição'});

      let extra = '';
      if (novoStatus==='revisao')   extra = ',enviado_em=NOW()';
      if (novoStatus==='aprovado')  extra = ',aprovado_em=NOW()';
      if (novoStatus==='concluido') extra = ',concluido_em=NOW()';
      await query('UPDATE projetos_academicos SET status=$1,updated_at=NOW()'+extra+' WHERE id=$2', [novoStatus, p.id]);
      await logHist(p.id, p.status, novoStatus, observacao, u.id);
      res.json({ok:true});
    } catch(e) { res.status(500).json({erro:e.message}); }
  });

  // ── Informe final (salvar campos)
  router.post('/projetos/:id/informe', requireAuth, async (req, res) => {
    try {
      const p = await buscarProjeto(req.params.id);
      if (!p) return res.status(404).json({erro:'Não encontrado'});
      if (!await podeEditar(req.session.usuario, p.tipo)) return res.status(403).json({erro:'Sem permissão'});
      const b = req.body;
      await query(`UPDATE projetos_academicos SET
        informe_conceito=$1,informe_atividades=$2,informe_resultados=$3,
        informe_aprendizados=$4,informe_problemas=$5,informe_conclusao=$6,updated_at=NOW()
        WHERE id=$7`,
        [b.informe_conceito,b.informe_atividades,b.informe_resultados,
         b.informe_aprendizados,b.informe_problemas,b.informe_conclusao,p.id]);
      res.json({ok:true});
    } catch(e) { res.status(500).json({erro:e.message}); }
  });

  // ── Gerar Google Doc (projeto ou informe)
  async function gerarESubir(p, ehInforme) {
    const { gerarDocx } = require('../services/projeto-doc');
    const { imagemBase64 } = require('../services/desligamento');
    const totalH = (p.cronograma||[]).reduce((a,c)=>a+parseFloat(c.horas_total||0),0);
    // Timbrado configurável da liga (faixas topo/rodapé no R2). Vazio => usa o padrão UCP embutido.
    const { Pool: PoolCfg } = require('pg');
    const poolCfg = new PoolCfg({connectionString: process.env.DATABASE_URL});
    const cfgRows = await poolCfg.query("SELECT chave, valor FROM configuracoes WHERE chave IN ('timbrado_proj_head_chave','timbrado_proj_foot_chave')");
    await poolCfg.end();
    const cfgMap = {}; cfgRows.rows.forEach(x => cfgMap[x.chave] = x.valor);
    const config = {
      timbrado_head_b64: await imagemBase64(cfgMap.timbrado_proj_head_chave),
      timbrado_foot_b64: await imagemBase64(cfgMap.timbrado_proj_foot_chave)
    };
    const buffer = await gerarDocx(p, totalH, ehInforme, config);

    const { getClientAtualizado, uploadParaDrive } = require('../services/google-drive');
    const { Pool } = require('pg');
    const pool = new Pool({connectionString: process.env.DATABASE_URL});
    const client = await getClientAtualizado(pool);
    const nomeArq = (ehInforme ? '[LAURO] INFORME FINAL – ' : '[LAURO] '+(p.tipo==='ensino'?'ENSEÑANZA':'EXTENSIÓN')+' – ')+p.nome+'.docx';
    const result = await uploadParaDrive(client.credentials, buffer, nomeArq,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await pool.end();
    return result;
  }

  router.post('/projetos/:id/gerar-doc', requireAuth, async (req, res) => {
    try {
      const p = await buscarProjeto(req.params.id);
      if (!p) return res.status(404).json({erro:'Não encontrado'});
      if (!await podeVer(req.session.usuario, p.tipo)) return res.status(403).json({erro:'Sem permissão'});
      const r = await gerarESubir(p, false);
      await query('UPDATE projetos_academicos SET gdoc_id=$1,gdoc_url=$2,updated_at=NOW() WHERE id=$3', [r.fileId, r.webViewLink, p.id]);
      await logHist(p.id, p.status, p.status, 'Google Doc do projeto gerado', req.session.usuario.id);
      res.json({ok:true, url:r.webViewLink});
    } catch(e) { console.error('gerar-doc:', e); res.status(500).json({erro:e.message}); }
  });


  // ── Gera o documento TIMBRADO (.docx com membrete UCP) e salva como anexo ──
  router.post('/projetos/:id/gerar-timbrado', requireAuth, async (req, res) => {
    try {
      const p = await buscarProjeto(req.params.id);
      if (!p) return res.status(404).json({erro:'No encontrado'});
      if (!await podeVer(req.session.usuario, p.tipo)) return res.status(403).json({erro:'Sin permiso'});
      const fs = require('fs');
      const { gerarProjetoTimbrado } = require('../services/projeto-doc-timbrado');
      const { uploadArquivo } = require('../services/arquivos');
      const membrete = fs.readFileSync(require('path').join(__dirname, '..', '..', 'templates', 'membrete-ucp.docx'));
      const cfg = await getConfig();
      const buffer = await gerarProjetoTimbrado(membrete, p, cfg);
      const agora = new Date();
      const dd = String(agora.getDate()).padStart(2,'0');
      const mm = String(agora.getMonth()+1).padStart(2,'0');
      const aa = agora.getFullYear();
      const hh = String(agora.getHours()).padStart(2,'0');
      const min = String(agora.getMinutes()).padStart(2,'0');
      const carimbo = dd + '-' + mm + '-' + aa + '_' + hh + 'h' + min;
      const nomeArq = (p.tipo==='ensino'?'Proyecto-Ensenanza-':'Proyecto-Extension-') + (p.nome||'proyecto').replace(/[^a-zA-Z0-9]/g,'_').slice(0,40) + '_' + carimbo + '.docx';
      const r = await uploadArquivo(buffer, nomeArq, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'projetos-docs');
      await query('INSERT INTO projetos_anexos (projeto_id,tipo,arquivo_chave,nome_original,mimetype,enviado_por) VALUES ($1,$2,$3,$4,$5,$6)',
        [p.id, 'documento_final', r.chave, nomeArq, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', req.session.usuario.id]);
      await logHist(p.id, p.status, p.status, 'Documento timbrado generado', req.session.usuario.id);
      res.json({ok:true, anexo_nome: nomeArq});
    } catch(e) { console.error('gerar-timbrado:', e); res.status(500).json({erro:e.message}); }
  });

  router.post('/projetos/:id/gerar-informe', requireAuth, async (req, res) => {
    try {
      const p = await buscarProjeto(req.params.id);
      if (!p) return res.status(404).json({erro:'Não encontrado'});
      if (!await podeVer(req.session.usuario, p.tipo)) return res.status(403).json({erro:'Sem permissão'});
      const r = await gerarESubir(p, true);
      await query('UPDATE projetos_academicos SET gdoc_id_informe=$1,gdoc_url_informe=$2,updated_at=NOW() WHERE id=$3', [r.fileId, r.webViewLink, p.id]);
      await logHist(p.id, p.status, p.status, 'Google Doc do informe gerado', req.session.usuario.id);
      res.json({ok:true, url:r.webViewLink});
    } catch(e) { console.error('gerar-informe:', e); res.status(500).json({erro:e.message}); }
  });

  // ── Excluir
  // INATIVAR: ensino/extensão/secretaria/admin/presidência. Some da lista dos não-admin.
  router.post('/projetos/:id/inativar', requireAuth, async (req, res) => {
    try {
      const u = req.session.usuario;
      const r = await query('SELECT tipo FROM projetos_academicos WHERE id=$1', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({erro:'No encontrado'});
      if (!await podeVer(u, r.rows[0].tipo)) return res.status(403).json({erro:'Sin permiso'});
      await query('UPDATE projetos_academicos SET inativado=true, inativado_por=$1, inativado_nome=$2, inativado_em=NOW(), updated_at=NOW() WHERE id=$3',
        [u.id, u.nome, req.params.id]);
      await logHist(req.params.id, '', '', 'Proyecto inactivado por '+u.nome, u.id);
      res.json({ok:true, redir:'/'+r.rows[0].tipo});
    } catch(e) { res.status(500).json({erro:e.message}); }
  });

  // REATIVAR: só admin/presidência
  router.post('/projetos/:id/reativar', requireAuth, async (req, res) => {
    if (!['admin','presidencia'].includes(req.session.usuario.perfil)) return res.status(403).json({erro:'Solo Presidencia/Admin'});
    try {
      await query('UPDATE projetos_academicos SET inativado=false, inativado_por=NULL, inativado_nome=NULL, inativado_em=NULL, updated_at=NOW() WHERE id=$1', [req.params.id]);
      await logHist(req.params.id, '', '', 'Proyecto reactivado por '+req.session.usuario.nome, req.session.usuario.id);
      res.json({ok:true});
    } catch(e) { res.status(500).json({erro:e.message}); }
  });

  // ELIMINAR DEFINITIVO: só admin/presidência
  router.post('/projetos/:id/excluir', requireAuth, async (req, res) => {
    if (!['admin','presidencia'].includes(req.session.usuario.perfil)) return res.status(403).json({erro:'Solo Presidencia/Admin'});
    try {
      const r = await query('SELECT tipo FROM projetos_academicos WHERE id=$1', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({erro:'No encontrado'});
      await query('DELETE FROM projetos_academicos WHERE id=$1', [req.params.id]);
      res.json({ok:true, redir:'/'+r.rows[0].tipo});
    } catch(e) { res.status(500).json({erro:e.message}); }
  });
};
