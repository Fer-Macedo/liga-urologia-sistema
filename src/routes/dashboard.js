// ═══ DASHBOARD (+ APIs de pendências da sidebar) ════════════════════════════
const dayjs = require('dayjs');
const { query } = require('../models/database');
const { requireAuth } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════
// APIs PÚBLICAS — Site Externo LAURO
// ═══════════════════════════════════════════════════════

// Monta o painel de numeros/lista especifico da area do usuario, reaproveitando as mesmas
// consultas que a propria tela daquela area ja usa - Ensino/Extensao (projetos_academicos),
// Cientifico (projetos/grupos/versoes) e Marketing (marketing_posts). Cada perfil sem acesso
// financeiro ve os numeros do que ele de fato acompanha, em vez de ficar sem nada relevante.
async function montarAreaEspecifica(perfil) {
  if (perfil === 'ensino' || perfil === 'extensao') {
    const statusR = await query('SELECT status, COUNT(*) n FROM projetos_academicos WHERE tipo=$1 GROUP BY status', [perfil]);
    const porStatus = {};
    statusR.rows.forEach(r => { porStatus[r.status] = parseInt(r.n); });
    const total = Object.values(porStatus).reduce((a, b) => a + b, 0);
    const pendentes = (porStatus.pendente||0) + (porStatus.liberado||0) + (porStatus.revisao||0);
    const andamento = (porStatus.aprovado||0) + (porStatus.andamento||0);
    const concluidos = porStatus.concluido || 0;
    const listaR = await query('SELECT id, nome, status FROM projetos_academicos WHERE tipo=$1 ORDER BY id DESC LIMIT 5', [perfil]);
    return {
      titulo: perfil === 'ensino' ? 'Projetos de Ensino' : 'Projetos de Extensão',
      link: '/' + perfil,
      cards: [
        { label: 'Total de Projetos', value: total, sub: 'cadastrados' },
        { label: 'Pendentes', value: pendentes, sub: 'aguardando aprovação' },
        { label: 'Em Andamento', value: andamento, sub: 'aprovados/em execução' },
        { label: 'Concluídos', value: concluidos, sub: 'finalizados' },
      ],
      listaTitulo: 'Projetos Recentes',
      itens: listaR.rows.map(r => ({ titulo: r.nome, sub: r.status }))
    };
  }
  if (perfil === 'cientifico') {
    const [projR, gruposR, aguardR, aprovR, listaR] = await Promise.all([
      query('SELECT COUNT(*) n FROM projetos_cientificos'),
      query('SELECT COUNT(*) n FROM grupos_cientificos'),
      query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status IN ('aguardando','em_revisao')"),
      query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status='aprovado'"),
      query('SELECT id, titulo FROM projetos_cientificos ORDER BY criado_em DESC LIMIT 5')
    ]);
    return {
      titulo: 'Portal Científico',
      link: '/cientifico',
      cards: [
        { label: 'Projetos Criados', value: projR.rows[0].n, sub: 'no total' },
        { label: 'Grupos', value: gruposR.rows[0].n, sub: 'formados' },
        { label: 'Aguardando Revisão', value: aguardR.rows[0].n, sub: 'trabalhos enviados' },
        { label: 'Aprovados', value: aprovR.rows[0].n, sub: 'trabalhos concluídos' },
      ],
      listaTitulo: 'Projetos Recentes',
      itens: listaR.rows.map(r => ({ titulo: r.titulo, sub: '' }))
    };
  }
  if (perfil === 'marketing') {
    const statusR = await query('SELECT status, COUNT(*) n FROM marketing_posts GROUP BY status');
    const porStatus = {};
    statusR.rows.forEach(r => { porStatus[r.status] = parseInt(r.n); });
    const total = Object.values(porStatus).reduce((a, b) => a + b, 0);
    const listaR = await query('SELECT id, titulo, status FROM marketing_posts ORDER BY criado_em DESC LIMIT 5');
    return {
      titulo: 'Marketing',
      link: '/marketing',
      cards: [
        { label: 'Total de Posts', value: total, sub: 'criados' },
        { label: 'Rascunhos', value: porStatus.rascunho||0, sub: 'não agendados' },
        { label: 'Agendados', value: porStatus.agendado||0, sub: 'aguardando publicação' },
        { label: 'Publicados', value: porStatus.publicado||0, sub: 'no ar' },
      ],
      listaTitulo: 'Posts Recentes',
      itens: listaR.rows.map(r => ({ titulo: r.titulo || '(sem título)', sub: r.status }))
    };
  }
  return null;
}

