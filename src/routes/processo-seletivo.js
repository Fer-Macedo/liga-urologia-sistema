// ═══ PROCESSO SELETIVO (PSS) ═════════════════════════════════════════════════
// Tudo do processo seletivo num lugar só: provas, questões, gabarito/OMR, candidatos,
// entrevistas, resultados, e as inscrições públicas (/pss/*) com pagamento.
// Regras de negócio (confirmar inscrição, e-mails): services/pss.js
const puppeteer = require('puppeteer');
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { upload, uploadArquivo } = require('../services/arquivos');
const { getUrlAssinada } = require('../services/desligamento');
const { enviarEmail } = require('../services/notificacoes');
const omr = require('../services/omr');
const {
  _pssProximoNumero, confirmarInscricaoPss, enviarEmailConfirmacaoPss,
  enviarLembretePss, enviarEmailBoasVindasPss,
  OCASIOES_PSS, listarCandidatosCheckin, buscarCandidatoCheckin, marcarPresencaPss
} = require('../services/pss');
const { calcularLiquidoPss } = require('../services/fluxo-pss');

// "Arrecadado (líq.)": soma o valor já líquido (taxa do PagBank descontada) de cada
// confirmado — o mesmo cálculo que vira lançamento real no fluxo de caixa (fluxo-pss.js).
// Isento (bruto=0) não precisa do método de pagamento: não teve pagamento, líquido é 0.
async function _arrecadadoLiquidoPss(inscritos) {
  const comValor = inscritos.filter(i => i.pagamento_status === 'confirmado' && (parseFloat(i.valor_pago) || 0) > 0);
  let metodosPorCandidato = {};
  if (comValor.length) {
    const pgR = await query("SELECT candidato_id, metodo FROM ps_pagamentos WHERE candidato_id = ANY($1::int[]) AND status='pago'", [comValor.map(i => i.id)]);
    pgR.rows.forEach(p => { metodosPorCandidato[p.candidato_id] = p.metodo; });
  }
  let arrecadado = 0;
  comValor.forEach(i => { arrecadado += calcularLiquidoPss(i.valor_pago, metodosPorCandidato[i.id]); });
  return arrecadado;
}