router.get('/dashboard', requireAuth, async (req, res) => {
  const config = await getConfig();
  const hoje = dayjs();
  const mes = hoje.format('YYYY-MM');
  const mesStr = '%-' + mes;
  const perfil = req.session.usuario.perfil;

  // Dados financeiros (inadimplencia, receita, pagamentos) so fazem sentido para quem
  // realmente acompanha as financas da Liga - os demais perfis veem o painel da propria area.
  const verFinanceiro = ['admin', 'presidencia', 'secretaria', 'financeiro'].includes(perfil);

  const consultas = [
    query("SELECT COUNT(*) n FROM membros WHERE ativo=1"),
    query("SELECT * FROM (SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'membro' as tipo FROM membros WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT nome, whatsapp, data_nascimento::text, TO_CHAR(data_nascimento::date,'MM-DD') as aniv, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t ORDER BY CASE WHEN aniv >= TO_CHAR(NOW() AT TIME ZONE 'America/Sao_Paulo','MM-DD') THEN 0 ELSE 1 END, aniv LIMIT 8")
  ];
  if (verFinanceiro) {
    consultas.push(
      query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pago' AND c.referencia LIKE $1 AND m.ativo=1", [mesStr]),
      query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pendente' AND c.referencia LIKE $1 AND m.ativo=1 AND c.data_vencimento::date >= CURRENT_DATE", [mesStr]),
      query("SELECT COUNT(*) n FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE (c.status='atrasado' OR (c.status='pendente' AND c.data_vencimento::date < CURRENT_DATE)) AND m.ativo=1"),
      query("SELECT COALESCE(SUM(COALESCE(valor_pago,valor_desconto)),0) v FROM cobrancas WHERE status='pago' AND referencia LIKE $1", [mesStr]),
      query("SELECT COALESCE(SUM(c.valor_cheio),0) v FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pendente' AND c.referencia LIKE $1 AND m.ativo=1 AND c.data_vencimento::date >= CURRENT_DATE", [mesStr]),
      query("SELECT COALESCE(SUM(c.valor_cheio),0) v FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE (c.status='atrasado' OR (c.status='pendente' AND c.data_vencimento::date < CURRENT_DATE)) AND m.ativo=1"),
      query("SELECT c.*, m.nome FROM cobrancas c JOIN membros m ON m.id=c.membro_id WHERE c.status='pago' ORDER BY c.data_pagamento DESC LIMIT 8")
    );
  } else {
    // Sem acesso financeiro: mostra os proximos eventos no lugar, se tiver permissao pra isso.
    const temEventos = perfil === 'admin' || (req.session.permissoesAtivas || []).includes('eventos');
    consultas.push(temEventos
      ? query("SELECT id, nome, data_inicio, local FROM eventos WHERE data_inicio >= NOW() ORDER BY data_inicio ASC LIMIT 5")
      : Promise.resolve({ rows: [] })
    );
  }

  const [resultados, areaEspecifica] = await Promise.all([
    Promise.all(consultas),
    verFinanceiro ? Promise.resolve(null) : montarAreaEspecifica(perfil)
  ]);
  const [total, aniversariantes] = resultados;

  let stats = { total: total.rows[0].n, pagos: 0, pendentes: 0, atrasados: 0, totalRecebido: 0, totalPendente: 0, totalAtrasado: 0 };
  let recentes = [], proximosEventos = [];
  if (verFinanceiro) {
    const [pagos, pendentes, atrasados, recTot, pendTot, atrTot, recentesR] = resultados.slice(2);
    stats = {
      total: total.rows[0].n, pagos: pagos.rows[0].n, pendentes: pendentes.rows[0].n,
      atrasados: atrasados.rows[0].n, totalRecebido: recTot.rows[0].v,
      totalPendente: pendTot.rows[0].v, totalAtrasado: atrTot.rows[0].v
    };
    recentes = recentesR.rows;
  } else if (!areaEspecifica) {
    proximosEventos = resultados[2].rows;
  }

  res.render('pages/dashboard', {
    config, usuario: req.session.usuario, stats, verFinanceiro, areaEspecifica,
    recentes, aniversariantes: aniversariantes.rows, proximosEventos,
    dayjs, msg: req.flash('msg'), erro: req.flash('erro')
  });
});