module.exports = function (router) {

  async function getPsData(req) {
    const [pR,qR,cR,prR] = await Promise.all([
      query('SELECT * FROM ps_processos ORDER BY criado_em DESC'),
      query("SELECT * FROM ps_questoes WHERE ativo=TRUE ORDER BY id"),
      query(`SELECT c.*, r.percentual, r.aprovado_prova, r.total_acertos, r.total_questoes,
              e.percentual_entrevista, e.resultado as resultado_entrevista
             FROM ps_candidatos c
             LEFT JOIN ps_respostas r ON r.candidato_id=c.id
             LEFT JOIN ps_entrevistas e ON e.candidato_id=c.id
             ORDER BY c.processo_id, c.numero_lista`),
      query(`SELECT pv.*, p.nome as processo_nome FROM ps_provas pv 
             JOIN ps_processos p ON p.id=pv.processo_id ORDER BY pv.criado_em DESC`)
    ]);
    const temas=[...new Set(qR.rows.map(q=>q.tema))];
    return {processos:pR.rows, questoes:qR.rows, temas, candidatos:cR.rows, provas:prR.rows};
  }
  router.get('/processo-seletivo', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const config=await getConfig();
      const msg=req.session.msg||[]; req.session.msg=[];
      const erro=req.session.erro||[]; req.session.erro=[];
      const data=await getPsData(req);
      res.render('pages/processo-seletivo', {config, msg, erro, usuario:req.session.usuario, ...data});
    } catch(e) { req.session.erro=[e.message]; res.redirect('/dashboard'); }
  });
  router.post('/processo-seletivo/criar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const {nome,semestre,data_prova,local_prova,vagas,nota_minima}=req.body;
      await query('INSERT INTO ps_processos (nome,semestre,data_prova,local_prova,vagas,nota_minima) VALUES ($1,$2,$3,$4,$5,$6)',
        [nome,semestre||null,data_prova||null,local_prova||null,parseInt(vagas)||10,parseFloat(nota_minima)||60]);
      req.session.msg=['Processo seletivo criado!'];
    } catch(e) { req.session.erro=[e.message]; }
    res.redirect('/processo-seletivo');
  });
  router.post('/processo-seletivo/:id/editar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const {nome,semestre,data_prova,local_prova,vagas,nota_minima}=req.body;
      await query('UPDATE ps_processos SET nome=$1,semestre=$2,data_prova=$3,local_prova=$4,vagas=$5,nota_minima=$6 WHERE id=$7',
        [nome,semestre||null,data_prova||null,local_prova||null,parseInt(vagas)||10,parseFloat(nota_minima)||60,req.params.id]);
      req.session.msg=['Processo atualizado!'];
    } catch(e) { req.session.erro=[e.message]; }
    res.redirect('/processo-seletivo');
  });
  router.post('/processo-seletivo/:id/deletar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try { await query('DELETE FROM ps_processos WHERE id=$1',[req.params.id]); req.session.msg=['Processo excluído!']; }
    catch(e) { req.session.erro=[e.message]; }
    res.redirect('/processo-seletivo');
  });
  router.post('/processo-seletivo/questao/criar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const {_id,tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade}=req.body;
      if(_id) {
        await query('UPDATE ps_questoes SET tema=$1,enunciado=$2,opcao_a=$3,opcao_b=$4,opcao_c=$5,opcao_d=$6,resposta_correta=$7,dificuldade=$8 WHERE id=$9',
          [tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade,_id]);
      } else {
        await query('INSERT INTO ps_questoes (tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade]);
      }
      req.session.msg=['Questão salva!'];
    } catch(e) { req.session.erro=[e.message]; }
    res.redirect('/processo-seletivo');
  });
  router.post('/processo-seletivo/questao/:id/editar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const {tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade}=req.body;
      await query('UPDATE ps_questoes SET tema=$1,enunciado=$2,opcao_a=$3,opcao_b=$4,opcao_c=$5,opcao_d=$6,resposta_correta=$7,dificuldade=$8 WHERE id=$9',
        [tema,enunciado,opcao_a,opcao_b,opcao_c,opcao_d,resposta_correta,dificuldade,req.params.id]);
      req.session.msg=['Questão atualizada!'];
    } catch(e) { req.session.erro=[e.message]; }
    res.redirect('/processo-seletivo');
  });
  router.post('/processo-seletivo/questao/:id/deletar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try { await query('UPDATE ps_questoes SET ativo=FALSE WHERE id=$1',[req.params.id]); req.session.msg=['Questão removida!']; }
    catch(e) { req.session.erro=[e.message]; }
    res.redirect('/processo-seletivo');
  });
  router.post('/processo-seletivo/candidato/criar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const {processo_id,nome,rg,email,telefone,curso,semestre_atual,numero_lista,fila_prova}=req.body;
      await query('INSERT INTO ps_candidatos (processo_id,nome,rg,email,telefone,curso,semestre_atual,numero_lista,fila_prova) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [processo_id,nome,rg||null,email||null,telefone||null,curso||null,semestre_atual||null,numero_lista||null,fila_prova||'A']);
      req.session.msg=['Candidato inscrito!'];
    } catch(e) { req.session.erro=[e.message]; }
    res.redirect('/processo-seletivo');
  });
  router.post('/processo-seletivo/candidato/:id/deletar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try { await query('DELETE FROM ps_candidatos WHERE id=$1',[req.params.id]); req.session.msg=['Candidato removido!']; }
    catch(e) { req.session.erro=[e.message]; }
    res.redirect('/processo-seletivo');
  });
  router.post('/processo-seletivo/candidato/:id/correcao', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const {respostas_json,total_questoes,total_acertos,percentual,prova_id}=req.body;
      const notaMin=(await query('SELECT nota_minima FROM ps_processos p JOIN ps_candidatos c ON c.processo_id=p.id WHERE c.id=$1',[req.params.id])).rows[0]?.nota_minima||60;
      const aprov=parseFloat(percentual)>=parseFloat(notaMin);
      let cartaoChave=req.body.cartao_chave||null;
      if(req.file){
        const {uploadArquivo}=require('../services/arquivos');
        const r=await uploadArquivo(req.file.buffer,'cartao-'+req.params.id+'.'+req.file.mimetype.split('/')[1],req.file.mimetype,'processo-seletivo');
        cartaoChave=r.chave;
      }
      const candR=await query('SELECT processo_id FROM ps_candidatos WHERE id=$1',[req.params.id]);
      await query('DELETE FROM ps_respostas WHERE candidato_id=$1',[req.params.id]);
      await query('INSERT INTO ps_respostas (candidato_id,processo_id,prova_id,respostas_json,total_questoes,total_acertos,percentual,aprovado_prova,cartao_chave,corrigido_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())',
        [req.params.id,candR.rows[0]?.processo_id,prova_id||null,respostas_json,total_questoes,total_acertos,percentual,aprov,cartaoChave]);
      await query("UPDATE ps_candidatos SET status=$1 WHERE id=$2",[aprov?'classificado':'reprovado',req.params.id]);
      res.json({ok:true,percentual,aprovado:aprov});
    } catch(e) { res.json({ok:false,erro:e.message}); }
  });
  router.post('/processo-seletivo/candidato/:id/entrevista', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const {respostas_json,pontuacao_total,pontuacao_maxima,percentual_entrevista,entrevistadores,observacoes}=req.body;
      const aprovEntrev=parseFloat(percentual_entrevista)>=60;
      const candR=await query('SELECT processo_id FROM ps_candidatos WHERE id=$1',[req.params.id]);
      await query('DELETE FROM ps_entrevistas WHERE candidato_id=$1',[req.params.id]);
      await query('INSERT INTO ps_entrevistas (candidato_id,processo_id,entrevistadores,respostas_json,pontuacao_total,pontuacao_maxima,percentual_entrevista,observacoes,resultado,realizada_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())',
        [req.params.id,candR.rows[0]?.processo_id,entrevistadores||null,JSON.stringify(respostas_json),pontuacao_total,pontuacao_maxima,percentual_entrevista,observacoes||null,aprovEntrev?'aprovado':'reprovado']);
      await query("UPDATE ps_candidatos SET status='entrevista' WHERE id=$1 AND status='classificado'",[req.params.id]);
      res.json({ok:true,percentual_entrevista,resultado:aprovEntrev?'aprovado':'reprovado'});
    } catch(e) { res.json({ok:false,erro:e.message}); }
  });
  // Habilitar candidato <60% para a entrevista, por exceção justificada (auditável)
  router.post('/processo-seletivo/candidato/:id/excecao', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const motivo = (req.body.motivo || '').trim();
      if (!motivo) return res.json({ ok: false, erro: 'Justificativa obrigatória.' });
      await query("UPDATE ps_candidatos SET habilitado_excecao=true, excecao_motivo=$1, excecao_por=$2, excecao_em=NOW() WHERE id=$3",
        [motivo, (req.session.usuario && req.session.usuario.nome) || null, req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
  });
  router.post('/processo-seletivo/candidato/:id/excecao/remover', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      await query("UPDATE ps_candidatos SET habilitado_excecao=false, excecao_motivo=NULL, excecao_por=NULL, excecao_em=NULL WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
  });
  router.get('/processo-seletivo/:id/gabarito/:fila', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const r=await query("SELECT id,gabarito_json FROM ps_provas WHERE processo_id=$1 AND fila=$2",[req.params.id,req.params.fila]);
      if(!r.rows.length) return res.json({gabarito:{},prova_id:null});
      const gab=r.rows[0].gabarito_json||{};
      res.json({gabarito:gab,prova_id:r.rows[0].id});
    } catch(e) { res.json({gabarito:{},erro:e.message}); }
  });
  // Pagina do scanner (correcao por camera) — mobile
  router.get('/processo-seletivo/:id/scanner', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const proc=(await query("SELECT * FROM ps_processos WHERE id=$1",[req.params.id])).rows[0];
      if(!proc){ req.session.erro=['Processo não encontrado']; return res.redirect('/processo-seletivo'); }
      const cands=(await query("SELECT c.id,c.nome,c.numero_lista,c.fila_prova,c.status, (r.id IS NOT NULL) as corrigido FROM ps_candidatos c LEFT JOIN ps_respostas r ON r.candidato_id=c.id WHERE c.processo_id=$1 ORDER BY c.numero_lista NULLS LAST, c.nome",[req.params.id])).rows;
      const config=await getConfig();
      res.render('pages/ps-scanner',{config,usuario:req.session.usuario,msg:req.session.msg||[],erro:req.session.erro||[],processo:proc,candidatos:cands});
      req.session.msg=[];req.session.erro=[];
    } catch(e){ req.session.erro=[e.message]; res.redirect('/processo-seletivo'); }
  });
  // Ler o cartao de um candidato por foto (IA de visao) — retorna as respostas lidas p/ revisao
  router.post('/processo-seletivo/candidato/:id/scan', requireAuth, requirePermissao('processo-seletivo'), require('../services/arquivos').upload.single('imagem'), async (req, res) => {
    try {
      if(!req.file) return res.json({ok:false,erro:'Nenhuma imagem recebida.'});
      const cand=(await query("SELECT c.*, p.nota_minima FROM ps_candidatos c JOIN ps_processos p ON p.id=c.processo_id WHERE c.id=$1",[req.params.id])).rows[0];
      if(!cand) return res.json({ok:false,erro:'Candidato não encontrado.'});
      const filaCand=(cand.fila_prova||'A').toString().trim().toUpperCase();
      // Provas/gabaritos deste processo por fila
      const provasR=await query("SELECT id,fila,gabarito_json FROM ps_provas WHERE processo_id=$1",[cand.processo_id]);
      if(!provasR.rows.length) return res.json({ok:false,erro:'Nenhuma prova montada neste processo. Monte a prova (por fila) primeiro.'});
      const porFila={}; provasR.rows.forEach(p=>{ porFila[String(p.fila).toUpperCase()]={id:p.id,gab:p.gabarito_json||{}}; });
      const provaRef=porFila[filaCand]||provasR.rows[0]&&{id:provasR.rows[0].id,gab:provasR.rows[0].gabarito_json||{}};
      // 1) LEITURA DETERMINISTICA (OMR): mede o preenchimento de cada bolha (sem IA)
      const omr=require('../services/omr');
      let leitura;
      try {
        const pvFull=(await query("SELECT * FROM ps_provas WHERE id=$1",[provaRef.id])).rows[0];
        const coords=await _cartaoCoords(pvFull);
        leitura=await omr.readCard(req.file.buffer, coords);
      } catch(e){ return res.json({ok:false,erro:'Não consegui ler o cartão: '+e.message}); }
      const filaLida=leitura.fila?String(leitura.fila).trim().toUpperCase():null;
      // 2) fila usada para corrigir = a lida (se existir prova) senao a do candidato
      const filaCorrecao=(filaLida && porFila[filaLida])?filaLida:filaCand;
      const prova=porFila[filaCorrecao]||provaRef;
      const gab=prova.gab; const totalQuestoes=Object.keys(gab).length;
      if(!totalQuestoes) return res.json({ok:false,erro:'Gabarito da fila '+filaCorrecao+' está vazio.'});
      const respostas=leitura.respostas||{};
      let acertos=0;
      for(let i=1;i<=totalQuestoes;i++){ const m=respostas[i]?String(respostas[i]).toUpperCase():null; if(m && gab[i] && m===String(gab[i]).toUpperCase()) acertos++; }
      const percentual=totalQuestoes? Math.round((acertos/totalQuestoes)*1000)/10 : 0;
      // 3) guarda a foto do cartao (para consulta/auditoria futura)
      let cartaoChave=null;
      try { const {uploadArquivo}=require('../services/arquivos');
        const up=await uploadArquivo(req.file.buffer,'cartao-'+req.params.id+'-'+Date.now()+'.'+((req.file.mimetype.split('/')[1])||'jpg'),req.file.mimetype,'processo-seletivo-cartoes');
        cartaoChave=up.chave;
      } catch(e){ console.error('[SCAN] upload foto cartao:', e.message); }
      res.json({ ok:true, prova_id:prova.id, fila:filaCorrecao, fila_candidato:filaCand, fila_lida:filaLida, total_questoes:totalQuestoes, gabarito:gab, respostas, acertos, percentual, nota_minima:parseFloat(cand.nota_minima)||60, numero_registro_lido:leitura.registro||null, incertas:leitura.incertas||[], cartao_chave:cartaoChave, candidato:{id:cand.id,nome:cand.nome,numero_lista:cand.numero_lista,fila:filaCand} });
    } catch(e){ res.json({ok:false,erro:e.message}); }
  });
  // Ler cartao e IDENTIFICAR o candidato automaticamente pelo numero de registro (nao precisa selecionar)
  router.post('/processo-seletivo/:id/scan', requireAuth, requirePermissao('processo-seletivo'), require('../services/arquivos').upload.single('imagem'), async (req, res) => {
    try {
      if(!req.file) return res.json({ok:false,erro:'Nenhuma imagem recebida.'});
      const procId=req.params.id;
      const proc=(await query("SELECT nota_minima FROM ps_processos WHERE id=$1",[procId])).rows[0];
      if(!proc) return res.json({ok:false,erro:'Processo não encontrado.'});
      const provasR=await query("SELECT id,fila,gabarito_json FROM ps_provas WHERE processo_id=$1",[procId]);
      if(!provasR.rows.length) return res.json({ok:false,erro:'Nenhuma prova montada neste processo.'});
      const porFila={}; provasR.rows.forEach(p=>{ porFila[String(p.fila).toUpperCase()]={id:p.id,gab:p.gabarito_json||{}}; });
      // LEITURA DETERMINISTICA (OMR): identifica pelo numero de registro medido no cartao
      const omr=require('../services/omr');
      let leitura;
      try {
        const pvFull=(await query("SELECT * FROM ps_provas WHERE processo_id=$1 LIMIT 1",[procId])).rows[0];
        const coords=await _cartaoCoords(pvFull);
        leitura=await omr.readCard(req.file.buffer, coords);
      } catch(e){ return res.json({ok:false,erro:'Não consegui ler o cartão: '+e.message}); }
      try { require('fs').writeFileSync('/tmp/last-scan.jpg', req.file.buffer); } catch(e){} // DEBUG temp
      console.log('[SCAN OMR] proc'+procId+' -> fila='+leitura.fila+' registro='+leitura.registro+' incertas='+(leitura.incertas||[]).length+' respostas='+JSON.stringify(leitura.respostas));
      const numReg=(leitura.registro && !leitura.registro.includes('?'))?leitura.registro.replace(/[^0-9]/g,''):null;
      const filaLida=leitura.fila?String(leitura.fila).trim().toUpperCase():null;
      // identifica o candidato pelo numero de registro == numero_lista
      let cand=null;
      if(numReg){
        const cr=await query("SELECT * FROM ps_candidatos WHERE processo_id=$1 AND (numero_lista::text=$2 OR numero_lista=$3) LIMIT 1",[procId,numReg,parseInt(numReg,10)||-1]);
        cand=cr.rows[0]||null;
      }
      const filaCorrecao=(filaLida&&porFila[filaLida])?filaLida:(cand&&cand.fila_prova?String(cand.fila_prova).toUpperCase():String(provasR.rows[0].fila).toUpperCase());
      const prova=porFila[filaCorrecao]||{id:provasR.rows[0].id,gab:provasR.rows[0].gabarito_json||{}};
      const gab=prova.gab; const totalQuestoes=Object.keys(gab).length;
      const respostas=leitura.respostas||{};
      let acertos=0; for(let i=1;i<=totalQuestoes;i++){ const m=respostas[i]?String(respostas[i]).toUpperCase():null; if(m&&gab[i]&&m===String(gab[i]).toUpperCase())acertos++; }
      const percentual=totalQuestoes?Math.round(acertos/totalQuestoes*1000)/10:0;
      let cartaoChave=null; try{ const {uploadArquivo}=require('../services/arquivos'); const up=await uploadArquivo(req.file.buffer,'cartao-proc'+procId+'-'+Date.now()+'.'+((req.file.mimetype.split('/')[1])||'jpg'),req.file.mimetype,'processo-seletivo-cartoes'); cartaoChave=up.chave; }catch(e){ console.error('[SCAN] foto:',e.message); }
      res.json({ ok:true, candidato: cand?{id:cand.id,nome:cand.nome,numero_lista:cand.numero_lista,fila:String(cand.fila_prova||'A').toUpperCase()}:null, numero_registro_lido:numReg, fila_lida:filaLida, fila:filaCorrecao, prova_id:prova.id, total_questoes:totalQuestoes, gabarito:gab, respostas, acertos, percentual, nota_minima:parseFloat(proc.nota_minima)||60, incertas:leitura.incertas||[], cartao_chave:cartaoChave });
    } catch(e){ res.json({ok:false,erro:e.message}); }
  });
  // Visualizar/baixar a foto do cartao arquivado de um candidato (consulta/auditoria)
  router.get('/processo-seletivo/candidato/:id/cartao', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const r=await query("SELECT cartao_chave FROM ps_respostas WHERE candidato_id=$1 AND cartao_chave IS NOT NULL ORDER BY corrigido_em DESC LIMIT 1",[req.params.id]);
      const chave=r.rows[0] && r.rows[0].cartao_chave;
      if(!chave) return res.status(404).send('Nenhum cartão arquivado para este candidato.');
      const { gerarUrlTemporaria }=require('../services/arquivos');
      const url=await gerarUrlTemporaria(chave,120);
      const axios=require('axios');
      const resp=await axios.get(url,{responseType:'stream',timeout:30000});
      res.setHeader('Content-Type',resp.headers['content-type']||'image/jpeg');
      res.setHeader('Content-Disposition',(req.query.download?'attachment':'inline')+'; filename="cartao-candidato-'+req.params.id+'.jpg"');
      res.setHeader('X-Frame-Options','SAMEORIGIN');
      resp.data.pipe(res);
    } catch(e){ res.status(500).send('Erro ao abrir cartão: '+e.message); }
  });
  router.get('/processo-seletivo/:id/resultados', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const r=await query(`SELECT c.*, r.percentual, r.aprovado_prova, r.total_acertos, r.total_questoes,
        e.percentual_entrevista, e.resultado as resultado_entrevista
        FROM ps_candidatos c
        LEFT JOIN ps_respostas r ON r.candidato_id=c.id
        LEFT JOIN ps_entrevistas e ON e.candidato_id=c.id
        WHERE c.processo_id=$1 ORDER BY r.percentual DESC NULLS LAST`,[req.params.id]);
      res.json({candidatos:r.rows});
    } catch(e) { res.json({candidatos:[],erro:e.message}); }
  });
  // Envia e-mail de boas-vindas aos aprovados na entrevista (selecionados)
  router.post('/processo-seletivo/boas-vindas', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      let ids = req.body.ids;
      if (typeof ids === 'string') ids = ids.split(',');
      ids = (ids || []).map(x => parseInt(x, 10)).filter(Boolean);
      if (!ids.length) return res.json({ ok: false, erro: 'Nenhum candidato selecionado.' });
      const r = await query(`SELECT c.id, c.nome, c.email, e.resultado AS resultado_entrevista
        FROM ps_candidatos c LEFT JOIN ps_entrevistas e ON e.candidato_id=c.id
        WHERE c.id = ANY($1::int[])`, [ids]);
      let enviados = 0; const falhas = [];
      for (const c of r.rows) {
        if (c.resultado_entrevista !== 'aprovado') { falhas.push(c.nome + ' (no aprobado en la entrevista)'); continue; }
        if (!c.email) { falhas.push(c.nome + ' (sin e-mail)'); continue; }
        const ok = await enviarEmailBoasVindasPss(c.id);
        if (ok) enviados++; else falhas.push(c.nome + ' (falha no envio)');
      }
      res.json({ ok: true, enviados, falhas });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
  });
  // Check-in de presença (aula magna, prova, entrevista) — QR enviado no e-mail de confirmação
  router.get('/processo-seletivo/:id/checkin', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const config = await getConfig();
      const msg = req.session.msg || []; req.session.msg = [];
      const [procR, candidatos] = await Promise.all([
        query('SELECT * FROM ps_processos WHERE id=$1', [req.params.id]),
        listarCandidatosCheckin(req.params.id)
      ]);
      if (!procR.rows[0]) { req.session.erro = ['Processo não encontrado.']; return res.redirect('/processo-seletivo'); }
      res.render('pages/processo-seletivo-checkin', {
        config, usuario: req.session.usuario, msg, erro: [],
        processo: procR.rows[0], candidatos, ocasioes: OCASIOES_PSS
      });
    } catch (e) { req.session.erro = ['Erro: ' + e.message]; res.redirect('/processo-seletivo'); }
  });
  router.post('/processo-seletivo/:id/checkin/buscar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const { busca, ocasiao } = req.body;
      if (!OCASIOES_PSS[ocasiao]) return res.json({ ok: false, msg: 'Ocasião inválida.' });
      const c = await buscarCandidatoCheckin(req.params.id, busca);
      if (!c) return res.json({ ok: false, msg: 'Candidato não encontrado.' });
      if (c.ocasioes_feitas.includes(ocasiao)) return res.json({ ok: false, msg: c.nome + ' já tem presença registrada em ' + OCASIOES_PSS[ocasiao] + '.' });
      await marcarPresencaPss(c.id, ocasiao, req.session.usuario.id);
      res.json({ ok: true, msg: 'Presença registrada: ' + c.nome + ' — ' + OCASIOES_PSS[ocasiao], nome: c.nome });
    } catch (e) { res.json({ ok: false, msg: 'Erro: ' + e.message }); }
  });
  router.post('/processo-seletivo/:id/checkin/:candidatoId', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      await marcarPresencaPss(req.params.candidatoId, req.body.ocasiao, req.session.usuario.id);
      req.session.msg = ['Presença registrada!'];
    } catch (e) { req.session.erro = ['Erro: ' + e.message]; }
    res.redirect('/processo-seletivo/' + req.params.id + '/checkin');
  });
  router.get('/processo-seletivo/:id/perguntas-entrevista', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const r=await query('SELECT * FROM ps_entrevista_perguntas WHERE (processo_id=$1 OR processo_id IS NULL) AND ativo=TRUE ORDER BY ordem',[req.params.id]);
      res.json({perguntas:r.rows});
    } catch(e) { res.json({perguntas:[]}); }
  });
  router.get('/processo-seletivo/perguntas-entrevista', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const r=await query('SELECT * FROM ps_entrevista_perguntas WHERE processo_id IS NULL AND ativo=TRUE ORDER BY ordem');
      res.json({perguntas:r.rows});
    } catch(e) { res.json({perguntas:[]}); }
  });
  router.post('/processo-seletivo/perguntas-entrevista/salvar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const {perguntas}=req.body;
      await query('UPDATE ps_entrevista_perguntas SET ativo=FALSE WHERE processo_id IS NULL');
      for(let i=0;i<perguntas.length;i++){
        const p=perguntas[i];
        if(p.id){await query('UPDATE ps_entrevista_perguntas SET pergunta=$1,descricao=$2,peso=$3,ordem=$4,ativo=TRUE WHERE id=$5',[p.pergunta,p.descricao||null,p.peso||1,i,p.id]);}
        else{await query('INSERT INTO ps_entrevista_perguntas (pergunta,descricao,peso,ordem) VALUES ($1,$2,$3,$4)',[p.pergunta,p.descricao||null,p.peso||1,i]);}
      }
      res.json({ok:true});
    } catch(e) { res.json({ok:false,erro:e.message}); }
  });
  router.get('/processo-seletivo/:id/prova/gerar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const config=await getConfig();
      const [pR,qR,prvR]=await Promise.all([
        query('SELECT * FROM ps_processos WHERE id=$1',[req.params.id]),
        query("SELECT * FROM ps_questoes WHERE ativo=TRUE ORDER BY id"),
        query('SELECT * FROM ps_provas WHERE processo_id=$1',[req.params.id])
      ]);
      const temas=[...new Set(qR.rows.map(q=>q.tema))];
      res.render('pages/montar-prova',{config,usuario:req.session.usuario,msg:req.session.msg||[],erro:req.session.erro||[],processo:pR.rows[0],questoes:qR.rows,temas,provas:prvR.rows});
      req.session.msg=[];req.session.erro=[];
    } catch(e) { req.session.erro=[e.message]; res.redirect('/processo-seletivo'); }
  });
  router.post('/processo-seletivo/:id/prova/salvar', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const {fila,questoes_ids}=req.body;
      const ids=Array.isArray(questoes_ids)?questoes_ids:[questoes_ids];
      const qR=await query(`SELECT * FROM ps_questoes WHERE id=ANY($1::int[])`,[ ids.map(Number)]);
      const qMap={};qR.rows.forEach(q=>{qMap[q.id]=q;});
      const gabarito={};
      ids.forEach((id,i)=>{const q=qMap[id];if(q)gabarito[i+1]=q.resposta_correta;});
      await query('INSERT INTO ps_provas (processo_id,fila,questoes_json,gabarito_json) VALUES ($1,$2,$3,$4) ON CONFLICT (processo_id,fila) DO UPDATE SET questoes_json=$3,gabarito_json=$4',
        [req.params.id,fila,JSON.stringify(ids.map(Number)),JSON.stringify(gabarito)]);
      req.session.msg=['Prova Fila '+fila+' salva com '+ids.length+' questões!'];
    } catch(e) { req.session.erro=[e.message]; }
    res.redirect('/processo-seletivo/'+req.params.id+'/prova/gerar');
  });
  router.get('/processo-seletivo/prova/:id/pdf', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const pvR=await query(`SELECT pv.*,p.nome as proc_nome,p.data_prova FROM ps_provas pv JOIN ps_processos p ON p.id=pv.processo_id WHERE pv.id=$1`,[req.params.id]);
      if(!pvR.rows.length) return res.status(404).send('Prova não encontrada');
      const pv=pvR.rows[0];
      const ids=pv.questoes_json||[];
      const qR=await query(`SELECT * FROM ps_questoes WHERE id=ANY($1::int[])`,[ ids]);
      const qMap={};qR.rows.forEach(q=>{qMap[q.id]=q;});
      // Agrupar por tema
      const temas={};
      ids.forEach((id,i)=>{
        const q=qMap[id];if(!q)return;
        if(!temas[q.tema])temas[q.tema]=[];
        temas[q.tema].push({num:i+1,...q});
      });
      let conteudo='';
      Object.entries(temas).forEach(([tema,qs])=>{
        conteudo+='<div class="tema-titulo">'+tema+':</div>';
        qs.forEach(q=>{
          conteudo+='<div class="questao"><p><span class="questao-num">'+q.num+')</span> '+q.enunciado+'</p>';
          conteudo+='<div class="opcoes">';
          ['A','B','C','D'].forEach(l=>{conteudo+='<div class="opcao">'+l+') '+q['opcao_'+l.toLowerCase()]+'</div>';});
          conteudo+='</div></div>';
        });
      });
      const data=pv.data_prova?new Date(pv.data_prova).toLocaleDateString('pt-BR'):'___/___/______';
      const html=require('fs').readFileSync(__dirname.replace('routes','').replace('src/','')+'views/pdf/prova-template.html','utf8')
        .replace(/\{\{TITULO\}\}/g,pv.proc_nome||'Proceso Seletivo')
        .replace(/\{\{FILA\}\}/g,pv.fila)
        .replace(/\{\{DATA\}\}/g,data)
        .replace('{{CONTEUDO}}',conteudo);
      const puppeteer=require('puppeteer-core');
      const chromium=require('@sparticuz/chromium');
      chromium.setHeadlessMode=true; chromium.setGraphicsMode=false;
      const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],executablePath:await chromium.executablePath(),headless:'new'});
      const page=await browser.newPage();
      await page.setContent(html,{waitUntil:'networkidle0'});
      // Cabecalho e rodape da arte (barras + titulo em cima, logos embaixo) repetindo em
      // TODAS as paginas via displayHeaderFooter; conteudo flui no meio (mesmo metodo do contrato).
      const _base=__dirname.replace('routes','').replace('src/','');
      const _hdr='data:image/jpeg;base64,'+require('fs').readFileSync(_base+'public/img/fundo-prova-header.jpg').toString('base64');
      const _ftr='data:image/jpeg;base64,'+require('fs').readFileSync(_base+'public/img/fundo-prova-footer.jpg').toString('base64');
      const headerTemplate='<div style="margin:0;padding:0;width:100%;-webkit-print-color-adjust:exact;"><img src="'+_hdr+'" style="width:100%;display:block;margin:0;padding:0;"></div>';
      const footerTemplate='<div style="margin:0;padding:0;width:100%;-webkit-print-color-adjust:exact;"><img src="'+_ftr+'" style="width:100%;display:block;margin:0;padding:0;"></div>';
      const pdf=await page.pdf({format:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate,footerTemplate,margin:{top:'30mm',bottom:'40mm',left:'0',right:'0'}});
      await browser.close();
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',(req.query.download?'attachment':'inline')+'; filename="prova-fila-'+pv.fila+'.pdf"');
      res.end(Buffer.from(pdf)); // page.pdf() retorna Uint8Array; sem Buffer.from o Express serializa como JSON e corrompe o PDF
    } catch(e) { res.status(500).send('Erro PDF prova: '+e.message); }
  });
  router.get('/processo-seletivo/prova/:id/gabarito', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const pvR=await query(`SELECT pv.*,p.nome as proc_nome,p.data_prova FROM ps_provas pv JOIN ps_processos p ON p.id=pv.processo_id WHERE pv.id=$1`,[req.params.id]);
      if(!pvR.rows.length) return res.status(404).send('Prova não encontrada');
      const pv=pvR.rows[0];
      const ids=pv.questoes_json||[];
      const qR=await query(`SELECT * FROM ps_questoes WHERE id=ANY($1::int[])`,[ ids]);
      const qMap={};qR.rows.forEach(q=>{qMap[q.id]=q;});
      // Agrupar por tema para o gabarito
      const temas={};
      ids.forEach((id,i)=>{
        const q=qMap[id];if(!q)return;
        if(!temas[q.tema])temas[q.tema]=[];
        temas[q.tema].push({num:i+1,...q});
      });
      let secoesGab='';
      Object.entries(temas).forEach(([tema,qs])=>{
        secoesGab+='<div class="gabarito-section"><div class="gabarito-section-title">'+tema+'</div>';
        secoesGab+='<div style="font-size:8pt;font-weight:700;display:flex;gap:4px;margin-bottom:4px;padding-left:22px"><span>A</span><span>B</span><span>C</span><span>D</span></div>';
        qs.forEach(q=>{
          const corr=(q.resposta_correta||'').toString().trim().toUpperCase();
          secoesGab+='<div class="bubble-row"><span class="bubble-label">'+q.num+'</span>';
          ['A','B','C','D'].forEach(l=>{secoesGab+='<div class="bubble'+(l===corr?' marcada':'')+'">'+l+'</div>';});
          secoesGab+='</div>';
        });
        secoesGab+='</div>';
      });
      const data=pv.data_prova?new Date(pv.data_prova).toLocaleDateString('pt-BR'):'___/___/______';
      const html=require('fs').readFileSync(__dirname.replace('routes','').replace('src/','')+'views/pdf/gabarito-template.html','utf8')
        .replace(/\{\{FILA\}\}/g,pv.fila)
        .replace(/\{\{DATA\}\}/g,data)
        .replace('{{SECOES_GABARITO}}',secoesGab);
      const puppeteer=require('puppeteer-core');
      const chromium=require('@sparticuz/chromium');
      chromium.setHeadlessMode=true; chromium.setGraphicsMode=false;
      const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],executablePath:await chromium.executablePath(),headless:'new'});
      const page=await browser.newPage();
      await page.setContent(html,{waitUntil:'networkidle0'});
      const pdf=await page.pdf({format:'A4',printBackground:true,margin:{top:'10mm',bottom:'10mm',left:'15mm',right:'15mm'}});
      await browser.close();
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',(req.query.download?'attachment':'inline')+'; filename="gabarito-fila-'+pv.fila+'.pdf"');
      res.end(Buffer.from(pdf)); // idem: Buffer.from p/ nao corromper o PDF
    } catch(e) { res.status(500).send('Erro PDF gabarito: '+e.message); }
  });
  // ─── CARTAO DE RESPOSTA (hoja de respuestas / OMR) ───────────────────────────
  // Monta o HTML do cartao (reusado pela impressao E pela leitura OMR deterministica).
  async function _cartaoHTML(pv) {
      const fila = (pv.fila||'A').toString().trim().toUpperCase();
      const data = pv.data_prova ? new Date(pv.data_prova).toLocaleDateString('pt-BR') : '____/____/________';
      const ids = pv.questoes_json||[];
      const qR = await query('SELECT * FROM ps_questoes WHERE id=ANY($1::int[])',[ids]);
      const qMap={}; qR.rows.forEach(q=>qMap[q.id]=q);
      const bub = (l,on,omr)=>'<span class="bub'+(on?' on':'')+'"'+(omr?' data-omr="'+omr+'"':'')+'>'+l+'</span>';
      const qRow = (n)=>'<div class="qrow"><span class="qn">'+n+'</span><span class="bubs">'+['A','B','C','D'].map(l=>bub(l,false,'q'+n+'-'+l)).join('')+'</span></div>';
      const nums = ids.map((id,i)=>qMap[id]?i+1:null).filter(Boolean);
      const half = Math.ceil(nums.length/2);
      const secHtml = nums.length ? '<div class="qcol">'+nums.slice(0,half).map(qRow).join('')+'</div><div class="qcol">'+nums.slice(half).map(qRow).join('')+'</div>' : '<div style="color:#999">Prova sem questões.</div>';
      const digCol = (col)=>'<div class="digcol">'+[0,1,2,3,4,5,6,7,8,9].map(d=>'<span class="bub sm" data-omr="reg'+col+'-'+d+'">'+d+'</span>').join('')+'</div>';
      const marks = Array.from({length:11}).map(()=>'<div class="sq"></div>').join('');
      const _base=__dirname.replace('routes','').replace('src/','');
      const _ftr='data:image/jpeg;base64,'+require('fs').readFileSync(_base+'public/img/cartao-footer.jpg').toString('base64');
      const linha = (w)=>'<span class="line" style="min-width:'+w+'mm"></span>';
      const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>'
        +'*{margin:0;padding:0;box-sizing:border-box;}'
        +'body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:10pt;position:relative;width:210mm;height:297mm;}'
        +'.wrap{padding:9mm 15mm 30mm;}'
        +'.marks{position:absolute;top:8mm;bottom:8mm;width:6mm;display:flex;flex-direction:column;justify-content:space-between;z-index:5;}'
        +'.marks.l{left:3mm;}.marks.r{right:3mm;}.sq{width:6mm;height:6mm;background:#000;}'
        +'.header{border:1.6px solid #000;padding:6px 10px;margin-bottom:8px;font-size:9pt;}'
        +'.hrow{display:flex;gap:16px;margin:3px 0;flex-wrap:wrap;align-items:flex-end;}'
        +'.fld{display:flex;align-items:flex-end;gap:4px;}.fld b{white-space:nowrap;}'
        +'.line{border-bottom:1px solid #000;display:inline-block;height:12px;}'
        +'.titulo{text-align:center;font-size:24pt;font-weight:900;letter-spacing:5px;margin:6px 0 12px;}'
        +'.metatop{display:flex;gap:16px;margin-bottom:12px;justify-content:center;align-items:flex-start;}'
        +'.mini{border:1.3px solid #000;padding:7px 10px;}'
        +'.mini-t{font-weight:800;font-size:9pt;text-transform:uppercase;margin-bottom:7px;text-align:center;}'
        +'.mini-b{display:flex;gap:14px;justify-content:center;}'
        +'.digrid{display:flex;gap:18px;justify-content:center;}.digcol{display:flex;flex-direction:column;gap:4px;align-items:center;}'
        +'.questoes{display:flex;gap:50px;justify-content:center;}.qcol{display:flex;flex-direction:column;gap:15px;}'
        +'.qrow{display:flex;align-items:center;}'
        +'.qn{width:30px;font-weight:700;text-align:right;margin-right:12px;font-size:12pt;flex-shrink:0;}'
        +'.bubs{display:flex;}'
        +'.bub{display:inline-flex;width:26px;height:26px;border:1.5px solid #000;border-radius:50%;align-items:center;justify-content:center;font-size:11pt;margin:0 9px;font-weight:600;}'
        +'.bub.sm{width:19px;height:19px;font-size:9pt;margin:0;}.bub.on{background:#000;color:#fff;}'
        +'.firma{text-align:center;margin-top:26mm;}.firma .l{border-top:1.3px solid #000;width:58%;margin:0 auto 5px;}'
        +'.firma .t{font-size:9.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;}'
        +'.footer{position:absolute;left:0;right:0;bottom:0;width:100%;}.footer img{width:100%;display:block;}'
        +'</style></head><body>'
        +'<div class="marks l">'+marks+'</div><div class="marks r">'+marks+'</div>'
        +'<div class="wrap">'
        +'<div class="header">'
        +'<div class="hrow"><div class="fld" style="flex:1"><b>ALUMNO(A):</b> '+linha(120)+'</div></div>'
        +'<div class="hrow"><div class="fld"><b>FECHA DE NASCIMENTO:</b> '+linha(30)+'</div><div class="fld"><b>CATRACA:</b> '+linha(22)+'</div><div class="fld"><b>RG:</b> '+linha(28)+'</div></div>'
        +'<div class="hrow"><div class="fld"><b>NÚMERO DE LISTA:</b> '+linha(20)+'</div><div class="fld"><b>MOTIVO:</b> Evaluación</div><div class="fld"><b>VALOR:</b> '+linha(18)+'</div></div>'
        +'<div class="hrow"><div class="fld"><b>PRUEBA FILA:</b> <span style="font-weight:900;font-size:12pt">'+fila+'</span></div><div class="fld"><b>FECHA:</b> '+data+'</div><div class="fld"><b>PUNTOS:</b> '+linha(18)+'</div></div>'
        +'</div>'
        +'<div class="titulo">GABARITO</div>'
        +'<div class="metatop">'
        +'<div class="mini"><div class="mini-t">Conjunto de examen</div><div class="mini-b">'+bub('A',fila==='A','conj-A')+bub('B',fila==='B','conj-B')+bub('C',fila==='C','conj-C')+'</div></div>'
        +'<div class="mini"><div class="mini-t">Número de Registro</div><div class="digrid">'+digCol(0)+digCol(1)+digCol(2)+'</div></div>'
        +'</div>'
        +'<div class="questoes">'+secHtml+'</div>'
        +'<div class="firma"><div class="l"></div><div class="t">Firma del Candidato (A)</div></div>'
        +'</div>'
        +'<div class="footer"><img src="'+_ftr+'"></div>'
        +'</body></html>';
      return { html, fila, data };
  }
  // Renderiza o cartao e extrai o MAPA DE COORDENADAS canonico (base do OMR). Layout e
  // identico p/ qualquer fila, entao serve p/ ler o cartao de qualquer prova do processo.
  async function _cartaoCoords(pv) {
    const { html } = await _cartaoHTML(pv);
    const puppeteer=require('puppeteer-core'); const chromium=require('@sparticuz/chromium');
    chromium.setHeadlessMode=true; chromium.setGraphicsMode=false;
    const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],executablePath:await chromium.executablePath(),headless:'new'});
    try {
      const page=await browser.newPage();
      await page.setViewport({width:794,height:1123,deviceScaleFactor:1});
      await page.setContent(html,{waitUntil:'networkidle0'});
      return await page.evaluate(()=>{
        const c=el=>{const r=el.getBoundingClientRect();return {x:Math.round((r.left+r.width/2)*100)/100,y:Math.round((r.top+r.height/2)*100)/100,r:Math.round(Math.min(r.width,r.height)/2*100)/100};};
        const bolhas={}; document.querySelectorAll('[data-omr]').forEach(el=>{bolhas[el.getAttribute('data-omr')]=c(el);});
        const marcadores=[...document.querySelectorAll('.sq')].map(c).map(m=>({x:m.x,y:m.y}));
        return { W:document.documentElement.scrollWidth, H:document.documentElement.scrollHeight, bolhas, marcadores };
      });
    } finally { await browser.close(); }
  }
  router.get('/processo-seletivo/prova/:id/cartao-resposta', requireAuth, requirePermissao('processo-seletivo'), async (req, res) => {
    try {
      const pvR = await query("SELECT pv.*,p.nome as proc_nome,p.data_prova FROM ps_provas pv JOIN ps_processos p ON p.id=pv.processo_id WHERE pv.id=$1",[req.params.id]);
      if(!pvR.rows.length) return res.status(404).send('Prova não encontrada');
      const pv = pvR.rows[0];
      const { html, fila } = await _cartaoHTML(pv);
      const puppeteer=require('puppeteer-core'); const chromium=require('@sparticuz/chromium');
      chromium.setHeadlessMode=true; chromium.setGraphicsMode=false;
      const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],executablePath:await chromium.executablePath(),headless:'new'});
      const page=await browser.newPage();
      await page.setViewport({width:794,height:1123,deviceScaleFactor:1}); // A4 @96dpi (canonico p/ OMR)
      await page.setContent(html,{waitUntil:'networkidle0'});
      // ?coords=1 -> devolve o MAPA DE COORDENADAS (centro de cada bolha + marcadores), base do OMR deterministico
      if(req.query.coords){
        const mapa=await page.evaluate(()=>{
          const c=el=>{const r=el.getBoundingClientRect();return {x:Math.round((r.left+r.width/2)*100)/100,y:Math.round((r.top+r.height/2)*100)/100,r:Math.round(Math.min(r.width,r.height)/2*100)/100};};
          const bolhas={}; document.querySelectorAll('[data-omr]').forEach(el=>{bolhas[el.getAttribute('data-omr')]=c(el);});
          const marcadores=[...document.querySelectorAll('.sq')].map(c).map(m=>({x:m.x,y:m.y}));
          return { W:document.documentElement.scrollWidth, H:document.documentElement.scrollHeight, bolhas, marcadores };
        });
        await browser.close();
        return res.json({ ok:true, fila, ...mapa });
      }
      if(req.query.png){ await page.setViewport({width:794,height:1123,deviceScaleFactor:2}); const shot=await page.screenshot({type:'png',clip:{x:0,y:0,width:794,height:1123}}); await browser.close(); res.setHeader('Content-Type','image/png'); return res.end(shot); }
      const pdf=await page.pdf({format:'A4',printBackground:true,margin:{top:'0',bottom:'0',left:'0',right:'0'}});
      await browser.close();
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',(req.query.download?'attachment':'inline')+'; filename="cartao-resposta-fila-'+fila+'.pdf"');
      res.end(Buffer.from(pdf));
    } catch(e) { res.status(500).send('Erro cartão-resposta: '+e.message); }
  });
  // ─────────────────────────────────────────────────────────────────────────────

  router.get('/pss/:id/inscricao', async (req, res) => {
    try {
      const p = (await query("SELECT * FROM ps_processos WHERE id=$1", [req.params.id])).rows[0];
      if (!p) return res.status(404).send('Processo não encontrado.');
      const config = await getConfig();
      res.render('pages/pss-inscricao-publica', { processo: p, config, sucesso: false, numero: null, erro: null, cupomUrl: req.query.cupom ? req.query.cupom.toUpperCase() : '' });
    } catch (e) { console.error('GET /pss/inscricao:', e.message); res.status(500).send('Erro ao carregar inscrição.'); }
  });
  router.post('/pss/:id/inscricao', async (req, res) => {
    const renderErro = async (msg) => { const p = (await query("SELECT * FROM ps_processos WHERE id=$1", [req.params.id])).rows[0]; const config = await getConfig(); return res.status(400).render('pages/pss-inscricao-publica', { processo: p, config, sucesso: false, numero: null, erro: msg, cupomUrl: (req.body.cupom_codigo || '').toUpperCase() }); };
    try {
      const p = (await query("SELECT * FROM ps_processos WHERE id=$1", [req.params.id])).rows[0];
      if (!p) return res.status(404).send('Processo não encontrado.');
      if (!p.inscricoes_abertas) return renderErro('As inscrições para este processo estão encerradas.');
      const nome = (req.body.nome || '').trim();
      const email = (req.body.email || '').trim().toLowerCase();
      const whatsappPais = (req.body.whatsapp_pais || '').trim();
      const whatsappNum = (req.body.whatsapp || '').trim();
      const whatsapp = whatsappNum ? (whatsappPais ? whatsappPais + ' ' + whatsappNum : whatsappNum) : '';
      const dataNascimento = (req.body.data_nascimento || '').trim();
      const catraca = (req.body.catraca || '').trim();
      const docTipo = (req.body.documento_tipo || 'CPF').trim().toUpperCase();
      const documento = (req.body.documento || '').replace(/\s+/g, '').trim();
      const semestre = parseInt(req.body.semestre_atual, 10) || null;
      const turma = (req.body.turma || '').trim().toUpperCase();
      if (!nome || !email || !whatsappNum || !dataNascimento || !catraca || !documento || !semestre || !turma)
        return renderErro('Todos los campos son obligatorios. / Preencha todos os campos.');
      if (p.edital_chave && req.body.aceite_edital !== 'on')
        return renderErro('Debe aceptar las Bases del Edital para continuar.');
      if (req.body.aceite_lgpd !== 'on')
        return renderErro('Debe aceptar la Política de Privacidad (LGPD) para continuar.');
      const dup = await query("SELECT id FROM ps_candidatos WHERE processo_id=$1 AND (LOWER(email)=$2 OR (documento IS NOT NULL AND documento=$3)) LIMIT 1", [p.id, email, documento]);
      if (dup.rows.length) return renderErro('Ya existe una inscripción con este documento o correo en este proceso. / Já existe uma inscrição com este documento ou e-mail neste processo.');
      const cupomCodigo = (req.body.cupom_codigo || '').toUpperCase().trim();
      let valorBase = parseFloat(p.valor_inscricao) || 0, valorFinal = valorBase, isento = false, cupomValido = null;
      if (cupomCodigo) {
        const cr = await query("SELECT * FROM ps_cupons WHERE processo_id=$1 AND UPPER(codigo)=$2 AND ativo=true", [p.id, cupomCodigo]);
        cupomValido = cr.rows[0];
        if (cupomValido && cupomValido.usos_atual < cupomValido.usos_max) {
          if (cupomValido.tipo === 'percentual') { if (parseFloat(cupomValido.valor) >= 100) { isento = true; valorFinal = 0; } else valorFinal = Math.max(0, Math.round(valorBase * (1 - parseFloat(cupomValido.valor) / 100) * 100) / 100); }
          else { valorFinal = Math.max(0, Math.round((valorBase - parseFloat(cupomValido.valor)) * 100) / 100); if (valorFinal === 0) isento = true; }
        } else { cupomValido = null; return renderErro('Cupom inválido ou esgotado.'); }
      }
      if (valorBase <= 0) isento = true;
      const cpfField = docTipo === 'CPF' ? documento : null;
      const ins = await query("INSERT INTO ps_candidatos (processo_id,nome,email,telefone,documento,documento_tipo,data_nascimento,catraca,turma,semestre_atual,rg,status,pagamento_status,cupom_codigo,isento,valor_pago,criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW()) RETURNING id",
        [p.id, nome, email, whatsapp || null, documento, docTipo, dataNascimento || null, catraca || null, turma || null, semestre, documento, isento ? 'confirmado' : 'pendente', isento ? 'confirmado' : 'pendente', cupomCodigo || null, isento, isento ? 0 : valorFinal]);
      const candId = ins.rows[0].id;
      if (cupomValido) await query("UPDATE ps_cupons SET usos_atual=usos_atual+1, usado_por_candidato_id=$1 WHERE id=$2", [candId, cupomValido.id]);
      if (isento) {
        await confirmarInscricaoPss(candId, {});
        const config = await getConfig();
        const numero = (await query("SELECT numero_lista FROM ps_candidatos WHERE id=$1", [candId])).rows[0].numero_lista;
        return res.render('pages/pss-inscricao-publica', { processo: p, config, sucesso: true, numero, erro: null, cupomUrl: '' });
      }
      const { criarPixPss } = require('../services/pagbank');
      const pixData = await criarPixPss({ candidato: { id: candId, nome, email, cpf: cpfField }, valor: valorFinal, processoNome: p.nome });
      await query("INSERT INTO ps_pagamentos (candidato_id,valor,metodo,status,pagbank_order_id,pix_copia_cola,pix_qr_image) VALUES ($1,$2,'pix','pendente',$3,$4,$5)",
        [candId, valorFinal, pixData && pixData.order_id || null, pixData && pixData.pix_copia_cola || null, pixData && pixData.pix_qr_image || null]);
      res.redirect('/pss/pagamento/' + candId);
    } catch (e) { console.error('POST /pss/inscricao:', e.message); res.status(500).send('Erro ao processar inscrição.'); }
  });
  // ── Página de pagamento (PIX) ──
  router.get('/pss/pagamento/:cid', async (req, res) => {
    try {
      const c = (await query("SELECT c.*, p.nome AS processo_nome FROM ps_candidatos c JOIN ps_processos p ON p.id=c.processo_id WHERE c.id=$1", [req.params.cid])).rows[0];
      if (!c) return res.status(404).send('Inscrição não encontrada.');
      const pg = (await query("SELECT * FROM ps_pagamentos WHERE candidato_id=$1 ORDER BY id DESC LIMIT 1", [c.id])).rows[0];
      const config = await getConfig();
      const pixData = pg ? { pix_copia_cola: pg.pix_copia_cola, pix_qr_image: pg.pix_qr_image, order_id: pg.pagbank_order_id, checkout_link: null } : null;
      res.render('pages/pss-pagamento', { config, candidato: c, processoNome: c.processo_nome, valor: c.valor_pago, pixData });
    } catch (e) { console.error('GET /pss/pagamento:', e.message); res.status(500).send('Erro ao carregar pagamento.'); }
  });
  router.get('/pss/pagamento/:cid/status', async (req, res) => {
    try { const c = (await query("SELECT pagamento_status, numero_lista FROM ps_candidatos WHERE id=$1", [req.params.cid])).rows[0]; res.json({ confirmado: c && c.pagamento_status === 'confirmado', numero: c ? c.numero_lista : null }); }
    catch (e) { res.json({ confirmado: false }); }
  });
  function _traduzirRecusaCartaoPss(msg) {
    const m = (msg || '').toLowerCase();
    if (m.includes('insufficient') || m.includes('saldo')) return 'Saldo insuficiente no cartão.';
    if (m.includes('expired') || m.includes('expir')) return 'Cartão expirado.';
    if (m.includes('security') || m.includes('cvv') || m.includes('cvc')) return 'CVV inválido.';
    if (m.includes('invalid') || m.includes('inválid')) return 'Dados do cartão inválidos.';
    if (m.includes('blocked') || m.includes('bloqueado')) return 'Cartão bloqueado. Contate seu banco.';
    if (m.includes('limit') || m.includes('limite')) return 'Limite do cartão excedido.';
    return 'Pagamento não aprovado. Verifique os dados ou tente outro cartão.';
  }
  // Pagamento via Cartão de Crédito — mesmo padrão de eventos.js (dados do cartão direto
  // pro PagBank, sem tokenização no navegador; a inscrição usa confirmarInscricaoPss pra
  // reaproveitar o mesmo e-mail/QR/número de lista que o PIX já usa)
  router.post('/pss/pagamento/:cid/cartao', async (req, res) => {
    try {
      const { num, nome, mes, ano, cvv, cpf } = req.body;
      const c = (await query("SELECT c.*, p.nome AS processo_nome FROM ps_candidatos c JOIN ps_processos p ON p.id=c.processo_id WHERE c.id=$1", [req.params.cid])).rows[0];
      if (!c) return res.json({ ok: false, erro: 'Inscrição não encontrada.' });
      if (c.pagamento_status === 'confirmado') return res.json({ ok: true, numero: c.numero_lista });

      const axios = require('axios');
      const isProd = (process.env.PAGBANK_ENV || 'sandbox') === 'production';
      const BASE_URL = isProd ? 'https://api.pagseguro.com' : 'https://sandbox.api.pagseguro.com';
      const TOKEN = process.env.PAGBANK_TOKEN;
      const valorCents = Math.round(parseFloat(c.valor_pago) * 100);
      const referencia = 'pss-cand-' + c.id;
      const cpfLimpo = (cpf || '').replace(/\D/g, '') || '12345678909';

      const { data } = await axios.post(
        BASE_URL + '/orders',
        {
          reference_id: referencia,
          customer: { name: c.nome, email: c.email || 'inscrito@ligaurologia.com.br', tax_id: cpfLimpo },
          items: [{ name: ('Inscrição — ' + c.processo_nome).substring(0, 100), quantity: 1, unit_amount: valorCents }],
          charges: [{
            reference_id: referencia,
            description: ('Inscrição — ' + c.processo_nome).substring(0, 64),
            amount: { value: valorCents, currency: 'BRL' },
            payment_method: {
              type: 'CREDIT_CARD', installments: 1, capture: true,
              card: { number: num, exp_month: String(mes).padStart(2, '0'), exp_year: String(ano), security_code: cvv, holder: { name: nome } }
            }
          }],
          notification_urls: [(process.env.APP_URL || 'https://sistema.lauroucpcde.com') + '/webhook/pagbank']
        },
        { headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, timeout: 20000 }
      );

      const charges = data.charges || [];
      const aprovado = charges.some(ch => ch.status === 'PAID' || ch.status === 'AUTHORIZED');
      if (aprovado) {
        await query("INSERT INTO ps_pagamentos (candidato_id,valor,metodo,status,pagbank_order_id) VALUES ($1,$2,'cartao','pendente',$3)", [c.id, c.valor_pago, data.id]);
        await confirmarInscricaoPss(c.id, { orderId: data.id, valorPago: parseFloat(c.valor_pago), metodo: 'cartao' });
        const numero = (await query("SELECT numero_lista FROM ps_candidatos WHERE id=$1", [c.id])).rows[0].numero_lista;
        return res.json({ ok: true, numero });
      }
      const motivoCharge = charges[0];
      const motivo = motivoCharge ? (motivoCharge.payment_response?.message || motivoCharge.status || 'Recusado') : 'Pagamento não aprovado';
      console.error('PagBank cartão PSS recusado:', motivo);
      res.json({ ok: false, erro: _traduzirRecusaCartaoPss(motivo) });
    } catch (e) {
      const detail = e.response ? JSON.stringify(e.response.data).substring(0, 300) : e.message;
      console.error('PagBank cartão PSS ERRO:', detail);
      res.json({ ok: false, erro: 'Erro ao processar cartão. Verifique os dados e tente novamente.' });
    }
  });
  // ── Admin: Inscrições PSS (Financeiro/Presidência) ──
  router.get('/inscricoes-pss', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try {
      const config = await getConfig();
      const procs = (await query(`SELECT p.*,
          (SELECT COUNT(*) FROM ps_candidatos c WHERE c.processo_id=p.id) AS total_inscritos,
          (SELECT COUNT(*) FROM ps_candidatos c WHERE c.processo_id=p.id AND c.pagamento_status='confirmado') AS confirmados
        FROM ps_processos p ORDER BY p.id DESC`)).rows;
      const selId = req.query.processo ? parseInt(req.query.processo, 10) : null;
      const vista = selId ? 'detalhe' : 'lista';
      let processo = null, inscritos = [], cupons = [], resumo = { total: 0, confirmados: 0, pendentes: 0, arrecadado: 0 };
      if (selId) {
        processo = procs.find(p => p.id === selId) || null;
        inscritos = (await query("SELECT * FROM ps_candidatos WHERE processo_id=$1 ORDER BY (pagamento_status='confirmado') DESC, numero_lista NULLS LAST, criado_em DESC", [selId])).rows;
        cupons = (await query("SELECT ec.*, c.nome AS usado_nome FROM ps_cupons ec LEFT JOIN ps_candidatos c ON c.id=ec.usado_por_candidato_id WHERE ec.processo_id=$1 ORDER BY ec.criado_em DESC", [selId])).rows;
        resumo.total = inscritos.length;
        inscritos.forEach(i => { if (i.pagamento_status === 'confirmado') resumo.confirmados++; else resumo.pendentes++; });
        resumo.arrecadado = await _arrecadadoLiquidoPss(inscritos);
      }
      res.render('pages/inscricoes-pss', { config, usuario: req.session.usuario, procs, vista, processo, inscritos, cupons, resumo, inscricaoBase: process.env.INSCRICAO_URL || 'https://inscricao.lauroucpcde.com', msg: req.session.msg || [], erro: req.session.erro || [] });
      req.session.msg = []; req.session.erro = [];
    } catch (e) { res.status(500).send('Erro: ' + e.message); }
  });
  router.post('/inscricoes-pss/processo/:id/config', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try {
      await query("UPDATE ps_processos SET valor_inscricao=$2, inscricoes_abertas=$3 WHERE id=$1", [req.params.id, parseFloat(req.body.valor_inscricao) || 0, req.body.inscricoes_abertas === 'on' || req.body.inscricoes_abertas === 'true']);
      req.session.msg = ['Configuração de inscrições salva.'];
    } catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss?processo=' + req.params.id);
  });
  // Servir o banner do processo (redirect p/ URL assinada — igual eventos). Duas rotas:
  // /inscricoes-pss/... p/ o admin (sistema.) e /pss/... p/ a pagina publica (inscricao. so libera /pss).
  async function _servirBannerProcesso(req, res) {
    try {
      const r = await query('SELECT banner_chave FROM ps_processos WHERE id=$1', [req.params.id]);
      if (!r.rows[0] || !r.rows[0].banner_chave) return res.status(404).send('');
      res.redirect(await getUrlAssinada(r.rows[0].banner_chave));
    } catch (e) { res.status(404).send(''); }
  }
  router.get('/inscricoes-pss/processo/:id/banner', _servirBannerProcesso);
  router.get('/pss/:id/banner', _servirBannerProcesso);
  // Edital (PDF) do processo — consulta pública
  async function _servirEditalProcesso(req, res) {
    try {
      const r = await query('SELECT edital_chave FROM ps_processos WHERE id=$1', [req.params.id]);
      if (!r.rows[0] || !r.rows[0].edital_chave) return res.status(404).send('Edital não disponível.');
      res.redirect(await getUrlAssinada(r.rows[0].edital_chave));
    } catch (e) { res.status(404).send('Edital não disponível.'); }
  }
  router.get('/inscricoes-pss/processo/:id/edital', _servirEditalProcesso);
  router.get('/pss/:id/edital', _servirEditalProcesso);
  // Criar processo (com banner + dados de inscrição) — igual eventos
  router.post('/inscricoes-pss/criar', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try {
      upload.fields([{ name: 'banner', maxCount: 1 }, { name: 'edital', maxCount: 1 }])(req, res, async () => {
        try {
          const b = req.body; let bannerChave = null, editalChave = null;
          const fBanner = req.files && req.files.banner && req.files.banner[0];
          const fEdital = req.files && req.files.edital && req.files.edital[0];
          if (fBanner) { const r = await uploadArquivo(fBanner.buffer, fBanner.originalname, fBanner.mimetype, 'processo-seletivo'); bannerChave = r.chave; }
          if (fEdital) { const r = await uploadArquivo(fEdital.buffer, fEdital.originalname, fEdital.mimetype, 'processo-seletivo-editais'); editalChave = r.chave; }
          const ins = await query("INSERT INTO ps_processos (nome,semestre,data_prova,local_prova,endereco,vagas,nota_minima,valor_inscricao,inscricoes_abertas,banner_chave,cor_tema,descricao,wpp_grupo,edital_chave) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id",
            [b.nome, b.semestre || null, b.data_prova || null, b.local_prova || null, b.endereco || null, parseInt(b.vagas) || null, parseFloat(b.nota_minima) || 60, parseFloat(b.valor_inscricao) || 0, b.inscricoes_abertas === 'on' || b.inscricoes_abertas === 'true', bannerChave, b.cor_tema || '#2b6803', b.descricao || null, b.wpp_grupo || null, editalChave]);
          req.session.msg = ['Processo criado!'];
          res.redirect('/inscricoes-pss?processo=' + ins.rows[0].id);
        } catch (e2) { req.session.erro = [e2.message]; res.redirect('/inscricoes-pss'); }
      });
    } catch (e) { req.session.erro = [e.message]; res.redirect('/inscricoes-pss'); }
  });
  // Editar dados públicos do processo (banner + campos)
  router.post('/inscricoes-pss/processo/:id/editar-dados', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try {
      upload.fields([{ name: 'banner', maxCount: 1 }, { name: 'edital', maxCount: 1 }])(req, res, async () => {
        try {
          const b = req.body; let bannerChave = null, editalChave = null;
          const fBanner = req.files && req.files.banner && req.files.banner[0];
          const fEdital = req.files && req.files.edital && req.files.edital[0];
          if (fBanner) { const r = await uploadArquivo(fBanner.buffer, fBanner.originalname, fBanner.mimetype, 'processo-seletivo'); bannerChave = r.chave; }
          if (fEdital) { const r = await uploadArquivo(fEdital.buffer, fEdital.originalname, fEdital.mimetype, 'processo-seletivo-editais'); editalChave = r.chave; }
          const params = [b.nome, b.semestre || null, b.data_prova || null, b.local_prova || null, b.cor_tema || '#2b6803', b.wpp_grupo || null, b.descricao || null];
          let setExtra = '';
          if (bannerChave) { params.push(bannerChave); setExtra += ', banner_chave=$' + params.length; }
          if (editalChave) { params.push(editalChave); setExtra += ', edital_chave=$' + params.length; }
          params.push(req.params.id);
          await query(`UPDATE ps_processos SET nome=$1,semestre=$2,data_prova=$3,local_prova=$4,cor_tema=$5,wpp_grupo=$6,descricao=$7${setExtra} WHERE id=$${params.length}`, params);
          req.session.msg = ['Processo atualizado!'];
          res.redirect('/inscricoes-pss?processo=' + req.params.id);
        } catch (e2) { req.session.erro = [e2.message]; res.redirect('/inscricoes-pss?processo=' + req.params.id); }
      });
    } catch (e) { req.session.erro = [e.message]; res.redirect('/inscricoes-pss'); }
  });
  // Ativar / desativar inscrições (abre/fecha)
  router.post('/inscricoes-pss/processo/:id/toggle', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try { await query("UPDATE ps_processos SET inscricoes_abertas = NOT COALESCE(inscricoes_abertas,false) WHERE id=$1", [req.params.id]); }
    catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss' + (req.body.voltar_detalhe ? ('?processo=' + req.params.id) : ''));
  });
  router.post('/inscricoes-pss/processo/:id/cupom', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try {
      const codigo = (req.body.codigo || '').toUpperCase().trim();
      if (codigo) await query("INSERT INTO ps_cupons (processo_id,codigo,tipo,valor,usos_max,ativo) VALUES ($1,$2,$3,$4,$5,true)", [req.params.id, codigo, req.body.tipo || 'percentual', parseFloat(req.body.valor) || 0, parseInt(req.body.usos_max, 10) || 1]);
      req.session.msg = ['Cupom criado.'];
    } catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss?processo=' + req.params.id);
  });
  router.post('/inscricoes-pss/cupom/:cid/deletar', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    const pid = req.body.processo_id;
    try { await query("DELETE FROM ps_cupons WHERE id=$1", [req.params.cid]); req.session.msg = ['Cupom removido.']; } catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss?processo=' + pid);
  });
  router.post('/inscricoes-pss/candidato/:cid/confirmar-manual', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try { await confirmarInscricaoPss(req.params.cid, { metodo: 'manual' }); req.session.msg = ['Inscrição confirmada manualmente.']; } catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss?processo=' + (req.body.processo_id || ''));
  });
  router.post('/inscricoes-pss/candidato/:cid/reenviar-email', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try { await enviarEmailConfirmacaoPss(req.params.cid); req.session.msg = ['E-mail reenviado.']; } catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss?processo=' + (req.body.processo_id || ''));
  });
  router.post('/inscricoes-pss/candidato/:cid/editar', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try {
      const b = req.body;
      const num = (b.numero_lista !== '' && b.numero_lista != null) ? (parseInt(b.numero_lista, 10) || null) : null;
      const sem = (b.semestre_atual !== '' && b.semestre_atual != null) ? (parseInt(b.semestre_atual, 10) || null) : null;
      const doc = (b.documento || '').trim() || null;
      await query("UPDATE ps_candidatos SET nome=$2,email=$3,telefone=$4,documento_tipo=$5,documento=$6,curso=$7,semestre_atual=$8,numero_lista=$9,fila_prova=$10 WHERE id=$1",
        [req.params.cid, (b.nome || '').trim(), (b.email || '').trim().toLowerCase(), b.telefone || null, b.documento_tipo || null, doc, b.curso || null, sem, num, (b.fila_prova || '').trim() || null]);
      req.session.msg = ['Inscrição atualizada.'];
    } catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss?processo=' + (req.body.processo_id || ''));
  });
  router.post('/inscricoes-pss/candidato/:cid/excluir', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try {
      await query("DELETE FROM ps_pagamentos WHERE candidato_id=$1", [req.params.cid]);
      await query("DELETE FROM ps_candidatos WHERE id=$1", [req.params.cid]);
      req.session.msg = ['Inscrição excluída.'];
    } catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss?processo=' + (req.body.processo_id || ''));
  });
  router.post('/inscricoes-pss/candidato/:cid/lembrete', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try { const ok = await enviarLembretePss(req.params.cid); req.session.msg = [ok ? 'Lembrete enviado.' : 'Candidato já confirmado ou sem e-mail.']; } catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss?processo=' + (req.body.processo_id || ''));
  });
  router.post('/inscricoes-pss/processo/:id/lembrete-pendentes', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try {
      const pend = (await query("SELECT id FROM ps_candidatos WHERE processo_id=$1 AND pagamento_status!='confirmado' AND email IS NOT NULL", [req.params.id])).rows;
      let n = 0; for (const c of pend) { if (await enviarLembretePss(c.id)) n++; }
      req.session.msg = [n + ' lembrete(s) enviado(s) aos pendentes.'];
    } catch (e) { req.session.erro = [e.message]; }
    res.redirect('/inscricoes-pss?processo=' + req.params.id);
  });
  router.get('/inscricoes-pss/relatorio', requireAuth, requirePermissao('inscricoes-pss'), async (req, res) => {
    try {
      const pid = parseInt(req.query.processo, 10);
      const processo = (await query("SELECT * FROM ps_processos WHERE id=$1", [pid])).rows[0];
      if (!processo) return res.status(404).send('Processo não encontrado.');
      let inscritos = (await query("SELECT * FROM ps_candidatos WHERE processo_id=$1 ORDER BY (pagamento_status='confirmado') DESC, numero_lista NULLS LAST, nome", [pid])).rows;
      const busca = (req.query.busca || '').toLowerCase().trim(), status = req.query.status || '';
      if (busca) inscritos = inscritos.filter(i => ((i.nome || '') + ' ' + (i.documento || '') + ' ' + (i.email || '')).toLowerCase().includes(busca));
      if (status) inscritos = inscritos.filter(i => i.pagamento_status === status);
      let confirmados = 0;
      inscritos.forEach(i => { if (i.pagamento_status === 'confirmado') confirmados++; });
      const arrecadado = await _arrecadadoLiquidoPss(inscritos);
      const config = await getConfig();
      res.render('pages/inscricoes-pss-relatorio', { config, processo, inscritos, arrecadado, confirmados, busca, status });
    } catch (e) { res.status(500).send('Erro: ' + e.message); }
  });

};