router.get('/api/pendentes', requireAuth, async (req, res) => {
  try {
    const [rD,rL] = await Promise.all([
      query('SELECT COUNT(*) n FROM diretivos WHERE pendente=true'),
      query('SELECT COUNT(*) n FROM ligantes WHERE pendente=true')
    ]);
    const nD=parseInt(rD.rows[0].n), nL=parseInt(rL.rows[0].n);
    const count0=nD+nL, itens=[];
    if(nD>0) itens.push({tipo:'diretivo',label:nD+' diretivo'+(nD>1?'s':'')+' aguardando aprovacao',url:'/diretivos?status=pendente'});
    if(nL>0) itens.push({tipo:'ligante',label:nL+' ligante'+(nL>1?'s':'')+' aguardando aprovacao',url:'/ligantes?status=pendente'});

    // Trabalhos cientificos aguardando revisao/decisao - so aparece para quem tem acesso
    // ao modulo (permissao cientifico, presidencia ou admin).
    // "Aguardando" (ninguem pegou ainda) conta para TODOS - e uma pendencia coletiva.
    // "Em revisao" so conta para quem esta revisando (revisor_atual_id) - uma vez que
    // alguem clica "Revisar", deixa de ser pendencia pros outros, pois ja esta sob controle.
    let count = count0;
    const perfil = req.session.usuario.perfil;
    let temAcessoCientifico = perfil==='presidencia' || perfil==='admin';
    if (!temAcessoCientifico) {
      const pr = await query("SELECT 1 FROM usuario_permissoes WHERE usuario_id=$1 AND modulo='cientifico'", [req.session.usuario.id]);
      temAcessoCientifico = pr.rows.length > 0;
    }
    if (temAcessoCientifico) {
      const [aR, rR] = await Promise.all([
        query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status='aguardando'"),
        query("SELECT COUNT(*) n FROM versoes_trabalho WHERE status='em_revisao' AND revisor_atual_id=$1", [req.session.usuario.id])
      ]);
      const nAguardando = parseInt(aR.rows[0].n), nComigo = parseInt(rR.rows[0].n);
      if (nAguardando > 0) {
        count += nAguardando;
        itens.push({tipo:'cientifico',label:nAguardando+' trabalho'+(nAguardando>1?'s':'')+' aguardando alguem assumir a correcao',url:'/cientifico/pendencias'});
      }
      if (nComigo > 0) {
        count += nComigo;
        itens.push({tipo:'cientifico',label:nComigo+' trabalho'+(nComigo>1?'s':'')+' que voce esta revisando',url:'/cientifico/pendencias'});
      }
    }
    res.json({count,itens});
  } catch(e){ res.json({count:0,itens:[]}); }
});


// ─── FIM INSTAGRAM OAUTH ──────────────────────────────────────────────────────
router.get("/api/pendencias", requireAuth, async (req, res) => {
  try {
    const r = await query("SELECT COUNT(*) as total FROM instagram_posts WHERE status='agendado'");
    const lig = await query("SELECT COUNT(*) as total FROM ligantes WHERE status='pendente'"); const dir = await query("SELECT COUNT(*) as total FROM diretivos WHERE status='pendente'"); const pal = await query("SELECT COUNT(*) as total FROM palestrantes WHERE status='pendente' OR ativo=0 LIMIT 1").catch(()=>({rows:[{total:0}]})); const l=parseInt(lig.rows[0].total)||0; const d=parseInt(dir.rows[0].total)||0; const p=parseInt(pal.rows[0].total)||0;
    const _perfil = req.session.usuario && req.session.usuario.perfil;
    const _isAdmin = _perfil === 'admin' || _perfil === 'presidencia';
    const atendR = await query("SELECT COUNT(*) as total FROM lauro_atendimentos WHERE status='aguardando'" + (_isAdmin?'':' AND area=$1'), _isAdmin?[]:[_perfil]).catch(()=>({rows:[{total:0}]}));
    const atend = parseInt(atendR.rows[0].total)||0;
    res.json({ ok:true, ligantes:l, diretivos:d, palestrantes:p, atendimentos:atend, total:l+d+p });
  } catch(e) { res.json({ ok: true, pendencias: 0 }); }
});

};
